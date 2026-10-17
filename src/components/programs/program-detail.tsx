"use client";

import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { snapshotQuery } from "@/hooks/use-programs";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatRelativeTime, getExplorerUrl, type SolanaExplorer } from "@/lib/utils";
import {
  ArrowLeft,
  Edit,
  Trash2,
  RefreshCw,
  ExternalLink,
  Activity,
  AlertCircle,
  Eye,
  Download,
  FileJson,
  X,
} from "lucide-react";
import {
  useProgram,
  useProgramSnapshots,
  useProgramChanges,
  useProgramChain,
  useDeleteProgram,
} from "@/hooks/use-programs";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useAuth } from "@/lib/auth/auth-context";
import { AddToWatchlistButton } from "@/components/watchlist/add-to-watchlist-button";
import { PendingProposals, ProgramFacts } from "./program-security";
import { RiskBadges, RiskBanner } from "./risk";
import { ChangeGroupRows } from "@/components/changes/change-rows";
import { summarizeChain } from "@/lib/chain/risk";
import { groupChanges } from "@/lib/changes/grouping";

const SnapshotJson = dynamic(() => import("./snapshot-json"), {
  loading: () => <p>Loading viewer…</p>,
});

// Rows fetched for the recent-changes card; one large IDL release can fill it alone.
const CHANGE_ROWS = 100;

interface Snapshot {
  id: string;
  program_id: string;
  idl_hash: string;
  version_number: number;
  fetched_at: string;
}

interface ProgramDetailProps {
  programId: string;
}

