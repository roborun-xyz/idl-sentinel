import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  classifyLoaderInstruction,
  decodeProgramAccount,
  decodeProgramData,
  programCodeHash,
  programDataAddress,
  UPGRADEABLE_LOADER,
  type RawAccount,
} from "../src/lib/chain/loaders";
import {
  decodeMultisig,
  decodeProposal,
  decodeVaultTransaction,
  findVaultIndex,
  programActions,
  proposalAddress,
  resolveTransactionAccounts,
  transactionAddress,
  SQUADS_V4_PROGRAM,
} from "../src/lib/chain/squads";
import { classifyVerification } from "../src/lib/chain/verify";
import { chainStateHash, diffChainStates, type ChainState } from "../src/lib/chain/state";
import {
  watchPrograms,
  type ChainReader,
  type ChainStore,
  type WatchTarget,
} from "../src/lib/chain/watch";
import type { DetectedChange } from "../src/lib/monitoring/change-detector";

// Read-only captures of Solana mainnet accounts (see tests/fixtures/mainnet-accounts.json).
const fixtures = JSON.parse(readFileSync("tests/fixtures/mainnet-accounts.json", "utf8"))
  .accounts as Record<string, { owner: string; data: string }>;
const account = (name: string): RawAccount => ({
  owner: fixtures[name].owner,
  data: Buffer.from(fixtures[name].data, "base64"),
});

const KLEND = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const KLEND_MULTISIG = "6hhBGCtmg7tPWUSgp3LG6X2rsmYWAc4tNsA6G4CnfQbM";
const KLEND_AUTHORITY = "GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW";

test("upgradeable loader accounts decode to deploy slot and authority", () => {
  const program = decodeProgramAccount(account("klendProgram"));
  assert.equal(program.loader, "upgradeable");
  assert.equal(program.programDataAddress, programDataAddress(KLEND));
  const state = decodeProgramData(program, account("klendProgramDataHeader"));
  assert.equal(state.status, "deployed");
  assert.equal(state.deploySlot, 440486775);
  assert.equal(state.upgradeAuthority, KLEND_AUTHORITY);
  assert.equal(decodeProgramData(program, null).status, "closed");
  assert.equal(decodeProgramAccount(null).status, "missing");
  assert.equal(
    decodeProgramAccount({
      owner: "BPFLoader2111111111111111111111111111111111",
      data: new Uint8Array(),
    }).loader,
    "immutable"
  );
});

test("Squads v4 multisig, vault, upgrade transaction, and proposal decode from mainnet bytes", () => {
  const multisig = decodeMultisig(KLEND_MULTISIG, account("klendMultisig").data)!;
  assert.equal(multisig.threshold, 5);
  assert.equal(multisig.timeLock, 86_400);
  assert.equal(multisig.members.length, 10);
  assert.equal(multisig.transactionIndex, 106);
  assert.equal(multisig.configAuthority, null);
  assert.equal(findVaultIndex(KLEND_MULTISIG, KLEND_AUTHORITY), 0);
  assert.equal(findVaultIndex(KLEND_MULTISIG, KLEND), null);

  const transaction = decodeVaultTransaction(account("klendUpgradeTx105").data)!;
  assert.equal(transaction.index, 105);
  assert.equal(transaction.multisig, KLEND_MULTISIG);
  const accounts = resolveTransactionAccounts(transaction, new Map())!;
  const actions = programActions(transaction, accounts, {
    programId: KLEND,
    programDataAddress: programDataAddress(KLEND),
  });
  assert.deepEqual(actions, [
    { action: "upgrade", buffer: "79iZkQoYtrarqdurjKKpaYPygkt2dnSMuCogsXMi5xxs" },
  ]);
  // The same transaction says nothing about an unrelated program.
  assert.deepEqual(
    programActions(transaction, accounts, {
      programId: SQUADS_V4_PROGRAM,
      programDataAddress: null,
    }),
    []
  );

  const proposal = decodeProposal(account("klendUpgradeProposal105").data);
  assert.equal(proposal.status, "approved");
  assert.equal(proposal.approvals, 5);
  assert.equal(proposal.statusAt, 1791995662);
  assert.equal(decodeProposal(null).status, "none");

  // Config transactions are not vault transactions; Drift's admin call is not an upgrade.
  assert.equal(decodeVaultTransaction(account("klendConfigTx76").data), null);
  const drift = decodeVaultTransaction(account("driftAdminTx141").data)!;
  assert.deepEqual(
    programActions(drift, resolveTransactionAccounts(drift, new Map())!, {
      programId: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
      programDataAddress: programDataAddress("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"),
    }),
    []
  );
  assert.equal(decodeProposal(account("driftProposal141").data).status, "executed");
  assert.throws(() => decodeProposal(account("klendMultisig").data), /Not a Squads proposal/);
});

