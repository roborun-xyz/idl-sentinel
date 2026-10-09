import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeChangeCount,
  formatDetectedAt,
  getProgramUrl,
  highestSeverity,
} from "../src/lib/notifications/format";
import type { NotificationChange } from "../src/lib/notifications/worker";

// The channel modules import the Supabase client, which validates its config at load time.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
const channels = () =>
  Promise.all([
    import("../src/lib/notifications/slack"),
    import("../src/lib/notifications/telegram-user"),
  ]);

const program = {
  id: "db-id-1",
  name: "Jupiter <v6> & Co",
  program_id: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
};

function change(
  overrides: Partial<NotificationChange> & { severity: NotificationChange["severity"] }
): NotificationChange {
  return {
    id: overrides.id ?? `change-${Math.random().toString(36).slice(2)}`,
    change_summary:
      overrides.change_summary ?? "Instruction 'swap' modified: accounts count changed",
    detected_at: overrides.detected_at ?? "2026-10-08T10:00:00.000Z",
    severity: overrides.severity,
    monitored_programs: program,
  };
}

test("program URLs come from NEXT_PUBLIC_APP_URL and tolerate trailing slashes", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://idl-sentinel.example.com/";
    assert.equal(getProgramUrl("abc"), "https://idl-sentinel.example.com/programs/abc");
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    assert.equal(getProgramUrl("abc"), null);
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(getProgramUrl("abc"), null);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});

test("change counts and timestamps describe the batch, not the send time", () => {
  const changes = [
    change({ severity: "low", detected_at: "2026-10-08T10:00:00.000Z" }),
    change({ severity: "critical", detected_at: "2026-10-08T11:30:45.000Z" }),
    change({ severity: "low", detected_at: "2026-10-08T09:00:00.000Z" }),
  ];
  assert.equal(highestSeverity(changes), "critical");
  assert.equal(describeChangeCount(changes), "3 changes (1 critical, 2 low)");
  assert.equal(describeChangeCount([changes[1]]), "1 critical change");
  assert.equal(formatDetectedAt(changes), "2026-10-08 11:30:45 UTC");
});

test("Slack messages link to the program, order groups by severity, and escape mrkdwn", async () => {
  const [{ formatSlackMessage }] = await channels();
  const url = "https://idl-sentinel.example.com/programs/db-id-1";
  const changes = [
    change({ severity: "low", change_summary: "New type 'A<B>' added" }),
    change({ severity: "critical", change_summary: "Instruction 'close' removed" }),
    change({ severity: "high" }),
  ];
  const message = formatSlackMessage(program.name, program.program_id, changes, url);
  const text = JSON.stringify(message.blocks);

  assert.ok(message.text.includes("3 changes (1 critical, 1 high, 1 low)"));
  assert.ok(text.includes(`<${url}|Jupiter &lt;v6&gt; &amp; Co>`));
  assert.ok(text.includes("New type 'A&lt;B&gt;' added"));
  assert.ok(text.indexOf("Critical (1)") < text.indexOf("High (1)"));
  assert.ok(text.indexOf("High (1)") < text.indexOf("Low (1)"));
  const actions = message.blocks?.find((block) => block.type === "actions") as
    | { elements: Array<{ url: string }> }
    | undefined;
  assert.equal(actions?.elements[0]?.url, url);
});

test("Slack messages without an app URL still render without links", async () => {
  const [{ formatSlackMessage }] = await channels();
  const message = formatSlackMessage(
    program.name,
    program.program_id,
    [change({ severity: "medium" })],
    null
  );
  assert.ok(!message.blocks?.some((block) => block.type === "actions"));
  assert.ok(JSON.stringify(message).includes("Jupiter &lt;v6&gt; &amp; Co"));
});

test("Telegram messages use HTML, escape user content, and stay under the API limit", async () => {
  const [, { formatTelegramMessage }] = await channels();
  const url = "https://idl-sentinel.example.com/programs/db-id-1";
  const changes = [
    change({ severity: "critical", change_summary: "Instruction 'a<b>' removed & gone" }),
    ...Array.from({ length: 7 }, (_, i) =>
      change({ severity: "low", change_summary: `New error code ${i} added: Err${i}` })
    ),
  ];
  const message = formatTelegramMessage(program.name, program.program_id, changes, url);

  assert.ok(message.startsWith("🔴 <b>IDL change detected</b>"));
  assert.ok(message.includes(`<a href="${url}">Jupiter &lt;v6&gt; &amp; Co</a>`));
  assert.ok(message.includes("Instruction 'a&lt;b&gt;' removed &amp; gone"));
  assert.ok(message.includes("… and 2 more"));
  assert.ok(message.includes("<b>Detected:</b> 2026-10-08 10:00:00 UTC"));
  assert.ok(!/\\[._\-!]/.test(message), "no stray Markdown escapes");
  assert.ok(message.length <= 4096);

  const huge = Array.from({ length: 60 }, (_, i) =>
    change({
      severity: (["critical", "high", "medium", "low"] as const)[i % 4],
      change_summary: "x".repeat(400),
    })
  );
  const trimmed = formatTelegramMessage(program.name, program.program_id, huge, url);
  assert.ok(trimmed.length <= 4096);
  assert.ok(trimmed.includes("omitted"));
});
