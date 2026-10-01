import { notificationStore } from "./delivery";
import { runNotificationBatch, createSendLimiter, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";

const TELEGRAM_API_TIMEOUT_MS = 10_000;

export interface TelegramUserConfig {
  userId: string;
  walletAddress: string;
  chatId: string;
}

/**
 * Sends a notification to a user's personal Telegram chat using the shared bot
 */
export async function sendTelegramUserNotification(
  config: TelegramUserConfig,
  message: string
): Promise<boolean> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      return false;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      timeoutMs: TELEGRAM_API_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Telegram API error:", response.status, errorText);
      return false;
    }

    const result = await response.json();
    console.log("Telegram notification sent successfully:", result.message_id);
    return true;
  } catch (error) {
    console.error("Error sending Telegram notification:", error);
    return false;
  }
}

/**
 * Formats changes into a Telegram message (same format as admin notifications)
 */
export function formatTelegramMessage(
  programName: string,
  programId: string,
  changes: NotificationChange[]
): string {
  if (changes.length === 0) {
    return `🔍 *IDL Sentinel*\n\nNo changes detected for program *${escapeMarkdown(programName)}*`;
  }

  // Group changes by severity
  const changesBySeverity = {
    critical: changes.filter((c) => c.severity === "critical"),
    high: changes.filter((c) => c.severity === "high"),
    medium: changes.filter((c) => c.severity === "medium"),
    low: changes.filter((c) => c.severity === "low"),
  };

  let message = `🚨 *IDL Sentinel - Changes Detected*\n\n`;
  message += `📋 *Program:* ${escapeMarkdown(programName)}\n`;
  message += `🔗 *Address:* \`${programId}\`\n`;
  message += `📊 *Total Changes:* ${changes.length}\n\n`;

  // Add changes by severity
  for (const [severity, severityChanges] of Object.entries(changesBySeverity)) {
    if (severityChanges.length === 0) continue;

    const severityTitle = severity.charAt(0).toUpperCase() + severity.slice(1);

    message += `*${severityTitle} (${severityChanges.length})*\n`;

    for (const change of severityChanges.slice(0, 5)) {
      // Limit to 5 per severity
      message += `• ${escapeMarkdown(change.change_summary)}\n`;
    }

    if (severityChanges.length > 5) {
      message += `• ... and ${severityChanges.length - 5} more\n`;
    }

    message += "\n";
  }

  // Add timestamp
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  message += `⏰ *Detected:* ${timestamp} UTC`;

  return message;
}

/**
 * Escapes Markdown special characters for Telegram
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export async function sendTelegramWatchlistNotifications(deadline = Date.now() + 45_000) {
  const limit = createSendLimiter(50, 1000);
  return runNotificationBatch(
    notificationStore("telegram_user", deadline),
    async (watcher, changes) => {
      await limit(watcher.destination);
      const program = changes[0].monitored_programs;
      return sendTelegramUserNotification(
        {
          userId: watcher.userId,
          walletAddress: watcher.walletAddress,
          chatId: watcher.destination,
        },
        formatTelegramMessage(program.name, program.program_id, changes)
      );
    },
    { deadline, concurrency: 3 }
  );
}

/**
 * Tests Telegram configuration by sending a test message using the shared bot
 */
export async function testTelegramConfig(chatId: string): Promise<boolean> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      return false;
    }

    const testMessage = `🧪 *IDL Sentinel Test*\n\nThis is a test notification to verify your Telegram configuration.\n\n⏰ *Sent:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessage,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      timeoutMs: TELEGRAM_API_TIMEOUT_MS,
    });

    return response.ok;
  } catch (error) {
    console.error("Error testing Telegram config:", error);
    return false;
  }
}
