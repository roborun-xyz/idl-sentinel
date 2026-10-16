import { createHash } from "node:crypto";
import { notificationStore } from "./delivery";
import { runNotificationBatch, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";
import {
  SEVERITY_ORDER,
  describeChangeCount,
  getAppUrl,
  getProgramUrl,
  highestSeverity,
  truncateSummary,
} from "./format";
import { alertNoun } from "../changes/categories";
import type { ChangeSeverity } from "../db/changes";

export const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";
const PAGERDUTY_TIMEOUT_MS = 10_000;

const PAGERDUTY_SEVERITY: Record<ChangeSeverity, "critical" | "error" | "warning" | "info"> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "info",
};

/** Events API v2 integration keys are 32 alphanumeric characters. */
export function isPagerDutyRoutingKey(value: string): boolean {
  return /^[A-Za-z0-9]{32}$/.test(value.trim());
}

export function meetsSeverity(severity: ChangeSeverity, minimum: ChangeSeverity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(minimum);
}

/** One PagerDuty event per program batch; the dedup key keeps retries from opening twice. */
export function formatPagerDutyEvent(routingKey: string, changes: NotificationChange[]) {
  const program = changes[0].monitored_programs;
  const severity = highestSeverity(changes);
  const url = getProgramUrl(program.id);
  const lead = changes.find((change) => change.severity === severity) ?? changes[0];
  const dedup = createHash("sha256")
    .update(
      changes
        .map((change) => change.id)
        .sort()
        .join(",")
    )
    .digest("hex")
    .slice(0, 32);
  return {
    routing_key: routingKey,
    event_action: "trigger" as const,
    dedup_key: `idl-sentinel:${program.program_id}:${dedup}`,
    client: "IDL Sentinel",
    ...(getAppUrl() ? { client_url: getAppUrl() } : {}),
    payload: {
      summary: truncateSummary(
        `${alertNoun(changes.map((c) => c.change_type))} for ${program.name}: ${lead.change_summary}${
          changes.length > 1 ? ` (+${changes.length - 1} more)` : ""
        }`,
        1000
      ),
      source: program.program_id,
      severity: PAGERDUTY_SEVERITY[severity],
      timestamp: changes[changes.length - 1].detected_at,
      component: program.name,
      group: "solana-program",
      class: lead.change_type ?? "idl_change",
      custom_details: {
        program: program.name,
        address: program.program_id,
        summary: describeChangeCount(changes),
        changes: changes.map((change) => ({
          severity: change.severity,
          type: change.change_type ?? null,
          summary: change.change_summary,
          detected_at: change.detected_at,
        })),
      },
    },
    ...(url ? { links: [{ href: url, text: "Open in IDL Sentinel" }] } : {}),
  };
}

export async function sendPagerDutyEvent(event: unknown): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(PAGERDUTY_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      timeoutMs: PAGERDUTY_TIMEOUT_MS,
    });
    if (response.status !== 202 && !response.ok) {
      console.error("PagerDuty error:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending PagerDuty event:", error);
    return false;
  }
}

export async function sendPagerDutyNotifications(deadline = Date.now() + 45_000) {
  return runNotificationBatch(
    notificationStore("pagerduty", deadline),
    async (watcher, changes) => {
      const paging = changes.filter((change) =>
        meetsSeverity(change.severity, watcher.minSeverity ?? "high")
      );
      // Below the user's threshold is a successful no-op, not a failure to retry.
      if (!paging.length) return true;
      return sendPagerDutyEvent(formatPagerDutyEvent(watcher.destination, paging));
    },
    { deadline, concurrency: 3 }
  );
}

export async function testPagerDuty(routingKey: string): Promise<boolean> {
  return sendPagerDutyEvent({
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: `idl-sentinel:test:${Date.now()}`,
    client: "IDL Sentinel",
    payload: {
      summary: "IDL Sentinel test event: your PagerDuty integration is connected",
      source: "idl-sentinel",
      severity: "info",
    },
  });
}
