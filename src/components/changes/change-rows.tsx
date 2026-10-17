"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn, formatRelativeTime, severityDotColors } from "@/lib/utils";
import { CATEGORY_LABELS, changeCategory, changeTypeLabel } from "@/lib/changes/categories";
import { severityCounts, type ChangeGroup, type GroupableChange } from "@/lib/changes/grouping";

export interface ChangeRowData extends GroupableChange {
  change_type: string;
  change_summary: string;
  monitored_programs?: { name: string; program_id: string };
}

const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-yellow-700 dark:text-yellow-400",
  low: "text-blue-600 dark:text-blue-400",
};

function SeverityDot({ severity, className }: { severity: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 flex-shrink-0 rounded-full",
        severityDotColors[severity as keyof typeof severityDotColors] ?? "bg-gray-500",
        className
      )}
    />
  );
}

/** One change on one line: severity, what changed, and a link to its own page. */
export function ChangeRow({ change, showTime }: { change: ChangeRowData; showTime: boolean }) {
  return (
    <li>
      <Link
        href={`/changes/${change.id}`}
        className="group flex items-center gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SeverityDot severity={change.severity} />
        {/* Phones keep the dot; the word is announced either way. */}
        <span
          className={cn(
            "sr-only text-xs font-medium capitalize sm:not-sr-only sm:w-14 sm:flex-shrink-0",
            SEVERITY_TEXT[change.severity]
          )}
        >
          {change.severity}
        </span>
        <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
          <span className="block truncate font-medium sm:inline sm:flex-shrink-0">
            {changeTypeLabel(change.change_type)}
          </span>
          <span className="block truncate text-muted-foreground sm:inline">
            {change.change_summary}
          </span>
        </span>
        {changeCategory(change.change_type) !== "idl" && (
          <span className="hidden flex-shrink-0 rounded-sm border px-1.5 text-[10px] text-muted-foreground sm:inline">
            {CATEGORY_LABELS[changeCategory(change.change_type)]}
          </span>
        )}
        {showTime && (
          <time
            dateTime={change.detected_at}
            className="flex-shrink-0 text-xs text-muted-foreground"
          >
            {formatRelativeTime(change.detected_at)}
          </time>
        )}
        <ChevronRight
          aria-hidden
          className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

const PREVIEW = 3;

/**
 * Changes from one event (a deploy, a new IDL version) under one header that
 * carries the highest severity, so a dozen low-severity edits cannot bury the
 * one that matters. Long groups show the most severe few until expanded.
 */
export function ChangeGroupRows({
  group,
  showProgram,
  truncated = false,
}: {
  group: ChangeGroup<ChangeRowData>;
  showProgram: boolean;
  /** The group may continue past the rows loaded so far. */
  truncated?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const program = group.changes[0].monitored_programs;
  const single = group.changes.length === 1 && !truncated;
  const visible = expanded ? group.changes : group.changes.slice(0, PREVIEW);
  const hidden = group.changes.length - visible.length;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-2 text-xs text-muted-foreground">
        {!single && <SeverityDot severity={group.severity} />}
        {showProgram && program && (
          <Link
            href={`/programs/${group.programId}`}
            className="min-w-0 truncate font-semibold text-foreground hover:underline"
          >
            {program.name}
          </Link>
        )}
        {!single && (
          <span className="whitespace-nowrap">
            {group.changes.length}
            {truncated && "+"} changes
            <span className="hidden sm:inline">
              {" "}
              · {severityCounts(group.changes)}
              {truncated && " so far"}
            </span>
          </span>
        )}
        <time
          dateTime={group.detectedAt}
          className="ml-auto whitespace-nowrap"
          title={group.detectedAt}
        >
          {formatRelativeTime(group.detectedAt)}
        </time>
      </div>
      <ul className={cn(!single && "border-l-2 border-muted pl-1", single && "pl-1")}>
        {visible.map((change) => (
          <ChangeRow key={change.id} change={change} showTime={false} />
        ))}
      </ul>
      {group.changes.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="ml-3 mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}