export function ProgramDetail({ programId }: ProgramDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [viewingSnapshot, setViewingSnapshot] = useState<Snapshot | null>(null);

  const {
    data: programData,
    isLoading: programLoading,
    isError: programError,
    error: programErrorObj,
    refetch: refetchProgram,
  } = useProgram(programId);
  const { data: snapshotsData, refetch: refetchSnapshots } = useProgramSnapshots(programId, 5);
  const { data: changesData, refetch: refetchChanges } = useProgramChanges(programId, CHANGE_ROWS);
  // The fetch time, not render time, decides "executable now"; it refreshes every minute.
  const {
    data: chainData,
    isLoading: chainLoading,
    isError: chainError,
    dataUpdatedAt: chainUpdatedAt,
    refetch: refetchChain,
  } = useProgramChain(programId);
  const { data: settingsData } = useUserSettings({ enabled: true });
  const { isAdmin, userId } = useAuth();
  const deleteMutation = useDeleteProgram();

  const program = programData?.program;
  const snapshots = snapshotsData?.snapshots || [];
  const changes = changesData?.changes || [];
  const preferredExplorer: SolanaExplorer =
    settingsData?.user?.preferred_explorer || "explorer.solana.com";
  const isProgramOwner = !!program && !!userId && program.owner_id === userId;
  const canManageProgram = !!program && (isAdmin || isProgramOwner);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchProgram(), refetchSnapshots(), refetchChanges(), refetchChain()]);
    setRefreshing(false);
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this program? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(programId);
      router.push("/programs");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete program");
    }
  };

  const formatHash = (hash: string) => {
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const downloadSnapshot = async (snapshot: Snapshot) => {
    try {
      setSnapshotError(null);
      const data = await queryClient.fetchQuery(snapshotQuery(programId, snapshot.id));
      const dataStr = JSON.stringify(data.snapshot.idl_content, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${program?.name || "snapshot"}_${snapshot.idl_hash.substring(0, 8)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setSnapshotError("Unable to download snapshot. Please try again.");
    }
  };

  if (programLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (programError) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/programs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Programs
            </Link>
          </Button>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {programErrorObj instanceof Error ? programErrorObj.message : "Failed to load program"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!program) {
    return null;
  }

  const chainState = chainData?.chain?.state ?? null;
  const summary = chainData?.chain
    ? summarizeChain(chainData.chain.state, chainData.chain.checked_at)
    : null;
  const groups = groupChanges(changes.map((change) => ({ ...change, program_id: program.id })));

  return (
    <div className="space-y-6">
      {snapshotError && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{snapshotError}</AlertDescription>
        </Alert>
      )}

      <Link
        href="/programs"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Programs
      </Link>

      {/* Header: name, status badges, address, actions */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{program.name}</h1>
            {!program.is_active && <Badge variant="secondary">Paused</Badge>}
          </div>
          <RiskBadges summary={summary} now={chainUpdatedAt} />
          {program.description && (
            <p className="max-w-2xl text-sm text-muted-foreground">{program.description}</p>
          )}
          <div className="flex items-center gap-1">
            <code className="break-all rounded bg-muted px-2 py-0.5 font-mono text-xs">
              {program.program_id}
            </code>
            <CopyButton
              variant="ghost"
              size="sm"
              value={program.program_id}
              copyLabel="Copy program ID"
              copiedLabel="Program ID copied"
            />
            <Button variant="ghost" size="sm" asChild>
              <a
                href={getExplorerUrl(program.program_id, preferredExplorer)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in explorer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AddToWatchlistButton programId={program.program_id} programDbId={program.id} size="sm" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          {canManageProgram && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/programs/${programId}/edit`} aria-label="Edit" title="Edit">
                  <Edit className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700"
                aria-label="Delete"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      {/* The verdict first: what, if anything, is about to change this program */}
      {chainLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : chainError ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          On-chain state is unavailable right now.
        </p>
      ) : (
        <RiskBanner
          summary={summary}
          now={chainUpdatedAt}
          footer={
            summary && (
              <>
                Checked {formatRelativeTime(summary.checkedAt)}. Verified-build status comes from{" "}
                <a
                  href="https://verify.osec.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  OtterSec
                </a>
                ; it shows the source reproduces the code, not that the code is safe.
              </>
            )
          }
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {chainState && <PendingProposals state={chainState} now={chainUpdatedAt} />}

          {/* Recent changes, one row per change, grouped by the event that produced them */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Recent changes
              </CardTitle>
              {changes.length > 0 && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/changes?programId=${encodeURIComponent(program.program_id)}`}>
                    View all
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes detected yet.</p>
              ) : (
                <div className="space-y-4">
                  {groups.slice(0, 5).map((group, i) => (
                    <ChangeGroupRows
                      key={group.key}
                      group={group}
                      showProgram={false}
                      truncated={i === groups.length - 1 && changes.length >= CHANGE_ROWS}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* IDL versions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileJson className="h-4 w-4" />
                IDL versions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {snapshots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No IDL found yet. Programs without a published Anchor or Program Metadata IDL are
                  still watched for deploys and authority changes.
                </p>
              ) : (
                <ul className="divide-y">
                  {snapshots.slice(0, 5).map((snapshot, i) => (
                    <li
                      key={snapshot.id}
                      className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="w-10 text-sm font-medium tabular-nums">
                        v{snapshot.version_number}
                      </span>
                      <code className="hidden rounded bg-muted px-1.5 py-0.5 text-xs sm:inline">
                        {formatHash(snapshot.idl_hash)}
                      </code>
                      {i === 0 && <Badge variant="outline">Latest</Badge>}
                      <span className="flex-1 text-right text-xs text-muted-foreground">
                        {formatRelativeTime(snapshot.fetched_at)}
                      </span>
                      <div className="flex items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingSnapshot(snapshot)}
                          aria-label={`View IDL v${snapshot.version_number}`}
                          title="View IDL"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadSnapshot(snapshot)}
                          aria-label={`Download IDL v${snapshot.version_number}`}
                          title="Download JSON"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <ProgramFacts
            program={program}
            chain={chainData?.chain}
            chainLoading={chainLoading}
            chainError={chainError}
            explorer={preferredExplorer}
          />
        </aside>
      </div>

      {/* Snapshot Viewer Modal */}
      {viewingSnapshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewingSnapshot(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-md bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b p-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold">IDL Snapshot</h3>
                <p className="text-sm text-muted-foreground">
                  Hash: {formatHash(viewingSnapshot.idl_hash)} •{" "}
                  {formatRelativeTime(viewingSnapshot.fetched_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadSnapshot(viewingSnapshot)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setViewingSnapshot(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              <SnapshotJson programId={programId} snapshotId={viewingSnapshot.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
