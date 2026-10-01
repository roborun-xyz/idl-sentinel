"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Star, Loader2 } from "lucide-react";
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";

interface AddToWatchlistButtonProps {
  programId: string;
  programDbId: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost";
}

export function AddToWatchlistButton({
  programDbId,
  size = "default",
  variant = "outline",
}: AddToWatchlistButtonProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: watchlistData, isLoading: watchlistLoading } = useWatchlist({
    enabled: isAuthenticated,
  });
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const isInWatchlist =
    watchlistData?.watchlist.some((item) => item.program_id === programDbId) ?? false;

  const loading = addMutation.isPending || removeMutation.isPending;
  const checking = watchlistLoading;

  const toggleWatchlist = async () => {
    if (!isAuthenticated) {
      alert("Please sign in to manage your watchlist");
      return;
    }

    try {
      if (isInWatchlist) {
        await removeMutation.mutateAsync(programDbId);
      } else {
        await addMutation.mutateAsync(programDbId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update watchlist");
    }
  };

  if (!isAuthenticated && !authLoading) {
    return null; // Don't show button for non-authenticated users
  }

  if (checking || authLoading) {
    return (
      <Button variant={variant} size={size} disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  return (
    <Button
      variant={isInWatchlist ? "default" : variant}
      size={size}
      onClick={toggleWatchlist}
      disabled={loading}
      className="flex items-center gap-2"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Star className={`h-4 w-4 ${isInWatchlist ? "fill-current" : ""}`} />
      )}
      <span>{isInWatchlist ? "Watching" : "Watch"}</span>
    </Button>
  );
}
