"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatRelativeTime,
  severityDotColors,
  severityBadgeColors,
  truncateString,
} from "@/lib/utils";
import { Search, Filter, ChevronDown, ChevronUp } from "lucide-react";
import dynamic from "next/dynamic";
const LazyChangeDetails = dynamic(() => import("./lazy-change-details"), {
  loading: () => <p>Loading details…</p>,
});
import { useChanges } from "@/hooks/use-changes";

interface ChangesListProps {
  programId?: string;
}

export function ChangesList({ programId }: ChangesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, isFetching } =
    useChanges(50, programId, {
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

  const toggleExpanded = (changeId: string) => {
    const newExpanded = new Set(expandedChanges);
    if (newExpanded.has(changeId)) {
      newExpanded.delete(changeId);
    } else {
      newExpanded.add(changeId);
    }
    setExpandedChanges(newExpanded);
  };

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
          {filteredChanges.length} of {changes.length} changes
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
                    ? "IDL changes for this program will appear here once detected"
                    : "IDL changes will appear here once your programs are monitored"}
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
        <div className="space-y-4">
          {filteredChanges.map((change) => {
            const isExpanded = expandedChanges.has(change.id);
            const programAddress = change.monitored_programs?.program_id || change.program_id;

            return (
              <Card key={change.id}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div
                      className={`mt-1 h-4 w-4 flex-shrink-0 rounded-sm ${
                        severityDotColors[change.severity] || "bg-gray-500"
                      }`}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {change.monitored_programs?.name || "Unknown Program"}
                          </h3>
                          <Badge variant="outline" className="text-xs">
                            {change.change_type}
                          </Badge>
                          <Badge
                            className={`text-xs ${
                              severityBadgeColors[change.severity] || "bg-gray-500 text-white"
                            }`}
                          >
                            {change.severity}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatRelativeTime(change.detected_at)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} change details`}
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(change.id)}
                            className="h-6 w-6 p-0"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className="mb-2 text-sm text-muted-foreground">{change.change_summary}</p>

                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {truncateString(programAddress, 40)}
                      </p>

                      {isExpanded && (
                        <div className="mt-4 overflow-auto rounded-md bg-muted/50 p-3 sm:p-4">
                          <h4 className="mb-3 text-sm font-medium">Change Details</h4>
                          <LazyChangeDetails id={change.id} />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
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
