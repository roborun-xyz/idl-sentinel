import { supabaseAdmin, type IdlChange } from "../supabase";

export type ChangeType =
  | "instruction_added"
  | "instruction_removed"
  | "instruction_modified"
  | "type_added"
  | "type_removed"
  | "type_modified"
  | "account_added"
  | "account_removed"
  | "account_modified"
  | "error_added"
  | "error_removed"
  | "error_modified"
  | "idl_removed"
  | ProgramChangeType;

/** On-chain events recorded by the program watcher, alongside IDL diffs. */
export type ProgramChangeType =
  | "program_upgraded"
  | "program_closed"
  | "upgrade_authority_changed"
  | "program_made_immutable"
  | "squads_config_changed"
  | "squads_proposal_created"
  | "squads_proposal_approved"
  | "squads_proposal_cancelled"
  | "verification_lost"
  | "verification_gained";

export type ChangeSeverity = "low" | "medium" | "high" | "critical";

export interface ChangeDetails {
  changeType: ChangeType;
  itemName: string;
  oldValue?: unknown;
  newValue?: unknown;
  description: string;
}

export type ChangeSummary = Pick<
  IdlChange,
  "id" | "program_id" | "change_type" | "change_summary" | "severity" | "detected_at"
> & {
  monitored_programs: { name: string; program_id: string };
};
export interface ChangeQueryFilters {
  programId?: string;
  severity?: ChangeSeverity;
  search?: string;
  programName?: string;
  before?: { time: string; id: string };
}

export async function getRecentChanges(
  limit = 50,
  filters: ChangeQueryFilters = {}
): Promise<ChangeSummary[]> {
  const { data, error } = await supabaseAdmin.rpc("list_change_summaries", {
    p_limit: limit,
    p_before_time: filters.before?.time ?? null,
    p_before_id: filters.before?.id ?? null,
    p_program_address: filters.programId ?? null,
    p_severity: filters.severity ?? null,
    p_search: filters.search ?? "",
    p_program_name: filters.programName ?? null,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getProgramChanges(programId: string, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("idl_changes")
    .select("id, program_id, change_type, change_summary, severity, detected_at")
    .eq("program_id", programId)
    .order("detected_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getChangeDetails(id: string): Promise<ChangeDetails | null> {
  const { data, error } = await supabaseAdmin
    .from("idl_changes")
    .select("change_details")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.change_details || null;
}

export async function getChangeStatistics(programId?: string) {
  const { data, error } = await supabaseAdmin.rpc("get_change_statistics", {
    p_program_address: programId ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data?.[0];
  return {
    total: Number(result?.total_count || 0),
    recent24h: Number(result?.recent_24h_count || 0),
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0, ...result?.severity_counts },
    byType: result?.type_counts || {},
  };
}

export interface ChangeRecord {
  id: string;
  program_id: string;
  change_type: ChangeType;
  change_summary: string;
  severity: ChangeSeverity;
  detected_at: string;
  change_details: ChangeDetails | null;
  monitored_programs: { id: string; name: string; program_id: string };
}

/** One change with its program, for the change's own page. */
export async function getChangeRecord(id: string): Promise<ChangeRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("idl_changes")
    .select(
      "id, program_id, change_type, change_summary, severity, detected_at, change_details, monitored_programs!inner(id, name, program_id)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as ChangeRecord | null;
}

/**
 * Other changes recorded in the same transition (same program, same timestamp),
 * most severe first. Read one severity at a time so a cap never drops a
 * critical change in favour of low ones.
 */
export async function getEventSiblings(
  change: ChangeRecord,
  limit = 200
): Promise<Array<Omit<ChangeRecord, "change_details" | "monitored_programs">>> {
  const rows: Array<Omit<ChangeRecord, "change_details" | "monitored_programs">> = [];
  for (const severity of ["critical", "high", "medium", "low"] as const) {
    if (rows.length >= limit) break;
    const { data, error } = await supabaseAdmin
      .from("idl_changes")
      .select("id, program_id, change_type, change_summary, severity, detected_at")
      .eq("program_id", change.program_id)
      .eq("detected_at", change.detected_at)
      .eq("severity", severity)
      .neq("id", change.id)
      .order("id", { ascending: false })
      .limit(limit - rows.length);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}
