/** Client-safe grouping of change rows into the events that produced them. */
export type Severity = "low" | "medium" | "high" | "critical";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface GroupableChange {
  id: string;
  program_id: string;
  severity: Severity;
  detected_at: string;
}

export interface ChangeGroup<T extends GroupableChange> {
  key: string;
  programId: string;
  detectedAt: string;
  severity: Severity;
  /** Most severe first; ties keep their original order. */
  changes: T[];
}

/**
 * One IDL transition or one watcher pass records all of its changes in a single
 * transaction, so they share `detected_at`. Consecutive rows with the same
 * program and timestamp are one event: one deploy, one new IDL version.
 * Input order (newest first) is kept between groups.
 */
export function groupChanges<T extends GroupableChange>(changes: T[]): ChangeGroup<T>[] {
  const groups: ChangeGroup<T>[] = [];
  for (const change of changes) {
    const last = groups[groups.length - 1];
    // Exact text match: the database returns microseconds, which Date would drop.
    if (last && last.programId === change.program_id && last.detectedAt === change.detected_at) {
      last.changes.push(change);
      if (SEVERITY_RANK[change.severity] < SEVERITY_RANK[last.severity]) {
        last.severity = change.severity;
      }
      continue;
    }
    groups.push({
      key: `${change.program_id}:${change.detected_at}:${change.id}`,
      programId: change.program_id,
      detectedAt: change.detected_at,
      severity: change.severity,
      changes: [change],
    });
  }
  for (const group of groups) {
    group.changes = group.changes
      .map((change, i) => ({ change, i }))
      .sort(
        (a, b) => SEVERITY_RANK[a.change.severity] - SEVERITY_RANK[b.change.severity] || a.i - b.i
      )
      .map(({ change }) => change);
  }
  return groups;
}

/** "3 high, 9 low" — counts per severity, most severe first. */
export function severityCounts(changes: GroupableChange[]): string {
  const counts = new Map<Severity, number>();
  for (const change of changes) counts.set(change.severity, (counts.get(change.severity) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => SEVERITY_RANK[a] - SEVERITY_RANK[b])
    .map(([severity, n]) => `${n} ${severity}`)
    .join(", ");
}
