"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Star, StarOff, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";
import { useWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";

export function WatchlistManager() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, error, refetch } = useWatchlist({
    enabled: isAuthenticated,
  });
  const removeMutation = useRemoveFromWatchlist();
  const watchlist = data?.watchlist || [];

  const removeFromWatchlist = async (programId: string) => {
    try {
      await removeMutation.mutateAsync(programId);
    } catch (err) {
      console.error("Error removing from watchlist:", err);
    }
  };

  if (!isAuthenticated && !authLoading) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <Star className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">Sign In Required</h3>
          <p className="mb-4 text-muted-foreground">
            Please connect your wallet and sign in to manage your watchlist
          </p>
        </div>
      </Card>
    );
  }

  if (isLoading || authLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          <span>Loading watchlist...</span>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="p-6">
        <div className="text-center text-destructive">
          <p>Error: {error instanceof Error ? error.message : "Failed to fetch watchlist"}</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (watchlist.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <Star className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">No Programs in Watchlist</h3>
          <p className="mb-4 text-muted-foreground">
            Start watching programs to receive notifications when their IDLs change
          </p>
          <Link href="/">
            <Button>Browse Programs</Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">My Watchlist</h2>
        <span className="text-sm text-muted-foreground">
          {watchlist.length} program{watchlist.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid gap-4">
        {watchlist.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <Link
                    href={`/programs/${item.monitored_programs.id}`}
                    className="text-lg font-medium hover:underline"
                  >
                    {item.monitored_programs.name}
                  </Link>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>

                {item.monitored_programs.description && (
                  <p className="mb-2 text-sm text-muted-foreground">
                    {item.monitored_programs.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <code className="rounded bg-muted px-2 py-1">
                    {item.monitored_programs.program_id.substring(0, 12)}...
                  </code>
                  <span>Added {formatRelativeTime(item.created_at)}</span>
                  <span
                    className={
                      item.monitored_programs.is_active ? "text-green-600" : "text-red-600"
                    }
                  >
                    {item.monitored_programs.is_active ? "● Active" : "○ Inactive"}
                  </span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeFromWatchlist(item.program_id)}
                className="ml-4"
              >
                <StarOff className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
