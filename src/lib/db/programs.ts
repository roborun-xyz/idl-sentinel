import { supabaseAdmin, type MonitoredProgram } from '../supabase'

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
    .from('monitored_programs')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Not found
    }
    console.error('Error fetching program by ID:', error)
    throw new Error(`Failed to fetch program: ${error.message}`)
  }

  // Fetch the latest monitoring log to get last_checked_at
  if (data) {
    const { data: latestLog } = await supabaseAdmin
      .from('monitoring_logs')
      .select('created_at')
      .eq('program_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Add last_checked_at to the program data
    return {
      ...data,
      last_checked_at: latestLog?.created_at || null
    }
  }

  return data
}

/**
 * Get a program by program_id (Solana address)
 */
export async function getProgramByAddress(programId: string): Promise<MonitoredProgram | null> {
  const { data, error } = await supabaseAdmin
    .from('monitored_programs')
    .select('*')
    .eq('program_id', programId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Not found
    }
    console.error('Error fetching program by address:', error)
    throw new Error(`Failed to fetch program: ${error.message}`)
  }

  return data
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
  const { data, error} = await supabaseAdmin
    .from('monitored_programs')
    .insert({
      program_id: programId,
      name,
      description,
      is_active: true,
      owner_id: ownerId
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating program:', error)
    throw new Error(`Failed to create program: ${error.message}`)
  }

  return data
}

/**
 * Update a monitored program
 */
export async function updateProgram(
  id: string,
  updates: Partial<Pick<MonitoredProgram, 'name' | 'description' | 'is_active'>>
): Promise<MonitoredProgram> {
  const { data, error } = await supabaseAdmin
    .from('monitored_programs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating program:', error)
    throw new Error(`Failed to update program: ${error.message}`)
  }

  return data
}

/**
 * Delete a monitored program
 */
export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('monitored_programs')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting program:', error)
    throw new Error(`Failed to delete program: ${error.message}`)
  }
}

/**
 * Get programs with their latest monitoring timestamp.
 */
export async function getAllPrograms(options?: {
  limit?: number
  offset?: number
  activeOnly?: boolean
}): Promise<MonitoredProgram[]> {
  const limit = options?.limit
  const offset = options?.offset || 0

  if (!options?.activeOnly || (!limit && offset === 0)) {
    const { data, error } = await supabaseAdmin.rpc('get_all_programs_with_last_check', {
      p_limit: limit || null,
      p_offset: offset
    })

    if (error) {
      console.error('Error fetching all programs:', error)
      throw new Error(`Failed to fetch programs: ${error.message}`)
    }

    const programs = (data || []) as MonitoredProgram[]
    return options?.activeOnly
      ? programs.filter((program) => program.is_active)
      : programs
  }

  let query = supabaseAdmin
    .from('monitored_programs')
    .select('*')
    .order('created_at', { ascending: false })

  if (options?.activeOnly) {
    query = query.eq('is_active', true)
  }

  if (limit) {
    query = query.range(offset, offset + limit - 1)
  } else if (offset > 0) {
    query = query.range(offset, offset + 999_999)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching all programs:', error)
    throw new Error(`Failed to fetch programs: ${error.message}`)
  }

  const programs = data || []
  if (programs.length === 0) {
    return []
  }

  const { data: logs, error: logsError } = await supabaseAdmin
    .from('monitoring_logs')
    .select('program_id, created_at')
    .in('program_id', programs.map((program) => program.id))
    .order('created_at', { ascending: false })

  if (logsError) {
    console.error('Error fetching latest monitoring logs:', logsError)
    throw new Error(`Failed to fetch latest monitoring logs: ${logsError.message}`)
  }

  const lastCheckedByProgram = new Map<string, string>()
  for (const log of logs || []) {
    if (!lastCheckedByProgram.has(log.program_id)) {
      lastCheckedByProgram.set(log.program_id, log.created_at)
    }
  }

  return programs.map((program) => ({
    ...program,
    last_checked_at: lastCheckedByProgram.get(program.id) || null
  }))
}

/**
 * Get total count of programs
 */
export async function getProgramCount(options?: {
  activeOnly?: boolean
}): Promise<number> {
  let query = supabaseAdmin
    .from('monitored_programs')
    .select('*', { count: 'exact', head: true })

  if (options?.activeOnly) {
    query = query.eq('is_active', true)
  }

  const { count, error } = await query

  if (error) {
    console.error('Error counting programs:', error)
    throw new Error(`Failed to count programs: ${error.message}`)
  }

  return count || 0
}
