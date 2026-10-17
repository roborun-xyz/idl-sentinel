/**
 * Client-safe risk summary of a program's on-chain state: the one-line verdict
 * on the program page, the badges in program lists, and the attention banner.
 * Only type imports, so the browser bundle never pulls in Node code.
 */
import type { ChainState } from "./state";
import type { DeployStatus, LoaderKind } from "./loaders";
import type { VerificationStatus } from "./verify";
import { isOpenProposal } from "./proposal-status";
import { currentVerification } from "./verification-status";

export interface ProposalSummary {
  index: number;
  status: string;
  approvals: number;
  actions: string[];
  /** Unix seconds after which an approved proposal can execute. */
  executableAt: number | null;
}

/** The small part of `ChainState` that lists need; safe to send for every row. */
export interface ChainSummary {
  status: DeployStatus;
  loader: LoaderKind;
  upgradeable: boolean;
  multisig: { threshold: number; members: number; timeLock: number } | null;
  /** null while the first verification check for the deployed code is pending. */
  verification: VerificationStatus | null;
  openProposals: ProposalSummary[];
  deployedAt: number | null;
  checkedAt: string;
}

export function summarizeChain(state: ChainState, checkedAt: string): ChainSummary {
  return {
    status: state.status,
    loader: state.loader,
    upgradeable: !!state.upgradeAuthority,
    multisig: state.squads
      ? {
          threshold: state.squads.threshold,
          members: state.squads.members.length,
          timeLock: state.squads.timeLock,
        }
      : null,
    verification: currentVerification(state)?.status ?? null,
    openProposals: (state.squads?.proposals ?? [])
      .filter((p) => isOpenProposal(p.status))
      .map((p) => ({
        index: p.index,
        status: p.status,
        approvals: p.approvals,
        actions: [...new Set(p.actions)],
        executableAt: p.executableAt,
      })),
    deployedAt: state.deployedAt,
    checkedAt,
  };
}

/** Ordered from most to least urgent. */
export type RiskTone = "danger" | "warning" | "notice" | "ok" | "unknown";
const TONE_ORDER: RiskTone[] = ["danger", "warning", "notice", "ok", "unknown"];

export interface RiskFinding {
  tone: RiskTone;
  title: string;
  detail?: string;
}

