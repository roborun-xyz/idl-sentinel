"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Flag, Layers } from "lucide-react";
import { severityDotColors } from "@/lib/utils";
import { changeTypeLabel } from "@/lib/changes/categories";

interface ChangeStatistics {
  total: number;
  bySeverity: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  byType: {
    instruction_added: number;
    instruction_removed: number;
    instruction_modified: number;
    type_added: number;
    type_removed: number;
    type_modified: number;
    account_added: number;
    account_removed: number;
    account_modified: number;
    error_added: number;
    error_removed: number;
    error_modified: number;
    idl_removed: number;
  };
  recent24h: number;
}

interface ChangeSummaryProps {
  programId?: string;
}

export function ChangeSummary({ programId }: ChangeSummaryProps) {
  const [stats, setStats] = useState<ChangeStatistics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ stats: "true" });
        if (programId) {
          params.set("programId", programId);
        }

        const response = await fetch(`/api/changes?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setStats(data.statistics);
        }
      } catch (error) {
        console.error("Error fetching statistics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatistics();
  }, [programId]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 animate-pulse rounded-sm bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="mb-2 h-8 w-16 animate-pulse rounded-sm bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded-sm bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const topChangeTypes = Object.entries(stats.byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .filter(([, count]) => count > 0);

  return (
    <div className="space-y-6">
      {/* Summary Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Changes</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">
              {programId ? "For selected program" : "All detected changes"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last 24 Hours</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.recent24h}</div>
            <p className="text-xs text-muted-foreground">Recent activity</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical/High</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.bySeverity.critical + stats.bySeverity.high}
            </div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Medium/Low</CardTitle>
            <Flag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.bySeverity.medium + stats.bySeverity.low}
            </div>
            <p className="text-xs text-muted-foreground">Informational</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Severity Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Changes by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stats.bySeverity).map(([severity, count]) => (
                <div key={severity} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`h-3 w-3 rounded-sm ${
                        severityDotColors[severity as keyof typeof severityDotColors] ||
                        "bg-gray-500"
                      }`}
                    />
                    <span className="text-sm capitalize">{severity}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">{count}</span>
                    {stats.total > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({Math.round((count / stats.total) * 100)}%)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Change Types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Change Types</CardTitle>
          </CardHeader>
          <CardContent>
            {topChangeTypes.length > 0 ? (
              <div className="space-y-3">
                {topChangeTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {changeTypeLabel(type)}
                    </Badge>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">{count}</span>
                      {stats.total > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({Math.round((count / stats.total) * 100)}%)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No changes detected yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
