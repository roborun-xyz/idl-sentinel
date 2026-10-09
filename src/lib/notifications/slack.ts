import { notificationStore } from "./delivery";
import { runNotificationBatch, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";
import {
  SEVERITY_EMOJI,
  MAX_CHANGES_PER_SEVERITY,
  capitalize,
  describeChangeCount,
  escapeSlackText,
  formatDetectedAt,
  getProgramUrl,
  groupBySeverity,
  highestSeverity,
  truncateSummary,
} from "./format";

const SLACK_WEBHOOK_TIMEOUT_MS = 10_000;

export interface SlackWebhookConfig {
  webhookUrl: string;
  userId: string;
  walletAddress: string;
}

/**
 * Sends a notification to Slack webhook
 */
export async function sendSlackNotification(
  webhookUrl: string,
  message: unknown
): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      timeoutMs: SLACK_WEBHOOK_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Slack webhook error:", response.status, errorText);
      return false;
    }

    console.log("Slack notification sent successfully");
    return true;
  } catch (error) {
    console.error("Error sending Slack notification:", error);
    return false;
  }
}

/**
 * Formats changes into a Slack message
 */
export function formatSlackMessage(
  programName: string,
  programId: string,
  changes: NotificationChange[],
  programUrl: string | null = changes[0] ? getProgramUrl(changes[0].monitored_programs.id) : null
) {
  const safeName = escapeSlackText(programName);
  if (changes.length === 0) {
    return {
      text: `IDL Sentinel: no changes detected for ${safeName}`,
    };
  }

  const severity = highestSeverity(changes);
  const summary = describeChangeCount(changes);
  const programLabel = programUrl ? `<${programUrl}|${safeName}>` : safeName;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${SEVERITY_EMOJI[severity]} IDL change: ${programName}`.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Program:*\n${programLabel}` },
        { type: "mrkdwn", text: `*Changes:*\n${summary}` },
        { type: "mrkdwn", text: `*Address:*\n\`${programId}\`` },
        { type: "mrkdwn", text: `*Detected:*\n${formatDetectedAt(changes)}` },
      ],
    },
    { type: "divider" },
  ];

  for (const group of groupBySeverity(changes)) {
    const lines = group.changes
      .slice(0, MAX_CHANGES_PER_SEVERITY)
      .map((change) => `• ${escapeSlackText(truncateSummary(change.change_summary))}`);
    const remaining = group.changes.length - MAX_CHANGES_PER_SEVERITY;
    if (remaining > 0) lines.push(`• … and ${remaining} more`);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${SEVERITY_EMOJI[group.severity]} ${capitalize(group.severity)} (${group.changes.length})*\n${lines.join("\n")}`,
      },
    });
  }

  if (programUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View diff in IDL Sentinel", emoji: true },
          url: programUrl,
        },
      ],
    });
  }

  return {
    text: `${SEVERITY_EMOJI[severity]} IDL Sentinel: ${summary} for ${programName} (${programId})`,
    blocks,
  };
}

export async function sendWatchlistNotifications(deadline = Date.now() + 45_000) {
  return runNotificationBatch(
    notificationStore("slack", deadline),
    async (watcher, changes) => {
      const program = changes[0].monitored_programs;
      return sendSlackNotification(
        watcher.destination,
        formatSlackMessage(program.name, program.program_id, changes)
      );
    },
    { deadline, concurrency: 5 }
  );
}

/**
 * Tests Slack webhook by sending a test message
 */
export async function testSlackWebhook(webhookUrl: string): Promise<boolean> {
  try {
    const testMessage = {
      text: "🧪 IDL Sentinel Test",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🧪 IDL Sentinel Test",
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Your Slack webhook is connected. IDL change alerts for programs in your watchlist will arrive in this channel.\n\n*Sent:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
          },
        },
      ],
    };

    return await sendSlackNotification(webhookUrl, testMessage);
  } catch (error) {
    console.error("Error testing Slack webhook:", error);
    return false;
  }
}
