import { NextRequest, NextResponse } from "next/server";
import { watchPrograms } from "@/lib/chain/watch";
import { createRpcChainReader } from "@/lib/chain/rpc-reader";
import { chainStore } from "@/lib/db/chain";
import { acquireCronLock, releaseCronLock } from "@/lib/cron/lock";
import { notificationErrors, runNotificationJobs } from "@/lib/cron/notifications";
import { cache, CacheKeys } from "@/lib/cache";

export const maxDuration = 120;

const WATCH_CRON_LOCK = "watch-programs";

/**
 * Checks every active program's deploy slot, upgrade authority, Squads
 * proposals, and verified-build status, then delivers any alerts at once.
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response("Unauthorized", { status: 401 });

  const runId = crypto.randomUUID();
  let locked = false;
  try {
    locked = await acquireCronLock(WATCH_CRON_LOCK, runId, 150_000);
  } catch {
    return NextResponse.json({ error: "Unable to acquire program watch lock" }, { status: 500 });
  }
  if (!locked) {
    return NextResponse.json({ success: true, skipped: true }, { status: 202 });
  }

  try {
    // Budget inside maxDuration (120s): stop new work at 60s, hard-abort RPC at 85s,
    // and give alert delivery only what remains before 110s so receipts get written.
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(85_000);
    const result = await watchPrograms(chainStore(runId), createRpcChainReader(signal), {
      deadline: startedAt + 60_000,
    });
    if (result.changesDetected) cache.delete(CacheKeys.DASHBOARD_STATS);
    // Alerts should not wait for the next notification tick when time allows.
    const notifyDeadline = Math.min(Date.now() + 25_000, startedAt + 110_000);
    const notifications =
      result.changesDetected && notifyDeadline - Date.now() > 5_000
        ? await runNotificationJobs(notifyDeadline, { waitForLock: true })
        : null;
    const errors = [
      ...result.errors.map((e) => `watch:${e.programId}:${e.error}`),
      ...(notifications ? notificationErrors(notifications) : []),
    ];
    return NextResponse.json(
      { success: !errors.length, result, notifications, errors },
      { status: errors.length ? 500 : 200 }
    );
  } catch (error) {
    console.error("Program watch failed:", error);
    return NextResponse.json({ error: "Program watch failed" }, { status: 500 });
  } finally {
    await releaseCronLock(WATCH_CRON_LOCK, runId);
  }
}
