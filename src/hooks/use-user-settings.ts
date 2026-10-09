import { useAuth } from "@/lib/auth/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { queryKeys } from "./query-keys";

interface UserSettings {
  wallet_address: string;
  slack_webhook_url: string | null;
  discord_webhook_url: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  preferred_explorer: "explorer.solana.com" | "solscan.io";
  is_admin: boolean;
  created_at: string;
  last_login_at: string;
}

interface UserSettingsResponse {
  user: UserSettings;
}

export function useUserSettings(options?: { enabled?: boolean }) {
  const { userId } = useAuth();
  return useQuery<UserSettingsResponse>({
    queryKey: queryKeys.userSettings(userId),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/user/settings", { signal });
      if (!response.ok) {
        if (response.status === 401) throw new Error("Authentication required");
        throw new Error("Failed to fetch settings");
      }
      return response.json();
    },
    staleTime: 60 * 1000,
    enabled: !!userId && (options?.enabled ?? true),
    retry: false,
  });
}

export function useUpdateSettings() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      updates: Partial<
        Pick<
          UserSettings,
          "slack_webhook_url" | "discord_webhook_url" | "telegram_chat_id" | "preferred_explorer"
        >
      >
    ) => {
      const response = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update settings");
      }
      return response.json() as Promise<UserSettingsResponse>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.userSettings(userId), data);
    },
  });
}

export function useTestSlackWebhook() {
  return useMutation({
    mutationFn: async (webhookUrl: string) => {
      const response = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_type: "slack", slack_webhook_url: webhookUrl }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to send test notification");
      }
      return response.json();
    },
  });
}

export function useTestDiscordWebhook() {
  return useMutation({
    mutationFn: async (webhookUrl: string) => {
      const response = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_type: "discord", discord_webhook_url: webhookUrl }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to send test notification");
      }
      return response.json();
    },
  });
}

export function useTestTelegram() {
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_type: "telegram" }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to send test notification");
      }
      return response.json();
    },
  });
}

export function useTelegramConnect() {
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/telegram/connect", { method: "POST" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to generate connection link");
      }
      return response.json() as Promise<{ url: string }>;
    },
  });
}

export function useTelegramConnectionPoll(isWaiting: boolean, onConnected: () => void) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isWaiting) {
      cleanup();
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch("/api/user/settings");
        if (response.ok) {
          const data: UserSettingsResponse = await response.json();
          if (data.user?.telegram_chat_id) {
            queryClient.setQueryData(queryKeys.userSettings(userId), data);
            onConnectedRef.current();
            cleanup();
          }
        }
      } catch (err) {
        console.error("Error polling for connection status:", err);
      }
    }, 3000);

    pollTimeoutRef.current = setTimeout(
      () => {
        cleanup();
      },
      10 * 60 * 1000
    );

    return cleanup;
  }, [isWaiting, queryClient, cleanup, userId]);
}
