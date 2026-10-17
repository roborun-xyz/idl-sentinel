import { acquireCronLock, releaseCronLock } from "./lock";
import { sendWatchlistNotifications } from "../notifications/slack";
import { sendTelegramWatchlistNotifications } from "../notifications/telegram-user";
import { sendDiscordWatchlistNotifications } from "../notifications/discord";
import { sendWebhookNotifications } from "../notifications/webhook";
import { sendPagerDutyNotifications } from "../notifications/pagerduty";

type ChannelResult = { sent: number; failed: number; deferred: number; errors: string[] };

export interface ChannelLockDeps {
  acquire(name: string, runId: string): Promise<boolean>;
  release(name: string, runId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const LOCK_RETRY_MS = 1_000;
/** Time kept for sending after waiting for a busy lock. */
const SEND_RESERVE_MS = 5_000;

const defaultLockDeps: ChannelLockDeps = {
  acquire: (name, runId) => acquireCronLock(name, runId, 120_000),
  release: releaseCronLock,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

/**
 * Runs one channel's delivery under its lock, so two runs never send the same
 * pending changes. With `wait`, a busy lock is retried until shortly before the
 * deadline: changes recorded after the holder loaded its batch would otherwise
 * wait for the next scheduled run.
 */
export async function withChannelLock(
  name: string,
  deadline: number,
  send: (deadline: number) => Promise<ChannelResult>,
  { wait = false, deps = defaultLockDeps }: { wait?: boolean; deps?: ChannelLockDeps } = {}
): Promise<ChannelResult & { skipped?: true }> {
  const runId = crypto.randomUUID();
  while (!(await deps.acquire(name, runId))) {
    if (!wait || deps.now() + LOCK_RETRY_MS > deadline - SEND_RESERVE_MS) {
      return { sent: 0, failed: 0, deferred: 0, errors: [], skipped: true };
    }
    await deps.sleep(LOCK_RETRY_MS);
  }
  try {
    return await send(deadline);
  } finally {
    await deps.release(name, runId);
  }
}

/**
 * Delivers pending alerts on every channel. Detection runs pass
 * `waitForLock` after recording changes so a concurrent run cannot delay them.
 */
export async function runNotificationJobs(
  deadline = Date.now() + 45_000,
  { waitForLock = false }: { waitForLock?: boolean } = {}
) {
  const channel = (name: string, send: (deadline: number) => Promise<ChannelResult>) =>
    withChannelLock(name, deadline, send, { wait: waitForLock });
  const [slack, telegram_user, discord, webhook, pagerduty] = await Promise.all([
    channel("notify-slack", sendWatchlistNotifications),
    channel("notify-telegram", sendTelegramWatchlistNotifications),
    channel("notify-discord", sendDiscordWatchlistNotifications),
    channel("notify-webhook", sendWebhookNotifications),
    channel("notify-pagerduty", sendPagerDutyNotifications),
  ]);
  return { slack, telegram_user, discord, webhook, pagerduty };
}

/** Flattens per-channel errors as "channel:error" for cron responses. */
export function notificationErrors(results: Record<string, { errors: string[] }>): string[] {
  return Object.entries(results).flatMap(([name, result]) =>
    result.errors.map((e) => `${name}:${e}`)
  );
}
