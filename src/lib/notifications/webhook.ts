import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { notificationStore } from "./delivery";
import { runNotificationBatch, type NotificationChange } from "./worker";
import { getAppUrl, getProgramUrl } from "./format";
import { postToPublicHttps, webhookUrlError } from "./url-guard";
import { changeCategory } from "../changes/categories";

const WEBHOOK_TIMEOUT_MS = 10_000;
export const SIGNATURE_HEADER = "x-idl-sentinel-signature";
export const TIMESTAMP_HEADER = "x-idl-sentinel-timestamp";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, the scheme receivers verify. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Reference verifier for receivers; rejects stale timestamps to stop replays. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  toleranceSeconds = 300,
  now = Date.now()
): boolean {
  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface WebhookPayload {
  type: "changes.detected" | "test";
  version: 1;
  sent_at: string;
  program: { id: string; address: string; name: string; url: string | null } | null;
  changes: Array<{
    id: string;
    type: string | null;
    category: string;
    severity: string;
    summary: string;
    detected_at: string;
    api_url: string | null;
  }>;
}

export function formatWebhookPayload(
  changes: NotificationChange[],
  now = new Date()
): WebhookPayload {
  const program = changes[0]?.monitored_programs;
  const base = getAppUrl();
  return {
    type: "changes.detected",
    version: 1,
    sent_at: now.toISOString(),
    program: program
      ? {
          id: program.id,
          address: program.program_id,
          name: program.name,
          url: getProgramUrl(program.id),
        }
      : null,
    changes: changes.map((change) => ({
      id: change.id,
      type: change.change_type ?? null,
      category: changeCategory(change.change_type),
      severity: change.severity,
      summary: change.change_summary,
      detected_at: change.detected_at,
      api_url: base ? `${base}/api/v1/changes/${encodeURIComponent(change.id)}` : null,
    })),
  };
}

export async function sendWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<boolean> {
  try {
    if (webhookUrlError(url)) return false;
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    // The socket's own DNS lookup refuses private addresses, so rebinding cannot
    // swap in an internal host after validation; redirects are never followed.
    const status = await postToPublicHttps(
      new URL(url),
      {
        "Content-Type": "application/json",
        "User-Agent": "IDL-Sentinel-Webhook/1",
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: signWebhook(secret, timestamp, body),
      },
      body,
      WEBHOOK_TIMEOUT_MS
    );
    if (status < 200 || status >= 300) {
      console.error("Webhook delivery failed:", status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending webhook:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function sendWebhookNotifications(deadline = Date.now() + 45_000) {
  return runNotificationBatch(
    notificationStore("webhook", deadline),
    async (watcher, changes) =>
      !!watcher.secret &&
      sendWebhook(watcher.destination, watcher.secret, formatWebhookPayload(changes)),
    { deadline, concurrency: 5 }
  );
}

export async function testWebhook(url: string, secret: string): Promise<boolean> {
  return sendWebhook(url, secret, {
    type: "test",
    version: 1,
    sent_at: new Date().toISOString(),
    program: null,
    changes: [],
  });
}
