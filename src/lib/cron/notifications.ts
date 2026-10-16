import { acquireCronLock, releaseCronLock } from "./lock";
import { sendWatchlistNotifications } from "../notifications/slack";
import { sendTelegramWatchlistNotifications } from "../notifications/telegram-user";
import { sendDiscordWatchlistNotifications } from "../notifications/discord";
import { sendWebhookNotifications } from "../notifications/webhook";
import { sendPagerDutyNotifications } from "../notifications/pagerduty";

export async function runNotificationJobs(deadline = Date.now() + 45_000) {
  async function channel(
    name: string,
    send: (
      deadline: number
    ) => Promise<{ sent: number; failed: number; deferred: number; errors: string[] }>
  ) {
    const runId = crypto.randomUUID();
    const locked = await acquireCronLock(name, runId, 120_000);
    if (!locked) return { sent: 0, failed: 0, deferred: 0, errors: [], skipped: true };
    try {
      return await send(deadline);
    } finally {
      await releaseCronLock(name, runId);
    }
  }
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
