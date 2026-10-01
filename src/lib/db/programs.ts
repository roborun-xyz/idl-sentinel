import { supabaseAdmin, type MonitoredProgram } from "../supabase";

/**
 * Get all active monitored programs
 */
export async function getActivePrograms(before: string): Promise<MonitoredProgram[]> {
  const { data, error } = await supabaseAdmin
    .from("monitored_programs")
    .select("*")
    .eq("is_active", true)
    .or(`last_polled_at.is.null,last_polled_at.lt.${before}`)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .order("id")
    .limit(100);

  if (error) {
    console.error("Error fetching active programs:", error);
    throw new Error(`Failed to fetch active programs: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a specific program by ID
 */
export async function getProgramById(id: string): Promise<MonitoredProgram | null> {
  const { data, error } = await supabaseAdmin
    .from("monitored_programs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    console.error("Error fetching program by ID:", error);
    throw new Error(`Failed to fetch program: ${error.message}`);
  }

  // Fetch the latest monitoring log to get last_checked_at
  if (data) {
    const { data: latestLog } = await supabaseAdmin
      .from("monitoring_logs")
      .select("created_at")
      .eq("program_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Add last_checked_at to the program data
    return {
      ...data,
      last_checked_at: latestLog?.created_at || null,
    };
  }

  return data;
}

/**
 * Get a program by program_id (Solana address)
 */
export async function getProgramByAddress(programId: string): Promise<MonitoredProgram | null> {
  const { data, error } = await supabaseAdmin
    .from("monitored_programs")
    .select("*")
    .eq("program_id", programId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    console.error("Error fetching program by address:", error);
    throw new Error(`Failed to fetch program: ${error.message}`);
  }

  return data;
}

/**
 * Create a new monitored program
 */
export async function createProgram(
  programId: string,
  name: string,
  ownerId: string,
  description?: string
): Promise<MonitoredProgram> {
  const { data, error } = await supabaseAdmin
    .from("monitored_programs")
    .insert({
      program_id: programId,
      name,
      description,
      is_active: true,
      owner_id: ownerId,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating program:", error);
    throw new Error(`Failed to create program: ${error.message}`);
  }

  return data;
}

/**
 * Update a monitored program
 */
export async function updateProgram(
  id: string,
  updates: Partial<Pick<MonitoredProgram, "name" | "description" | "is_active">>
): Promise<MonitoredProgram> {
  const { data, error } = await supabaseAdmin
    .from("monitored_programs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating program:", error);
    throw new Error(`Failed to update program: ${error.message}`);
  }

  return data;
}

/**
 * Delete a monitored program
 */
export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("monitored_programs").delete().eq("id", id);

  if (error) {
    console.error("Error deleting program:", error);
    throw new Error(`Failed to delete program: ${error.message}`);
  }
}

/**
 * Get programs with their latest monitoring timestamp.
 */
export async function getAllPrograms(
  options: { limit?: number; offset?: number; activeOnly?: boolean; search?: string } = {}
): Promise<MonitoredProgram[]> {
  const { data, error } = await supabaseAdmin.rpc("get_all_programs_with_last_check", {
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
    p_active_only: options.activeOnly ?? true,
    p_search: options.search ?? "",
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getProgramCount(
  options: { activeOnly?: boolean; search?: string } = {}
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("count_programs", {
    p_active_only: options.activeOnly ?? true,
    p_search: options.search ?? "",
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}
