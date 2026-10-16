import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const db = new PGlite({ extensions: { uuid_ossp } });
const upgrade = readFileSync("supabase/upgrade_reliability.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
before(async () => {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(schema);
});
after(() => db.close());
async function program() {
  const id = randomUUID();
  await db.query("INSERT INTO monitored_programs(id, program_id, name) VALUES($1, $2, $3)", [
    id,
    id,
    "Test",
  ]);
  return id;
}
async function transition(
  id: string,
  previous: string | null,
  hash: string,
  changes: unknown[] = [],
  initial = false
) {
  const { rows } = await db.query<{
    result: { snapshot: { id: string; version_number: number }; created: boolean };
  }>("SELECT record_idl_transition($1, $2, $3, $4, $5, $6) result", [
    id,
    previous,
    hash,
    JSON.stringify({ name: hash, instructions: [] }),
    JSON.stringify(changes),
    initial,
  ]);
  return rows[0].result;
}
const change = {
  changeType: "instruction_modified",
  changeSummary: "Changed",
  changeDetails: {},
  severity: "high",
};

test("upgrade stays in sync with canonical schema and is repeatable", async () => {
  assert.ok(schema.endsWith(upgrade));
  await db.exec(upgrade);
  await db.exec(upgrade);
});

test("discord upgrade backfills existing changes and accepts discord receipts", async () => {
  const legacy = new PGlite({ extensions: { uuid_ossp } });
  try {
    await legacy.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    // Simulate an installation that predates the Discord channel.
    const legacySchema = schema
      .replace("    discord_webhook_url TEXT,\n", "")
      .replace(
        "    discord_notified BOOLEAN NOT NULL DEFAULT false,\n    discord_notified_at TIMESTAMPTZ,\n",
        ""
      )
      .replace(
        "CHECK (channel IN ('slack', 'telegram_user', 'discord')),",
        "CHECK (channel IN ('slack', 'telegram_user')),"
      )
      .slice(0, schema.indexOf("-- Apply before deploying"))
      .split("\n")
      .filter((line) => !(line.startsWith("COMMENT ON") && line.includes("discord")))
      .join("\n");
    assert.ok(!legacySchema.includes("discord"));
    await legacy.exec(legacySchema);
    const id = randomUUID();
    await legacy.query("INSERT INTO monitored_programs(id, program_id, name) VALUES($1, $2, $3)", [
      id,
      id,
      "Legacy",
    ]);
    const snapshot = await legacy.query<{ id: string }>(
      "INSERT INTO idl_snapshots(program_id, idl_hash, idl_content, version_number) VALUES($1, 'A', '{}', 1) RETURNING id",
      [id]
    );
    const insertChange = (summary: string) =>
      legacy.query(
        "INSERT INTO idl_changes(program_id, new_snapshot_id, change_type, change_summary, change_details, severity) VALUES($1, $2, 'type_added', $3, '{}', 'low')",
        [id, snapshot.rows[0].id, summary]
      );
    await insertChange("old");
    await legacy.exec(upgrade);
    await legacy.exec(upgrade);
    await insertChange("new");
    const rows = await legacy.query<{ change_summary: string; discord_notified: boolean }>(
      "SELECT change_summary, discord_notified FROM idl_changes WHERE program_id = $1 ORDER BY change_summary DESC",
      [id]
    );
    assert.deepEqual(rows.rows, [
      { change_summary: "old", discord_notified: true },
      { change_summary: "new", discord_notified: false },
    ]);
    const user = await legacy.query<{ id: string }>(
      "INSERT INTO users(wallet_address, discord_webhook_url) VALUES('w', 'https://discord.com/api/webhooks/1/a') RETURNING id"
    );
    const change = await legacy.query<{ id: string }>(
      "SELECT id FROM idl_changes WHERE change_summary = 'new'"
    );
    await legacy.query(
      "SELECT record_notification_delivery('discord', $1, ARRAY[$2]::uuid[], 'delivered')",
      [user.rows[0].id, change.rows[0].id]
    );
    await assert.rejects(
      legacy.query(
        "SELECT record_notification_delivery('email', $1, ARRAY[$2]::uuid[], 'delivered')",
        [user.rows[0].id, change.rows[0].id]
      ),
      /violates check constraint/
    );
  } finally {
    await legacy.close();
  }
});

test("A -> B -> A and missing -> restored preserve every transition", async () => {
  const id = await program();
  let previous: string | null = null;
  for (const [index, hash] of ["A", "B", "A", "missing", "A"].entries()) {
    const result = await transition(id, previous, hash, index ? [change] : []);
    assert.equal(result.created, true);
    assert.equal(result.snapshot.version_number, index + 1);
    previous = result.snapshot.id;
  }
  const duplicate = await transition(id, previous, "A", [change]);
  assert.equal(duplicate.created, false);
  const result = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM idl_changes WHERE program_id = $1",
    [id]
  );
  assert.equal(result.rows[0].n, 4);
});

