import { createHash } from "node:crypto";
import { stableStringify } from "../monitoring/hash";
import type { DetectedChange } from "../monitoring/change-detector";
import type { ChangeSeverity, ProgramChangeType } from "../db/changes";
import type { DeployStatus, LoaderKind, LoaderInstruction } from "./loaders";
import { isOpenProposal, type ProposalStatus } from "./proposal-status";
import { currentVerification } from "./verification-status";

export { currentVerification };
import type { Verification } from "./verify";

export type AuthorityKind = "none" | "squads_v4" | "other";
/** "stale": past the multisig's stale index unapproved; "closed": its accounts were reclaimed. */
export type TrackedProposalStatus = ProposalStatus | "stale" | "closed";

/** A Squads proposal whose vault transaction changes the watched program. */
export interface TrackedProposal {
  index: number;
  status: TrackedProposalStatus;
  statusAt: number | null;
  approvals: number;
  actions: LoaderInstruction["action"][];
  newAuthority: string | null;
  buffer: string | null;
  /** Unix seconds after which an approved proposal can execute (timelock). */
  executableAt: number | null;
}

export interface SquadsState {
  multisig: string;
  vaultIndex: number;
  threshold: number;
  timeLock: number;
  members: string[];
  configAuthority: string | null;
  transactionIndex: number;
  staleTransactionIndex: number;
  /** Highest transaction index already classified. */
  scannedIndex: number;
  proposals: TrackedProposal[];
}

/** Who can change a program's code, what is deployed, and what is queued. */
export interface ChainState {
  version: 1;
  loader: LoaderKind;
  status: DeployStatus;
  programDataAddress: string | null;
  deploySlot: number | null;
  deployedAt: number | null;
  upgradeAuthority: string | null;
  authorityKind: AuthorityKind;
  authorityProbedAt: string | null;
  /** When this upgrade authority was first observed; a fresh handoff is re-probed sooner. */
  authoritySince?: string | null;
  /** Deploy slot whose block time was already asked for, so a null answer is not retried. */
  deployTimeSlot?: number | null;
  codeHash: string | null;
  codeHashSlot: number | null;
  squads: SquadsState | null;
  /** Last verify-API answer and the code hash it judged; see `currentVerification`. */
  verification: (Verification & { codeHash: string; checkedAt: string }) | null;
}

/** Bookkeeping timestamps are excluded so a quiet program costs no database write. */
export function chainStateHash(state: ChainState): string {
  const comparable = {
    ...state,
    authorityProbedAt: undefined,
    verification: state.verification ? { ...state.verification, checkedAt: undefined } : null,
  };
  return createHash("sha256").update(stableStringify(comparable)).digest("hex");
}

const short = (value: string | null | undefined, size = 4) =>
  value
    ? value.length > size * 2 + 1
      ? `${value.slice(0, size)}…${value.slice(-size)}`
      : value
    : "none";

function change(
  changeType: ProgramChangeType,
  severity: ChangeSeverity,
  itemName: string,
  changeSummary: string,
  description: string,
  oldValue?: unknown,
  newValue?: unknown
): DetectedChange {
  return {
    changeType,
    changeSummary,
    severity,
    changeDetails: { changeType, itemName, description, oldValue, newValue },
  };
}

function describeVerification(state: ChainState): string {
  const verification = currentVerification(state);
  if (!state.codeHash) return "Code hash pending.";
  if (!verification) return "Verified-build status pending.";
  const commit = verification.commit ? ` (commit ${verification.commit.slice(0, 7)})` : "";
  switch (verification.status) {
    case "verified":
      return `New code matches the verified build${commit}.`;
    case "mismatch":
      return `New code does not match the last verified build${commit}.`;
    case "unverified":
      return "No verified build is published for this program.";
    default:
      return "OtterSec has registered source but no build hash to compare yet.";
  }
}

function describeActions(proposal: TrackedProposal): string {
  const labels = proposal.actions.map((action) =>
    action === "set_authority"
      ? `change the upgrade authority to ${short(proposal.newAuthority)}`
      : action === "close"
        ? "close the program"
        : action === "extend"
          ? "extend the program's size"
          : "upgrade the program"
  );
  return [...new Set(labels)].join(" and ");
}

function proposalSeverity(proposal: TrackedProposal, approved: boolean): ChangeSeverity {
  const dangerous = proposal.actions.some((a) => a === "set_authority" || a === "close");
  if (approved) return "critical";
  return dangerous ? "critical" : "high";
}

