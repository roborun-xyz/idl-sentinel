import { supabaseAdmin, type IdlSnapshot } from "../supabase";
import type { SolanaIdl } from "../solana/idl-fetcher";
import type { DetectedChange } from "../monitoring/change-detector";

export type SnapshotSummary = Omit<IdlSnapshot, "idl_content">;
export interface SnapshotInsertResult {
  snapshot: IdlSnapshot;
  created: boolean;
  changes_count: number;
}

export async function getLatestSnapshot(
  programId: string,
  signal?: AbortSignal
): Promise<IdlSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from("idl_snapshots")
    .select("*")
    .eq("program_id", programId)
    .order("version_number", { ascending: false })
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .abortSignal(signal ?? AbortSignal.timeout(15_000))
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch latest snapshot: ${error.message}`);
  return data;
}

// The database locks the program and commits the snapshot and its changes together.
export async function recordIdlTransition(
  programId: string,
  expectedSnapshotId: string | null,
  hash: string,
  content: SolanaIdl,
  changes: DetectedChange[],
  initialOnly = false,
  signal?: AbortSignal
): Promise<SnapshotInsertResult> {
  const { data, error } = await supabaseAdmin
    .rpc("record_idl_transition", {
      p_program_id: programId,
      p_expected_snapshot_id: expectedSnapshotId,
      p_hash: hash,
      p_content: content,
      p_changes: changes,
      p_initial_only: initialOnly,
    })
    .abortSignal(signal ?? AbortSignal.timeout(15_000));
  if (error) throw new Error(`Failed to record IDL transition: ${error.message}`);
  return data as SnapshotInsertResult;
}

export async function getProgramSnapshots(
  programId: string,
  limit = 10
): Promise<SnapshotSummary[]> {
  const { data, error } = await supabaseAdmin
    .from("idl_snapshots")
    .select("id, program_id, idl_hash, version_number, fetched_at")
    .eq("program_id", programId)
    .order("version_number", { ascending: false })
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch snapshots: ${error.message}`);
  return data || [];
}

export async function getSnapshotById(id: string, programId: string): Promise<IdlSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from("idl_snapshots")
    .select("*")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch snapshot: ${error.message}`);
  return data;
}
