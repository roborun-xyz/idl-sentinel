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
  | "idl_removed";

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
