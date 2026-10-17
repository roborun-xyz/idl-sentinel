import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChainState, TrackedProposal } from "../src/lib/chain/state";
import {
  assessRisk,
  needsAttention,
  riskBadges,
  summarizeChain,
  type ChainSummary,
} from "../src/lib/chain/risk";
import { groupChanges, severityCounts } from "../src/lib/changes/grouping";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const SECONDS = NOW / 1000;
const CODE_HASH = "a".repeat(64);

function proposal(overrides: Partial<TrackedProposal>): TrackedProposal {
  return {
    index: 1,
    status: "active",
    statusAt: null,
    approvals: 1,
    actions: ["upgrade"],
    newAuthority: null,
    buffer: null,
    executableAt: null,
    ...overrides,
  };
}

function state(overrides: Partial<ChainState> = {}, proposals: TrackedProposal[] = []): ChainState {
  return {
    version: 1,
    loader: "upgradeable",
    status: "deployed",
    programDataAddress: "Data111111111111111111111111111111111111111",
    deploySlot: 1,
    deployedAt: SECONDS - 86_400,
    upgradeAuthority: "Auth111111111111111111111111111111111111111",
    authorityKind: "squads_v4",
    authorityProbedAt: null,
    codeHash: CODE_HASH,
    codeHashSlot: 1,
    squads: {
      multisig: "Msig111111111111111111111111111111111111111",
      vaultIndex: 0,
      threshold: 4,
      timeLock: 86_400,
      members: Array.from({ length: 9 }, (_, i) => `M${i}`),
      configAuthority: null,
      transactionIndex: 10,
      staleTransactionIndex: 0,
      scannedIndex: 10,
      proposals,
    },
    verification: null,
    ...overrides,
  };
}

const summary = (s: ChainState): ChainSummary => summarizeChain(s, "2026-10-16T11:59:00Z");

