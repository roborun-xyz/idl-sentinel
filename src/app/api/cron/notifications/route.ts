import { NextRequest, NextResponse } from "next/server";
import { runNotificationJobs } from "@/lib/cron/notifications";
import { cleanupNonces } from "@/lib/auth/nonces";
import { cleanupExpiredTokens } from "@/lib/telegram/connection-tokens";

export const maxDuration = 120;
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response("Unauthorized", { status: 401 });
  try {
    const notifications = await runNotificationJobs();
    await Promise.all([cleanupNonces(), cleanupExpiredTokens()]);
    const errors = [
      ...notifications.slack.errors,
      ...notifications.telegram_user.errors,
      ...notifications.discord.errors,
    ];
    return NextResponse.json(
      { success: !errors.length, notifications, errors },
      { status: errors.length ? 500 : 200 }
    );
  } catch (error) {
    console.error("Notification scheduler failed:", error);
    return NextResponse.json({ error: "Notification scheduler failed" }, { status: 500 });
  }
}
