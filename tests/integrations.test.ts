import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NotificationChange } from "../src/lib/notifications/worker";
import {
  isPrivateAddress,
  resolvesPublicly,
  webhookUrlError,
} from "../src/lib/notifications/url-guard";
import { alertNoun, changeCategory, changeTypeLabel } from "../src/lib/changes/categories";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
const webhook = () => import("../src/lib/notifications/webhook");
const pagerduty = () => import("../src/lib/notifications/pagerduty");
const v1 = () => import("../src/lib/api/v1");
const ci = () => import("../scripts/idl-sentinel-check.mjs");

const program = {
  id: "db-1",
  name: "Kamino Lend",
  program_id: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
};
const change = (
  severity: NotificationChange["severity"],
  change_type: string,
  id = change_type
): NotificationChange => ({
  id,
  severity,
  change_type,
  change_summary: `${change_type} happened`,
  detected_at: "2026-10-16T00:00:00.000Z",
  monitored_programs: program,
});

test("SSRF guard rejects private, loopback, metadata, and non-HTTPS targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "0.0.0.0",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  assert.equal(webhookUrlError("https://hooks.example.com/x"), null);
  assert.match(webhookUrlError("http://hooks.example.com/x")!, /https/);
  assert.match(webhookUrlError("https://localhost/x")!, /publicly/);
  assert.match(webhookUrlError("https://169.254.169.254/latest")!, /publicly/);
  assert.match(webhookUrlError("https://[::1]/x")!, /publicly/);
  assert.match(webhookUrlError("https://user:pw@example.com")!, /credentials/);
  assert.match(webhookUrlError("not a url")!, /valid URL/);
});

test("webhook signatures verify, and tampering or replay fails", async () => {
  const { signWebhook, verifyWebhookSignature, generateWebhookSecret } = await webhook();
  const secret = generateWebhookSecret();
  assert.match(secret, /^whsec_[\w-]{32}$/);
  const now = Date.parse("2026-10-16T00:00:00Z");
  const timestamp = String(now / 1000);
  const body = JSON.stringify({ hello: "world" });
  const signature = signWebhook(secret, timestamp, body);
  assert.match(signature, /^v1=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature(secret, timestamp, body, signature, 300, now), true);
  assert.equal(verifyWebhookSignature(secret, timestamp, `${body} `, signature, 300, now), false);
  assert.equal(verifyWebhookSignature("whsec_other", timestamp, body, signature, 300, now), false);
  assert.equal(
    verifyWebhookSignature(secret, timestamp, body, signature, 300, now + 301_000),
    false
  );
});

test("webhook payloads carry type, category, and API links for each change", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://sentinel.example/";
  const { formatWebhookPayload } = await webhook();
  const payload = formatWebhookPayload([
    change("critical", "squads_proposal_approved"),
    change("low", "type_added"),
  ]);
  assert.equal(payload.type, "changes.detected");
  assert.deepEqual(payload.program, {
    id: "db-1",
    address: program.program_id,
    name: "Kamino Lend",
    url: "https://sentinel.example/programs/db-1",
  });
  assert.deepEqual(
    payload.changes.map((c) => [c.type, c.category, c.api_url]),
    [
      [
        "squads_proposal_approved",
        "governance",
        "https://sentinel.example/api/v1/changes/squads_proposal_approved",
      ],
      ["type_added", "idl", "https://sentinel.example/api/v1/changes/type_added"],
    ]
  );
});

test("PagerDuty events map severity, dedupe regardless of order, and respect thresholds", async () => {
  const { formatPagerDutyEvent, meetsSeverity, isPagerDutyRoutingKey } = await pagerduty();
  const changes = [
    change("high", "program_upgraded", "a"),
    change("critical", "upgrade_authority_changed", "b"),
  ];
  const event = formatPagerDutyEvent("R".repeat(32), changes);
  assert.equal(event.payload.severity, "critical");
  assert.match(
    event.payload.summary,
    /^Program change for Kamino Lend: upgrade_authority_changed happened \(\+1 more\)$/
  );
  assert.equal(event.payload.source, program.program_id);
  assert.equal(
    event.dedup_key,
    formatPagerDutyEvent("R".repeat(32), [...changes].reverse()).dedup_key
  );
  assert.equal(meetsSeverity("critical", "high"), true);
  assert.equal(meetsSeverity("medium", "high"), false);
  assert.equal(isPagerDutyRoutingKey("a".repeat(32)), true);
  assert.equal(isPagerDutyRoutingKey("a".repeat(31)), false);
});

