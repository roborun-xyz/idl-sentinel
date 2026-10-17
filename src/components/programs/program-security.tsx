"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgramChainStateRow } from "@/lib/db/chain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { formatRelativeTime, getExplorerUrl, type SolanaExplorer } from "@/lib/utils";
import { isOpenProposal } from "@/lib/chain/proposal-status";
import { codeControl, summarizeChain, timelockText, type CodeControl } from "@/lib/chain/risk";

const CODE_LABELS: Record<CodeControl, React.ReactNode> = {
  closed: <Badge variant="destructive">Closed</Badge>,
  missing: <Badge variant="destructive">Not found</Badge>,
  retracted: <Badge variant="secondary">Retracted</Badge>,
  immutable: "Immutable",
  multisig: "Upgradeable",
  upgradeable: "Upgradeable",
  native: "Native program",
  unknown: "Not a program account",
};
import { currentVerification } from "@/lib/chain/verification-status";
import type { ChainState, TrackedProposal } from "@/lib/chain/state";
import {
  AlertTriangle,
  ExternalLink,
  GitCommit,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Users,
} from "lucide-react";

const short = (value: string, size = 4) => `${value.slice(0, size)}…${value.slice(-size)}`;

/** Local time with UTC alongside, e.g. "Oct 15, 6:34 PM (16:34 UTC)". */
function bothTimes(seconds: number): string {
  const date = new Date(seconds * 1000);
  const local = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${local} (${date.toISOString().slice(11, 16)} UTC)`;
}

function Address({ value, explorer }: { value: string; explorer: SolanaExplorer }) {
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs" title={value}>
        {short(value, 6)}
      </code>
      <CopyButton
        variant="ghost"
        size="sm"
        value={value}
        copyLabel="Copy address"
        copiedLabel="Copied"
      />
      <Button variant="ghost" size="sm" asChild>
        <a
          href={getExplorerUrl(value, explorer)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in explorer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function VerificationBadge({ state }: { state: ChainState }) {
  // A check judges one code hash; after an upgrade the old answer no longer applies.
  const verification = currentVerification(state);
  if (!state.codeHash || !verification) {
    return <span className="text-muted-foreground">Pending first check</span>;
  }
  const commit = verification.commit?.slice(0, 7);
  const repo = verification.repoUrl;
  const body =
    verification.status === "verified" ? (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
        <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verified build
      </Badge>
    ) : verification.status === "mismatch" ? (
      <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
        <ShieldX className="mr-1 h-3.5 w-3.5" /> Doesn&apos;t match verified build
      </Badge>
    ) : verification.status === "unknown" ? (
      <Badge variant="secondary">
        <ShieldQuestion className="mr-1 h-3.5 w-3.5" /> Source registered, no matching build
      </Badge>
    ) : (
      <Badge variant="secondary">
        <ShieldQuestion className="mr-1 h-3.5 w-3.5" /> No verified build
      </Badge>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      {body}
      {repo && (
        <a
          href={repo}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <GitCommit className="h-3.5 w-3.5" />
          {commit ? `source @ ${commit}` : "source"}
        </a>
      )}
    </span>
  );
}

function actionText(proposal: TrackedProposal) {
  const map = {
    upgrade: "Upgrade",
    set_authority: "Change authority",
    close: "Close program",
    extend: "Extend",
  };
  return [...new Set(proposal.actions.map((a) => map[a as keyof typeof map] ?? a))].join(" + ");
}

function ProposalRow({
  proposal,
  threshold,
  now,
}: {
  proposal: TrackedProposal;
  threshold: number;
  now: number;
}) {
  const approved = proposal.status === "approved";
  const ready = approved && proposal.executableAt !== null && proposal.executableAt * 1000 <= now;
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${
        ready
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : approved
            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : ""
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        {approved && (
          <AlertTriangle className={`h-4 w-4 ${ready ? "text-red-600" : "text-amber-600"}`} />
        )}
        #{proposal.index} · {actionText(proposal)}
      </span>
      <span className="text-muted-foreground">
        {proposal.status === "none" ? "awaiting proposal" : proposal.status} · {proposal.approvals}/
        {threshold} approvals
        {approved && proposal.executableAt !== null && (
          <>
            {" "}
            · {ready ? "executable now" : `executable after ${bothTimes(proposal.executableAt)}`}
          </>
        )}
      </span>
    </li>
  );
}

interface FactsProgram {
  program_id: string;
  is_active: boolean;
  created_at: string;
  last_checked_at?: string | null;
}

/**
 * The scannable fact column (deps.dev / GitHub Advisory style): identifiers,
 * who controls the code, and when we last looked.
 */
export function ProgramFacts({
  program,
  chain,
  chainLoading,
  chainError,
  explorer,
}: {
  program: FactsProgram;
  chain: ProgramChainStateRow | null | undefined;
  chainLoading: boolean;
  chainError: boolean;
  explorer: SolanaExplorer;
}) {
  const state = chain?.state;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <Field label="Program ID">
            <Address value={program.program_id} explorer={explorer} />
          </Field>
          {state && (
            <>
              <Field label="Code">
                {CODE_LABELS[codeControl(summarizeChain(state, chain!.checked_at))]}
                <span className="ml-2 text-xs text-muted-foreground">{state.loader} loader</span>
              </Field>
              <Field label="Upgrade authority">
                {state.upgradeAuthority ? (
                  <div className="space-y-1">
                    <Address value={state.upgradeAuthority} explorer={explorer} />
                    <div className="text-xs text-muted-foreground">
                      {state.squads ? (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          Squads v4 vault · {state.squads.threshold} of{" "}
                          {state.squads.members.length} · {timelockText(state.squads.timeLock)}
                        </span>
                      ) : (
                        "Single key or another program"
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Field>
              {state.squads && (
                <Field label="Multisig">
                  <Address value={state.squads.multisig} explorer={explorer} />
                </Field>
              )}
              <Field label="Verified build">
                <VerificationBadge state={state} />
              </Field>
              <Field label="Last deployed">
                {state.deployedAt ? (
                  <span title={new Date(state.deployedAt * 1000).toISOString()}>
                    {formatRelativeTime(new Date(state.deployedAt * 1000))}
                  </span>
                ) : (
                  "Unknown"
                )}
                {state.deploySlot !== null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    slot {state.deploySlot.toLocaleString()}
                  </span>
                )}
              </Field>
              {state.codeHash && (
                <Field label="Code hash (SHA-256)">
                  <span className="inline-flex items-center gap-1">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs" title={state.codeHash}>
                      {short(state.codeHash, 8)}
                    </code>
                    <CopyButton
                      variant="ghost"
                      size="sm"
                      value={state.codeHash}
                      copyLabel="Copy hash"
                      copiedLabel="Copied"
                    />
                  </span>
                </Field>
              )}
            </>
          )}
          {!state && !chainLoading && (
            <Field label="On-chain state">
              <span className="text-muted-foreground">
                {chainError ? "Unavailable right now" : "Not checked yet"}
              </span>
            </Field>
          )}
          <Field label="Monitoring">
            {program.is_active ? "Active" : <Badge variant="secondary">Paused</Badge>}
            <div className="text-xs text-muted-foreground">
              IDL checked{" "}
              {program.last_checked_at ? formatRelativeTime(program.last_checked_at) : "never"}
              {chain && <> · chain checked {formatRelativeTime(chain.checked_at)}</>}
            </div>
          </Field>
          <Field label="Added">{formatRelativeTime(program.created_at)}</Field>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Open Squads proposals that would change this program, most urgent first. */
export function PendingProposals({ state, now }: { state: ChainState; now: number }) {
  if (!state.squads) return null;
  const rank = (p: TrackedProposal) => (p.status === "approved" ? 0 : 1);
  const open = state.squads.proposals
    .filter((p) => isOpenProposal(p.status))
    .sort((a, b) => rank(a) - rank(b) || b.index - a.index);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Multisig proposals
          {open.length > 0 && <Badge variant="secondary">{open.length} open</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {open.length ? (
          <ul className="space-y-2">
            {open.map((proposal) => (
              <ProposalRow
                key={proposal.index}
                proposal={proposal}
                threshold={state.squads!.threshold}
                now={now}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No open proposals in the {state.squads.threshold}-of-{state.squads.members.length}{" "}
            multisig touch this program.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
