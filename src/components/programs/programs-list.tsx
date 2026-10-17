"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRelativeTime, truncateString } from "@/lib/utils";
import { Plus, Search, Edit, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { AddToWatchlistButton } from "@/components/watchlist/add-to-watchlist-button";
import { usePrograms, useDeleteProgram } from "@/hooks/use-programs";
import { cn } from "@/lib/utils";
import { RiskBadges } from "./risk";
import { codeControl, needsAttention, type ChainSummary } from "@/lib/chain/risk";

const PAGE_SIZE = 50;

const FILTERS = {
  all: { label: "All", match: () => true },
  attention: {
    label: "Needs attention",
    match: (c: ChainSummary | null, now: number) => needsAttention(c, now),
  },
  upgradeable: {
    label: "Upgradeable",
    match: (c: ChainSummary | null) => !!c && ["multisig", "upgradeable"].includes(codeControl(c)),
  },
  immutable: {
    label: "Immutable",
    match: (c: ChainSummary | null) => !!c && codeControl(c) === "immutable",
  },
  verified: {
    label: "Verified",
    match: (c: ChainSummary | null) => c?.verification === "verified",
  },
} satisfies Record<
  string,
  { label: string; match: (c: ChainSummary | null, now: number) => boolean }
>;
type FilterKey = keyof typeof FILTERS;

export function ProgramsList() {
  // Fallback clock for placeholder rows, which report a fetch time of 0.
  const [mountedAt] = useState(() => Date.now());
  const { isAdmin, userId } = useAuth();

  const deleteMutation = useDeleteProgram();

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const {
    data,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt: fetchedAt,
  } = usePrograms({
    limit: PAGE_SIZE,
    offset,
    search: debouncedSearchTerm,
  });
  const programs = useMemo(() => data?.programs || [], [data?.programs]);
  // Placeholder rows shown during a refetch report 0; never judge timelocks against 1970.
  const dataUpdatedAt = fetchedAt || mountedAt;

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setOffset(0);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Filters apply to what is loaded, so they only show when one page holds every match.
  const canFilter = offset === 0 && !data?.pagination.hasMore && programs.length > 1;
  const activeFilter = canFilter ? filter : "all";
  const filteredPrograms = programs.filter((p) =>
    FILTERS[activeFilter].match(p.chain, dataUpdatedAt)
  );

  const handleDelete = async (programId: string) => {
    if (!confirm("Are you sure you want to delete this program? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(programId);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete program");
    }
  };

  if (isError) return <p role="alert">Unable to load programs. Please try again.</p>;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="h-10 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-10 w-32 animate-pulse rounded bg-muted" />
        </div>

        <div className="grid gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="h-6 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input
              placeholder="Search programs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 sm:w-64"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredPrograms.length} of {data?.pagination.total ?? 0} programs
          </div>
        </div>

        <Link href="/programs/new" className="w-full sm:w-auto">
          <Button className="flex w-full items-center justify-center space-x-2 sm:w-auto">
            <Plus className="h-4 w-4" />
            <span>Add Program</span>
          </Button>
        </Link>
      </div>

      {canFilter && (
        <div role="group" aria-label="Filter programs" className="flex flex-wrap gap-2">
          {(Object.keys(FILTERS) as FilterKey[]).map((key) => {
            const count = programs.filter((p) => FILTERS[key].match(p.chain, dataUpdatedAt)).length;
            if (key !== "all" && count === 0 && filter !== key) return null;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={activeFilter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  activeFilter === key
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {FILTERS[key].label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filteredPrograms.length === 0 && activeFilter !== "all" ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No programs match this filter.
          </CardContent>
        </Card>
      ) : filteredPrograms.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            {!debouncedSearchTerm && offset === 0 ? (
              <div>
                <h3 className="mb-2 text-lg font-medium">No programs monitored yet</h3>
                <p className="mb-6 text-muted-foreground">
                  Start monitoring the first Solana program for changes
                </p>
                <Link href="/programs/new">
                  <Button className="flex items-center space-x-2">
                    <Plus className="h-4 w-4" />
                    <span>Add Your First Program</span>
                  </Button>
                </Link>
              </div>
            ) : (
              <div>
                <h3 className="mb-2 text-lg font-medium">No programs found</h3>
                <p className="text-muted-foreground">Try adjusting your search terms</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {filteredPrograms.map((program) => {
              const isProgramOwner = !!userId && program.owner_id === userId;
              const canManageProgram = isAdmin || isProgramOwner;

              return (
                <li
                  key={program.id}
                  className={cn(
                    "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between",
                    !program.is_active && "bg-muted/30"
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/programs/${program.id}`}
                        className={cn(
                          "font-semibold hover:underline",
                          !program.is_active && "text-muted-foreground"
                        )}
                      >
                        {program.name}
                      </Link>
                      {!program.is_active && <Badge variant="secondary">Hidden</Badge>}
                      <RiskBadges summary={program.chain} now={dataUpdatedAt} />
                    </div>
                    {program.description && (
                      <p className="truncate text-sm text-muted-foreground">
                        {program.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <code className="font-mono" title={program.program_id}>
                        {truncateString(program.program_id, 20)}
                      </code>
                      <span>
                        {program.last_checked_at
                          ? `Checked ${formatRelativeTime(program.last_checked_at)}`
                          : "Not checked yet"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:ml-4">
                    {program.is_active && (
                      <AddToWatchlistButton
                        programId={program.program_id}
                        programDbId={program.id}
                        size="sm"
                        variant="outline"
                      />
                    )}
                    {canManageProgram && (
                      <>
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            href={`/programs/${program.id}/edit`}
                            aria-label={`Edit ${program.name}`}
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(program.id)}
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${program.name}`}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={offset === 0 || isFetching}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={!data?.pagination.hasMore || isFetching}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
