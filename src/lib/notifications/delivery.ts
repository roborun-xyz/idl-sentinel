import { supabaseAdmin } from "../supabase";
import type { NotificationStore, NotificationChange, Watcher } from "./worker";

interface WatcherRow {
  id: string;
  program_id: string;
  users: {
    id: string;
    wallet_address: string;
    slack_webhook_url: string | null;
    discord_webhook_url: string | null;
    telegram_chat_id: string | null;
  };
}

export type NotificationChannel = "slack" | "telegram_user" | "discord";

const destinationField: Record<NotificationChannel, keyof WatcherRow["users"]> = {
  slack: "slack_webhook_url",
  telegram_user: "telegram_chat_id",
  discord: "discord_webhook_url",
};

// Always walk a stable cursor: no dependence on the Data API's response row cap.
async function allRows<T extends { id: string }>(
  page: (cursor?: string) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (true) {
    const { data, error } = await page(cursor);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
    cursor = data[data.length - 1].id;
  }
}

export function notificationStore(
  channel: NotificationChannel,
  deadline = Date.now() + 45_000
): NotificationStore {
  const checkDeadline = () => {
    if (Date.now() >= deadline) throw new Error("Notification query deadline exceeded");
  };
  const field = destinationField[channel];
  return {
    async loadChanges() {
      const { data, error } = await supabaseAdmin
        .from("idl_changes")
        .select(
          "id, severity, change_summary, detected_at, monitored_programs!inner(id, name, program_id)"
        )
        .eq(`${channel}_notified`, false)
        .lte(`${channel}_retry_at`, new Date().toISOString())
        .order("detected_at")
        .order("id")
        .limit(250);
      if (error) throw new Error(error.message);
      return (data || []) as unknown as NotificationChange[];
    },
    async loadWatchers(programIds) {
      const result = new Map<string, Watcher[]>();
      for (let i = 0; i < programIds.length; i += 50) {
        const rows = await allRows<WatcherRow>(async (cursor) => {
          checkDeadline();
          let query = supabaseAdmin
            .from("user_watchlist")
            .select(
              "id, program_id, users!inner(id, wallet_address, slack_webhook_url, discord_webhook_url, telegram_chat_id)"
            )
            .in("program_id", programIds.slice(i, i + 50))
            .not(`users.${field}`, "is", null)
            .order("id")
            .limit(500);
          if (cursor) query = query.gt("id", cursor);
          const result = await query;
          return { data: result.data as unknown as WatcherRow[] | null, error: result.error };
        });
        for (const row of rows) {
          const watchers = result.get(row.program_id) || [];
          watchers.push({
            userId: row.users.id,
            walletAddress: row.users.wallet_address,
            destination: row.users[field] as string,
          });
          result.set(row.program_id, watchers);
        }
      }
      return result;
    },
    async loadDeliveries(changeIds) {
      const delivered = new Map<string, Set<string>>();
      let maxAttempts = 0;
      for (let i = 0; i < changeIds.length; i += 50) {
        const rows = await allRows<{
          id: string;
          user_id: string;
          change_id: string;
          status: string;
          attempts: number;
        }>((cursor) => {
          checkDeadline();
          let query = supabaseAdmin
            .from("notification_deliveries")
            .select("id, user_id, change_id, status, attempts")
            .eq("channel", channel)
            .in("change_id", changeIds.slice(i, i + 50))
            .order("id")
            .limit(500);
          if (cursor) query = query.gt("id", cursor);
          return query;
        });
        for (const row of rows) {
          maxAttempts = Math.max(maxAttempts, row.attempts);
          if (row.status !== "delivered") continue;
          const ids = delivered.get(row.user_id) || new Set<string>();
          ids.add(row.change_id);
          delivered.set(row.user_id, ids);
        }
      }
      return { delivered, maxAttempts };
    },
    async record(userId, changeIds, success) {
      const { error } = await supabaseAdmin.rpc("record_notification_delivery", {
        p_channel: channel,
        p_user_id: userId,
        p_change_ids: changeIds,
        p_status: success ? "delivered" : "failed",
        p_error: success ? null : "Notification send failed",
      });
      if (error) throw new Error(error.message);
    },
    async markDelivered(changeIds) {
      if (!changeIds.length) return;
      const { error } = await supabaseAdmin
        .from("idl_changes")
        .update({
          [`${channel}_notified`]: true,
          [`${channel}_notified_at`]: new Date().toISOString(),
        })
        .in("id", changeIds);
      if (error) throw new Error(error.message);
    },
    async defer(changeIds, seconds) {
      const { error } = await supabaseAdmin
        .from("idl_changes")
        .update({ [`${channel}_retry_at`]: new Date(Date.now() + seconds * 1000).toISOString() })
        .in("id", changeIds);
      if (error) throw new Error(error.message);
    },
  };
}
