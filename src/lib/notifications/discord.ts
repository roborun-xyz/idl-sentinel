import { notificationStore } from "./delivery";
import { runNotificationBatch, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";
import {
  SEVERITY_EMOJI,
  MAX_CHANGES_PER_SEVERITY,
  capitalize,
  describeChangeCount,
  escapeDiscordMarkdown,
  getProgramUrl,
  groupBySeverity,
  highestSeverity,
  latestDetectedAt,
  truncateSummary,
} from "./format";
import type { ChangeSeverity } from "../db/changes";

const DISCORD_WEBHOOK_TIMEOUT_MS = 10_000;
const DISCORD_FIELD_LIMIT = 1024;
const DISCORD_SUMMARY_LENGTH = 180;

const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/;

const SEVERITY_COLORS: Record<ChangeSeverity, number> = {
  critical: 0xef4444,
  high: 0xf97316,
  medium: 0xeab308,
  low: 0x3b82f6,
};

export function isDiscordWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK_PATTERN.test(url.trim());
}

/**
 * Posts a payload to a Discord webhook. Discord answers 204 on success.
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  payload: unknown
): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: DISCORD_WEBHOOK_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord webhook error:", response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending Discord notification:", error);
    return false;
  }
}

/**
 * Formats changes into a Discord webhook payload with a single embed.
 */
export function formatDiscordMessage(
  programName: string,
  programId: string,
  changes: NotificationChange[],
  programUrl: string | null = changes[0] ? getProgramUrl(changes[0].monitored_programs.id) : null
) {
  const safeName = escapeDiscordMarkdown(programName);
  if (changes.length === 0) {
    return {
      username: "IDL Sentinel",
      content: `No changes detected for program **${safeName}**`,
      allowed_mentions: { parse: [] },
    };
  }

  const severity = highestSeverity(changes);
  const fields = groupBySeverity(changes).map((group) => {
    const lines = group.changes
      .slice(0, MAX_CHANGES_PER_SEVERITY)
      .map(
        (change) =>
          `• ${escapeDiscordMarkdown(truncateSummary(change.change_summary, DISCORD_SUMMARY_LENGTH))}`
      );
    const remaining = group.changes.length - MAX_CHANGES_PER_SEVERITY;
    if (remaining > 0) lines.push(`• … and ${remaining} more`);
    let value = lines.join("\n");
    if (value.length > DISCORD_FIELD_LIMIT) value = `${value.slice(0, DISCORD_FIELD_LIMIT - 1)}…`;
    return {
      name: `${SEVERITY_EMOJI[group.severity]} ${capitalize(group.severity)} (${group.changes.length})`,
      value,
    };
  });

  const embed: Record<string, unknown> = {
    title: `${SEVERITY_EMOJI[severity]} ${safeName}: ${describeChangeCount(changes)}`.slice(0, 256),
    description: `\`${programId}\``,
    color: SEVERITY_COLORS[severity],
    fields,
    timestamp: latestDetectedAt(changes).toISOString(),
    footer: {
      text: programUrl ? "IDL Sentinel · click the title to view the diff" : "IDL Sentinel",
    },
  };
  if (programUrl) embed.url = programUrl;

  return {
    username: "IDL Sentinel",
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}

export async function sendDiscordWatchlistNotifications(deadline = Date.now() + 45_000) {
  return runNotificationBatch(
    notificationStore("discord", deadline),
    async (watcher, changes) => {
      const program = changes[0].monitored_programs;
      return sendDiscordNotification(
        watcher.destination,
        formatDiscordMessage(program.name, program.program_id, changes)
      );
    },
    { deadline, concurrency: 3 }
  );
}

/**
 * Tests a Discord webhook by sending a short message.
 */
export async function testDiscordWebhook(webhookUrl: string): Promise<boolean> {
  const sent = new Date().toISOString().replace("T", " ").slice(0, 19);
  return sendDiscordNotification(webhookUrl, {
    username: "IDL Sentinel",
    embeds: [
      {
        title: "🧪 IDL Sentinel test",
        description: `Your Discord webhook is connected. IDL change alerts for programs in your watchlist will arrive in this channel.\n\n**Sent:** ${sent} UTC`,
        color: 0x3b82f6,
      },
    ],
    allowed_mentions: { parse: [] },
  });
}
