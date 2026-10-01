import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import type { MonitoredProgram, IdlSnapshot } from "@/lib/supabase";
import { useAuth } from "@/lib/auth/auth-context";

interface ProgramsResponse {
  programs: MonitoredProgram[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface ProgramResponse {
  program: MonitoredProgram;
}

interface SnapshotsResponse {
  snapshots: Array<{
    id: string;
    program_id: string;
    idl_hash: string;
    version_number: number;
    fetched_at: string;
  }>;
}

interface ProgramChangesResponse {
  changes: Array<{
    id: string;
    change_type: string;
    change_summary: string;
    change_details: unknown;
    severity: "low" | "medium" | "high" | "critical";
    detected_at: string;
  }>;
}

export function usePrograms(
  options: { limit?: number; offset?: number; search?: string; publicOnly?: boolean } = {}
) {
  const { isAdmin, isLoading: authLoading } = useAuth();

  return useQuery<ProgramsResponse>({
    queryKey: [
      ...queryKeys.programsList(),
      { includeInactive: !options.publicOnly && isAdmin, ...options },
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(options.limit ?? 50),
        offset: String(options.offset ?? 0),
        search: options.search ?? "",
      });
      if (options.publicOnly) params.set("activeOnly", "true");
      const response = await fetch(`/api/programs?${params}`, { signal });
      if (!response.ok) throw new Error("Failed to fetch programs");
      return response.json();
    },
    placeholderData: (previous, previousQuery) => {
      const scope = previousQuery?.queryKey[2] as { includeInactive?: boolean } | undefined;
      return scope?.includeInactive === (!options.publicOnly && isAdmin) ? previous : undefined;
    },
    enabled: options.publicOnly || !authLoading,
  });
}

export function useProgram(id: string) {
  return useQuery<ProgramResponse>({
    queryKey: queryKeys.programDetail(id),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/programs/${id}`, { signal });
      if (!response.ok) {
        if (response.status === 404) throw new Error("Program not found");
        throw new Error("Failed to fetch program");
      }
      return response.json();
    },
    enabled: !!id,
  });
}

export function useProgramSnapshots(id: string, limit = 10) {
  return useQuery<SnapshotsResponse>({
    queryKey: [...queryKeys.programSnapshots(id), limit],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/programs/${id}/snapshots?limit=${limit}`, { signal });
      if (!response.ok) throw new Error("Failed to fetch snapshots");
      return response.json();
    },
    enabled: !!id,
  });
}

export function useProgramChanges(id: string, limit = 10) {
  return useQuery<ProgramChangesResponse>({
    queryKey: [...queryKeys.programChanges(id), limit],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/programs/${id}/changes?limit=${limit}`, { signal });
      if (!response.ok) throw new Error("Failed to fetch changes");
      return response.json();
    },
    enabled: !!id,
  });
}

export function useDeleteProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (programId: string) => {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to delete program");
      }
      return programId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.programs });
    },
  });
}

export function snapshotQuery(programId: string, snapshotId: string) {
  return {
    queryKey: ["programs", programId, "snapshot", snapshotId],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<{ snapshot: IdlSnapshot }> => {
      const response = await fetch(`/api/programs/${programId}/snapshots/${snapshotId}`, {
        signal,
      });
      if (!response.ok) throw new Error("Failed to load snapshot");
      return response.json();
    },
    staleTime: Infinity,
  };
}
