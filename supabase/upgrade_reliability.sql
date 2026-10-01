-- Apply before deploying the matching application release. Safe to run again.
-- This block is also included in schema.sql, the canonical schema.
BEGIN;

-- Snapshots represent transitions: A -> B -> A must have three versions.
ALTER TABLE idl_snapshots DROP CONSTRAINT IF EXISTS unique_program_hash;
CREATE INDEX IF NOT EXISTS idx_snapshots_latest_version
    ON idl_snapshots(program_id, version_number DESC, fetched_at DESC, id DESC);
ALTER TABLE monitored_programs ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_programs_poll_order
    ON monitored_programs(last_polled_at ASC NULLS FIRST, id) WHERE is_active;
ALTER TABLE idl_changes ADD COLUMN IF NOT EXISTS slack_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE idl_changes ADD COLUMN IF NOT EXISTS telegram_user_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_changes_slack_due ON idl_changes(slack_retry_at, detected_at, id) WHERE NOT slack_notified;
CREATE INDEX IF NOT EXISTS idx_changes_telegram_due ON idl_changes(telegram_user_retry_at, detected_at, id) WHERE NOT telegram_user_notified;

CREATE TABLE IF NOT EXISTS auth_nonces (
    wallet_address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expiry ON auth_nonces(expires_at);

-- Serialize all snapshot writers on the parent row. A stale comparison must
-- retry from a fresh snapshot; any change insertion failure rolls everything back.
CREATE OR REPLACE FUNCTION record_idl_transition(
    p_program_id UUID, p_expected_snapshot_id UUID, p_hash TEXT,
    p_content JSONB, p_changes JSONB, p_initial_only BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    previous idl_snapshots%ROWTYPE;
    inserted idl_snapshots%ROWTYPE;
BEGIN
    PERFORM 1 FROM monitored_programs WHERE id = p_program_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Program not found'; END IF;
    SELECT * INTO previous FROM idl_snapshots WHERE program_id = p_program_id
        ORDER BY version_number DESC, fetched_at DESC, id DESC LIMIT 1;
    IF previous.id IS NOT NULL AND (p_initial_only OR previous.idl_hash = p_hash) THEN
        RETURN jsonb_build_object('snapshot', to_jsonb(previous), 'created', false, 'changes_count', 0);
    END IF;
    IF previous.id IS DISTINCT FROM p_expected_snapshot_id THEN
        RAISE EXCEPTION 'Snapshot changed during comparison' USING ERRCODE = '40001';
    END IF;
    INSERT INTO idl_snapshots(program_id, idl_hash, idl_content, version_number)
        VALUES(p_program_id, p_hash, p_content, COALESCE(previous.version_number, 0) + 1)
        RETURNING * INTO inserted;
    INSERT INTO idl_changes(program_id, old_snapshot_id, new_snapshot_id,
        change_type, change_summary, change_details, severity)
        SELECT p_program_id, previous.id, inserted.id,
            change->>'changeType', change->>'changeSummary', change->'changeDetails', change->>'severity'
        FROM jsonb_array_elements(p_changes) AS change;
    RETURN jsonb_build_object('snapshot', to_jsonb(inserted), 'created', true,
        'changes_count', jsonb_array_length(p_changes));
END;
$$;

CREATE OR REPLACE FUNCTION consume_auth_nonce(p_wallet TEXT, p_nonce TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    DELETE FROM auth_nonces WHERE wallet_address = p_wallet AND nonce = p_nonce AND expires_at > NOW();
    RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS get_all_programs_with_last_check(INT, INT);
CREATE OR REPLACE FUNCTION get_all_programs_with_last_check(
    p_limit INT DEFAULT 50, p_offset INT DEFAULT 0,
    p_active_only BOOLEAN DEFAULT TRUE, p_search TEXT DEFAULT ''
) RETURNS TABLE(id UUID, program_id TEXT, name TEXT, description TEXT, owner_id UUID,
    is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, last_checked_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT mp.id, mp.program_id, mp.name, mp.description, mp.owner_id, mp.is_active,
        mp.created_at, mp.updated_at, ml.created_at
    FROM (
        SELECT * FROM monitored_programs p
        WHERE (NOT p_active_only OR p.is_active)
            AND (p_search = '' OR strpos(lower(p.name || ' ' || p.program_id || ' ' || COALESCE(p.description, '')), lower(p_search)) > 0)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)
    ) mp
    LEFT JOIN LATERAL (SELECT l.created_at FROM monitoring_logs l WHERE l.program_id = mp.id
        ORDER BY l.created_at DESC LIMIT 1) ml ON true
    ORDER BY mp.created_at DESC, mp.id DESC;
$$;

CREATE OR REPLACE FUNCTION count_programs(p_active_only BOOLEAN DEFAULT TRUE, p_search TEXT DEFAULT '')
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT count(*) FROM monitored_programs p WHERE (NOT p_active_only OR p.is_active)
        AND (p_search = '' OR strpos(lower(p.name || ' ' || p.program_id || ' ' || COALESCE(p.description, '')), lower(p_search)) > 0);
$$;

DROP FUNCTION IF EXISTS get_change_statistics();
CREATE OR REPLACE FUNCTION get_change_statistics(p_program_address TEXT DEFAULT NULL)
RETURNS TABLE(total_count BIGINT, severity_counts JSONB, type_counts JSONB, recent_24h_count BIGINT)
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH filtered AS MATERIALIZED (
        SELECT c.severity, c.change_type, c.detected_at FROM idl_changes c
        JOIN monitored_programs p ON p.id = c.program_id
        WHERE p_program_address IS NULL OR p.program_id = p_program_address
    )
    SELECT count(*),
        COALESCE((SELECT jsonb_object_agg(severity, n) FROM (SELECT severity, count(*) n FROM filtered GROUP BY severity) s), '{}'::jsonb),
        COALESCE((SELECT jsonb_object_agg(change_type, n) FROM (SELECT change_type, count(*) n FROM filtered GROUP BY change_type) t), '{}'::jsonb),
        count(*) FILTER (WHERE detected_at >= NOW() - INTERVAL '24 hours')
    FROM filtered;
$$;

CREATE OR REPLACE FUNCTION list_change_summaries(
    p_limit INT DEFAULT 50, p_before_time TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL,
    p_program_address TEXT DEFAULT NULL, p_severity TEXT DEFAULT NULL,
    p_search TEXT DEFAULT '', p_program_name TEXT DEFAULT NULL
) RETURNS TABLE(id UUID, program_id UUID, change_type TEXT, change_summary TEXT,
    severity TEXT, detected_at TIMESTAMPTZ, monitored_programs JSONB)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT c.id, c.program_id, c.change_type, c.change_summary, c.severity, c.detected_at,
        jsonb_build_object('name', p.name, 'program_id', p.program_id)
    FROM idl_changes c JOIN monitored_programs p ON p.id = c.program_id
    WHERE (p_before_time IS NULL OR (c.detected_at, c.id) < (p_before_time, p_before_id))
        AND (p_program_address IS NULL OR p.program_id = p_program_address)
        AND (p_program_name IS NULL OR p.name = p_program_name)
        AND (p_severity IS NULL OR c.severity = p_severity)
        AND (p_search = '' OR strpos(lower(c.change_summary || ' ' || c.change_type || ' ' || p.name || ' ' || p.program_id), lower(p_search)) > 0)
    ORDER BY c.detected_at DESC, c.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 101);
$$;

CREATE OR REPLACE FUNCTION get_dashboard_statistics()
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT jsonb_build_object(
        'totalPrograms', (SELECT count(*) FROM monitored_programs),
        'activePrograms', (SELECT count(*) FROM monitored_programs WHERE is_active),
        'totalChanges', (SELECT count(*) FROM idl_changes),
        'recentChanges', (SELECT count(*) FROM idl_changes WHERE detected_at >= NOW() - INTERVAL '24 hours'),
        'lastMonitoringRun', (SELECT max(created_at) FROM monitoring_logs WHERE program_id IS NULL)
    );
$$;

CREATE OR REPLACE FUNCTION record_notification_delivery(
    p_channel TEXT, p_user_id UUID, p_change_ids UUID[], p_status TEXT, p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    INSERT INTO notification_deliveries(change_id, user_id, channel, status, attempts,
        last_attempt_at, delivered_at, last_error)
    SELECT id, p_user_id, p_channel, p_status, 1, NOW(),
        CASE WHEN p_status = 'delivered' THEN NOW() END, p_error
    FROM unnest(p_change_ids) id
    ON CONFLICT(change_id, user_id, channel) DO UPDATE SET
        status = EXCLUDED.status,
        attempts = notification_deliveries.attempts + 1,
        last_attempt_at = NOW(), delivered_at = EXCLUDED.delivered_at,
        last_error = EXCLUDED.last_error
    WHERE notification_deliveries.status <> 'delivered';
END;
$$;

-- Polling progress is operational metadata, not a program configuration edit.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'monitored_programs'
        AND (to_jsonb(NEW) - 'last_polled_at') = (to_jsonb(OLD) - 'last_polled_at') THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Wallet JWTs are verified by Next.js; they are not Supabase Auth sessions.
-- Every application query goes through the server, so Data API roles need no
-- table privileges. Remove legacy policies as well as their grants.
DO $$
DECLARE t TEXT; policy RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'monitored_programs', 'idl_snapshots', 'idl_changes',
        'notification_deliveries', 'user_watchlist', 'program_activation_payments',
        'telegram_connection_tokens', 'monitoring_logs', 'cron_locks', 'auth_nonces']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        FOR policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', policy.policyname, t);
        END LOOP;
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
        EXECUTE format('CREATE POLICY service_access ON public.%I TO service_role USING (true) WITH CHECK (true)', t);
    END LOOP;
END;
$$;

-- RPCs are invoker functions, and only the server may execute them.
DO $$
DECLARE fn RECORD;
BEGIN
    FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        AND p.proname IN ('record_idl_transition', 'consume_auth_nonce', 'get_all_programs_with_last_check',
            'count_programs', 'get_change_statistics', 'get_dashboard_statistics', 'list_change_summaries',
            'record_notification_delivery', 'try_acquire_cron_lock', 'release_cron_lock')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END LOOP;
END;
$$;
COMMIT;
