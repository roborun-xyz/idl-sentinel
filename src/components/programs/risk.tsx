"use client";

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assessRisk,
  riskBadges,
  type BadgeTone,
  type ChainSummary,
  type RiskTone,
} from "@/lib/chain/risk";

const BADGE_STYLES: Record<BadgeTone, string> = {
  danger:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  ok: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

/** Compact status badges, Solscan style: code mutability, control, verification, queue. */
export function RiskBadges({
  summary,
  now,
  className,
}: {
  summary: ChainSummary | null;
  now: number;
  className?: string;
}) {
  const badges = riskBadges(summary, now);
  if (!badges.length) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Status">
      {badges.map((badge) => (
        <li
          key={badge.key}
          title={badge.title}
          className={cn(
            "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none",
            BADGE_STYLES[badge.tone]
          )}
        >
          {badge.label}
        </li>
      ))}
    </ul>
  );
}

const TONE_STYLES: Record<RiskTone, { box: string; icon: string; Icon: LucideIcon }> = {
  danger: {
    box: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
    icon: "text-red-600 dark:text-red-400",
    Icon: AlertOctagon,
  },
  warning: {
    box: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  notice: {
    box: "border-border bg-muted/40",
    icon: "text-muted-foreground",
    Icon: Info,
  },
  ok: {
    box: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle2,
  },
  unknown: {
    box: "border-dashed border-border bg-muted/30",
    icon: "text-muted-foreground",
    Icon: CircleDashed,
  },
};

export function toneIcon(tone: RiskTone) {
  return TONE_STYLES[tone];
}

/**
 * The page's answer to "is this program safe to depend on right now?", in the
 * spirit of a status page banner: one verdict, then every finding behind it.
 */
export function RiskBanner({
  summary,
  now,
  footer,
}: {
  summary: ChainSummary | null;
  now: number;
  footer?: React.ReactNode;
}) {
  const risk = assessRisk(summary, now);
  const { box, icon, Icon } = TONE_STYLES[risk.tone];
  const findings = risk.findings.filter((f) => f.title !== risk.headline);
  const lead = risk.findings.find((f) => f.title === risk.headline);
  return (
    <section aria-label="Risk summary" className={cn("rounded-md border p-4 sm:p-5", box)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0", icon)} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="text-base font-semibold leading-tight sm:text-lg">{risk.headline}</h2>
            {lead?.detail && <p className="mt-1 text-sm text-muted-foreground">{lead.detail}</p>}
          </div>
          {findings.length > 0 && (
            <ul className="space-y-1 text-sm">
              {findings.map((finding) => {
                const style = TONE_STYLES[finding.tone];
                return (
                  <li key={finding.title} className="flex items-start gap-2">
                    <style.Icon
                      className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", style.icon)}
                      aria-hidden
                    />
                    <span>
                      <span className="font-medium">{finding.title}</span>
                      {finding.detail && (
                        <span className="text-muted-foreground"> · {finding.detail}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {footer && <div className="text-xs text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </section>
  );
}
