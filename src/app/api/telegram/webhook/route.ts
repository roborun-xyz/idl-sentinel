import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { consumeConnectionToken } from "@/lib/telegram/connection-tokens";
import { fetchWithTimeout } from "@/lib/http";

const TELEGRAM_API_TIMEOUT_MS = 10_000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

/**
 * Telegram webhook endpoint
 * Receives updates from the Telegram bot
 */
export async function POST(request: NextRequest) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      return NextResponse.json({ error: "Bot not configured" }, { status: 500 });
    }

    // Parse the update from Telegram
    const update: TelegramUpdate = await request.json();

    console.log("Received Telegram update:", JSON.stringify(update, null, 2));

    // Only process messages
    if (!update.message || !update.message.text) {
      return NextResponse.json({ ok: true });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text!.trim(); // Already checked above that text exists

    // Handle /start command with connection token
    if (text.startsWith("/start ")) {
      const token = text.substring(7).trim();

      if (!token) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "❌ Invalid connection link. Please generate a new one from the IDL Sentinel settings page."
        );
        return NextResponse.json({ ok: true });
      }

      // Verify and consume the token
      const userId = await consumeConnectionToken(token);

      if (!userId) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "❌ Connection link expired or invalid. Please generate a new one from the IDL Sentinel settings page.\n\n" +
            "Links expire after 10 minutes."
        );
        return NextResponse.json({ ok: true });
      }

      // Update user's telegram_chat_id
      const { data: user, error: updateError } = await supabaseAdmin
        .from("users")
        .update({
          telegram_chat_id: chatId.toString(),
          telegram_username: message.from.username || null,
        })
        .eq("id", userId)
        .select("wallet_address")
        .single();

      if (updateError || !user) {
        console.error("Error updating user telegram_chat_id:", updateError);
        await sendTelegramMessage(
          botToken,
          chatId,
          "❌ Failed to connect your account. Please try again."
        );
        return NextResponse.json({ ok: true });
      }

      // Send success message
      const walletShort = user.wallet_address.substring(0, 8) + "...";
      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ *Successfully connected!*\n\n` +
          `Your Telegram is now linked to wallet: \`${walletShort}\`\n\n` +
          `You'll receive notifications here when programs in your watchlist have IDL changes.\n\n` +
          `🔔 Manage your watchlist at: ${process.env.NEXT_PUBLIC_APP_URL || "https://idl-sentinel.com"}/settings`
      );

      return NextResponse.json({ ok: true });
    }

    // Handle /help command
    if (text === "/help" || text === "/start") {
      await sendTelegramMessage(
        botToken,
        chatId,
        `🤖 *IDL Sentinel Bot*\n\n` +
          `This bot sends you notifications when Solana programs in your watchlist have IDL changes.\n\n` +
          `*Commands:*\n` +
          `/start <token> - Connect your account\n` +
          `/status - Check connection status\n` +
          `/help - Show this help message\n\n` +
          `Get started at: ${process.env.NEXT_PUBLIC_APP_URL || "https://idl-sentinel.com"}`
      );
      return NextResponse.json({ ok: true });
    }

    // Handle /status command
    if (text === "/status") {
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("wallet_address, telegram_username")
        .eq("telegram_chat_id", chatId.toString())
        .single();

      if (user) {
        const walletShort = user.wallet_address.substring(0, 8) + "...";
        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ *Connected*\n\n` +
            `Wallet: \`${walletShort}\`\n\n` +
            `You're receiving notifications for your watchlist.`
        );
      } else {
        await sendTelegramMessage(
          botToken,
          chatId,
          `❌ *Not connected*\n\n` +
            `Connect your account at: ${process.env.NEXT_PUBLIC_APP_URL || "https://idl-sentinel.com"}/settings`
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Unknown command
    await sendTelegramMessage(
      botToken,
      chatId,
      `Unknown command. Use /help to see available commands.`
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error processing Telegram webhook:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Send a message via Telegram bot
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
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

    return true;
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}
