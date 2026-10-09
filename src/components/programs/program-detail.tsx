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
import {
  formatRelativeTime,
  getExplorerUrl,
  type SolanaExplorer,
  severityBadgeColors,
} from "@/lib/utils";
import {
  ArrowLeft,
  Edit,
  Trash2,
  RefreshCw,
  ExternalLink,
  Clock,
  Activity,
  AlertCircle,
  Eye,
  Download,
  X,
} from "lucide-react";
import {
  useProgram,
  useProgramSnapshots,
  useProgramChanges,
  useDeleteProgram,
} from "@/hooks/use-programs";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useAuth } from "@/lib/auth/auth-context";
import { AddToWatchlistButton } from "@/components/watchlist/add-to-watchlist-button";

const SnapshotJson = dynamic(() => import("./snapshot-json"), {
  loading: () => <p>Loading viewer…</p>,
});

interface Snapshot {
  id: string;
  program_id: string;
  idl_hash: string;
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
  const { data: changesData, refetch: refetchChanges } = useProgramChanges(programId);
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
    await Promise.all([refetchProgram(), refetchSnapshots(), refetchChanges()]);
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
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
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

  return (
    <div className="space-y-8">
      {snapshotError && <p role="alert">{snapshotError}</p>}
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/programs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Programs
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <AddToWatchlistButton programId={program.program_id} programDbId={program.id} size="sm" />
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          {canManageProgram && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/programs/${programId}/edit`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Program Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Program Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <p className="mt-1 text-sm">{program.name}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div className="mt-1">
                <Badge variant={program.is_active ? "default" : "secondary"}>
                  {program.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="mt-1 text-sm">{program.description || "No description provided"}</p>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">Program ID</label>
              <div className="mt-1 flex items-center gap-1">
                <code className="break-all rounded bg-muted px-2 py-1 text-sm">
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
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Created</label>
              <p className="mt-1 text-sm">{formatRelativeTime(program.created_at)}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Last Updated</label>
              <p className="mt-1 text-sm">{formatRelativeTime(program.updated_at)}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Last Checked</label>
              <p className="mt-1 text-sm">
                {program.last_checked_at ? formatRelativeTime(program.last_checked_at) : "Never"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Snapshots */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Snapshots
              <Badge variant="secondary">{snapshots.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No snapshots found</p>
            ) : (
              <div className="space-y-3">
                {snapshots.slice(0, 5).map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="flex-1">
                      <code className="rounded bg-muted px-2 py-1 text-xs">
                        {formatHash(snapshot.idl_hash)}
                      </code>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRelativeTime(snapshot.fetched_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewingSnapshot(snapshot)}
                        title="View IDL"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadSnapshot(snapshot)}
                        title="Download JSON"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <CopyButton
                        variant="ghost"
                        size="sm"
                        value={snapshot.idl_hash}
                        copyLabel="Copy hash"
                        copiedLabel="Hash copied"
                      />
                    </div>
                  </div>
                ))}

                {snapshots.length > 5 && (
                  <Button variant="outline" size="sm" className="w-full">
                    View All Snapshots
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Changes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Recent Changes
              <Badge variant="secondary">{changes.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes detected</p>
            ) : (
              <div className="space-y-3">
                {changes.slice(0, 5).map((change) => (
                  <div key={change.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <Badge
                        className={
                          severityBadgeColors[
                            change.severity as keyof typeof severityBadgeColors
                          ] || severityBadgeColors.low
                        }
                      >
                        {change.severity}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(change.detected_at)}
                      </span>
                    </div>

                    <div>
                      <p className="text-sm font-medium">{change.change_type}</p>
                      <p className="text-xs text-muted-foreground">{change.change_summary}</p>
                    </div>
                  </div>
                ))}

                {changes.length > 5 && (
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <Link href="/changes">View All Changes</Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
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
