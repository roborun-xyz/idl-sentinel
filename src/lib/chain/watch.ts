import {
  decodeProgramAccount,
  decodeProgramData,
  programCodeHash,
  LOADER_V4_HEADER,
  PROGRAM_DATA_HEADER,
  type LoaderState,
  type RawAccount,
} from "./loaders";
import {
  decodeMultisig,
  decodeProposal,
  decodeVaultTransaction,
  isOpenProposal,
  programActions,
  proposalAddress,
  resolveTransactionAccounts,
  transactionAddress,
} from "./squads";
import { chainStateHash, diffChainStates, type ChainState, type SquadsState } from "./state";
import type { Verification } from "./verify";
import type { DetectedChange } from "../monitoring/change-detector";

export interface ChainReader {
  /** Batched account reads; results align with `addresses`. */
  getAccounts(
    addresses: string[],
    dataSlice?: { offset: number; length: number }
  ): Promise<Array<RawAccount | null>>;
  /** One full account read, used to hash deployed code. */
  getFullAccount(address: string): Promise<RawAccount | null>;
  getBlockTime(slot: number): Promise<number | null>;
  getLookupTable(address: string): Promise<string[] | null>;
  /** Finds the Squads v4 multisig whose vault is `authority`, if any. */
  findSquadsVault(authority: string): Promise<{ multisig: string; vaultIndex: number } | null>;
  fetchVerification(programId: string, codeHash: string | null): Promise<Verification>;
}

export interface WatchTarget {
  id: string;
  programId: string;
  name: string;
  state: ChainState | null;
  stateHash: string | null;
}

export interface ChainStore {
  loadTargets(limit: number): Promise<WatchTarget[]>;
  record(
    target: WatchTarget,
    state: ChainState,
    hash: string,
    changes: DetectedChange[]
  ): Promise<{ created: boolean; changes_count: number }>;
  /**
   * Advances the polling cursor. `checked` marks an unchanged state as freshly
   * observed; after a failure only the cursor moves, so one program cannot starve the rest.
   */
  touch(target: WatchTarget, checked: boolean): Promise<void>;
  log(
    target: WatchTarget | null,
    level: "info" | "warning" | "error",
    message: string
  ): Promise<void>;
}

export interface WatchOptions {
  deadline: number;
  limit?: number;
  /** Full program downloads (up to 10 MiB each) per run. */
  hashBudget?: number;
  verifyBudget?: number;
  probeBudget?: number;
  /** Minimum age before re-asking the verify API about unchanged code. */
  verifyIntervalMs?: number;
  /** Minimum age before probing a non-Squads authority again. */
  probeIntervalMs?: number;
  /** New Squads transaction indexes classified per program per run. */
  scanBudget?: number;
  now?: () => number;
}

export interface WatchResult {
  checked: number;
  changed: number;
  changesDetected: number;
  deferred: boolean;
  errors: Array<{ programId: string; error: string }>;
}

const CHUNK = 100;
const KEEP_CLOSED_PROPOSALS = 5;

