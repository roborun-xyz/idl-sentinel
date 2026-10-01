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
