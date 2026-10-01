import { useQuery, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import type { ChangeSummary, ChangeDetails } from "@/lib/db/changes";

interface ChangesResponse {
  changes: ChangeSummary[];
  nextCursor: string | null;
}
export function useChanges(
  limit = 50,
  programId?: string,
  filters: { search?: string; severity?: string; programName?: string } = {}
) {
  return useInfiniteQuery<ChangesResponse>({
    queryKey: [...queryKeys.changesList({ limit, programId }), filters],
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (programId) params.set("programId", programId);
      for (const [key, value] of Object.entries(filters))
        if (value && value !== "all") params.set(key, value);
      if (typeof pageParam === "string") params.set("cursor", pageParam);
      const response = await fetch(`/api/changes?${params}`, { signal });
      if (!response.ok) throw new Error("Failed to load changes");
      return response.json();
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
export function useRecentChanges(limit = 8) {
  return useQuery<ChangesResponse>({
    queryKey: queryKeys.changesList({ limit }),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/changes?limit=${limit}`, { signal });
      if (!response.ok) throw new Error("Failed to load changes");
      return response.json();
    },
  });
}
export function useChangeDetails(id: string) {
  return useQuery<{ details: ChangeDetails }>({
    queryKey: ["changes", "detail", id],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/changes/${id}`, { signal });
      if (!response.ok) throw new Error("Failed to load change details");
      return response.json();
    },
    staleTime: Infinity,
  });
}
