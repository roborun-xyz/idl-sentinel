"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, truncateString } from "@/lib/utils";
import { ExternalLink, Plus, Code, Activity, AlertCircle } from "lucide-react";
import { usePrograms } from "@/hooks/use-programs";

export function MonitoredPrograms() {
  const { data, isLoading } = usePrograms({ limit: 5, publicOnly: true });
  const programs = data?.programs || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Monitored Programs</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3 rounded-lg border p-3">
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
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center space-x-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Monitored Programs</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/programs" className="flex-1 sm:flex-initial">
              <Button
                variant="outline"
                size="sm"
                className="flex w-full items-center justify-center space-x-1"
              >
                <span className="hidden sm:inline">View all</span>
                <span className="sm:hidden">All</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
            <Link href="/programs/new" className="flex-1 sm:flex-initial">
              <Button size="sm" className="flex w-full items-center justify-center space-x-1">
                <Plus className="h-3 w-3" />
                <span>Add</span>
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {programs.length === 0 ? (
          <div className="py-8 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="mb-2 font-medium text-muted-foreground">
              No programs are being monitored yet
            </p>
            <p className="mb-4 text-sm text-muted-foreground/70">
              Start monitoring the first Solana program
            </p>
            <Link href="/programs/new">
              <Button className="flex items-center space-x-2">
                <Plus className="h-4 w-4" />
                <span>Add Your First Program</span>
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {programs.slice(0, 5).map((program) => (
              <div
                key={program.id}
                className="flex flex-col gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Activity
                      className={`h-4 w-4 ${program.is_active ? "text-green-600" : "text-muted-foreground"}`}
                    />
                    <span className="font-medium">{program.name}</span>
                    <Badge variant={program.is_active ? "default" : "secondary"}>
                      {program.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {program.description && (
                    <p className="mb-2 text-sm text-muted-foreground">
                      {truncateString(program.description, 80)}
                    </p>
                  )}
                  <div className="space-y-1">
                    <p className="inline-block break-all rounded-sm bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {truncateString(program.program_id, 30)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {program.last_checked_at
                        ? `Last checked ${formatRelativeTime(program.last_checked_at)}`
                        : "Never checked"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:ml-4">
                  <Link href={`/programs/${program.id}`} className="flex-1 sm:flex-initial">
                    <Button variant="outline" size="sm" className="w-full">
                      View
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
            {programs.length > 5 && (
              <div className="pt-4 text-center">
                <Link href="/programs" className="block sm:inline-block">
                  <Button variant="outline" className="w-full sm:w-auto">
                    View all {programs.length} programs
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
