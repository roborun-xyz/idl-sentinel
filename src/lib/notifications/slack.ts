import { notificationStore } from "./delivery";
import { runNotificationBatch, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";

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
  changes: NotificationChange[]
) {
  if (changes.length === 0) {
    return {
      text: `🔍 IDL Sentinel - No changes detected for program *${programName}*`,
    };
  }

  // Group changes by severity
  const changesBySeverity = {
    critical: changes.filter((c) => c.severity === "critical"),
    high: changes.filter((c) => c.severity === "high"),
    medium: changes.filter((c) => c.severity === "medium"),
    low: changes.filter((c) => c.severity === "low"),
  };

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚨 IDL Sentinel - Changes Detected",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Program:*\n${programName}`,
        },
        {
          type: "mrkdwn",
          text: `*Total Changes:*\n${changes.length}`,
        },
        {
          type: "mrkdwn",
          text: `*Address:*\n\`${programId}\``,
        },
        {
          type: "mrkdwn",
          text: `*Detected:*\n${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
        },
      ],
    },
    {
      type: "divider",
    },
  ];

  // Add changes by severity
  for (const [severity, severityChanges] of Object.entries(changesBySeverity)) {
    if (severityChanges.length === 0) continue;

    const severityTitle = severity.charAt(0).toUpperCase() + severity.slice(1);

    const changesList = severityChanges
      .slice(0, 5)
      .map((change) => `• ${change.change_summary}`)
      .join("\n");

    const moreText =
      severityChanges.length > 5 ? `\n• ... and ${severityChanges.length - 5} more` : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${severityTitle} (${severityChanges.length})*\n${changesList}${moreText}`,
      },
    });
  }

  return {
    text: `🚨 IDL Sentinel - Changes detected for ${programName}`,
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
            text: `This is a test notification to verify your Slack webhook configuration.\n\n*Sent:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
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
