"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Clock, AlertCircle } from "lucide-react";
import { useRecentChanges } from "@/hooks/use-changes";
import { groupChanges } from "@/lib/changes/grouping";
import { ChangeGroupRows } from "@/components/changes/change-rows";

const LIMIT = 8;
// Enough rows that the newest few events are complete after grouping.
const FETCH = 100;
const GROUPS = 5;

export function RecentChanges() {
  const { data, isLoading } = useRecentChanges(FETCH);
  const changes = useMemo(() => data?.changes || [], [data?.changes]);
  const groups = useMemo(() => groupChanges(changes), [changes]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Recent Changes</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(LIMIT)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3 rounded-lg border p-3">
                <div className="h-2 w-2 animate-pulse rounded-sm bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 animate-pulse rounded-sm bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded-sm bg-muted/50" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center space-x-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Recent Changes</CardTitle>
        </div>
        <Link
          href="/changes"
          className="flex items-center space-x-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span>View all</span>
          <ExternalLink className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {changes.length === 0 ? (
          <div className="py-8 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-muted-foreground">No recent changes detected</p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Changes will appear here when detected
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.slice(0, GROUPS).map((group, i) => (
              <ChangeGroupRows
                key={group.key}
                group={group}
                showProgram
                truncated={i === groups.length - 1 && changes.length >= FETCH}
              />
            ))}
            <div className="pt-4 text-center">
              <Link href="/changes" className="block sm:inline-block">
                <button className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground sm:w-auto">
                  View all changes
                </button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