const utc = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function diffSquads(prev: SquadsState | null, next: SquadsState | null, name: string) {
  const changes: DetectedChange[] = [];
  if (!next) return changes;
  // A multisig seen for the first time (new authority, or found on a later
  // probe) has no config history, but its open proposals are news.
  if (!prev || prev.multisig !== next.multisig) prev = { ...next, proposals: [] };
  const added = next.members.filter((m) => !prev.members.includes(m));
  const removed = prev.members.filter((m) => !next.members.includes(m));
  const parts: string[] = [];
  if (prev.threshold !== next.threshold || added.length || removed.length) {
    parts.push(
      `threshold ${prev.threshold}-of-${prev.members.length} → ${next.threshold}-of-${next.members.length}`
    );
  }
  if (added.length) parts.push(`${added.length} member(s) added`);
  if (removed.length) parts.push(`${removed.length} member(s) removed`);
  if (prev.timeLock !== next.timeLock) parts.push(`timelock ${prev.timeLock}s → ${next.timeLock}s`);
  if (prev.configAuthority !== next.configAuthority) {
    parts.push(`config authority ${short(prev.configAuthority)} → ${short(next.configAuthority)}`);
  }
  if (parts.length) {
    // A new config authority can change members and threshold on its own.
    const weakened =
      next.threshold < prev.threshold ||
      next.timeLock < prev.timeLock ||
      added.length > 0 ||
      (prev.configAuthority === null && next.configAuthority !== null);
    changes.push(
      change(
        "squads_config_changed",
        weakened ? "critical" : "high",
        next.multisig,
        `Upgrade multisig for '${name}' changed: ${parts.join("; ")}`,
        "The Squads multisig that controls upgrades was reconfigured.",
        {
          threshold: prev.threshold,
          timeLock: prev.timeLock,
          members: prev.members,
          configAuthority: prev.configAuthority,
        },
        {
          threshold: next.threshold,
          timeLock: next.timeLock,
          members: next.members,
          configAuthority: next.configAuthority,
          added,
          removed,
        }
      )
    );
  }
  const before = new Map(prev.proposals.map((p) => [p.index, p]));
  for (const proposal of next.proposals) {
    const old = before.get(proposal.index);
    const what = describeActions(proposal);
    const item = `${next.multisig}#${proposal.index}`;
    const approved = proposal.status === "approved";
    if (!old && isOpenProposal(proposal.status) && proposal.status !== "approved") {
      changes.push(
        change(
          "squads_proposal_created",
          proposalSeverity(proposal, false),
          item,
          `Squads proposal #${proposal.index} would ${what} for '${name}' (${proposal.approvals}/${next.threshold} approvals)`,
          "A pending multisig transaction targets this program.",
          undefined,
          proposal
        )
      );
    } else if (approved && old?.status !== "approved") {
      const when = proposal.executableAt
        ? proposal.executableAt * 1000 > Date.now()
          ? `; executable after ${utc(proposal.executableAt)}`
          : "; executable now"
        : "";
      changes.push(
        change(
          "squads_proposal_approved",
          "critical",
          item,
          `Squads proposal #${proposal.index} to ${what} for '${name}' reached ${proposal.approvals}/${next.threshold} approvals${when}`,
          "The multisig approved a change to this program; any member can execute it once the timelock passes.",
          old,
          proposal
        )
      );
    } else if (
      old &&
      isOpenProposal(old.status) &&
      (proposal.status === "rejected" ||
        proposal.status === "cancelled" ||
        proposal.status === "stale")
    ) {
      changes.push(
        change(
          "squads_proposal_cancelled",
          "low",
          item,
          `Squads proposal #${proposal.index} to ${what} for '${name}' was ${proposal.status}`,
          "The pending change to this program will not execute.",
          old,
          proposal
        )
      );
    }
  }
  return changes;
}

/**
 * Turns two observations of a program into alerts. The first observation is a
 * baseline and never alerts.
 */
