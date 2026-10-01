import { runPool } from "../concurrency";
import type { IdlChange } from "../supabase";

export type NotificationChange = Pick<
  IdlChange,
  "id" | "severity" | "change_summary" | "detected_at"
> & {
  monitored_programs: { id: string; name: string; program_id: string };
};
export interface Watcher {
  userId: string;
  walletAddress: string;
  destination: string;
}
export interface DeliveryState {
  delivered: Map<string, Set<string>>;
  maxAttempts: number;
}
export interface NotificationStore {
  loadChanges(): Promise<NotificationChange[]>;
  loadWatchers(programIds: string[]): Promise<Map<string, Watcher[]>>;
  loadDeliveries(changeIds: string[]): Promise<DeliveryState>;
  record(userId: string, changeIds: string[], success: boolean): Promise<void>;
  markDelivered(changeIds: string[]): Promise<void>;
  defer(changeIds: string[], delaySeconds: number): Promise<void>;
}

export async function runNotificationBatch(
  store: NotificationStore,
  send: (watcher: Watcher, changes: NotificationChange[]) => Promise<boolean>,
  options: { deadline: number; concurrency: number; maxAttempts?: number }
) {
  const result = { sent: 0, failed: 0, deferred: 0, errors: [] as string[] };
  let attempts = 0;
  const canSend = () => Date.now() < options.deadline && attempts < (options.maxAttempts ?? 500);
  try {
    const changes = await store.loadChanges();
    if (!changes.length) return result;
    const groups = new Map<string, NotificationChange[]>();
    for (const change of changes) {
      const id = change.monitored_programs.id;
      groups.set(id, [...(groups.get(id) || []), change]);
    }
    // A lookup failure must abort the batch, never masquerade as zero watchers.
    const watchersByProgram = await store.loadWatchers([...groups.keys()]);
    for (const [programId, programChanges] of groups) {
      if (!canSend()) {
        result.deferred += programChanges.length;
        continue;
      }
      const ids = programChanges.map((c) => c.id);
      try {
        const watchers = watchersByProgram.get(programId) || [];
        if (!watchers.length) {
          await store.markDelivered(ids);
          continue;
        }
        const state = await store.loadDeliveries(ids);
        let failed = false;
        await runPool(
          watchers,
          options.concurrency,
          async (watcher) => {
            const delivered = state.delivered.get(watcher.userId) || new Set<string>();
            const pending = programChanges.filter((c) => !delivered.has(c.id));
            if (!pending.length) return;
            if (!canSend()) {
              result.deferred++;
              return;
            }
            attempts++;
            const pendingIds = pending.map((c) => c.id);
            try {
              const success = await send(watcher, pending);
              await store.record(watcher.userId, pendingIds, success);
              if (success) {
                pendingIds.forEach((id) => delivered.add(id));
                state.delivered.set(watcher.userId, delivered);
                result.sent++;
              } else {
                failed = true;
                result.failed++;
                result.errors.push(`Delivery failed for ${watcher.userId}`);
              }
            } catch (error) {
              failed = true;
              result.failed++;
              result.errors.push(error instanceof Error ? error.message : "Delivery failed");
            }
          },
          canSend
        );
        const fullyDelivered = ids.filter((id) =>
          watchers.every((w) => state.delivered.get(w.userId)?.has(id))
        );
        await store.markDelivered(fullyDelivered);
        const remaining = ids.filter((id) => !fullyDelivered.includes(id));
        if (failed && remaining.length) {
          await store.defer(remaining, Math.min(86_400, 900 * 2 ** Math.min(state.maxAttempts, 7)));
        } else if (remaining.length) {
          result.deferred += remaining.length;
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "Notification query failed");
      }
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Notification batch failed");
  }
  return result;
}

/** Per-chat spacing plus a global bot limit; reservations are synchronous. */
export function createSendLimiter(globalSpacingMs: number, recipientSpacingMs: number) {
  let nextGlobal = 0;
  const nextByRecipient = new Map<string, number>();
  return async (recipient: string) => {
    const at = Math.max(Date.now(), nextGlobal, nextByRecipient.get(recipient) || 0);
    nextGlobal = at + globalSpacingMs;
    nextByRecipient.set(recipient, at + recipientSpacingMs);
    const wait = at - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}
