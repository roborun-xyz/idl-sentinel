-- =====================================================
-- IDL Sentinel Database Schema
-- =====================================================
-- This script creates all necessary tables, indexes, and policies
-- Run this on a fresh Supabase project to set up the database
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- USERS TABLE
-- =====================================================
-- Stores authenticated users with wallet addresses
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL UNIQUE,
    is_admin BOOLEAN DEFAULT false,
    slack_webhook_url TEXT,
    discord_webhook_url TEXT,
    telegram_chat_id TEXT,
    telegram_username TEXT,
    preferred_explorer TEXT DEFAULT 'explorer.solana.com' CHECK (preferred_explorer IN ('explorer.solana.com', 'solscan.io')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_users_telegram_configured ON users(id)
    WHERE telegram_chat_id IS NOT NULL;

-- Comments
COMMENT ON TABLE users IS 'Authenticated users with wallet addresses';
COMMENT ON COLUMN users.is_admin IS 'Flag indicating if user has admin privileges';
COMMENT ON COLUMN users.slack_webhook_url IS 'User-specific Slack webhook URL for change notifications';
COMMENT ON COLUMN users.discord_webhook_url IS 'User-specific Discord webhook URL for change notifications';
COMMENT ON COLUMN users.telegram_chat_id IS 'User-specific Telegram chat ID for notifications';
COMMENT ON COLUMN users.telegram_username IS 'Telegram username for better UX';
COMMENT ON COLUMN users.preferred_explorer IS 'Preferred Solana explorer (explorer.solana.com or solscan.io)';

-- =====================================================
-- MONITORED PROGRAMS TABLE
-- =====================================================
-- Programs being monitored for IDL changes
CREATE TABLE IF NOT EXISTS monitored_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for monitored_programs table
CREATE INDEX IF NOT EXISTS idx_monitored_programs_active ON monitored_programs(is_active)
    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_monitored_programs_owner ON monitored_programs(owner_id);

-- Comments
COMMENT ON TABLE monitored_programs IS 'Solana programs being monitored for IDL changes';
COMMENT ON COLUMN monitored_programs.program_id IS 'Solana program public key address';

-- =====================================================
-- IDL SNAPSHOTS TABLE
-- =====================================================
-- Historical versions of IDL for each program
CREATE TABLE IF NOT EXISTS idl_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES monitored_programs(id) ON DELETE CASCADE,
    idl_hash TEXT NOT NULL,
    idl_content JSONB NOT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for idl_snapshots table
CREATE INDEX IF NOT EXISTS idx_idl_snapshots_program_fetched ON idl_snapshots(program_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_idl_snapshots_hash ON idl_snapshots(idl_hash);

-- Comments
COMMENT ON TABLE idl_snapshots IS 'Historical snapshots of program IDLs';
COMMENT ON COLUMN idl_snapshots.idl_hash IS 'SHA-256 hash of the IDL content for change detection';
COMMENT ON COLUMN idl_snapshots.idl_content IS 'Full IDL JSON content';

-- =====================================================
-- IDL CHANGES TABLE
-- =====================================================
-- Detected changes between IDL versions
CREATE TABLE IF NOT EXISTS idl_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES monitored_programs(id) ON DELETE CASCADE,
    old_snapshot_id UUID REFERENCES idl_snapshots(id) ON DELETE SET NULL,
    new_snapshot_id UUID NOT NULL REFERENCES idl_snapshots(id) ON DELETE CASCADE,
    change_type TEXT NOT NULL,
    change_summary TEXT NOT NULL,
    change_details JSONB NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    notified BOOLEAN DEFAULT false,
    notified_at TIMESTAMPTZ,
    slack_notified BOOLEAN DEFAULT false,
    slack_notified_at TIMESTAMPTZ,
    telegram_user_notified BOOLEAN DEFAULT false,
    telegram_user_notified_at TIMESTAMPTZ,
    discord_notified BOOLEAN NOT NULL DEFAULT false,
    discord_notified_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for idl_changes table
CREATE INDEX IF NOT EXISTS idx_idl_changes_detected ON idl_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_idl_changes_program ON idl_changes(program_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_idl_changes_unnotified ON idl_changes(notified)
    WHERE notified = false;
-- Composite indexes for efficient notification queries with ordering
CREATE INDEX IF NOT EXISTS idx_idl_changes_slack_unnotified ON idl_changes(slack_notified, detected_at DESC)
    WHERE slack_notified = false;
CREATE INDEX IF NOT EXISTS idx_idl_changes_telegram_user_unnotified ON idl_changes(telegram_user_notified, detected_at DESC)
    WHERE telegram_user_notified = false;
-- Legacy single-column indexes (kept for backward compatibility)
CREATE INDEX IF NOT EXISTS idx_idl_changes_slack_notified ON idl_changes(slack_notified)
    WHERE slack_notified = false;
CREATE INDEX IF NOT EXISTS idx_idl_changes_telegram_user_notified ON idl_changes(telegram_user_notified)
    WHERE telegram_user_notified = false;

-- Comments
COMMENT ON TABLE idl_changes IS 'Detected changes between IDL versions with severity classification';
COMMENT ON COLUMN idl_changes.severity IS 'Impact level: low, medium, high, or critical';
COMMENT ON COLUMN idl_changes.notified IS 'Legacy notification flag';
COMMENT ON COLUMN idl_changes.slack_notified IS 'Flag indicating if Slack notifications have been sent';
COMMENT ON COLUMN idl_changes.telegram_user_notified IS 'Flag indicating if Telegram notifications have been sent';
COMMENT ON COLUMN idl_changes.discord_notified IS 'Flag indicating if Discord notifications have been sent';

-- =====================================================
-- NOTIFICATION DELIVERIES TABLE
-- =====================================================
-- Per-user delivery receipts used to retry partial notification failures
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    change_id UUID NOT NULL REFERENCES idl_changes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('slack', 'telegram_user', 'discord')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(change_id, user_id, channel)
);

-- Indexes for notification_deliveries table
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_change ON notification_deliveries(change_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_channel ON notification_deliveries(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON notification_deliveries(channel, status, last_attempt_at)
    WHERE status <> 'delivered';

-- Comments
COMMENT ON TABLE notification_deliveries IS 'Per-user notification delivery receipts for retry-safe change notifications';
COMMENT ON COLUMN notification_deliveries.channel IS 'Notification channel: slack, telegram_user, or discord';
COMMENT ON COLUMN notification_deliveries.status IS 'Delivery status for this user/change/channel';

-- =====================================================
-- USER WATCHLIST TABLE
-- =====================================================
-- Programs that users are watching/subscribed to
CREATE TABLE IF NOT EXISTS user_watchlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES monitored_programs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, program_id)
);

-- Indexes for user_watchlist table
CREATE INDEX IF NOT EXISTS idx_user_watchlist_user ON user_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_program ON user_watchlist(program_id);

-- Comments
COMMENT ON TABLE user_watchlist IS 'Programs that users are watching for notifications';

-- =====================================================
-- PROGRAM ACTIVATION PAYMENTS TABLE
-- =====================================================
-- One-time USDC payments for self-serve program activation
CREATE TABLE IF NOT EXISTS program_activation_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payer_wallet TEXT NOT NULL,
    program_address TEXT NOT NULL,
    program_name TEXT NOT NULL,
    description TEXT,
    amount_usdc NUMERIC(12, 6) NOT NULL DEFAULT 5.000000,
    amount_atomic BIGINT NOT NULL DEFAULT 5000000,
    usdc_mint TEXT NOT NULL,
    treasury_token_account TEXT NOT NULL,
    payment_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'consumed', 'expired', 'failed')),
    payment_signature TEXT UNIQUE,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for program_activation_payments table
