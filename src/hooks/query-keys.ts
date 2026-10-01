export const queryKeys = {
  // Programs
  programs: ["programs"] as const,
  programsList: () => [...queryKeys.programs, "list"] as const,
  programDetail: (id: string) => [...queryKeys.programs, "detail", id] as const,
  programSnapshots: (id: string) => [...queryKeys.programs, id, "snapshots"] as const,
  programChanges: (id: string) => [...queryKeys.programs, id, "changes"] as const,

  // Changes
  changes: ["changes"] as const,
  changesList: (params?: { limit?: number; programId?: string }) =>
    [...queryKeys.changes, "list", params] as const,

  // Watchlist
  watchlist: ["watchlist"] as const,
  watchlistFor: (userId: string | null) => ["watchlist", userId] as const,

  // User
  user: ["user"] as const,
  userSettings: (userId: string | null) => [...queryKeys.user, userId, "settings"] as const,

  // Stats
  stats: ["stats"] as const,
  monitoringStats: () => [...queryKeys.stats, "monitoring"] as const,
};