test("approved proposals past their timelock lead the verdict", () => {
  const s = summary(
    state({}, [
      proposal({ index: 1026, status: "approved", approvals: 4, executableAt: SECONDS - 60 }),
      proposal({ index: 1022, status: "approved", approvals: 4, executableAt: SECONDS - 3600 }),
      proposal({ index: 1030, status: "executed" }),
    ])
  );
  assert.equal(s.openProposals.length, 2, "executed proposals are not open");
  const risk = assessRisk(s, NOW);
  assert.equal(risk.tone, "danger");
  assert.equal(risk.headline, "2 approved upgrades can execute now");
  assert.match(risk.findings[0].detail!, /#1026, #1022/);
  // The multisig is still reported, below the urgent finding.
  assert.ok(risk.findings.some((f) => f.title === "Upgrades need 4 of 9 multisig approvals"));
  assert.deepEqual(
    riskBadges(s, NOW).map((b) => b.label),
    ["Multisig 4/9", "2 executable"]
  );
  assert.equal(needsAttention(s, NOW), true);
});

test("timelocked and unknown-time approvals are never called executable", () => {
  const s = summary(
    state({}, [
      proposal({ index: 5, status: "approved", executableAt: SECONDS + 3600 }),
      proposal({ index: 6, status: "approved", executableAt: null }),
    ])
  );
  const risk = assessRisk(s, NOW);
  assert.equal(risk.tone, "warning");
  assert.equal(risk.headline, "2 approved upgrades in timelock");
  assert.match(risk.findings[0].detail!, /2026-10-16 13:00 UTC/);
  assert.deepEqual(
    riskBadges(s, NOW).map((b) => b.label),
    ["Multisig 4/9", "2 in timelock"]
  );
  // The same proposal becomes executable once the clock passes its unlock time.
  assert.equal(
    assessRisk(s, NOW + 2 * 3600_000).findings[0].title,
    "1 approved upgrade can execute now"
  );
});

test("proposal nouns follow the actions they carry", () => {
  const s = summary(state({}, [proposal({ index: 7, actions: ["set_authority"] })]));
  assert.equal(assessRisk(s, NOW).headline, "1 proposed authority change awaiting votes");
  const mixed = summary(
    state({}, [
      proposal({ index: 7, actions: ["set_authority"] }),
      proposal({ index: 8, actions: ["upgrade", "upgrade"] }),
    ])
  );
  assert.equal(assessRisk(mixed, NOW).headline, "2 proposed changes awaiting votes");
  assert.deepEqual(mixed.openProposals[1].actions, ["upgrade"], "actions are deduplicated");
});

test("quiet programs read as no pending changes, with what keeps them safe", () => {
  const immutable = summary(state({ upgradeAuthority: null, authorityKind: "none", squads: null }));
  const risk = assessRisk(immutable, NOW);
  assert.equal(risk.tone, "ok");
  assert.equal(risk.headline, "No pending changes");
  assert.equal(risk.findings[0].title, "Immutable");
  assert.equal(needsAttention(immutable, NOW), false);

  const singleKey = summary(state({ authorityKind: "other", squads: null }));
  assert.equal(assessRisk(singleKey, NOW).tone, "notice");
  // A single key can upgrade with no proposal first, so it never reads "No pending changes".
  assert.equal(assessRisk(singleKey, NOW).headline, "Upgradeable without a Squads multisig");
  assert.deepEqual(
    riskBadges(singleKey, NOW).map((b) => [b.label, b.tone]),
    [["Upgradeable", "warning"]]
  );
});

test("verification badges only describe the deployed code", () => {
  const checked = {
    repoUrl: null,
    commit: null,
    executableHash: CODE_HASH,
    lastVerifiedAt: null,
    checkedAt: "x",
  };
  const verified = summary(
    state({ verification: { ...checked, status: "verified", codeHash: CODE_HASH } })
  );
  assert.deepEqual(
    riskBadges(verified, NOW).map((b) => b.label),
    ["Multisig 4/9", "Verified"]
  );
  // An answer about older code no longer applies after an upgrade.
  const stale = summary(
    state({ verification: { ...checked, status: "verified", codeHash: "b".repeat(64) } })
  );
  assert.equal(stale.verification, null);
  const mismatch = summary(
    state({ verification: { ...checked, status: "mismatch", codeHash: CODE_HASH } })
  );
  assert.equal(
    assessRisk(mismatch, NOW).headline,
    "Deployed code doesn't match its verified build"
  );
});

test("closed and unchecked programs", () => {
  const closed = summary(state({ status: "closed", upgradeAuthority: null, squads: null }));
  assert.equal(assessRisk(closed, NOW).headline, "Program closed");
  assert.deepEqual(
    riskBadges(closed, NOW).map((b) => b.label),
    ["Closed"]
  );
  assert.equal(assessRisk(null, NOW).tone, "unknown");
  assert.deepEqual(riskBadges(null, NOW), []);
  assert.equal(needsAttention(null, NOW), false);
});

test("changes group by program and exact timestamp, most severe first", () => {
  const t1 = "2026-10-16T09:16:01.123456+00:00";
  const t1b = "2026-10-16T09:16:01.123999+00:00"; // same millisecond, different transaction
  const rows = [
    { id: "a", program_id: "p1", severity: "low" as const, detected_at: t1 },
    { id: "b", program_id: "p1", severity: "high" as const, detected_at: t1 },
    { id: "c", program_id: "p1", severity: "low" as const, detected_at: t1 },
    { id: "d", program_id: "p1", severity: "medium" as const, detected_at: t1b },
    { id: "e", program_id: "p2", severity: "critical" as const, detected_at: t1b },
  ];
  const groups = groupChanges(rows);
  assert.deepEqual(
    groups.map((g) => [g.severity, g.changes.map((c) => c.id)]),
    [
      ["high", ["b", "a", "c"]],
      ["medium", ["d"]],
      ["critical", ["e"]],
    ]
  );
  assert.equal(severityCounts(groups[0].changes), "1 high, 2 low");
});

test("only BPF programs without an authority are immutable", () => {
  const noControl = { upgradeAuthority: null, authorityKind: "none" as const, squads: null };
  const native = summary(state({ ...noControl, loader: "native" }));
  assert.equal(assessRisk(native, NOW).headline, "Native program");
  assert.deepEqual(
    riskBadges(native, NOW).map((b) => b.label),
    ["Native"]
  );
  const wallet = summary(state({ ...noControl, loader: "unknown" }));
  assert.equal(assessRisk(wallet, NOW).tone, "unknown");
  assert.deepEqual(riskBadges(wallet, NOW), []);
  const missing = summary(state({ ...noControl, status: "missing" }));
  assert.deepEqual(
    riskBadges(missing, NOW).map((b) => b.label),
    ["Not found"]
  );
  assert.equal(assessRisk(missing, NOW).headline, "Program account not found");
  const loaderV4 = summary(state({ ...noControl, loader: "loader-v4" }));
  assert.equal(assessRisk(loaderV4, NOW).findings[0].title, "Immutable");
});
