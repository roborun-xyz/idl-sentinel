import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase";
import { testSlackWebhook } from "@/lib/notifications/slack";
import { isDiscordWebhookUrl, testDiscordWebhook } from "@/lib/notifications/discord";
import { generateWebhookSecret, testWebhook } from "@/lib/notifications/webhook";
import { resolvesPublicly, webhookUrlError } from "@/lib/notifications/url-guard";
import { isPagerDutyRoutingKey, testPagerDuty } from "@/lib/notifications/pagerduty";
import { SEVERITY_ORDER } from "@/lib/notifications/format";

const USER_SETTINGS_COLUMNS =
  "wallet_address, slack_webhook_url, discord_webhook_url, telegram_chat_id, telegram_username, webhook_url, webhook_secret, pagerduty_routing_key, pagerduty_min_severity, preferred_explorer, is_admin, created_at, last_login_at";

// Get user settings
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .select(USER_SETTINGS_COLUMNS)
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
    const {
      slack_webhook_url,
      discord_webhook_url,
      telegram_chat_id,
      preferred_explorer,
      webhook_url,
      rotate_webhook_secret,
      pagerduty_routing_key,
      pagerduty_min_severity,
    } = body;

    const updates: {
      slack_webhook_url?: string | null;
      discord_webhook_url?: string | null;
      telegram_chat_id?: null;
      telegram_username?: null;
      preferred_explorer?: string;
      webhook_url?: string | null;
      webhook_secret?: string | null;
      pagerduty_routing_key?: string | null;
      pagerduty_min_severity?: string;
    } = {};

    // Signed webhook: a secret is minted with the first URL and on explicit rotation.
    if (webhook_url !== undefined) {
      if (webhook_url !== null && webhook_url !== "") {
        const problem =
          typeof webhook_url === "string" ? webhookUrlError(webhook_url) : "Invalid webhook URL";
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        // Catch hostnames that resolve privately now, not on the first failed alert.
        if (!(await resolvesPublicly(new URL(webhook_url.trim()).hostname))) {
          return NextResponse.json(
            { error: "Webhook host must resolve to a public address" },
            { status: 400 }
          );
        }
        updates.webhook_url = webhook_url.trim();
      } else {
        updates.webhook_url = null;
        updates.webhook_secret = null;
      }
    }
    // Removing the URL clears the secret above; never mint a new one in the same request.
    if (updates.webhook_url || (rotate_webhook_secret === true && updates.webhook_url !== null)) {
      const { data: current } = await supabaseAdmin
        .from("users")
        .select("webhook_url, webhook_secret")
        .eq("id", user.userId)
        .single();
      // A new receiver gets a new secret, so the previous endpoint cannot forge payloads to it.
      const movedReceiver = !!updates.webhook_url && updates.webhook_url !== current?.webhook_url;
      if (rotate_webhook_secret === true || movedReceiver || !current?.webhook_secret) {
        if (!updates.webhook_url && !current?.webhook_url) {
          return NextResponse.json({ error: "Add a webhook URL first" }, { status: 400 });
        }
        updates.webhook_secret = generateWebhookSecret();
      }
    }

    if (pagerduty_routing_key !== undefined) {
      if (pagerduty_routing_key !== null && pagerduty_routing_key !== "") {
        if (
          typeof pagerduty_routing_key !== "string" ||
          !isPagerDutyRoutingKey(pagerduty_routing_key)
        ) {
          return NextResponse.json(
            { error: "PagerDuty routing keys are 32 letters and digits (Events API v2)" },
            { status: 400 }
          );
        }
        updates.pagerduty_routing_key = pagerduty_routing_key.trim();
      } else {
        updates.pagerduty_routing_key = null;
      }
    }
    if (pagerduty_min_severity !== undefined) {
      if (!SEVERITY_ORDER.includes(pagerduty_min_severity)) {
        return NextResponse.json(
          { error: "Invalid PagerDuty severity threshold" },
          { status: 400 }
        );
      }
      updates.pagerduty_min_severity = pagerduty_min_severity;
    }

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
      .select(USER_SETTINGS_COLUMNS)
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

    // Test the saved webhook or PagerDuty integration; both need server-held secrets.
    if (test_type === "webhook" || test_type === "pagerduty") {
      const { data: saved } = await supabaseAdmin
        .from("users")
        .select("webhook_url, webhook_secret, pagerduty_routing_key")
        .eq("id", user.userId)
        .single();
      if (test_type === "webhook") {
        if (!saved?.webhook_url || !saved.webhook_secret) {
          return NextResponse.json({ error: "Save a webhook URL first" }, { status: 400 });
        }
        return (await testWebhook(saved.webhook_url, saved.webhook_secret))
          ? NextResponse.json({ success: true, message: "Signed test event delivered" })
          : NextResponse.json(
              { error: "Webhook endpoint did not answer with a 2xx status" },
              { status: 502 }
            );
      }
      if (!saved?.pagerduty_routing_key) {
        return NextResponse.json({ error: "Save a PagerDuty routing key first" }, { status: 400 });
      }
      return (await testPagerDuty(saved.pagerduty_routing_key))
        ? NextResponse.json({ success: true, message: "PagerDuty test event sent" })
        : NextResponse.json({ error: "PagerDuty rejected the test event" }, { status: 502 });
    }

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
