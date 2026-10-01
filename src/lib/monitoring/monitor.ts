import { createSolanaConnection, fetchIdlFromChain } from "../solana/idl-fetcher";
import { calculateIdlHash } from "./hash";
import { getActivePrograms } from "../db/programs";
import { getLatestSnapshot, recordIdlTransition } from "../db/snapshots";
import { detectChanges, type DetectedChange } from "./change-detector";
import { supabaseAdmin, type MonitoredProgram } from "../supabase";
import { cache, CacheKeys, CacheTTL } from "../cache";
import { runPool } from "../concurrency";

export interface MonitoringResult {
  runId: string;
  programsChecked: number;
  snapshotsCreated: number;
  changesDetected: number;
  deferred: boolean;
  errors: Array<{ programId: string; error: string }>;
  duration: number;
}
export interface InitialIdlFetchResult {
  success: boolean;
  snapshotCreated: boolean;
  error?: string;
  idlFound: boolean;
}

export async function fetchInitialIdl(program: MonitoredProgram): Promise<InitialIdlFetchResult> {
  try {
    const idl = await fetchIdlFromChain(
      createSolanaConnection(undefined, AbortSignal.timeout(60_000)),
      program.program_id
    );
    if (!idl)
      return {
        success: true,
        snapshotCreated: false,
        idlFound: false,
        error: "No IDL found on chain",
      };
    // An activation racing a cron run must never advance an existing program's history.
    const result = await recordIdlTransition(
      program.id,
      null,
      calculateIdlHash(idl),
      idl,
      [],
      true
    );
    cache.delete(CacheKeys.DASHBOARD_STATS);
    return { success: true, snapshotCreated: result.created, idlFound: true };
  } catch (error) {
    return {
      success: false,
      snapshotCreated: false,
      idlFound: false,
      error: error instanceof Error ? error.message : "Initial fetch failed",
    };
  }
}

export async function monitorPrograms(deadline = Date.now() + 120_000): Promise<MonitoringResult> {
  const start = Date.now();
  const cutoff = new Date(start).toISOString();
  const result: MonitoringResult = {
    runId: crypto.randomUUID(),
    programsChecked: 0,
    snapshotsCreated: 0,
    changesDetected: 0,
    deferred: false,
    errors: [],
    duration: 0,
  };
  await logMonitoringEvent(result.runId, null, "info", "Starting IDL monitoring run");
  try {
    while (Date.now() < deadline) {
      const programs = await getActivePrograms(cutoff);
      if (!programs.length) break;
      const completed = await runPool(
        programs,
        10,
        async (program) => {
          result.programsChecked++;
          try {
            const checked = await monitorProgram(program);
            result.snapshotsCreated += Number(checked.created);
            result.changesDetected += checked.changes_count;
            await logMonitoringEvent(
              result.runId,
              program.id,
              "info",
              `Program checked; changes: ${checked.changes_count}`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "Monitoring failed";
            result.errors.push({ programId: program.program_id, error: message });
            await logMonitoringEvent(result.runId, program.id, "error", message);
          }
          // Advance the durable polling cursor even after a failed RPC so one bad
          // program cannot starve the rest of the registry on every scheduler run.
          const { error } = await supabaseAdmin
            .from("monitored_programs")
            .update({ last_polled_at: new Date().toISOString() })
            .eq("id", program.id);
          if (error) throw new Error(`Failed to advance polling cursor: ${error.message}`);
        },
        () => Date.now() < deadline
      );
      if (completed < programs.length) {
        result.deferred = true;
        break;
      }
    }
    if (Date.now() >= deadline) result.deferred = true;
  } catch (error) {
    result.errors.push({
      programId: "SYSTEM",
      error: error instanceof Error ? error.message : "Monitoring failed",
    });
  }
  result.duration = Date.now() - start;
  await logMonitoringEvent(
    result.runId,
    null,
    result.errors.length ? "error" : "info",
    "Monitoring run completed",
    { duration: result.duration, deferred: result.deferred }
  );
  cache.delete(CacheKeys.DASHBOARD_STATS);
  return result;
}

async function monitorProgram(program: MonitoredProgram) {
  const signal = AbortSignal.timeout(60_000);
  const connection = createSolanaConnection(undefined, signal);
  const previous = await getLatestSnapshot(program.id, signal);
  let current = await fetchIdlFromChain(connection, program.program_id, 3, signal);
  let changes: DetectedChange[];
  if (!current) {
    if (!previous) throw new Error("No IDL found on chain and no prior snapshot exists");
    current = await fetchIdlFromChain(connection, program.program_id, 2, signal);
  }
  if (!current) {
    current = {
      name: previous!.idl_content.name || program.name,
      address: program.program_id,
      instructions: [],
      accounts: [],
      types: [],
      errors: [],
      metadata: { address: program.program_id, idl_sentinel_status: "missing" },
    };
    changes = [
      {
        changeType: "idl_removed",
        changeSummary: `IDL for '${program.name}' is no longer available on chain`,
        changeDetails: {
          changeType: "idl_removed",
          itemName: program.name,
          oldValue: previous!.idl_content,
          newValue: current,
          description: "IDL missing after confirmation fetch",
        },
        severity: "critical",
      },
    ];
  } else {
    changes = detectChanges(previous?.idl_content || null, current);
  }
  const hash = calculateIdlHash(current);
  if (hash === previous?.idl_hash) return { created: false, changes_count: 0 };
  return recordIdlTransition(
    program.id,
    previous?.id || null,
    hash,
    current,
    changes,
    false,
    signal
  );
}

async function logMonitoringEvent(
  runId: string,
  programId: string | null,
  level: "info" | "warning" | "error",
  message: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from("monitoring_logs").insert({
    run_id: runId,
    program_id: programId,
    log_level: level,
    message,
    metadata,
  });
  if (error) console.error("Failed to write monitoring log:", error.message);
}

export interface DashboardStats {
  totalPrograms: number;
  activePrograms: number;
  totalChanges: number;
  recentChanges: number;
  lastMonitoringRun: string | null;
}
export async function getDashboardStats(): Promise<DashboardStats> {
  return cache.getOrCompute(
    CacheKeys.DASHBOARD_STATS,
    async () => {
      const { data, error } = await supabaseAdmin.rpc("get_dashboard_statistics");
      if (error) throw new Error(`Failed to fetch dashboard statistics: ${error.message}`);
      return data as DashboardStats;
    },
    CacheTTL.DASHBOARD_STATS
  );
}