test("change categories drive labels and alert headlines", async () => {
  assert.equal(changeCategory("instruction_removed"), "idl");
  assert.equal(changeCategory("program_upgraded"), "code");
  assert.equal(changeTypeLabel("squads_proposal_approved"), "Upgrade approved");
  assert.equal(changeTypeLabel("instruction_modified"), "Instruction modified");
  assert.equal(alertNoun(["type_added", undefined]), "IDL change");
  assert.equal(alertNoun(["type_added", "program_upgraded"]), "Program change");
  const { formatSlackMessage } = await import("../src/lib/notifications/slack");
  const message = formatSlackMessage(program.name, program.program_id, [
    change("high", "program_upgraded"),
  ]);
  assert.match(JSON.stringify(message.blocks?.[0]), /Program change: Kamino Lend/);
});

test("v1 change queries validate input and clamp limits", async () => {
  const { parseChangeQuery } = await v1();
  const parsed = parseChangeQuery(
    new URLSearchParams({
      limit: "999",
      min_severity: "high",
      category: "governance",
      since: "2026-10-01",
    })
  );
  assert.deepEqual(parsed, {
    limit: 200,
    minSeverity: "high",
    category: "governance",
    since: "2026-10-01T00:00:00.000Z",
  });
  assert.match(
    parseChangeQuery(new URLSearchParams({ min_severity: "urgent" })) as string,
    /min_severity/
  );
  assert.match(parseChangeQuery(new URLSearchParams({ category: "vibes" })) as string, /category/);
  const { encodeCursor } = await v1();
  const uuid = `${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`;
  const time = "2026-10-16T06:31:22.754123+00:00";
  const cursor = encodeCursor(time, uuid);
  // The cursor survives an unencoded query string and keeps microseconds intact.
  assert.match(cursor, /^[\w-]+$/);
  const ok = parseChangeQuery(new URLSearchParams(`cursor=${cursor}`));
  assert.deepEqual((ok as { cursor: unknown }).cursor, { time, id: uuid });
  for (const bad of [
    encodeCursor("2026-10-01T00:00:00Z", "not-a-uuid"),
    encodeCursor('x"),or(id.gt.0', uuid),
    "x),or(id.gt.0_aaaa",
  ]) {
    assert.match(parseChangeQuery(new URLSearchParams({ cursor: bad })) as string, /cursor/);
  }
  for (const raw of [
    "2026-10-16T06:31:22+00:00",
    "2026-10-16 06:31:22+00:00",
    "2026-10-16 06:31:22Z",
  ]) {
    const parsed = parseChangeQuery(new URLSearchParams(`since=${raw}`));
    assert.equal((parsed as { since: string }).since, "2026-10-16T06:31:22.000Z", raw);
  }
});

function fakeApi(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const body = routes[new URL(url).pathname];
    if (!body) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchImpl, calls };
}

const status = (overrides: Record<string, unknown> = {}) => ({
  program: { address: program.program_id, name: "Kamino Lend" },
  idl: { hash: "idl-1", version: 3, fetched_at: "2026-10-01T00:00:00Z" },
  chain: {
    deploy_slot: 1,
    code_hash: "c1",
    multisig: { pending_proposals: [] },
    verification: { status: "verified" },
  },
  ...overrides,
});