test("loader instruction classification only counts the watched program", () => {
  const program = { programId: KLEND, programDataAddress: programDataAddress(KLEND) };
  const setAuthority = new Uint8Array([4, 0, 0, 0]);
  assert.deepEqual(
    classifyLoaderInstruction(setAuthority, [program.programDataAddress, "cur", "next"], program),
    { action: "set_authority", newAuthority: "next" }
  );
  // SetAuthority on a buffer that merely lists the program elsewhere is not a program change.
  assert.equal(classifyLoaderInstruction(setAuthority, ["buffer", KLEND], program), null);
  assert.equal(
    classifyLoaderInstruction(new Uint8Array([5, 0, 0, 0]), ["other", "x"], program),
    null
  );
  assert.deepEqual(
    classifyLoaderInstruction(
      new Uint8Array([5, 0, 0, 0]),
      [program.programDataAddress, "r", "a", KLEND],
      program
    ),
    { action: "close" }
  );
});

test("code hash trims trailing zero padding after the loader header", () => {
  const elf = Buffer.from("7f454c46deadbeef", "hex");
  const data = Buffer.concat([Buffer.alloc(45, 7), elf, Buffer.alloc(100)]);
  assert.equal(
    programCodeHash("upgradeable", data),
    createHash("sha256").update(elf).digest("hex")
  );
  assert.equal(programCodeHash("immutable", data), null);
});

test("verification compares OtterSec's build hash with our own code hash", () => {
  const [A, B] = ["a".repeat(64), "b".repeat(64)];
  const response = {
    is_verified: true,
    repo_url: "https://github.com/x/y",
    commit: "abc1234def",
    executable_hash: A.toUpperCase(),
  };
  assert.equal(classifyVerification(response, A).status, "verified");
  // Their cache may still say verified after an upgrade; our hash wins.
  assert.equal(classifyVerification(response, B).status, "mismatch");
  assert.equal(classifyVerification({ is_verified: false, repo_url: "" }, A).status, "unverified");
  // Source registered but no build hash to compare: inconclusive, never "lost".
  assert.equal(
    classifyVerification({ is_verified: false, repo_url: "https://github.com/x/y" }, A).status,
    "unknown"
  );
  assert.equal(classifyVerification({ ...response, executable_hash: "zz" }, A).status, "unknown");
  // Untrusted repo links are dropped unless https.
  assert.equal(
    classifyVerification({ ...response, repo_url: "javascript:alert(1)" }, A).repoUrl,
    null
  );
});

