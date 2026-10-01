import { useAuth } from "@/lib/auth/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

interface WatchlistItem {
  id: string;
  program_id: string;
  created_at: string;
  monitored_programs: {
    id: string;
    program_id: string;
    name: string;
    description: string | null;
    is_active: boolean;
  };
}

interface WatchlistResponse {
  watchlist: WatchlistItem[];
}

export function useWatchlist(options?: { enabled?: boolean }) {
  const { userId } = useAuth();
  return useQuery<WatchlistResponse>({
    queryKey: queryKeys.watchlistFor(userId),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/watchlist", { signal });
      if (!response.ok) {
        if (response.status === 401) throw new Error("Authentication required");
        throw new Error("Failed to fetch watchlist");
      }
      return response.json();
    },
    staleTime: 60_000,
    enabled: !!userId && (options?.enabled ?? true),
    retry: false,
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (programDbId: string) => {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId: programDbId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to add to watchlist");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });
}

export function useRemoveFromWatchlist() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (programDbId: string) => {
      const response = await fetch(`/api/watchlist?programId=${programDbId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to remove from watchlist");
      }
      return programDbId;
    },
    onMutate: async (programDbId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist });
      const previous = queryClient.getQueryData<WatchlistResponse>(queryKeys.watchlistFor(userId));

      queryClient.setQueryData<WatchlistResponse>(queryKeys.watchlistFor(userId), (old) =>
        old
          ? {
              watchlist: old.watchlist.filter((item) => item.program_id !== programDbId),
            }
          : undefined
      );

      return { previous };
    },
    onError: (_err, _programDbId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.watchlistFor(userId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });
}