CREATE INDEX IF NOT EXISTS idx_program_activation_payments_user ON program_activation_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_activation_payments_program ON program_activation_payments(program_address);
CREATE INDEX IF NOT EXISTS idx_program_activation_payments_status ON program_activation_payments(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_program_activation_payments_signature ON program_activation_payments(payment_signature)
    WHERE payment_signature IS NOT NULL;

-- Comments
COMMENT ON TABLE program_activation_payments IS 'One-time USDC payment intents for self-serve monitored program activation';
COMMENT ON COLUMN program_activation_payments.payment_reference IS 'Random public key included in the payment memo instruction for transaction matching';
COMMENT ON COLUMN program_activation_payments.amount_atomic IS 'USDC amount in base units using 6 decimals';

-- =====================================================
-- TELEGRAM CONNECTION TOKENS TABLE
-- =====================================================
-- Temporary tokens for Telegram bot authentication
CREATE TABLE IF NOT EXISTS telegram_connection_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT false,
    used_at TIMESTAMPTZ
);

-- Indexes for telegram_connection_tokens table
CREATE INDEX IF NOT EXISTS idx_telegram_tokens_token ON telegram_connection_tokens(token)
    WHERE used = false;
CREATE INDEX IF NOT EXISTS idx_telegram_tokens_expires ON telegram_connection_tokens(expires_at)
    WHERE used = false;

-- Comments
COMMENT ON TABLE telegram_connection_tokens IS 'Temporary tokens for stateless Telegram bot authentication';