test("failed change insert rolls back snapshot, so retry succeeds", async () => {
  const id = await program();
  await assert.rejects(transition(id, null, "A", [{ ...change, severity: "invalid" }]));
  const result = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM idl_snapshots WHERE program_id = $1",
    [id]
  );
  assert.equal(result.rows[0].n, 0);
  assert.equal((await transition(id, null, "A", [change])).created, true);
});

test("stale writers cannot insert a diff against an obsolete snapshot", async () => {
  const id = await program();
  const a = await transition(id, null, "A");
  const results = await Promise.allSettled([
    transition(id, a.snapshot.id, "B", [change]),
    transition(id, a.snapshot.id, "C", [change]),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const initial = await transition(id, null, "D", [], true);
  assert.equal(initial.created, false);
  assert.equal(initial.snapshot.version_number, 2);
});

test("anonymous/authenticated roles cannot read secrets, create admins, or write system tables", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      for (const query of [
        "SELECT slack_webhook_url FROM users",
        "SELECT discord_webhook_url FROM users",
        "INSERT INTO users(wallet_address, is_admin) VALUES('attacker', true)",
        "DELETE FROM idl_snapshots",
        "DELETE FROM idl_changes",
        "DELETE FROM monitoring_logs",
        "SELECT consume_auth_nonce('wallet', 'nonce')",
        "SELECT get_dashboard_statistics()",
      ])
        await assert.rejects(db.exec(query), /permission denied/);
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  await db.exec("SET ROLE service_role");
  try {
    await db.exec("SELECT get_dashboard_statistics()");
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("nonce can be consumed exactly once across requests; expired/wrong nonces fail", async () => {
  await db.exec("INSERT INTO auth_nonces VALUES('wallet', 'nonce', NOW() + INTERVAL '5 minutes')");
  const consume = (nonce: string) =>
    db.query<{ ok: boolean }>("SELECT consume_auth_nonce('wallet', $1) ok", [nonce]);
  assert.equal((await consume("wrong")).rows[0].ok, false);
  const results = await Promise.all([consume("nonce"), consume("nonce")]);
  assert.deepEqual(results.map((r) => r.rows[0].ok).sort(), [false, true]);
  await db.exec("INSERT INTO auth_nonces VALUES('wallet', 'expired', NOW() - INTERVAL '1 second')");
  assert.equal((await consume("expired")).rows[0].ok, false);
});

test("aggregations include more than 1,000 changes and filter by program", async () => {
  const id = await program();
  const snapshot = await transition(id, null, "A");
  await db.query(
    `INSERT INTO idl_changes(program_id, new_snapshot_id, change_type, change_summary, change_details, severity)
    SELECT $1, $2, 'type_added', 'Test', '{}'::jsonb, 'low' FROM generate_series(1, 1205)`,
    [id, snapshot.snapshot.id]
  );
  const stats = await db.query<{ total_count: number; severity_counts: { low: number } }>(
    "SELECT * FROM get_change_statistics($1)",
    [id]
  );
  assert.equal(Number(stats.rows[0].total_count), 1205);
  assert.equal(stats.rows[0].severity_counts.low, 1205);
});

test("keyset pagination handles equal timestamps without returning full diff bodies", async () => {
  const id = await program();
  const snapshot = await transition(id, null, "A");
  await db.query(
    `INSERT INTO idl_changes(program_id, new_snapshot_id, change_type, change_summary, change_details, severity)
    SELECT $1, $2, 'type_added', 'Needle', '{"large":true}'::jsonb, 'low' FROM generate_series(1, 130)`,
    [id, snapshot.snapshot.id]
  );
  let cursorTime: string | null = null,
    cursorId: string | null = null;
  const seen = new Set<string>();
  while (true) {
    const { rows }: { rows: { id: string; cursor_time: string; change_details?: unknown }[] } =
      await db.query<{ id: string; cursor_time: string; change_details?: unknown }>(
        "SELECT *, detected_at::text cursor_time FROM list_change_summaries(25, $1, $2, $3, $4, $5)",
        [cursorTime, cursorId, id, "low", "Needle"]
      );
    if (!rows.length) break;
    for (const row of rows) {
      assert.ok(!seen.has(row.id));
      seen.add(row.id);
      assert.equal(row.change_details, undefined);
    }
    cursorId = rows.at(-1)!.id;
    cursorTime = rows.at(-1)!.cursor_time;
  }
  assert.equal(seen.size, 130);
});

test("delivery retries increment attempts and cannot downgrade a delivered receipt", async () => {
  const id = await program();
  await transition(id, null, "A", [change]);
  const userId = randomUUID();
  await db.query("INSERT INTO users(id, wallet_address) VALUES($1, $2)", [userId, userId]);
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM idl_changes WHERE program_id = $1",
    [id]
  );
  for (const status of ["failed", "failed", "delivered", "failed"]) {
    await db.query("SELECT record_notification_delivery('slack', $1, $2, $3)", [
      userId,
      [rows[0].id],
      status,
    ]);
  }
  const receipts = await db.query<{ attempts: number; status: string }>(
    "SELECT attempts, status FROM notification_deliveries WHERE user_id = $1",
    [userId]
  );
  assert.deepEqual(receipts.rows, [{ attempts: 3, status: "delivered" }]);
});

test("polling traverses a registry larger than the API row cap and preserves program edit times", async () => {
  await db.exec(`INSERT INTO monitored_programs(program_id, name, updated_at)
    SELECT 'registry-' || n, 'Registry ' || n, '2020-01-01'::timestamptz FROM generate_series(1, 1105) n`);
  const cutoff = new Date().toISOString();
  const seen = new Set<string>();
  while (true) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM monitored_programs
      WHERE is_active AND (last_polled_at IS NULL OR last_polled_at < $1)
      ORDER BY last_polled_at ASC NULLS FIRST, id LIMIT 100`,
      [cutoff]
    );
    if (!rows.length) break;
    rows.forEach((row) => {
      assert.ok(!seen.has(row.id));
      seen.add(row.id);
    });
    await db.query(
      "UPDATE monitored_programs SET last_polled_at = clock_timestamp() WHERE id = ANY($1)",
      [rows.map((r) => r.id)]
    );
  }
  assert.ok(seen.size >= 1105);
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM monitored_programs WHERE program_id LIKE 'registry-%' AND updated_at = '2020-01-01'::timestamptz"
  );
  assert.equal(rows[0].n, 1105);
});

async function chainTransition(
  id: string,
  expected: string | null,
  hash: string,
  changes: unknown[] = []
) {
  const { rows } = await db.query<{ result: { created: boolean; changes_count: number } }>(
    "SELECT record_chain_transition($1, $2, $3, $4, $5) result",
    [id, expected, hash, JSON.stringify({ deploySlot: hash }), JSON.stringify(changes)]
  );
  return rows[0].result;
}

test("chain transitions baseline, dedupe, refuse stale writers, and emit snapshot-less changes", async () => {
  const id = await program();
  assert.deepEqual(await chainTransition(id, null, "S1"), { created: true, changes_count: 0 });
  assert.deepEqual(await chainTransition(id, "S1", "S1"), { created: false, changes_count: 0 });
  // Same comparable hash still saves refreshed bookkeeping in the state body.
  await db.query("SELECT record_chain_transition($1, 'S1', 'S1', $2, '[]')", [
    id,
    JSON.stringify({ deploySlot: "S1", authorityProbedAt: "2026-10-16T00:00:00Z" }),
  ]);
  const saved = await db.query<{ probed: string }>(
    "SELECT state->>'authorityProbedAt' probed FROM program_chain_states WHERE program_id = $1",
    [id]
  );
  assert.equal(saved.rows[0].probed, "2026-10-16T00:00:00Z");
  const upgrade = {
    changeType: "program_upgraded",
    changeSummary: "Program 'Test' was upgraded at slot 2",
    changeDetails: { changeType: "program_upgraded", itemName: "Test", description: "x" },
    severity: "high",
  };
  const results = await Promise.allSettled([
    chainTransition(id, "S1", "S2", [upgrade]),
    chainTransition(id, "S1", "S3", [upgrade]),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason),
    /changed during comparison/
  );
  const rows = await db.query<{
    change_type: string;
    new_snapshot_id: string | null;
    slack_notified: boolean;
  }>("SELECT change_type, new_snapshot_id, slack_notified FROM idl_changes WHERE program_id = $1", [
    id,
  ]);
  assert.deepEqual(rows.rows, [
    { change_type: "program_upgraded", new_snapshot_id: null, slack_notified: false },
  ]);
  const listed = await db.query<{ change_type: string }>(
    "SELECT change_type FROM list_change_summaries(10, NULL, NULL, $1)",
    [id]
  );
  assert.deepEqual(listed.rows, [{ change_type: "program_upgraded" }]);
  await assert.rejects(chainTransition(randomUUID(), null, "S1"), /Program not found/);
});

test("watch targets are active programs in cursor order, and the cursor keeps edit times", async () => {
  const [a, b, c] = [await program(), await program(), await program()];
  await db.query("UPDATE monitored_programs SET is_active = false WHERE id = $1", [c]);
  // Other tests register more programs than one page holds; park them behind ours.
  await db.query(
    "UPDATE monitored_programs SET chain_checked_at = NOW() + INTERVAL '1 day' WHERE id <> ALL($1::uuid[])",
    [[a, b, c]]
  );
  await db.query("UPDATE monitored_programs SET chain_checked_at = NOW() WHERE id = $1", [a]);
  const before = await db.query<{ updated_at: string }>(
    "SELECT updated_at FROM monitored_programs WHERE id = $1",
    [a]
  );
  await chainTransition(a, null, "S1");
  const after = await db.query<{ updated_at: string; chain_checked_at: string }>(
    "SELECT updated_at, chain_checked_at FROM monitored_programs WHERE id = $1",
    [a]
  );
  assert.equal(String(after.rows[0].updated_at), String(before.rows[0].updated_at));
  const targets = await db.query<{ id: string; state_hash: string | null }>(
    "SELECT id, state_hash FROM list_chain_watch_targets(1000)"
  );
  const ids = targets.rows.map((r) => r.id);
  assert.ok(!ids.includes(c));
  assert.deepEqual(ids.slice(0, 2), [b, a], "never-checked programs come first");
  assert.equal(targets.rows.find((r) => r.id === a)?.state_hash, "S1");
});

test("webhook and pagerduty channels backfill old changes and accept receipts", async () => {
  const legacy = new PGlite({ extensions: { uuid_ossp } });
  try {
    await legacy.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    await legacy.exec(schema.slice(0, schema.indexOf("-- Apply before deploying")));
    const id = randomUUID();
    await legacy.query("INSERT INTO monitored_programs(id, program_id, name) VALUES($1, $2, 'L')", [
      id,
      id,
    ]);
    const snap = await legacy.query<{ id: string }>(
      "INSERT INTO idl_snapshots(program_id, idl_hash, idl_content) VALUES($1, 'A', '{}') RETURNING id",
      [id]
    );
    const insert = (summary: string) =>
      legacy.query(
        "INSERT INTO idl_changes(program_id, new_snapshot_id, change_type, change_summary, change_details, severity) VALUES($1, $2, 'type_added', $3, '{}', 'low')",
        [id, snap.rows[0].id, summary]
      );
    await insert("old");
    await legacy.exec(upgrade);
    await legacy.exec(upgrade);
    await insert("new");
    const rows = await legacy.query<{
      change_summary: string;
      webhook_notified: boolean;
      pagerduty_notified: boolean;
    }>(
      "SELECT change_summary, webhook_notified, pagerduty_notified FROM idl_changes ORDER BY change_summary DESC"
    );
    assert.deepEqual(rows.rows, [
      { change_summary: "old", webhook_notified: true, pagerduty_notified: true },
      { change_summary: "new", webhook_notified: false, pagerduty_notified: false },
    ]);
    const user = await legacy.query<{ id: string; pagerduty_min_severity: string }>(
      "INSERT INTO users(wallet_address) VALUES('w') RETURNING id, pagerduty_min_severity"
    );
    assert.equal(user.rows[0].pagerduty_min_severity, "high");
    const changeId = (
      await legacy.query<{ id: string }>("SELECT id FROM idl_changes WHERE change_summary = 'new'")
    ).rows[0].id;
    for (const channel of ["webhook", "pagerduty"]) {
      await legacy.query(
        "SELECT record_notification_delivery($1, $2, ARRAY[$3]::uuid[], 'delivered')",
        [channel, user.rows[0].id, changeId]
      );
    }
    await assert.rejects(
      legacy.query("UPDATE users SET pagerduty_min_severity = 'urgent'"),
      /violates check constraint/
    );
  } finally {
    await legacy.close();
  }
});

test("chain state and integration secrets stay private to the server role", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      for (const query of [
        "SELECT * FROM program_chain_states",
        "SELECT webhook_secret, pagerduty_routing_key FROM users",
        "SELECT * FROM list_chain_watch_targets(10)",
        `SELECT record_chain_transition('${randomUUID()}', NULL, 'x', '{}', '[]')`,
      ])
        await assert.rejects(db.exec(query), /permission denied/);
    } finally {
      await db.exec("RESET ROLE");
    }
  }
});
