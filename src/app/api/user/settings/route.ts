import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase";
import { testSlackWebhook } from "@/lib/notifications/slack";
import { isDiscordWebhookUrl, testDiscordWebhook } from "@/lib/notifications/discord";

// Get user settings
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .select(
        "wallet_address, slack_webhook_url, discord_webhook_url, telegram_chat_id, telegram_username, preferred_explorer, is_admin, created_at, last_login_at"
      )
      .eq("id", user.userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Failed to fetch user settings" }, { status: 500 });
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    return NextResponse.json({ error: "Failed to fetch user settings" }, { status: 500 });
  }
}

// Update user settings
export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { slack_webhook_url, discord_webhook_url, telegram_chat_id, preferred_explorer } = body;

    const updates: {
      slack_webhook_url?: string | null;
      discord_webhook_url?: string | null;
      telegram_chat_id?: null;
      telegram_username?: null;
      preferred_explorer?: string;
    } = {};

    // Handle Slack webhook
    if (slack_webhook_url !== undefined) {
      if (slack_webhook_url !== null && slack_webhook_url !== "") {
        if (!slack_webhook_url.startsWith("https://hooks.slack.com/")) {
          return NextResponse.json({ error: "Invalid Slack webhook URL format" }, { status: 400 });
        }
        updates.slack_webhook_url = slack_webhook_url;
      } else {
        updates.slack_webhook_url = null;
      }
    }

    // Handle Discord webhook
    if (discord_webhook_url !== undefined) {
      if (discord_webhook_url !== null && discord_webhook_url !== "") {
        if (typeof discord_webhook_url !== "string" || !isDiscordWebhookUrl(discord_webhook_url)) {
          return NextResponse.json(
            { error: "Invalid Discord webhook URL format" },
            { status: 400 }
          );
        }
        updates.discord_webhook_url = discord_webhook_url.trim();
      } else {
        updates.discord_webhook_url = null;
      }
    }

    // Handle Telegram disconnection (connection is done via /api/telegram/connect)
    if (telegram_chat_id !== undefined) {
      if (telegram_chat_id === null) {
        updates.telegram_chat_id = null;
        updates.telegram_username = null;
      }
    }

    // Handle preferred explorer
    if (preferred_explorer !== undefined) {
      if (preferred_explorer === "explorer.solana.com" || preferred_explorer === "solscan.io") {
        updates.preferred_explorer = preferred_explorer;
      } else {
        return NextResponse.json(
          {
            error:
              'Invalid explorer preference. Must be either "explorer.solana.com" or "solscan.io"',
          },
          { status: 400 }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", user.userId)
      .select()
      .single();

    if (error || !data) {
      console.error("Error updating user settings:", error);
      return NextResponse.json({ error: "Failed to update user settings" }, { status: 500 });
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    console.error("Error updating user settings:", error);
    return NextResponse.json({ error: "Failed to update user settings" }, { status: 500 });
  }
}

// Test Slack webhook or Telegram bot
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { slack_webhook_url, discord_webhook_url, test_type } = body;

    // Test Discord
    if (test_type === "discord") {
      if (typeof discord_webhook_url !== "string" || !isDiscordWebhookUrl(discord_webhook_url)) {
        return NextResponse.json({ error: "Invalid Discord webhook URL format" }, { status: 400 });
      }

      const success = await testDiscordWebhook(discord_webhook_url.trim());
      if (success) {
        return NextResponse.json({
          success: true,
          message: "Discord test notification sent successfully",
        });
      }
      return NextResponse.json(
        { error: "Failed to send Discord test notification" },
        { status: 500 }
      );
    }

    // Test Slack
    if (test_type === "slack" || slack_webhook_url) {
      if (!slack_webhook_url) {
        return NextResponse.json({ error: "Slack webhook URL is required" }, { status: 400 });
      }

      if (!slack_webhook_url.startsWith("https://hooks.slack.com/")) {
        return NextResponse.json({ error: "Invalid Slack webhook URL format" }, { status: 400 });
      }

      const success = await testSlackWebhook(slack_webhook_url);

      if (success) {
        return NextResponse.json({
          success: true,
          message: "Slack test notification sent successfully",
        });
      } else {
        return NextResponse.json(
          { error: "Failed to send Slack test notification" },
          { status: 500 }
        );
      }
    }

    // Test Telegram - send to user's connected Telegram
    if (test_type === "telegram") {
      // Get user's telegram_chat_id from database
      const { data: userData, error: userError } = await supabaseAdmin
        .from("users")
        .select("telegram_chat_id")
        .eq("id", user.userId)
        .single();

      if (userError || !userData || !userData.telegram_chat_id) {
        return NextResponse.json(
          { error: "Telegram not connected. Please connect your Telegram account first." },
          { status: 400 }
        );
      }

      const { testTelegramConfig } = await import("@/lib/notifications/telegram-user");
      const success = await testTelegramConfig(userData.telegram_chat_id);

      if (success) {
        return NextResponse.json({
          success: true,
          message: "Telegram test notification sent successfully",
        });
      } else {
        return NextResponse.json(
          { error: "Failed to send Telegram test notification." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: "Invalid test type or missing parameters" }, { status: 400 });
  } catch (error) {
    console.error("Error testing notification:", error);
    return NextResponse.json({ error: "Failed to send test notification" }, { status: 500 });
  }
}