export async function watchPrograms(
  store: ChainStore,
  reader: ChainReader,
  options: WatchOptions
): Promise<WatchResult> {
  const now = options.now ?? Date.now;
  const budget = {
    hash: options.hashBudget ?? 4,
    verify: options.verifyBudget ?? 25,
    probe: options.probeBudget ?? 3,
  };
  const result: WatchResult = {
    checked: 0,
    changed: 0,
    changesDetected: 0,
    deferred: false,
    errors: [],
  };
  const targets = await store.loadTargets(options.limit ?? 500);
  for (let start = 0; start < targets.length; start += CHUNK) {
    if (now() >= options.deadline) {
      result.deferred = true;
      break;
    }
    const chunk = targets.slice(start, start + CHUNK);
    let loaders: Array<LoaderState | Error>;
    try {
      loaders = await readLoaderStates(
        reader,
        chunk.map((t) => t.programId)
      );
    } catch (error) {
      // Move these programs to the back of the queue so the next run reaches the rest.
      const message = error instanceof Error ? error.message : "Account read failed";
      result.errors.push({ programId: "SYSTEM", error: message });
      await store.log(null, "error", `Program watch batch failed: ${message}`);
      await Promise.all(chunk.map((target) => store.touch(target, false).catch(() => {})));
      continue;
    }
    // Upgrades get first claim on the per-run download budget; backfill takes what is left.
    const order = chunk
      .map((target, i) => ({ target, loader: loaders[i] }))
      .sort(
        (a, b) => Number(isUpgrade(b.target, b.loader)) - Number(isUpgrade(a.target, a.loader))
      );
    for (const { target, loader } of order) {
      if (now() >= options.deadline) {
        result.deferred = true;
        break;
      }
      result.checked++;
      try {
        if (loader instanceof Error) throw loader;
        const next = await buildState(target, loader, reader, budget, options, now);
        const hash = chainStateHash(next);
        if (hash === target.stateHash) {
          // Refreshed probe/verify timestamps must be saved, or every run redoes that work.
          const bookkeeping = (st: ChainState | null) =>
            JSON.stringify([st?.authorityProbedAt ?? null, st?.verification?.checkedAt ?? null]);
          if (bookkeeping(next) !== bookkeeping(target.state)) {
            await store.record(target, next, hash, []);
          } else {
            await store.touch(target, true);
          }
          continue;
        }
        const changes = diffChainStates(target.state, next, target.name);
        const recorded = await store.record(target, next, hash, changes);
        result.changed += Number(recorded.created);
        result.changesDetected += recorded.changes_count;
        if (recorded.changes_count) {
          await store.log(
            target,
            "info",
            `Program watch recorded ${recorded.changes_count} change(s)`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Program watch failed";
        result.errors.push({ programId: target.programId, error: message });
        await store.log(target, "error", `Program watch failed: ${message}`);
        await store.touch(target, false).catch(() => {});
      }
    }
    if (result.deferred) break;
  }
  return result;
}

function isUpgrade(target: WatchTarget, loader: LoaderState | Error) {
  if (loader instanceof Error) return false;
  return (
    !!target.state && loader.deploySlot !== null && loader.deploySlot !== target.state.deploySlot
  );
}

/** One malformed account becomes that program's error, never the whole batch's. */
function decodeSafely<T>(decode: () => T): T | Error {
  try {
    return decode();
  } catch (error) {
    return error instanceof Error ? error : new Error("Account decode failed");
  }
}

async function readLoaderStates(
  reader: ChainReader,
  programIds: string[]
): Promise<Array<LoaderState | Error>> {
  // Program accounts are 36 bytes (v3) or start with a 48-byte header (v4); never pull v4 code here.
  const programs = await reader.getAccounts(programIds, { offset: 0, length: LOADER_V4_HEADER });
  const states = programs.map((account) => decodeSafely(() => decodeProgramAccount(account)));
  const dataAddresses = states
    .map((s) => (s instanceof Error ? null : s.programDataAddress))
    .filter((a): a is string => !!a);
  const programData = dataAddresses.length
    ? await reader.getAccounts(dataAddresses, { offset: 0, length: PROGRAM_DATA_HEADER })
    : [];
  const byAddress = new Map(dataAddresses.map((address, i) => [address, programData[i]]));
  return states.map((state) =>
    state instanceof Error || !state.programDataAddress
      ? state
      : decodeSafely(() =>
          decodeProgramData(state, byAddress.get(state.programDataAddress!) ?? null)
        )
  );
}

async function buildState(
  target: WatchTarget,
  loader: LoaderState,
  reader: ChainReader,
  budget: { hash: number; verify: number; probe: number },
  options: WatchOptions,
  now: () => number
): Promise<ChainState> {
  const prev = target.state;
  const sameDeploy = !!prev && prev.deploySlot === loader.deploySlot;
  const state: ChainState = {
    version: 1,
    ...loader,
    deployedAt: sameDeploy ? prev.deployedAt : null,
    authorityKind: loader.upgradeAuthority ? "other" : "none",
    authorityProbedAt: null,
    authoritySince:
      loader.upgradeAuthority && prev?.upgradeAuthority === loader.upgradeAuthority
        ? (prev.authoritySince ?? null)
        : // Only a handoff we watched happen is "fresh"; a first observation's age is unknown.
          loader.upgradeAuthority && prev
          ? new Date(now()).toISOString()
          : null,
    deployTimeSlot: sameDeploy ? (prev.deployTimeSlot ?? null) : null,
    codeHash: prev && prev.codeHashSlot === loader.deploySlot ? prev.codeHash : null,
    codeHashSlot: prev && prev.codeHashSlot === loader.deploySlot ? prev.codeHashSlot : null,
    squads: null,
    verification: null,
  };
  // Ask once per deploy slot; only a thrown (transient) error is retried next run.
  if (
    loader.deploySlot !== null &&
    state.deployedAt === null &&
    state.deployTimeSlot !== loader.deploySlot
  ) {
    try {
      state.deployedAt = await reader.getBlockTime(loader.deploySlot);
      state.deployTimeSlot = loader.deploySlot;
    } catch {
      // leave deployTimeSlot unset so the next run tries again
    }
  }
  const codeAddress =
    loader.loader === "upgradeable" ? loader.programDataAddress : target.programId;
  if (
    state.status === "deployed" &&
    !state.codeHash &&
    loader.deploySlot !== null &&
    codeAddress &&
    budget.hash > 0
  ) {
    budget.hash--;
    const account = await reader.getFullAccount(codeAddress);
    const slotNow = account ? decodeProgramData(loader, account).deploySlot : null;
    // Hash only bytes from the deploy we observed; a deploy in between is caught next run.
    if (account && (loader.loader !== "upgradeable" || slotNow === loader.deploySlot)) {
      state.codeHash = programCodeHash(loader.loader, account.data);
      state.codeHashSlot = loader.deploySlot;
    }
  }

  if (loader.upgradeAuthority) {
    const sameAuthority = prev?.upgradeAuthority === loader.upgradeAuthority;
    const probedAt = prev?.authorityProbedAt ? Date.parse(prev.authorityProbedAt) : 0;
    // A vault created for a handoff may have no Squads history yet, so a fresh
    // authority is re-probed every 30 minutes for a day, then daily.
    const since = state.authoritySince ? Date.parse(state.authoritySince) : 0;
    const interval =
      now() - since < 86_400_000 ? 1_800_000 : (options.probeIntervalMs ?? 86_400_000);
    const reprobe =
      !sameAuthority || (prev?.authorityKind === "other" && now() - probedAt > interval);
    if (sameAuthority && prev?.authorityKind === "squads_v4" && prev.squads) {
      state.authorityKind = "squads_v4";
      state.authorityProbedAt = prev.authorityProbedAt;
      state.squads = await refreshSquads(
        prev.squads,
        target,
        loader,
        reader,
        options.scanBudget ?? 10
      );
      if (!state.squads) state.authorityKind = "other";
    } else if (reprobe && budget.probe > 0) {
      budget.probe--;
      const vault = await reader.findSquadsVault(loader.upgradeAuthority);
      state.authorityProbedAt = new Date(now()).toISOString();
      if (vault) {
        state.authorityKind = "squads_v4";
        state.squads = await refreshSquads(
          {
            multisig: vault.multisig,
            vaultIndex: vault.vaultIndex,
            threshold: 0,
            timeLock: 0,
            members: [],
            configAuthority: null,
            transactionIndex: 0,
            staleTransactionIndex: 0,
            scannedIndex: -1,
            proposals: [],
          },
          target,
          loader,
          reader,
          options.scanBudget ?? 10
        );
        if (!state.squads) state.authorityKind = "other";
      }
    } else if (sameAuthority && prev) {
      state.authorityKind = prev.authorityKind;
      state.authorityProbedAt = prev.authorityProbedAt;
      state.squads = prev.squads;
    }
  }

  // The last answer is carried forward with the code hash it judged. A failed or
  // skipped check after an upgrade stays "pending" instead of erasing it, so the
  // next successful check can still report that verification was lost.
  const prevVerification = prev?.verification ?? null;
  state.verification = prevVerification;
  const verifiable = loader.loader === "upgradeable" || loader.loader === "loader-v4";
  if (verifiable && state.status === "deployed" && state.codeHash) {
    const stale =
      !prevVerification ||
      prevVerification.codeHash !== state.codeHash ||
      now() - Date.parse(prevVerification.checkedAt) > (options.verifyIntervalMs ?? 6 * 3_600_000);
    if (stale && budget.verify > 0) {
      budget.verify--;
      try {
        const verification = await reader.fetchVerification(target.programId, state.codeHash);
        state.verification = {
          ...verification,
          codeHash: state.codeHash,
          checkedAt: new Date(now()).toISOString(),
        };
      } catch {
        // An outage must not read as "verification lost"; retry next run.
      }
    }
  }
  return state;
}

async function refreshSquads(
  squads: SquadsState,
  target: WatchTarget,
  loader: LoaderState,
  reader: ChainReader,
  scanBudget: number
): Promise<SquadsState | null> {
  const [account] = await reader.getAccounts([squads.multisig]);
  const multisig = account ? decodeMultisig(squads.multisig, account.data) : null;
  if (!multisig) return null;
  const program = { programId: target.programId, programDataAddress: loader.programDataAddress };
  const tracked = new Map(squads.proposals.map((p) => [p.index, { ...p }]));

  // First sight: look back over the recent, still-actionable window only.
  let from =
    squads.scannedIndex < 0
      ? Math.max(multisig.staleTransactionIndex + 1, multisig.transactionIndex - scanBudget + 1)
      : squads.scannedIndex + 1;
  from = Math.max(from, 1);
  const to = Math.min(multisig.transactionIndex, from + scanBudget - 1);
  const indexes = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  if (indexes.length) {
    const accounts = await reader.getAccounts(
      indexes.map((i) => transactionAddress(squads.multisig, i))
    );
    for (const [i, index] of indexes.entries()) {
      const transaction = accounts[i] ? decodeVaultTransaction(accounts[i]!.data) : null;
      if (!transaction || transaction.vaultIndex !== squads.vaultIndex) continue;
      const keys = [...new Set(transaction.addressTableLookups.map((l) => l.accountKey))];
      const loaded = await Promise.all(keys.map((key) => reader.getLookupTable(key)));
      const tables = new Map<string, string[]>();
      keys.forEach((key, i) => loaded[i] && tables.set(key, loaded[i]!));
      const resolved = resolveTransactionAccounts(transaction, tables);
      if (!resolved) continue;
      const actions = programActions(transaction, resolved, program);
      if (!actions.length) continue;
      tracked.set(index, {
        index,
        status: "none",
        statusAt: null,
        approvals: 0,
        actions: [...new Set(actions.map((a) => a.action))],
        newAuthority: actions.find((a) => a.action === "set_authority")?.newAuthority ?? null,
        buffer: actions.find((a) => a.action === "upgrade")?.buffer ?? null,
        executableAt: null,
      });
    }
  }

  const open = [...tracked.values()].filter((p) => isOpenProposal(p.status));
  if (open.length) {
    const accounts = await reader.getAccounts(
      open.flatMap((p) => [
        proposalAddress(squads.multisig, p.index),
        transactionAddress(squads.multisig, p.index),
      ])
    );
    for (const [i, proposal] of open.entries()) {
      const proposalAccount = accounts[i * 2];
      // Squads lets members reclaim rent after execution or cancellation. A tracked
      // proposal whose accounts are gone is finished, not "awaiting proposal" forever.
      if (!proposalAccount && (proposal.status !== "none" || !accounts[i * 2 + 1])) {
        proposal.status = "closed";
        proposal.executableAt = null;
        continue;
      }
      const decoded = decodeProposal(proposalAccount?.data ?? null);
      proposal.status = decoded.status;
      proposal.statusAt = decoded.statusAt;
      proposal.approvals = decoded.approvals;
      proposal.executableAt =
        decoded.status === "approved" && decoded.statusAt !== null
          ? decoded.statusAt + multisig.timeLock
          : null;
      // Squads refuses to approve or execute unapproved proposals at or below the stale index.
      if (
        proposal.index <= multisig.staleTransactionIndex &&
        decoded.status !== "approved" &&
        isOpenProposal(decoded.status)
      ) {
        proposal.status = "stale";
      }
    }
  }

  const all = [...tracked.values()].sort((a, b) => b.index - a.index);
  const keepOpen = all.filter((p) => isOpenProposal(p.status));
  const closed = all.filter((p) => !keepOpen.includes(p)).slice(0, KEEP_CLOSED_PROPOSALS);
  return {
    multisig: squads.multisig,
    vaultIndex: squads.vaultIndex,
    threshold: multisig.threshold,
    timeLock: multisig.timeLock,
    members: multisig.members,
    configAuthority: multisig.configAuthority,
    transactionIndex: multisig.transactionIndex,
    staleTransactionIndex: multisig.staleTransactionIndex,
    scannedIndex: Math.max(squads.scannedIndex, to, from - 1),
    proposals: [...keepOpen, ...closed].sort((a, b) => b.index - a.index),
  };
}
