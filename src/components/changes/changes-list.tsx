"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Filter } from "lucide-react";
import { useChanges } from "@/hooks/use-changes";
import { groupChanges } from "@/lib/changes/grouping";
import { ChangeGroupRows } from "./change-rows";

const PAGE_SIZE = 100;
const MIN_EVENTS = 5;
const MAX_AUTO_PAGES = 5;

interface ChangesListProps {
  programId?: string;
}

export function ChangesList({ programId }: ChangesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");

  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, isFetching } =
    useChanges(PAGE_SIZE, programId, {
      search: debouncedSearchTerm,
      severity: severityFilter,
      programName: programFilter,
    });
  const changes = useMemo(() => data?.pages.flatMap((page) => page.changes) ?? [], [data?.pages]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const filteredChanges = changes;
  const groups = useMemo(() => groupChanges(changes), [changes]);
  const pages = data?.pages.length ?? 0;

  // One large IDL release can fill a whole page; keep loading until the feed
  // shows a few distinct events, within a bounded number of pages.
  useEffect(() => {
    if (
      groups.length < MIN_EVENTS &&
      hasNextPage &&
      !isFetching &&
      pages > 0 &&
      pages < MAX_AUTO_PAGES
    ) {
      void fetchNextPage();
    }
  }, [groups.length, hasNextPage, isFetching, pages, fetchNextPage]);

  const severityOptions = [
    { value: "all", label: "All Severities" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "critical", label: "Critical" },
  ];

  // Get unique program names
  const programOptions = [
    { value: "all", label: "All Programs" },
    ...Array.from(
      new Set(
        [programFilter, ...changes.map((change) => change.monitored_programs?.name)].filter(
          (name) => name && name !== "all"
        )
      )
    )
      .map((name) => ({ value: name as string, label: name as string }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  if (isError) return <p role="alert">Unable to load changes. Please try again.</p>;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="h-10 w-64 animate-pulse rounded-sm bg-muted" />
            <div className="h-10 w-32 animate-pulse rounded-sm bg-muted" />
          </div>
        </div>

        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="h-6 animate-pulse rounded-sm bg-muted" />
                  <div className="h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded-sm bg-muted" />
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input
              placeholder="Search changes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10"
            />
          </div>

          <div className="relative flex-1 sm:flex-initial">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-auto"
            >
              {severityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 sm:flex-initial">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-auto"
            >
              {programOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          {changes.length} changes in {groups.length} {groups.length === 1 ? "event" : "events"}
          {hasNextPage && " loaded"}
        </div>

        {programId && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="text-muted-foreground">Program filter: </span>
              <span className="break-all font-mono">{programId}</span>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/changes">Clear</Link>
            </Button>
          </div>
        )}
      </div>

      {filteredChanges.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            {changes.length === 0 ? (
              <div>
                <h3 className="mb-2 text-lg font-medium">No changes detected yet</h3>
                <p className="text-muted-foreground">
                  {programId
                    ? "Changes to this program will appear here once detected"
                    : "Changes will appear here once your programs are monitored"}
                </p>
              </div>
            ) : (
              <div>
                <h3 className="mb-2 text-lg font-medium">No changes found</h3>
                <p className="text-muted-foreground">Try adjusting your search terms or filters</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 p-3 sm:p-4">
            {groups.map((group, i) => (
              <ChangeGroupRows
                key={group.key}
                group={group}
                showProgram={!programId}
                truncated={i === groups.length - 1 && !!hasNextPage}
              />
            ))}
          </CardContent>
        </Card>
      )}
      {hasNextPage && (
        <Button
          variant="outline"
          disabled={isFetchingNextPage || isFetching}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? "Loading…" : "Load more changes"}
        </Button>
      )}
    </div>
  );
}
