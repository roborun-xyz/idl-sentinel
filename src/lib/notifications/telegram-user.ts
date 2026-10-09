import { notificationStore } from "./delivery";
import { runNotificationBatch, createSendLimiter, type NotificationChange } from "./worker";
import { fetchWithTimeout } from "../http";
import {
  SEVERITY_EMOJI,
  MAX_CHANGES_PER_SEVERITY,
  capitalize,
  describeChangeCount,
  escapeHtml,
  formatDetectedAt,
  getProgramUrl,
  groupBySeverity,
  highestSeverity,
  truncateSummary,
} from "./format";

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
        parse_mode: "HTML",
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

const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Formats changes into a Telegram HTML message.
 */
export function formatTelegramMessage(
  programName: string,
  programId: string,
  changes: NotificationChange[],
  programUrl: string | null = changes[0] ? getProgramUrl(changes[0].monitored_programs.id) : null
): string {
  const safeName = escapeHtml(programName);
  if (changes.length === 0) {
    return `🔍 <b>IDL Sentinel</b>\n\nNo changes detected for program <b>${safeName}</b>`;
  }

  const severity = highestSeverity(changes);
  const programLabel = programUrl
    ? `<a href="${programUrl}">${safeName}</a>`
    : `<b>${safeName}</b>`;

  const header = [
    `${SEVERITY_EMOJI[severity]} <b>IDL change detected</b>`,
    "",
    `📋 <b>Program:</b> ${programLabel}`,
    `🔗 <b>Address:</b> <code>${programId}</code>`,
    `📊 <b>Changes:</b> ${escapeHtml(describeChangeCount(changes))}`,
    "",
  ];

  const footer = [`⏰ <b>Detected:</b> ${formatDetectedAt(changes)}`];
  if (programUrl) footer.push(`<a href="${programUrl}">View diff in IDL Sentinel</a>`);

  const sections: string[] = [];
  for (const group of groupBySeverity(changes)) {
    const lines = [
      `<b>${SEVERITY_EMOJI[group.severity]} ${capitalize(group.severity)} (${group.changes.length})</b>`,
    ];
    for (const change of group.changes.slice(0, MAX_CHANGES_PER_SEVERITY)) {
      lines.push(`• ${escapeHtml(truncateSummary(change.change_summary))}`);
    }
    const remaining = group.changes.length - MAX_CHANGES_PER_SEVERITY;
    if (remaining > 0) lines.push(`• … and ${remaining} more`);
    sections.push(lines.join("\n"));
  }

  const build = (body: string[]) => [...header, ...body, "", ...footer].join("\n");
  let message = build(sections.flatMap((section) => [section, ""]));

  // Telegram rejects messages above 4096 characters; drop detail lines until it fits.
  while (message.length > TELEGRAM_MESSAGE_LIMIT && sections.length > 0) {
    const omitted = sections.length;
    sections.pop();
    message = build([
      ...sections.flatMap((section) => [section, ""]),
      `<i>${omitted} more severity group${omitted === 1 ? "" : "s"} omitted. Open the program page for the full list.</i>`,
    ]);
  }

  return message;
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

    const testMessage = `🧪 <b>IDL Sentinel Test</b>\n\nYour Telegram account is connected. IDL change alerts for programs in your watchlist will arrive here.\n\n⏰ <b>Sent:</b> ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessage,
        parse_mode: "HTML",
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