-- =====================================================
-- MONITORING LOGS TABLE
-- =====================================================
-- System logs for debugging and monitoring
CREATE TABLE IF NOT EXISTS monitoring_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL,
    program_id UUID REFERENCES monitored_programs(id) ON DELETE SET NULL,
    log_level TEXT NOT NULL CHECK (log_level IN ('info', 'warning', 'error')),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for monitoring_logs table
CREATE INDEX IF NOT EXISTS idx_monitoring_logs_run ON monitoring_logs(run_id, created_at);
-- Critical for getAllPrograms() last_checked_at lookup - prevents N+1 full table scans
CREATE INDEX IF NOT EXISTS idx_monitoring_logs_program_created ON monitoring_logs(program_id, created_at DESC);

-- Comments
COMMENT ON TABLE monitoring_logs IS 'System logs for debugging and monitoring cron jobs';

-- =====================================================
-- CRON LOCKS TABLE
-- =====================================================
-- Prevent overlapping scheduler runs
CREATE TABLE IF NOT EXISTS cron_locks (
    lock_name TEXT PRIMARY KEY,
    run_id UUID NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    acquired_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for cron_locks table
CREATE INDEX IF NOT EXISTS idx_cron_locks_locked_until ON cron_locks(locked_until);

-- Comments
COMMENT ON TABLE cron_locks IS 'Database-backed locks for singleton cron jobs';
COMMENT ON COLUMN cron_locks.locked_until IS 'Timestamp after which another run may steal the lock';

-- =====================================================
-- CUSTOM FUNCTIONS
-- =====================================================

-- Function to get all programs with their last check timestamp
-- Optimized to avoid N+1 queries by using lateral join
-- Supports pagination with limit and offset


-- Function to atomically acquire a cron lock if it is absent or expired
CREATE OR REPLACE FUNCTION try_acquire_cron_lock(
    p_lock_name TEXT,
    p_run_id UUID,
    p_locked_until TIMESTAMPTZ
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO cron_locks (lock_name, run_id, locked_until, acquired_at, updated_at)
    VALUES (p_lock_name, p_run_id, p_locked_until, NOW(), NOW())
    ON CONFLICT (lock_name) DO UPDATE
    SET
        run_id = EXCLUDED.run_id,
        locked_until = EXCLUDED.locked_until,
        acquired_at = NOW(),
        updated_at = NOW()
    WHERE cron_locks.locked_until <= NOW();

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to release a cron lock only if the caller still owns it
CREATE OR REPLACE FUNCTION release_cron_lock(
    p_lock_name TEXT,
    p_run_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM cron_locks
    WHERE lock_name = p_lock_name
    AND run_id = p_run_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get change statistics with aggregation
-- Optimized to avoid fetching all rows and counting in memory


-- =====================================================
-- TRIGGERS
-- =====================================================
-- Trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to monitored_programs
DROP TRIGGER IF EXISTS update_monitored_programs_updated_at ON monitored_programs;
CREATE TRIGGER update_monitored_programs_updated_at
    BEFORE UPDATE ON monitored_programs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to program_activation_payments
DROP TRIGGER IF EXISTS update_program_activation_payments_updated_at ON program_activation_payments;
CREATE TRIGGER update_program_activation_payments_updated_at
    BEFORE UPDATE ON program_activation_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to notification_deliveries
DROP TRIGGER IF EXISTS update_notification_deliveries_updated_at ON notification_deliveries;
CREATE TRIGGER update_notification_deliveries_updated_at
    BEFORE UPDATE ON notification_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to cron_locks
DROP TRIGGER IF EXISTS update_cron_locks_updated_at ON cron_locks;
CREATE TRIGGER update_cron_locks_updated_at
    BEFORE UPDATE ON cron_locks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Reliability upgrade (keep synchronized with upgrade_reliability.sql)
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

-- Discord webhooks are a third notification channel. Changes that predate the
-- column are marked delivered so a newly connected webhook is not flooded.
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'idl_changes' AND column_name = 'discord_notified') THEN
        ALTER TABLE idl_changes ADD COLUMN discord_notified BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE idl_changes ALTER COLUMN discord_notified SET DEFAULT false;
    END IF;
END;
$$;
ALTER TABLE idl_changes ADD COLUMN IF NOT EXISTS discord_notified_at TIMESTAMPTZ;
ALTER TABLE idl_changes ADD COLUMN IF NOT EXISTS discord_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_changes_discord_due ON idl_changes(discord_retry_at, detected_at, id) WHERE NOT discord_notified;
ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
    CHECK (channel IN ('slack', 'telegram_user', 'discord'));

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
