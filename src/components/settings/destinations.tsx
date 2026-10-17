"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWatchlist } from "@/hooks/use-watchlist";

interface DestinationSettings {
  slack_webhook_url?: string | null;
  discord_webhook_url?: string | null;
  telegram_chat_id?: string | null;
  webhook_url?: string | null;
  pagerduty_routing_key?: string | null;
  pagerduty_min_severity?: string | null;
}

/**
 * Where alerts go, at a glance (Tenderly-style destinations): every channel
 * with its state, plus what the alerts cover. Each card jumps to its form.
 */
export function DestinationOverview({ settings }: { settings: DestinationSettings | null }) {
  const { data: watchlistData, isLoading: watchlistLoading } = useWatchlist();
  const watched = watchlistData?.watchlist.length ?? 0;

  const destinations = [
    { name: "Slack", target: "slack-webhook", on: !!settings?.slack_webhook_url },
    { name: "Discord", target: "discord-webhook", on: !!settings?.discord_webhook_url },
    { name: "Telegram", target: "telegram", on: !!settings?.telegram_chat_id },
    { name: "Webhook", target: "webhook-url", on: !!settings?.webhook_url, note: "signed JSON" },
    {
      name: "PagerDuty",
      target: "pagerduty-key",
      on: !!settings?.pagerduty_routing_key,
      note: settings?.pagerduty_routing_key
        ? `${settings.pagerduty_min_severity ?? "high"} and above`
        : undefined,
    },
  ];
  const connected = destinations.filter((d) => d.on).length;
  const gap = !watchlistLoading && (watched === 0 || connected === 0);

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Alert destinations</h2>
        <p className="text-sm text-muted-foreground">
          {watchlistLoading
            ? "Loading watchlist…"
            : `${connected} of ${destinations.length} connected · covering ${watched} watched ${watched === 1 ? "program" : "programs"}`}
        </p>
      </div>

      {gap && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
          <span>
            {watched === 0 ? (
              <>
                You won&apos;t receive alerts until you watch a program.{" "}
                <Link href="/programs" className="font-medium underline">
                  Browse programs
                </Link>
              </>
            ) : (
              "Connect at least one destination below to receive alerts."
            )}
          </span>
        </p>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {destinations.map((destination) => (
          <li key={destination.name}>
            <a
              href={`#${destination.target}`}
              className={cn(
                "flex h-full flex-col gap-1 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50",
                destination.on && "border-green-300 dark:border-green-900"
              )}
            >
              <span className="font-medium">{destination.name}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  destination.on ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
                )}
              >
                {destination.on ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Circle className="h-3.5 w-3.5" aria-hidden />
                )}
                {destination.on ? "Connected" : "Not set up"}
              </span>
              {destination.note && (
                <span className="text-xs text-muted-foreground">{destination.note}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