test("CI pin records current hashes; check fails on severe changes and warns on pending upgrades", async () => {
  const { pin, check, renderSummary } = await ci();
  const base = `/api/v1/programs/${program.program_id}`;
  const quiet = fakeApi({
    [base]: status(),
    [`${base}/changes`]: { changes: [], has_more: false, next_cursor: null },
  });
  const pinned = await pin({ api: "https://s.example/" }, [program.program_id], {
    fetchImpl: quiet.fetchImpl,
    now: new Date("2026-10-10T00:00:00Z"),
  });
  assert.deepEqual(pinned.programs[program.program_id], {
    name: "Kamino Lend",
    idl_hash: "idl-1",
    deploy_slot: 1,
    code_hash: "c1",
    pinned_at: "2026-10-10T00:00:00.000Z",
  });
  assert.equal((await check(pinned, { fetchImpl: quiet.fetchImpl })).failed, false);
  assert.ok(quiet.calls.some((url) => url.includes("since=2026-10-10T00%3A00%3A00.000Z")));

  const busy = fakeApi({
    [base]: status({
      chain: {
        deploy_slot: 2,
        multisig: {
          pending_proposals: [
            {
              index: 106,
              status: "approved",
              actions: ["upgrade"],
              executable_at: "2026-10-17T00:00:00Z",
            },
          ],
        },
        verification: { status: "mismatch" },
      },
    }),
    [`${base}/changes`]: {
      changes: [
        {
          type: "program_upgraded",
          severity: "high",
          summary: "Upgraded",
          detected_at: "2026-10-12T00:00:00Z",
        },
        {
          type: "type_added",
          severity: "low",
          summary: "Type added",
          detected_at: "2026-10-12T00:00:00Z",
        },
      ],
      has_more: false,
    },
  });
  const outcome = await check(pinned, { fetchImpl: busy.fetchImpl });
  assert.equal(outcome.failed, true);
  const [result] = outcome.results;
  assert.deepEqual(result.failures, ["[high] Upgraded (2026-10-12T00:00:00Z)"]);
  assert.match(
    result.warnings[0],
    /Approved Squads proposal #106 will upgrade this program and can execute/
  );
  assert.equal(
    (await check(pinned, { fetchImpl: busy.fetchImpl, failOn: "critical" })).failed,
    false
  );
  assert.equal(
    (await check(pinned, { fetchImpl: busy.fetchImpl, failOn: "critical", failOnPending: true }))
      .failed,
    true
  );
  assert.match(renderSummary(outcome), /❌ fail/);

  const missing = await check(
    { ...pinned, programs: { Unknown1111111111111111111111111111111111111: {} } },
    { fetchImpl: quiet.fetchImpl }
  );
  assert.match(missing.results[0].failures[0], /Not registered/);
});

test("CI script exits 2 without pins and documents usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idl-ci-"));
  const config = join(dir, "pins.json");
  await writeFile(config, JSON.stringify({ api: "https://s.example", programs: {} }));
  const run = promisify(execFile);
  await assert.rejects(
    run(process.execPath, ["scripts/idl-sentinel-check.mjs", "check", "--config", config]),
    (error: { code: number; stderr: string }) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /No programs pinned/);
      return true;
    }
  );
  assert.equal(JSON.parse(await readFile(config, "utf8")).api, "https://s.example");
});

test("webhook transport refuses private targets in every spelling, even after DNS", async () => {
  const { sendWebhook } = await webhook();
  const { postToPublicHttps, publicOnlyLookup } =
    await import("../src/lib/notifications/url-guard");
  // WHATWG URL rewrites mapped addresses to hex; both spellings must be caught.
  assert.equal(new URL("https://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");
  for (const address of [
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "0:0:0:0:0:ffff:0a00:0001",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("64:ff9b::808:808"), false);
  for (const address of [
    "2002:a9fe:a9fe::",
    "2002:7f00:1::1",
    "2001:0:4136:e378:8000:63bf:80ff:fffe",
    "64:ff9b:1::1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("2002:808:808::1"), false);
  // Only 192.0.0.0/24 is reserved; 192.0.78.0/24 hosts public services.
  assert.equal(isPrivateAddress("192.0.78.9"), false);
  assert.equal(isPrivateAddress("192.0.0.8"), true);
  assert.match(webhookUrlError("https://[::ffff:169.254.169.254]/latest")!, /publicly/);
  assert.equal(await resolvesPublicly("localhost"), false);
  // The socket lookup itself rejects a hostname that resolves privately.
  const lookupError = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
    publicOnlyLookup("localhost", {}, (error) => resolve(error))
  );
  assert.equal(lookupError?.code, "EADDRNOTPUBLIC");
  await assert.rejects(
    postToPublicHttps(new URL("https://127.0.0.1/x"), {}, "{}", 1000),
    /non-public/
  );
  await assert.rejects(
    postToPublicHttps(new URL("https://localhost:1/x"), {}, "{}", 1000),
    /non-public/
  );
  const payload = {
    type: "test" as const,
    version: 1 as const,
    sent_at: "",
    program: null,
    changes: [],
  };
  assert.equal(await sendWebhook("https://[::ffff:7f00:1]/hook", "whsec_x", payload), false);
  assert.equal(await sendWebhook("http://example.com/hook", "whsec_x", payload), false);
});
