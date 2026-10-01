import { NextRequest, NextResponse } from "next/server";
import { monitorPrograms } from "@/lib/monitoring/monitor";
import { runNotificationJobs } from "@/lib/cron/notifications";
import { cleanupExpiredTokens } from "@/lib/telegram/connection-tokens";
import { acquireCronLock, releaseCronLock } from "@/lib/cron/lock";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 300;

const MONITOR_CRON_LOCK = "monitor-idls";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { success: false, error: "Cron authentication is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const lockRunId = generateUUID();
  let lockAcquired = false;
  try {
    lockAcquired = await acquireCronLock(MONITOR_CRON_LOCK, lockRunId, 360_000);
  } catch {
    return NextResponse.json({ error: "Unable to acquire monitoring lock" }, { status: 500 });
  }

  if (!lockAcquired) {
    return NextResponse.json(
      {
        success: true,
        skipped: true,
        message: "IDL monitoring already in progress",
      },
      { status: 202 }
    );
  }

  try {
    // Run the monitoring process
    const result = await monitorPrograms();

    const { slack: slackResult, telegram_user: telegramUserResult } = await runNotificationJobs();

    // Clean up expired Telegram connection tokens
    await cleanupExpiredTokens();

    console.log("Scheduled monitoring completed:", result);
    console.log("Slack notification result:", slackResult);
    console.log("Telegram user notification result:", telegramUserResult);

    const errors = [
      ...result.errors.map((error) => `monitoring:${error.programId}:${error.error}`),
      ...slackResult.errors.map((error) => `slack:${error}`),
      ...telegramUserResult.errors.map((error) => `telegram_user:${error}`),
    ];
    const success = errors.length === 0;

    return NextResponse.json(
      {
        success,
        message: success
          ? "IDL monitoring and notifications completed"
          : "IDL monitoring and notifications completed with errors",
        result,
        notifications: {
          telegram_user: telegramUserResult,
          slack: slackResult,
        },
        errors,
      },
      { status: success ? 200 : 500 }
    );
  } catch (error) {
    console.error("Monitoring scheduler failed:", error);
    return NextResponse.json({ error: "Monitoring scheduler failed" }, { status: 500 });
  } finally {
    await releaseCronLock(MONITOR_CRON_LOCK, lockRunId);
  }
}
