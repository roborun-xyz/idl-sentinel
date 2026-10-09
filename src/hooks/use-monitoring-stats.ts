import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

interface MonitoringStats {
  totalPrograms: number;
  activePrograms: number;
  totalChanges: number;
  recentChanges: number;
  lastMonitoringRun: string | null;
}

interface StatsResponse {
  stats: MonitoringStats;
}

export function useMonitoringStats() {
  return useQuery<StatsResponse>({
    queryKey: queryKeys.monitoringStats(),
    queryFn: async () => {
      const response = await fetch("/api/monitoring/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    staleTime: 60 * 1000,
  });
}