function baseState(overrides: Partial<ChainState> = {}): ChainState {
  return {
    version: 1,
    loader: "upgradeable",
    status: "deployed",
    programDataAddress: "pd",
    deploySlot: 100,
    deployedAt: 1_700_000_000,
    upgradeAuthority: "Auth1111111111111111111111111111111111111111",
    authorityKind: "squads_v4",
    authorityProbedAt: null,
    codeHash: "aa",
    codeHashSlot: 100,
    squads: {
      multisig: "Multisig11111111111111111111111111111111111",
      vaultIndex: 0,
      threshold: 3,
      timeLock: 3600,
      members: ["a", "b", "c", "d"],
      configAuthority: null,
      transactionIndex: 10,
      staleTransactionIndex: 5,
      scannedIndex: 10,
      proposals: [],
    },
    verification: {
      status: "verified",
      repoUrl: "https://github.com/x/y",
      commit: "abc1234def",
      executableHash: "aa",
      lastVerifiedAt: null,
      codeHash: "aa",
      checkedAt: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

const types = (changes: DetectedChange[]) => changes.map((c) => [c.changeType, c.severity]);

test("first observation is a baseline; bookkeeping-only differences do not alert or rewrite", () => {
  assert.deepEqual(diffChainStates(null, baseState(), "P"), []);
  const later = baseState({
    authorityProbedAt: "2026-10-02T00:00:00.000Z",
    verification: { ...baseState().verification!, checkedAt: "2026-10-02T00:00:00.000Z" },
  });
  assert.equal(chainStateHash(baseState()), chainStateHash(later));
  assert.deepEqual(diffChainStates(baseState(), later, "P"), []);
});

test("upgrades, authority changes, immutability, and closure are classified", () => {
  const prev = baseState();
  const upgraded = baseState({
    deploySlot: 200,
    codeHash: "bb",
    codeHashSlot: 200,
    verification: { ...prev.verification!, status: "mismatch", codeHash: "bb" },
  });
  assert.deepEqual(types(diffChainStates(prev, upgraded, "P")), [
    ["program_upgraded", "high"],
    ["verification_lost", "high"],
  ]);
  assert.match(
    diffChainStates(prev, upgraded, "P")[0].changeSummary,
    /does not match the last verified build/
  );

  const moved = baseState({
    upgradeAuthority: "Other111111111111111111111111111111111111111",
    squads: null,
    authorityKind: "other",
  });
  assert.deepEqual(types(diffChainStates(prev, moved, "P")), [
    ["upgrade_authority_changed", "critical"],
  ]);
  const frozen = baseState({ upgradeAuthority: null, squads: null, authorityKind: "none" });
  assert.deepEqual(types(diffChainStates(prev, frozen, "P")), [
    ["program_made_immutable", "medium"],
  ]);
  const closed = baseState({
    status: "closed",
    deploySlot: null,
    upgradeAuthority: null,
    squads: null,
  });
  assert.deepEqual(types(diffChainStates(prev, closed, "P")), [["program_closed", "critical"]]);
  const v4 = baseState({ loader: "loader-v4", programDataAddress: null, squads: null });
  const retracted = baseState({ ...v4, status: "retracted" });
  assert.deepEqual(diffChainStates(v4, retracted, "P"), []);
  const redeployed = baseState({ ...v4, deploySlot: 300, codeHash: "cc", codeHashSlot: 300 });
  assert.deepEqual(types(diffChainStates(retracted, redeployed, "P")), [
    ["program_upgraded", "high"],
  ]);
  const reopened = baseState({ deploySlot: 400, codeHash: "dd", codeHashSlot: 400 });
  const reopenedChanges = diffChainStates(closed, reopened, "P");
  assert.equal(reopenedChanges.length, 1);
  assert.match(reopenedChanges[0].changeSummary, /redeployed after being closed/);
  const migrated = baseState({ ...v4, deploySlot: 500 });
  assert.match(
    diffChainStates(prev, migrated, "P")[0].changeSummary,
    /migrated from the upgradeable loader to loader-v4/
  );
});

test("multisig weakening is critical; proposal lifecycle alerts once per transition", () => {
  const prev = baseState();
  const weaker = baseState({ squads: { ...prev.squads!, threshold: 1 } });
  assert.deepEqual(types(diffChainStates(prev, weaker, "P")), [
    ["squads_config_changed", "critical"],
  ]);
  const stronger = baseState({ squads: { ...prev.squads!, threshold: 4 } });
  assert.deepEqual(types(diffChainStates(prev, stronger, "P")), [
    ["squads_config_changed", "high"],
  ]);

  const proposal = {
    index: 11,
    status: "active" as const,
    statusAt: 1_700_000_000,
    approvals: 1,
    actions: ["upgrade" as const],
    newAuthority: null,
    buffer: "buf",
    executableAt: null,
  };
  const proposed = baseState({ squads: { ...prev.squads!, proposals: [proposal] } });
  assert.deepEqual(types(diffChainStates(prev, proposed, "P")), [
    ["squads_proposal_created", "high"],
  ]);
  const handover = baseState({
    squads: {
      ...prev.squads!,
      proposals: [{ ...proposal, actions: ["set_authority"], newAuthority: "X" }],
    },
  });
  assert.deepEqual(types(diffChainStates(prev, handover, "P")), [
    ["squads_proposal_created", "critical"],
  ]);
  // More approvals without reaching the threshold is not a new alert.
  const moreVotes = baseState({
    squads: { ...prev.squads!, proposals: [{ ...proposal, approvals: 2 }] },
  });
  assert.deepEqual(diffChainStates(proposed, moreVotes, "P"), []);
  const approved = baseState({
    squads: {
      ...prev.squads!,
      proposals: [{ ...proposal, status: "approved", approvals: 3, executableAt: 4_000_000_000 }],
    },
  });
  const [alert] = diffChainStates(moreVotes, approved, "P");
  assert.equal(alert.changeType, "squads_proposal_approved");
  assert.equal(alert.severity, "critical");
  assert.match(alert.changeSummary, /executable after 2096-/);
  const cancelled = baseState({
    squads: { ...prev.squads!, proposals: [{ ...proposal, status: "cancelled" }] },
  });
  assert.deepEqual(types(diffChainStates(approved, cancelled, "P")), [
    ["squads_proposal_cancelled", "low"],
  ]);
  assert.deepEqual(diffChainStates(cancelled, cancelled, "P"), []);
});

test("verification gained alerts low; a missing previous check does not", () => {
  const unverified = baseState({
    verification: { ...baseState().verification!, status: "unverified" },
  });
  assert.deepEqual(types(diffChainStates(unverified, baseState(), "P")), [
    ["verification_gained", "low"],
  ]);
  assert.deepEqual(diffChainStates(baseState({ verification: null }), baseState(), "P"), []);
});

test("a verification check that lags an upgrade still reports the loss later", () => {
  const prev = baseState();
  // Upgrade observed; the verify API was unreachable, so the old answer is carried.
  const pending = baseState({ deploySlot: 200, codeHash: "bb", codeHashSlot: 200 });
  assert.deepEqual(types(diffChainStates(prev, pending, "P")), [["program_upgraded", "high"]]);
  assert.match(diffChainStates(prev, pending, "P")[0].changeSummary, /status pending/);
  const judged = baseState({
    deploySlot: 200,
    codeHash: "bb",
    codeHashSlot: 200,
    verification: { ...prev.verification!, status: "mismatch", codeHash: "bb" },
  });
  assert.deepEqual(types(diffChainStates(pending, judged, "P")), [["verification_lost", "high"]]);
  assert.deepEqual(diffChainStates(judged, judged, "P"), []);
  // Upgraded to code that is verified too: one low follow-up, not a repeat of the upgrade.
  const reverified = baseState({
    deploySlot: 200,
    codeHash: "bb",
    codeHashSlot: 200,
    verification: { ...prev.verification!, codeHash: "bb" },
  });
  assert.deepEqual(types(diffChainStates(pending, reverified, "P")), [
    ["verification_gained", "low"],
  ]);
  assert.deepEqual(types(diffChainStates(prev, reverified, "P")), [["program_upgraded", "high"]]);
});

/** In-memory chain built from the Kamino fixtures, with a programmable ProgramData slot. */
function fakeChain() {
  const pd = programDataAddress(KLEND);
  const chain = {
    slot: 440486775,
    proposal: account("klendUpgradeProposal105").data as Uint8Array | null,
    verifyCalls: 0,
    fullReads: 0,
    failPrograms: new Set<string>(),
    verifyDown: false,
    reclaimed: false,
  };
  const header = () => {
    const data = Buffer.from(account("klendProgramDataHeader").data);
    data.writeBigUInt64LE(BigInt(chain.slot), 4);
    return data;
  };
  const accounts = new Map<string, () => RawAccount | null>([
    [KLEND, () => account("klendProgram")],
    [pd, () => ({ owner: UPGRADEABLE_LOADER, data: header() })],
    [KLEND_MULTISIG, () => account("klendMultisig")],
    [
      transactionAddress(KLEND_MULTISIG, 105),
      () => (chain.reclaimed ? null : account("klendUpgradeTx105")),
    ],
    [transactionAddress(KLEND_MULTISIG, 106), () => null],
    [
      proposalAddress(KLEND_MULTISIG, 105),
      () =>
        chain.proposal && !chain.reclaimed
          ? { owner: SQUADS_V4_PROGRAM, data: chain.proposal }
          : null,
    ],
  ]);
  const reader: ChainReader = {
    async getAccounts(addresses) {
      if (addresses.some((a) => chain.failPrograms.has(a))) throw new Error("RPC unavailable");
      return addresses.map((a) => accounts.get(a)?.() ?? null);
    },
    async getFullAccount(address) {
      chain.fullReads++;
      const head = accounts.get(address)?.();
      if (!head) return null;
      return {
        owner: head.owner,
        data: Buffer.concat([
          Buffer.from(head.data),
          Buffer.from(`elf-${chain.slot}`),
          Buffer.alloc(64),
        ]),
      };
    },
    async getBlockTime(slot) {
      return 1_780_000_000 + (slot % 1000);
    },
    async getLookupTable() {
      return null;
    },
    async findSquadsVault(authority) {
      return authority === KLEND_AUTHORITY ? { multisig: KLEND_MULTISIG, vaultIndex: 0 } : null;
    },
    async fetchVerification(_programId, codeHash) {
      chain.verifyCalls++;
      if (chain.verifyDown) throw new Error("verify API down");
      return classifyVerification(
        {
          is_verified: true,
          repo_url: "https://github.com/Kamino-Finance/klend",
          commit: "a087609",
          executable_hash: chain.slot === 440486775 ? codeHash! : "f".repeat(64),
        },
        codeHash
      );
    },
  };
  return { chain, reader };
}

function memoryStore(targets: WatchTarget[]) {
  const recorded: DetectedChange[][] = [];
  const touched: Array<[string, boolean]> = [];
  const store: ChainStore = {
    async loadTargets() {
      return targets;
    },
    async record(target, state, hash, changes) {
      target.state = state;
      target.stateHash = hash;
      recorded.push(changes);
      return { created: true, changes_count: changes.length };
    },
    async touch(target, checked) {
      touched.push([target.programId, checked]);
    },
    async log() {},
  };
  return { store, recorded, touched };
}

test("watcher baselines Kamino with its approved upgrade, then alerts on the deploy", async () => {
  const { chain, reader } = fakeChain();
  const target: WatchTarget = {
    id: "k",
    programId: KLEND,
    name: "Kamino Lend",
    state: null,
    stateHash: null,
  };
  const { store, recorded, touched } = memoryStore([target]);
  const now = () => Date.parse("2026-10-16T00:00:00Z");

  const first = await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(first.errors.length, 0);
  assert.deepEqual(recorded, [[]]); // baseline only
  const squads = target.state!.squads!;
  assert.equal(target.state!.authorityKind, "squads_v4");
  assert.equal(squads.threshold, 5);
  assert.equal(squads.proposals[0].index, 105);
  assert.equal(squads.proposals[0].status, "approved");
  assert.equal(squads.proposals[0].executableAt, 1791995662 + 86_400);
  assert.equal(target.state!.verification?.status, "verified");

  // Nothing changed: no write, just a freshness touch, and no extra RPC-heavy work.
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(recorded.length, 1);
  assert.deepEqual(touched.at(-1), [KLEND, true]);
  assert.equal(chain.fullReads, 1);
  assert.equal(chain.verifyCalls, 1);

  // The proposal executes: the deploy slot moves and the new code no longer matches.
  chain.slot = 460000000;
  const executed = Buffer.from(account("klendUpgradeProposal105").data);
  executed[8 + 32 + 8] = 5; // ProposalStatus::Executed keeps the timestamp layout
  chain.proposal = executed;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.deepEqual(types(recorded.at(-1)!), [
    ["program_upgraded", "high"],
    ["verification_lost", "high"],
  ]);
  assert.equal(target.state!.deploySlot, 460000000);
  assert.equal(target.state!.squads!.proposals[0].status, "executed");
  assert.equal(chain.fullReads, 2);
});

test("watch failures advance only the cursor, and the deadline defers the rest", async () => {
  const { chain, reader } = fakeChain();
  chain.failPrograms.add(KLEND);
  const target: WatchTarget = {
    id: "k",
    programId: KLEND,
    name: "Kamino Lend",
    state: null,
    stateHash: null,
  };
  const healthy: WatchTarget = {
    id: "t",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "Token",
    state: null,
    stateHash: null,
  };
  const { store, touched } = memoryStore([target]);
  const result = await watchPrograms(store, reader, { deadline: Infinity });
  assert.equal(result.errors[0].programId, "SYSTEM");
  assert.equal(target.state, null);
  assert.deepEqual(
    touched,
    [[KLEND, false]],
    "a failed batch still moves its programs back in line"
  );

  // A malformed account fails only its own program.
  chain.failPrograms.clear();
  const broken = { owner: "LoaderV411111111111111111111111111111111111", data: new Uint8Array(3) };
  const original = reader.getAccounts;
  reader.getAccounts = async (addresses, slice) =>
    addresses.includes(healthy.programId)
      ? addresses.map((a) => (a === healthy.programId ? broken : null))
      : original(addresses, slice);
  const mixed = memoryStore([healthy, target]);
  const outcome = await watchPrograms(mixed.store, reader, { deadline: Infinity });
  assert.deepEqual(
    outcome.errors.map((e) => e.programId),
    [healthy.programId]
  );
  assert.ok(target.state, "the other program in the batch was still checked");

  const late = await watchPrograms(memoryStore([target]).store, reader, { deadline: 0 });
  assert.equal(late.deferred, true);
  assert.equal(late.checked, 0);
});

test("verify outages and reclaimed proposals do not lose alerts or linger as pending", async () => {
  const { chain, reader } = fakeChain();
  const target: WatchTarget = {
    id: "k",
    programId: KLEND,
    name: "Kamino Lend",
    state: null,
    stateHash: null,
  };
  const { store, recorded } = memoryStore([target]);
  const now = () => Date.parse("2026-10-16T00:00:00Z");
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(target.state!.verification?.status, "verified");

  chain.slot = 460000000;
  chain.verifyDown = true;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.deepEqual(types(recorded.at(-1)!), [["program_upgraded", "high"]]);
  assert.equal(
    target.state!.verification?.status,
    "verified",
    "old answer carried, judged for old code"
  );

  chain.verifyDown = false;
  chain.reclaimed = true;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.deepEqual(types(recorded.at(-1)!), [["verification_lost", "high"]]);
  assert.equal(target.state!.squads!.proposals[0].status, "closed");
  const calls = chain.verifyCalls;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(chain.verifyCalls, calls, "a judged hash is not re-checked within the interval");
});

test("re-verifying unchanged code saves the new check time without alerting", async () => {
  const { chain, reader } = fakeChain();
  const target: WatchTarget = {
    id: "k",
    programId: KLEND,
    name: "Kamino Lend",
    state: null,
    stateHash: null,
  };
  const { store, recorded } = memoryStore([target]);
  await watchPrograms(store, reader, {
    deadline: Infinity,
    now: () => Date.parse("2026-10-16T00:00:00Z"),
  });
  const later = () => Date.parse("2026-10-16T07:00:00Z");
  await watchPrograms(store, reader, { deadline: Infinity, now: later });
  assert.equal(chain.verifyCalls, 2);
  assert.deepEqual(recorded.at(-1), []);
  assert.equal(target.state!.verification!.checkedAt, "2026-10-16T07:00:00.000Z");
  await watchPrograms(store, reader, { deadline: Infinity, now: later });
  assert.equal(chain.verifyCalls, 2, "the saved check time stops repeat calls");
});

test("v4 closure, changes during retraction, new multisigs, and config authorities alert correctly", () => {
  const v4 = baseState({
    loader: "loader-v4",
    programDataAddress: null,
    squads: null,
    authorityKind: "other",
  });
  // Closing a v4 program deletes the account: critical, not "made immutable".
  const missing = baseState({
    ...v4,
    loader: "unknown",
    status: "missing",
    deploySlot: null,
    upgradeAuthority: null,
  });
  assert.deepEqual(types(diffChainStates(v4, missing, "P")), [["program_closed", "critical"]]);
  // A handoff during retraction is still reported.
  const retracted = baseState({
    ...v4,
    status: "retracted",
    upgradeAuthority: "New1111111111111111111111111111111111111111",
  });
  assert.deepEqual(types(diffChainStates(v4, retracted, "P")), [
    ["upgrade_authority_changed", "critical"],
  ]);

  // Authority moves to a multisig that already approved an upgrade.
  const approved = {
    index: 3,
    status: "approved" as const,
    statusAt: 1,
    approvals: 3,
    actions: ["upgrade" as const],
    newAuthority: null,
    buffer: "b",
    executableAt: 2,
  };
  const withMultisig = baseState({
    squads: {
      ...baseState().squads!,
      multisig: "Other11111111111111111111111111111111111111",
      proposals: [approved],
    },
  });
  assert.deepEqual(types(diffChainStates(baseState(), withMultisig, "P")), [
    ["squads_proposal_approved", "critical"],
  ]);
  const wasOther = baseState({ squads: null, authorityKind: "other" });
  assert.deepEqual(types(diffChainStates(wasOther, withMultisig, "P")), [
    ["squads_proposal_approved", "critical"],
  ]);

  const centralized = baseState({
    squads: {
      ...baseState().squads!,
      configAuthority: "Admin111111111111111111111111111111111111111",
    },
  });
  assert.deepEqual(types(diffChainStates(baseState(), centralized, "P")), [
    ["squads_config_changed", "critical"],
  ]);
});

test("block time is asked once per deploy slot; a fresh authority handoff is re-probed sooner", async () => {
  const { reader } = fakeChain();
  let blockTimeCalls = 0;
  reader.getBlockTime = async () => {
    blockTimeCalls++;
    return null;
  };
  let probes = 0;
  const findVault = reader.findSquadsVault;
  reader.findSquadsVault = async (authority) => {
    probes++;
    return probes > 1 ? findVault(authority) : null; // the new vault has no history at first
  };
  const target: WatchTarget = {
    id: "k",
    programId: KLEND,
    name: "Kamino Lend",
    state: null,
    stateHash: null,
  };
  const { store, recorded } = memoryStore([target]);
  let clock = Date.parse("2026-10-16T00:00:00Z");
  const now = () => clock;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(blockTimeCalls, 1, "a null block time is not re-requested");
  assert.equal(target.state!.authorityKind, "other");
  // Simulate having watched the handoff happen just now.
  target.state = { ...target.state!, authoritySince: new Date(clock).toISOString() };
  clock += 31 * 60_000;
  await watchPrograms(store, reader, { deadline: Infinity, now });
  assert.equal(target.state!.authorityKind, "squads_v4");
  assert.deepEqual(types(recorded.at(-1)!), [["squads_proposal_approved", "critical"]]);
});