export interface RiskAssessment {
  tone: RiskTone;
  headline: string;
  findings: RiskFinding[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ACTION_NOUNS: Record<string, string> = {
  upgrade: "upgrade",
  set_authority: "authority change",
  close: "program close",
  extend: "extension",
};

/** "upgrade", "authority change", or "change" when proposals mix actions. */
function proposalNoun(proposals: ProposalSummary[]): string {
  const nouns = new Set(
    proposals.flatMap((p) => p.actions.map((a) => ACTION_NOUNS[a] ?? "change"))
  );
  return nouns.size === 1 ? [...nouns][0] : "change";
}

/** "2026-10-16 09:16 UTC" */
export function utcMinute(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function timelockText(seconds: number): string {
  if (seconds <= 0) return "no timelock";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d timelock`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h timelock`;
  return `${Math.round(seconds / 60)}m timelock`;
}

/** Proposals split by how close they are to changing the program. */
export function proposalStages(summary: ChainSummary, nowMs: number) {
  const approved = summary.openProposals.filter((p) => p.status === "approved");
  // An approval without a timestamp has an unknown unlock time; it is never called executable.
  const ready = approved.filter((p) => p.executableAt !== null && p.executableAt * 1000 <= nowMs);
  const waiting = approved.filter((p) => !ready.includes(p));
  const voting = summary.openProposals.filter((p) => p.status !== "approved");
  return { ready, waiting, voting };
}

/**
 * One verdict plus every finding behind it. `nowMs` decides whether an
 * approved proposal's timelock has passed; pass the data's fetch time so a
 * stale page never claims more than it saw.
 */
export function assessRisk(summary: ChainSummary | null, nowMs: number): RiskAssessment {
  if (!summary) {
    return {
      tone: "unknown",
      headline: "Not checked yet",
      findings: [
        {
          tone: "unknown",
          title: "Waiting for the first on-chain check",
          detail: "Deploys, upgrade authority, and multisig proposals are read every five minutes.",
        },
      ],
    };
  }

  const findings: RiskFinding[] = [];
  if (summary.status === "closed") {
    findings.push({
      tone: "danger",
      title: "Program closed",
      detail: "Its code was removed; calls to it fail.",
    });
  } else if (summary.status === "retracted") {
    findings.push({
      tone: "warning",
      title: "Program retracted",
      detail: "Loader v4 programs are retracted while a redeploy is in progress.",
    });
  } else if (summary.status === "missing") {
    findings.push({
      tone: "danger",
      title: "Program account not found",
      detail: "Nothing executable is deployed at this address.",
    });
  }

  const { ready, waiting, voting } = proposalStages(summary, nowMs);
  if (ready.length) {
    findings.push({
      tone: "danger",
      title: `${plural(ready.length, `approved ${proposalNoun(ready)}`)} can execute now`,
      detail: `Proposal ${ready.map((p) => `#${p.index}`).join(", ")} passed the multisig vote and the timelock; a member with execute permission can run ${ready.length === 1 ? "it" : "them"} at any time.`,
    });
  }
  if (waiting.length) {
    const times = waiting.flatMap((p) => (p.executableAt === null ? [] : [p.executableAt]));
    findings.push({
      tone: "warning",
      title: `${plural(waiting.length, `approved ${proposalNoun(waiting)}`)} in timelock`,
      detail: times.length
        ? `Executable from ${utcMinute(Math.min(...times))}.`
        : "Approval time unknown.",
    });
  }
  if (voting.length) {
    findings.push({
      tone: "warning",
      title: `${plural(voting.length, `proposed ${proposalNoun(voting)}`)} awaiting votes`,
      detail: summary.multisig
        ? `Needs ${summary.multisig.threshold} of ${summary.multisig.members} approvals.`
        : undefined,
    });
  }

  if (summary.verification === "mismatch") {
    findings.push({
      tone: "warning",
      title: "Deployed code doesn't match its verified build",
      detail: "The registered source no longer reproduces what is on chain.",
    });
  }

  const control = codeControl(summary);
  if (control === "immutable") {
    findings.push({ tone: "ok", title: "Immutable", detail: "No one can change this code." });
  } else if (control === "multisig") {
    const { threshold, members, timeLock } = summary.multisig!;
    findings.push({
      tone: "ok",
      title: `Upgrades need ${threshold} of ${members} multisig approvals`,
      detail: `Squads v4 vault, ${timelockText(timeLock)}.`,
    });
  } else if (control === "upgradeable") {
    findings.push({
      tone: "notice",
      title: "Upgradeable without a Squads multisig",
      detail: "The authority is a single key or another program; upgrades can land unannounced.",
    });
  } else if (control === "native") {
    findings.push({
      tone: "notice",
      title: "Native program",
      detail: "Built into the validator; it changes through feature activations, not deploys.",
    });
  } else if (control === "unknown") {
    findings.push({
      tone: "unknown",
      title: "Not a recognized program account",
      detail: "No BPF loader owns this address, so deploys and authority cannot be tracked.",
    });
  }

  findings.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
  const top = findings[0] ?? { tone: "ok" as const, title: "No pending changes" };
  const tone = top.tone;
  // "No pending changes" only when the code is under known control; a single-key
  // authority can upgrade without any proposal for us to see first.
  const headline = tone === "ok" ? "No pending changes" : top.title;
  return { tone, headline, findings };
}

export type CodeControl =
  | "closed"
  | "missing"
  | "retracted"
  | "immutable"
  | "multisig"
  | "upgradeable"
  | "native"
  | "unknown";

/**
 * Who can change the code. Only BPF-loader programs without an authority are
 * immutable; native programs and non-program accounts are neither.
 */
export function codeControl(summary: ChainSummary): CodeControl {
  if (summary.status !== "deployed") return summary.status;
  if (summary.loader === "native") return "native";
  if (summary.loader === "unknown") return "unknown";
  if (!summary.upgradeable) return "immutable";
  return summary.multisig ? "multisig" : "upgradeable";
}

export type BadgeTone = "danger" | "warning" | "ok" | "neutral";

export interface RiskBadge {
  key: string;
  label: string;
  tone: BadgeTone;
  title: string;
}

/** Status badges in the order a reader scans them: code, control, source, queue. */
export function riskBadges(summary: ChainSummary | null, nowMs: number): RiskBadge[] {
  if (!summary) return [];
  const badges: RiskBadge[] = [];

  const control = codeControl(summary);
  const code: Record<CodeControl, Omit<RiskBadge, "key"> | null> = {
    closed: { label: "Closed", tone: "danger", title: "Program code was removed" },
    missing: {
      label: "Not found",
      tone: "danger",
      title: "No program is deployed at this address",
    },
    retracted: { label: "Retracted", tone: "warning", title: "Redeploy in progress" },
    immutable: {
      label: "Immutable",
      tone: "ok",
      title: "No upgrade authority; the code cannot change",
    },
    multisig: summary.multisig
      ? {
          label: `Multisig ${summary.multisig.threshold}/${summary.multisig.members}`,
          tone: "neutral",
          title: `Upgradeable through a Squads v4 multisig, ${summary.multisig.threshold} of ${summary.multisig.members}, ${timelockText(summary.multisig.timeLock)}`,
        }
      : null,
    upgradeable: {
      label: "Upgradeable",
      tone: "warning",
      title: "Upgradeable by a single key or another program",
    },
    native: { label: "Native", tone: "neutral", title: "Built into the validator" },
    unknown: null,
  };
  const codeBadge = code[control];
  if (codeBadge) badges.push({ key: "code", ...codeBadge });

  if (summary.verification === "verified") {
    badges.push({
      key: "verify",
      label: "Verified",
      tone: "ok",
      title: "Published source reproduces the deployed code (OtterSec)",
    });
  } else if (summary.verification === "mismatch") {
    badges.push({
      key: "verify",
      label: "Build mismatch",
      tone: "warning",
      title: "Deployed code doesn't match the verified build",
    });
  }

  const { ready, waiting, voting } = proposalStages(summary, nowMs);
  if (ready.length) {
    badges.push({
      key: "queue",
      label: `${ready.length} executable`,
      tone: "danger",
      title: "Approved multisig proposals that can execute now",
    });
  } else if (waiting.length) {
    badges.push({
      key: "queue",
      label: `${waiting.length} in timelock`,
      tone: "warning",
      title: "Approved multisig proposals waiting out the timelock",
    });
  } else if (voting.length) {
    badges.push({
      key: "queue",
      label: `${voting.length} proposed`,
      tone: "warning",
      title: "Multisig proposals that would change this program, awaiting votes",
    });
  }
  return badges;
}

/** Programs whose verdict asks the reader to act or look. */
export function needsAttention(summary: ChainSummary | null, nowMs: number): boolean {
  const tone = assessRisk(summary, nowMs).tone;
  return tone === "danger" || tone === "warning";
}
