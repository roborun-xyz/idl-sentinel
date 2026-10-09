import type { ChangeSeverity } from "../db/changes";
import type { NotificationChange } from "./worker";

export const SEVERITY_ORDER: ChangeSeverity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_EMOJI: Record<ChangeSeverity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

export const MAX_CHANGES_PER_SEVERITY = 5;
const MAX_SUMMARY_LENGTH = 240;

export interface SeverityGroup {
  severity: ChangeSeverity;
  changes: NotificationChange[];
}

/**
 * Returns the public app URL without a trailing slash, or null when it is not
 * configured with an absolute http(s) URL.
 */
export function getAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

export function getProgramUrl(programDbId: string): string | null {
  const base = getAppUrl();
  return base ? `${base}/programs/${encodeURIComponent(programDbId)}` : null;
}

export function groupBySeverity(changes: NotificationChange[]): SeverityGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    changes: changes.filter((change) => change.severity === severity),
  })).filter((group) => group.changes.length > 0);
}

export function highestSeverity(changes: NotificationChange[]): ChangeSeverity {
  return groupBySeverity(changes)[0]?.severity ?? "low";
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "3 changes (1 critical, 2 low)" or "1 critical change". */
export function describeChangeCount(changes: NotificationChange[]): string {
  const groups = groupBySeverity(changes);
  if (changes.length === 1) return `1 ${groups[0].severity} change`;
  const breakdown = groups.map((group) => `${group.changes.length} ${group.severity}`).join(", ");
  return `${changes.length} changes (${breakdown})`;
}

/** Latest detection time across the batch, falling back to `now`. */
export function latestDetectedAt(changes: NotificationChange[], now = new Date()): Date {
  let latest = Number.NEGATIVE_INFINITY;
  for (const change of changes) {
    const time = Date.parse(change.detected_at);
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return Number.isFinite(latest) ? new Date(latest) : now;
}

/** Latest detection time across the batch, as "YYYY-MM-DD HH:MM:SS UTC". */
export function formatDetectedAt(changes: NotificationChange[], now = new Date()): string {
  return `${latestDetectedAt(changes, now).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function truncateSummary(summary: string, maxLength = MAX_SUMMARY_LENGTH): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack mrkdwn treats &, <, > as control characters. */
export function escapeSlackText(text: string): string {
  return escapeHtml(text);
}

/** Discord renders markdown; escape the characters that would change formatting. */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/[\\*_~`|>]/g, "\\$&");
}
