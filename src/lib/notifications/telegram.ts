import { supabaseAdmin } from "../supabase";
import type { IdlChange } from "../supabase";
import { fetchWithTimeout } from "../http";

const TELEGRAM_API_TIMEOUT_MS = 10_000;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Gets Telegram configuration from environment variables
 */
export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.log("Telegram not configured (missing environment variables)");
      return null;
    }

    return {
      botToken,
      chatId,
    };
  } catch (error) {
    console.error("Error getting Telegram config:", error);
    return null;
  }
}

/**
 * Sends a notification to Telegram
 */
export async function sendTelegramNotification(
  config: TelegramConfig,
  message: string
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

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
 * Formats changes into a Telegram message
 */
export function formatChangesMessage(
  programName: string,
  programId: string,
  changes: IdlChange[]
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

/**
 * Sends notifications for unnotified changes
 */
export async function sendPendingNotifications(): Promise<{
  sent: number;
  failed: number;
  errors: string[];
}> {
  const result = {
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // Get Telegram configuration
    const config = await getTelegramConfig();
    if (!config) {
      result.errors.push("Telegram not configured");
      return result;
    }

    // Get unnotified changes
    const { data: changes, error } = await supabaseAdmin
      .from("idl_changes")
      .select(
        `
        *,
        monitored_programs!inner(name, program_id)
      `
      )
      .eq("notified", false)
      .order("detected_at", { ascending: true });

    if (error) {
      result.errors.push(`Failed to fetch unnotified changes: ${error.message}`);
      return result;
    }

    if (!changes || changes.length === 0) {
      console.log("No pending notifications to send");
      return result;
    }

    // Group changes by program
    const changesByProgram = new Map<string, (typeof changes)[number][]>();

    for (const change of changes) {
      const programId = change.monitored_programs.program_id;
      if (!changesByProgram.has(programId)) {
        changesByProgram.set(programId, []);
      }
      changesByProgram.get(programId)!.push(change);
    }

    // Send notifications for each program
    for (const [programId, programChanges] of changesByProgram) {
      try {
        const programName = programChanges[0].monitored_programs.name;
        const message = formatChangesMessage(programName, programId, programChanges);

        const success = await sendTelegramNotification(config, message);

        if (success) {
          // Mark changes as notified
          const changeIds = programChanges.map((c) => c.id);

          const { error: updateError } = await supabaseAdmin
            .from("idl_changes")
            .update({
              notified: true,
              notified_at: new Date().toISOString(),
            })
            .in("id", changeIds);

          if (updateError) {
            console.error("Error marking changes as notified:", updateError);
            result.errors.push(`Failed to mark changes as notified for ${programName}`);
          } else {
            result.sent += programChanges.length;
            console.log(
              `Sent notification for ${programName} with ${programChanges.length} changes`
            );
          }
        } else {
          result.failed += programChanges.length;
          result.errors.push(`Failed to send notification for ${programName}`);
        }

        // Add delay between notifications to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.failed += programChanges.length;
        result.errors.push(
          `Error processing notifications for program ${programId}: ${errorMessage}`
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Fatal error in notification processing: ${errorMessage}`);
  }

  return result;
}

/**
 * Tests Telegram configuration by sending a test message
 */
export async function testTelegramNotification(): Promise<boolean> {
  try {
    const config = await getTelegramConfig();
    if (!config) {
      console.error("Telegram not configured for testing");
      return false;
    }

    const testMessage = `🧪 *IDL Sentinel Test*\n\nThis is a test notification to verify your Telegram bot configuration.\n\n⏰ *Sent:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;

    return await sendTelegramNotification(config, testMessage);
  } catch (error) {
    console.error("Error testing Telegram notification:", error);
    return false;
  }
}
