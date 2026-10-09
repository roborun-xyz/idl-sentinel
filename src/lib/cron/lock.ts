import { supabaseAdmin } from "../supabase";

const DEFAULT_LOCK_TTL_MS = 20 * 60 * 1000;

export async function acquireCronLock(
  lockName: string,
  runId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + ttlMs).toISOString();

  const { data, error } = await supabaseAdmin.rpc("try_acquire_cron_lock", {
    p_lock_name: lockName,
    p_run_id: runId,
    p_locked_until: lockedUntil,
  });

  if (error) {
    throw new Error(`Failed to acquire cron lock: ${error.message}`);
  }

  return data === true;
}

export async function releaseCronLock(lockName: string, runId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_cron_lock", {
    p_lock_name: lockName,
    p_run_id: runId,
  });

  if (error) {
    console.error("Failed to release cron lock:", error);
  }
}