export function diffChainStates(
  prev: ChainState | null,
  next: ChainState,
  name: string
): DetectedChange[] {
  if (!prev) return [];
  const changes: DetectedChange[] = [];
  // Loader v4 programs close by deleting the program account itself ("missing").
  const gone =
    next.status === "closed" ||
    (next.status === "missing" && (prev.status === "deployed" || prev.status === "retracted"));
  if (gone && prev.status !== "closed") {
    changes.push(
      change(
        "program_closed",
        "critical",
        name,
        `Program '${name}' was closed; its code can no longer execute`,
        "The program's executable data is gone.",
        { status: prev.status, deploySlot: prev.deploySlot },
        { status: next.status }
      )
    );
    return changes;
  }
  // Loader v4 retracts a program while writing new code; the redeploy that
  // follows is reported as an upgrade, so a retraction alone raises no code
  // alert. Authority, multisig, and verification changes are still diffed below.
  const redeployed =
    next.status === "deployed" &&
    next.deploySlot !== null &&
    (prev.status !== "deployed" || prev.loader !== next.loader);
  if (redeployed) {
    const how =
      prev.loader !== next.loader
        ? `migrated from the ${prev.loader} loader to ${next.loader}`
        : `redeployed after being ${prev.status}`;
    changes.push(
      change(
        "program_upgraded",
        "high",
        name,
        `Program '${name}' was ${how} at slot ${next.deploySlot}. ${describeVerification(next)}`,
        "New executable code is live at this address.",
        {
          status: prev.status,
          loader: prev.loader,
          deploySlot: prev.deploySlot,
          codeHash: prev.codeHash,
        },
        {
          status: next.status,
          loader: next.loader,
          deploySlot: next.deploySlot,
          codeHash: next.codeHash,
        }
      )
    );
  } else if (
    next.status === "deployed" &&
    prev.deploySlot !== null &&
    next.deploySlot !== null &&
    next.deploySlot !== prev.deploySlot
  ) {
    changes.push(
      change(
        "program_upgraded",
        "high",
        name,
        `Program '${name}' was upgraded at slot ${next.deploySlot}. ${describeVerification(next)}`,
        "New executable code was deployed. Integrations may behave differently even when the IDL is unchanged.",
        { deploySlot: prev.deploySlot, deployedAt: prev.deployedAt, codeHash: prev.codeHash },
        {
          deploySlot: next.deploySlot,
          deployedAt: next.deployedAt,
          codeHash: next.codeHash,
          verification: currentVerification(next)?.status ?? "pending",
          commit: currentVerification(next)?.commit ?? null,
        }
      )
    );
  }
  if (prev.upgradeAuthority !== next.upgradeAuthority && prev.status !== "closed") {
    if (next.upgradeAuthority === null) {
      changes.push(
        change(
          "program_made_immutable",
          "medium",
          name,
          `Program '${name}' is now immutable; its upgrade authority was removed`,
          "No one can upgrade this program's code anymore.",
          { upgradeAuthority: prev.upgradeAuthority },
          { upgradeAuthority: null }
        )
      );
    } else {
      const kind =
        next.authorityKind === "squads_v4" && next.squads
          ? ` (Squads ${next.squads.threshold}-of-${next.squads.members.length} multisig)`
          : "";
      changes.push(
        change(
          "upgrade_authority_changed",
          "critical",
          name,
          `Upgrade authority for '${name}' changed from ${short(prev.upgradeAuthority)} to ${short(next.upgradeAuthority)}${kind}`,
          "A different key or multisig can now replace this program's code.",
          { upgradeAuthority: prev.upgradeAuthority, authorityKind: prev.authorityKind },
          { upgradeAuthority: next.upgradeAuthority, authorityKind: next.authorityKind }
        )
      );
    }
  }
  changes.push(...diffSquads(prev.squads, next.squads, name));
  // `was` is the last judgment of whatever code was deployed then; `now` waits
  // until the deployed code has been judged.
  const was = prev.verification?.status;
  const current = currentVerification(next);
  const now = current?.status;
  const previouslyJudged = prev.verification ? (prev.verification.codeHash ?? prev.codeHash) : null;
  if (current && was === "verified" && (now === "mismatch" || now === "unverified")) {
    changes.push(
      change(
        "verification_lost",
        "high",
        name,
        `Deployed code for '${name}' no longer matches its verified build`,
        "The on-chain code hash differs from the build OtterSec verified from the published source.",
        prev.verification,
        current
      )
    );
  } else if (
    current &&
    now === "verified" &&
    was !== undefined &&
    // A re-verified upgrade is news only if the upgrade alert went out before the check.
    (was !== "verified" ||
      (previouslyJudged !== current.codeHash &&
        !changes.some((c) => c.changeType === "program_upgraded")))
  ) {
    changes.push(
      change(
        "verification_gained",
        "low",
        name,
        `Deployed code for '${name}' now matches a verified build${current.commit ? ` (commit ${current.commit.slice(0, 7)})` : ""}`,
        "OtterSec reproduced the on-chain code from the published source.",
        prev.verification,
        current
      )
    );
  }
  return changes;
}
