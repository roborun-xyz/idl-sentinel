"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, getExplorerUrl, type SolanaExplorer } from "@/lib/utils";
import { useProgramChain } from "@/hooks/use-programs";
import { isOpenProposal } from "@/lib/chain/proposal-status";
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

function duration(seconds: number): string {
  if (seconds <= 0) return "no timelock";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d timelock`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h timelock`;
  return `${Math.round(seconds / 60)}m timelock`;
}

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
    <div>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
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
        approved ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : ""
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        {approved && <AlertTriangle className="h-4 w-4 text-amber-600" />}#{proposal.index} ·{" "}
        {actionText(proposal)}
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

export function ProgramSecurityCard({
  programId,
  explorer,
}: {
  programId: string;
  explorer: SolanaExplorer;
}) {
  // The fetch time, not render time, decides "executable now"; it refreshes every minute.
  const { data, isLoading, isError, dataUpdatedAt } = useProgramChain(programId);
  const row = data?.chain;
  const state = row?.state;
  const open = state?.squads?.proposals.filter((p) => isOpenProposal(p.status)) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          On-chain security
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">On-chain state is unavailable right now.</p>
        ) : !state ? (
          <p className="text-sm text-muted-foreground">
            Not checked yet. The program watcher reads deploys, upgrade authority, and multisig
            proposals every five minutes.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Code">
                {state.status === "closed" ? (
                  <Badge variant="destructive">Closed</Badge>
                ) : state.status === "retracted" ? (
                  <Badge variant="secondary">Retracted (redeploy in progress?)</Badge>
                ) : state.upgradeAuthority ? (
                  <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                    Upgradeable
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                    Immutable
                  </Badge>
                )}
                <span className="ml-2 text-xs text-muted-foreground">{state.loader} loader</span>
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
              <Field label="Upgrade authority">
                {state.upgradeAuthority ? (
                  <div className="space-y-1">
                    <Address value={state.upgradeAuthority} explorer={explorer} />
                    <div className="text-xs text-muted-foreground">
                      {state.squads ? (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          Squads v4 vault · {state.squads.threshold} of{" "}
                          {state.squads.members.length} · {duration(state.squads.timeLock)}
                        </span>
                      ) : (
                        "Single key or another program (no Squads v4 multisig found)"
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">None. No one can change this code.</span>
                )}
              </Field>
              <Field label="Verified build">
                <VerificationBadge state={state} />
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
              {state.squads && (
                <Field label="Multisig">
                  <Address value={state.squads.multisig} explorer={explorer} />
                </Field>
              )}
            </div>

            {state.squads && (
              <div>
                <div className="mb-2 text-sm font-medium text-muted-foreground">
                  Pending changes to this program
                </div>
                {open.length ? (
                  <ul className="space-y-2">
                    {open.map((proposal) => (
                      <ProposalRow
                        key={proposal.index}
                        proposal={proposal}
                        threshold={state.squads!.threshold}
                        now={dataUpdatedAt}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No open multisig proposals touch this program.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Checked {formatRelativeTime(row!.checked_at)}. Verified-build status comes from{" "}
              <a
                href="https://verify.osec.io"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                OtterSec
              </a>
              ; it shows the source reproduces the code, not that the code is safe.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
