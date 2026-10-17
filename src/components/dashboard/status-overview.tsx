"use client";

import { useState } from "react";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import { usePrograms } from "@/hooks/use-programs";
import { useMonitoringStats } from "@/hooks/use-monitoring-stats";
import { assessRisk, needsAttention } from "@/lib/chain/risk";
import { RiskBadges, toneIcon } from "@/components/programs/risk";

/**
 * Status-page style overview: one sentence about every monitored program,
 * then only the programs that need a look. Replaces counters that asked the
 * reader to do the interpretation.
 */
export function StatusOverview() {
  // Fallback clock for placeholder rows, which report a fetch time of 0.
  const [mountedAt] = useState(() => Date.now());
  const {
    data,
    isLoading,
    isError,
    dataUpdatedAt: fetchedAt,
  } = usePrograms({
    limit: 100,
    publicOnly: true,
  });
  const { data: statsData } = useMonitoringStats();
  const stats = statsData?.stats;

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (isError || !data) {
    return (
      <p role="alert" className="rounded-md border p-4 text-sm text-muted-foreground">
        Program status is unavailable right now.
      </p>
    );
  }

  const programs = data.programs;
  const dataUpdatedAt = fetchedAt || mountedAt;
  // The overview reads one page; past it, say so instead of implying full coverage.
  const total = data.pagination.total;
  const scope = data.pagination.hasMore
    ? `the first ${programs.length} of ${total}`
    : `${programs.length}`;
  const attention = programs
    .filter((p) => needsAttention(p.chain, dataUpdatedAt))
    .map((p) => ({ program: p, risk: assessRisk(p.chain, dataUpdatedAt) }))
    .sort((a, b) => (a.risk.tone === b.risk.tone ? 0 : a.risk.tone === "danger" ? -1 : 1));
  const tone = attention.some((a) => a.risk.tone === "danger")
    ? "danger"
    : attention.length
      ? "warning"
      : programs.length
        ? "ok"
        : "unknown";
  const { Icon, icon } = toneIcon(tone);
  const unchecked = programs.filter((p) => !p.chain).length;
  const headline = !programs.length
    ? "No programs monitored yet"
    : attention.length
      ? `${attention.length} of ${scope} programs ${attention.length === 1 ? "needs" : "need"} attention`
      : `No pending upgrades across ${scope} monitored programs`;

  const facts = [
    unchecked > 0 && `${unchecked} not checked on chain yet`,
    stats && `${stats.totalChanges.toLocaleString()} changes recorded`,
    stats && `${stats.recentChanges.toLocaleString()} in the last 24 hours`,
    stats?.lastMonitoringRun && `IDLs checked ${formatRelativeTime(stats.lastMonitoringRun)}`,
  ].filter(Boolean);

  return (
    <section
      aria-label="Monitoring status"
      className={cn(
        "overflow-hidden rounded-md border",
        tone === "danger" && "border-red-300 dark:border-red-900",
        tone === "warning" && "border-amber-300 dark:border-amber-900",
        tone === "ok" && "border-green-300 dark:border-green-900"
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 p-4 sm:items-center",
          tone === "danger" && "bg-red-50 dark:bg-red-950/40",
          tone === "warning" && "bg-amber-50 dark:bg-amber-950/30",
          tone === "ok" && "bg-green-50 dark:bg-green-950/30",
          tone === "unknown" && "bg-muted/40"
        )}
      >
        <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0 sm:mt-0", icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{headline}</h2>
          {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
        </div>
      </div>
      {attention.length > 0 && (
        <ul className="divide-y border-t">
          {attention.map(({ program, risk }) => {
            const style = toneIcon(risk.tone);
            return (
              <li key={program.id}>
                <Link
                  href={`/programs/${program.id}`}
                  className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/50"
                >
                  <style.Icon className={cn("h-4 w-4 flex-shrink-0", style.icon)} aria-hidden />
                  <span className="font-medium">{program.name}</span>
                  <span className="text-muted-foreground">{risk.headline}</span>
                  <RiskBadges
                    summary={program.chain}
                    now={dataUpdatedAt}
                    className="ml-auto hidden sm:flex"
                  />
                  <ChevronRight
                    className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
