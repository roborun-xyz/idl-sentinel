import { supabaseAdmin } from "../supabase";
import type { ChainState } from "../chain/state";
import { summarizeChain, type ChainSummary } from "../chain/risk";
import type { ChainStore, WatchTarget } from "../chain/watch";

export interface ProgramChainStateRow {
  program_id: string;
  state: ChainState;
  state_hash: string;
  checked_at: string;
  changed_at: string;
}

export async function getProgramChainState(
  programDbId: string
): Promise<ProgramChainStateRow | null> {
  const { data, error } = await supabaseAdmin
    .from("program_chain_states")
    .select("program_id, state, state_hash, checked_at, changed_at")
    .eq("program_id", programDbId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch chain state: ${error.message}`);
  return data;
}

/** Compact on-chain summaries for list rows, keyed by program row id. */
export async function getChainSummaries(
  programDbIds: string[]
): Promise<Record<string, ChainSummary>> {
  if (!programDbIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from("program_chain_states")
    .select("program_id, state, checked_at")
    .in("program_id", programDbIds);
  if (error) throw new Error(`Failed to fetch chain states: ${error.message}`);
  return Object.fromEntries(
    (data || []).map((row: { program_id: string; state: ChainState; checked_at: string }) => [
      row.program_id,
      summarizeChain(row.state, row.checked_at),
    ])
  );
}

export function chainStore(runId: string): ChainStore {
  return {
    async loadTargets(limit) {
      const { data, error } = await supabaseAdmin.rpc("list_chain_watch_targets", {
        p_limit: limit,
      });
      if (error) throw new Error(`Failed to load watch targets: ${error.message}`);
      return (data || []).map(
        (row: {
          id: string;
          program_id: string;
          name: string;
          state: ChainState | null;
          state_hash: string | null;
        }) => ({
          id: row.id,
          programId: row.program_id,
          name: row.name,
          state: row.state,
          stateHash: row.state_hash,
        })
      );
    },
    async record(target, state, hash, changes) {
      const { data, error } = await supabaseAdmin.rpc("record_chain_transition", {
        p_program_id: target.id,
        p_expected_hash: target.stateHash,
        p_hash: hash,
        p_state: state,
        p_changes: changes,
      });
      if (error) throw new Error(`Failed to record chain transition: ${error.message}`);
      return data as { created: boolean; changes_count: number };
    },
    async touch(target: WatchTarget, checked: boolean) {
      const now = new Date().toISOString();
      const [cursor, state] = await Promise.all([
        supabaseAdmin
          .from("monitored_programs")
          .update({ chain_checked_at: now })
          .eq("id", target.id),
        checked
          ? supabaseAdmin
              .from("program_chain_states")
              .update({ checked_at: now })
              .eq("program_id", target.id)
          : { error: null },
      ]);
      const error = cursor.error ?? state.error;
      if (error) throw new Error(`Failed to advance watch cursor: ${error.message}`);
    },
    async log(target, level, message) {
      const { error } = await supabaseAdmin.from("monitoring_logs").insert({
        run_id: runId,
        program_id: target?.id ?? null,
        log_level: level,
        message,
        metadata: { source: "program-watch" },
      });
      if (error) console.error("Failed to write monitoring log:", error.message);
    },
  };
}
