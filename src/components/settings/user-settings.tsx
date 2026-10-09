"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Save, TestTube, Check, X, ExternalLink } from "lucide-react";
import {
  useUserSettings,
  useUpdateSettings,
  useTestSlackWebhook,
  useTestDiscordWebhook,
  useTestTelegram,
  useTelegramConnect,
  useTelegramConnectionPoll,
} from "@/hooks/use-user-settings";

export function UserSettings() {
  const { isAuthenticated, isLoading: authLoading, walletAddress } = useAuth();

  const {
    data: settingsData,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useUserSettings({
    enabled: isAuthenticated,
  });
  const updateSettingsMutation = useUpdateSettings();
  const testSlackMutation = useTestSlackWebhook();
  const testDiscordMutation = useTestDiscordWebhook();
  const testTelegramMutation = useTestTelegram();
  const telegramConnectMutation = useTelegramConnect();

  const settings = settingsData?.user || null;

  const [slackDraft, setSlackDraft] = useState<{ wallet: string | null; value: string } | null>(
    null
  );
  const [discordDraft, setDiscordDraft] = useState<{ wallet: string | null; value: string } | null>(
    null
  );
  const [explorerDraft, setExplorerDraft] = useState<{
    wallet: string | null;
    value: "explorer.solana.com" | "solscan.io";
  } | null>(null);
  const slackWebhook =
    slackDraft?.wallet === walletAddress ? slackDraft.value : settings?.slack_webhook_url || "";
  const preferredExplorer =
    explorerDraft?.wallet === walletAddress
      ? explorerDraft.value
      : settings?.preferred_explorer || "explorer.solana.com";
  const discordWebhook =
    discordDraft?.wallet === walletAddress
      ? discordDraft.value
      : settings?.discord_webhook_url || "";
  const setSlackWebhook = (value: string) => setSlackDraft({ wallet: walletAddress, value });
  const setDiscordWebhook = (value: string) => setDiscordDraft({ wallet: walletAddress, value });
  const setPreferredExplorer = (value: "explorer.solana.com" | "solscan.io") =>
    setExplorerDraft({ wallet: walletAddress, value });
  const [telegramConnectionUrl, setTelegramConnectionUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [slackTestSuccess, setSlackTestSuccess] = useState<boolean | null>(null);
  const [discordTestSuccess, setDiscordTestSuccess] = useState<boolean | null>(null);
  const [telegramTestSuccess, setTelegramTestSuccess] = useState<boolean | null>(null);
  const [explorerSaveSuccess, setExplorerSaveSuccess] = useState(false);

  const handleTelegramConnected = useCallback(() => {
    setTelegramConnectionUrl(null);
  }, []);

  useTelegramConnectionPoll(!!telegramConnectionUrl, handleTelegramConnected);

  const saveExplorerPreference = async (explorer: "explorer.solana.com" | "solscan.io") => {
    try {
      setError(null);
      setExplorerSaveSuccess(false);
      setPreferredExplorer(explorer);

      await updateSettingsMutation.mutateAsync({ preferred_explorer: explorer });
      setExplorerSaveSuccess(true);
      setTimeout(() => setExplorerSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save explorer preference");
      setPreferredExplorer(settings?.preferred_explorer || "explorer.solana.com");
    }
  };

  const saveSettings = async () => {
    try {
      setError(null);
      setSaveSuccess(false);

      await updateSettingsMutation.mutateAsync({
        slack_webhook_url: slackWebhook || null,
        discord_webhook_url: discordWebhook || null,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  const testSlackWebhook = async () => {
    try {
      setError(null);
      setSlackTestSuccess(null);

      await testSlackMutation.mutateAsync(slackWebhook);
      setSlackTestSuccess(true);
      setTimeout(() => setSlackTestSuccess(null), 5000);
    } catch (err) {
      setSlackTestSuccess(false);
      setError(err instanceof Error ? err.message : "Failed to send test notification");
    }
  };

  const testDiscordWebhook = async () => {
    try {
      setError(null);
      setDiscordTestSuccess(null);

      await testDiscordMutation.mutateAsync(discordWebhook);
      setDiscordTestSuccess(true);
      setTimeout(() => setDiscordTestSuccess(null), 5000);
    } catch (err) {
      setDiscordTestSuccess(false);
      setError(err instanceof Error ? err.message : "Failed to send test notification");
    }
  };

  const connectTelegram = async () => {
    try {
      setError(null);

      const data = await telegramConnectMutation.mutateAsync();
      const url = (data as { telegramUrl?: string }).telegramUrl;
      if (url) {
        setTelegramConnectionUrl(url);
        window.open(url, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Telegram");
    }
  };

  const disconnectTelegram = async () => {
    try {
      setError(null);
      await updateSettingsMutation.mutateAsync({ telegram_chat_id: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Telegram");
    }
  };

  const testTelegram = async () => {
    try {
      setError(null);
      setTelegramTestSuccess(null);

      await testTelegramMutation.mutateAsync();
      setTelegramTestSuccess(true);
      setTimeout(() => setTelegramTestSuccess(null), 5000);
    } catch (err) {
      setTelegramTestSuccess(false);
      setError(err instanceof Error ? err.message : "Failed to send test notification");
    }
  };

  const saving = updateSettingsMutation.isPending;
  const savingExplorer = updateSettingsMutation.isPending;
  const testingSlack = testSlackMutation.isPending;
  const testingDiscord = testDiscordMutation.isPending;
  const testingTelegram = testTelegramMutation.isPending;
  const connectingTelegram = telegramConnectMutation.isPending;
  const disconnectingTelegram = updateSettingsMutation.isPending;

  if (!isAuthenticated && !authLoading) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <h3 className="mb-2 text-lg font-medium">Sign In Required</h3>
          <p className="mb-4 text-muted-foreground">
            Please connect your wallet and sign in to manage your settings
          </p>
        </div>
      </Card>
    );
  }

  if (isLoading || authLoading) {
    return (
      <div className="space-y-6">
        {/* Account Information Skeleton */}
        <Card className="p-6">
          <Skeleton className="mb-4 h-7 w-48" />
          <div className="space-y-3">
            <div>
              <Skeleton className="mb-2 h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </Card>

        {/* Notification Settings Skeleton */}
        <Card className="p-6">
          <Skeleton className="mb-2 h-7 w-56" />
          <Skeleton className="mb-6 h-4 w-96" />

          <div className="space-y-4">
            {/* Slack Section */}
            <div>
              <Skeleton className="mb-2 h-5 w-40" />
              <Skeleton className="mb-3 h-10 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-20" />
              </div>
            </div>

            {/* Telegram Section */}
            <div>
              <Skeleton className="mb-2 h-5 w-48" />
              <Skeleton className="mb-4 h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
              <Skeleton className="h-10 w-36" />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (isError && !settings) {
    return (
      <Card className="p-6">
        <div className="text-center text-destructive">
          <p>
            Error: {queryError instanceof Error ? queryError.message : "Failed to fetch settings"}
          </p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-semibold">Account Information</h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Wallet Address</label>
            <div className="mt-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {settings?.wallet_address || walletAddress}
            </div>
          </div>
          {settings?.is_admin && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">Role</label>
              <div className="mt-1">
                <span className="inline-flex items-center rounded-sm bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                  Administrator
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Explorer Preference</h2>
          {savingExplorer && (
            <span className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {explorerSaveSuccess && !savingExplorer && (
            <span className="flex items-center text-sm text-green-600">
              <Check className="mr-1 h-3 w-3" />
              Saved
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Choose your preferred Solana explorer for viewing program addresses
        </p>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center space-x-3">
            <input
              type="radio"
              name="explorer"
              value="explorer.solana.com"
              checked={preferredExplorer === "explorer.solana.com"}
              onChange={(e) =>
                saveExplorerPreference(e.target.value as "explorer.solana.com" | "solscan.io")
              }
              disabled={savingExplorer}
              className="h-4 w-4 border-gray-300 text-primary focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Solana Explorer</div>
              <div className="text-xs text-muted-foreground">explorer.solana.com</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-center space-x-3">
            <input
              type="radio"
              name="explorer"
              value="solscan.io"
              checked={preferredExplorer === "solscan.io"}
              onChange={(e) =>
                saveExplorerPreference(e.target.value as "explorer.solana.com" | "solscan.io")
              }
              disabled={savingExplorer}
              className="h-4 w-4 border-gray-300 text-primary focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Solscan</div>
              <div className="text-xs text-muted-foreground">solscan.io</div>
            </div>
          </label>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-2 text-xl font-semibold">Notification Settings</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Alerts go to every channel you configure here, for programs in your watchlist.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="slack-webhook" className="mb-2 block text-sm font-medium">
              Slack Webhook URL
            </label>
            <p className="mb-3 text-xs text-muted-foreground">
              Receive notifications in Slack when programs in your watchlist have IDL changes.{" "}
              <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary hover:underline"
              >
                Learn how to create a webhook
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </p>
            <div className="flex gap-2">
              <Input
                id="slack-webhook"
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={testSlackWebhook}
                disabled={!slackWebhook || testingSlack}
                variant="outline"
              >
                {testingSlack ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                Test
              </Button>
            </div>

            {slackTestSuccess !== null && (
              <div
                className={`mt-2 flex items-center text-sm ${slackTestSuccess ? "text-green-600" : "text-red-600"}`}
              >
                {slackTestSuccess ? (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    Test notification sent successfully! Check your Slack channel.
                  </>
                ) : (
                  <>
                    <X className="mr-1 h-4 w-4" />
                    Failed to send test notification. Please check your webhook URL.
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="discord-webhook" className="mb-2 block text-sm font-medium">
              Discord Webhook URL
            </label>
            <p className="mb-3 text-xs text-muted-foreground">
              Post alerts to a Discord channel. In Discord, open the channel settings, choose
              Integrations, then Webhooks, and copy the webhook URL.{" "}
              <a
                href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary hover:underline"
              >
                Discord webhook guide
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </p>
            <div className="flex gap-2">
              <Input
                id="discord-webhook"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordWebhook}
                onChange={(e) => setDiscordWebhook(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={testDiscordWebhook}
                disabled={!discordWebhook || testingDiscord}
                variant="outline"
              >
                {testingDiscord ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                Test
              </Button>
            </div>

            {discordTestSuccess !== null && (
              <div
                className={`mt-2 flex items-center text-sm ${discordTestSuccess ? "text-green-600" : "text-red-600"}`}
              >
                {discordTestSuccess ? (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    Test notification sent successfully! Check your Discord channel.
                  </>
                ) : (
                  <>
                    <X className="mr-1 h-4 w-4" />
                    Failed to send test notification. Please check your webhook URL.
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Telegram Notifications</label>
            <p className="mb-4 text-xs text-muted-foreground">
              Receive notifications via Telegram when programs in your watchlist have IDL changes.
            </p>

            {!settings?.telegram_chat_id ? (
              <div className="space-y-3">
                <Button onClick={connectTelegram} disabled={connectingTelegram} className="w-full">
                  {connectingTelegram ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating connection link...
                    </>
                  ) : (
                    <>Connect Telegram</>
                  )}
                </Button>

                {telegramConnectionUrl && (
                  <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
                    <p className="text-sm font-medium text-blue-900">Connection link generated!</p>
                    <p className="text-xs text-blue-700">
                      Click the button below or use this link to connect your Telegram:
                    </p>
                    <a
                      href={telegramConnectionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm text-blue-600 hover:underline"
                    >
                      Open in Telegram
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                    <p className="mt-2 text-xs text-blue-600">
                      Waiting for you to connect... (Link expires in 10 minutes)
                    </p>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Click the button above to open a Telegram chat with the IDL Sentinel bot. Click
                  &quot;Start&quot; in Telegram to complete the connection.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
                  <div className="flex items-center">
                    <Check className="mr-2 h-4 w-4 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-900 dark:text-green-100">
                        Connected
                      </p>
                      {settings.telegram_username && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          @{settings.telegram_username}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={disconnectTelegram}
                    disabled={disconnectingTelegram}
                    variant="outline"
                    size="sm"
                  >
                    {disconnectingTelegram ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Disconnect"
                    )}
                  </Button>
                </div>

                <Button
                  onClick={testTelegram}
                  disabled={testingTelegram}
                  variant="outline"
                  className="w-full"
                >
                  {testingTelegram ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending test...
                    </>
                  ) : (
                    <>
                      <TestTube className="mr-2 h-4 w-4" />
                      Send Test Notification
                    </>
                  )}
                </Button>

                {telegramTestSuccess !== null && (
                  <div
                    className={`flex items-center text-sm ${telegramTestSuccess ? "text-green-600" : "text-red-600"}`}
                  >
                    {telegramTestSuccess ? (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Test notification sent! Check your Telegram.
                      </>
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Failed to send test notification.
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center text-sm text-destructive">
              <X className="mr-1 h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            {saveSuccess && (
              <span className="flex items-center text-sm text-green-600">
                <Check className="mr-1 h-4 w-4" />
                Settings saved successfully
              </span>
            )}
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
