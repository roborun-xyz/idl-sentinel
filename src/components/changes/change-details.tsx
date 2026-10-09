"use client";

import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Edit } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useTheme } from "@/lib/theme/theme-provider";

// Dynamically import ReactDiffViewer to avoid SSR issues
const ReactDiffViewer = dynamic(() => import("react-diff-viewer"), {
  ssr: false,
});

interface ChangeDetailsProps {
  details: {
    changeType: string;
    itemName: string;
    oldValue?: unknown;
    newValue?: unknown;
    description: string;
  };
}

export function ChangeDetails({ details }: ChangeDetailsProps) {
  const { theme } = useTheme();
  const isAddition = details.changeType.includes("added");
  const isRemoval = details.changeType.includes("removed");
  const isModification = details.changeType.includes("modified");
  const [splitView, setSplitView] = useState(true);

  // Format values as pretty JSON strings for diff viewer
  const formatValue = (value: unknown): string => {
    if (value === undefined || value === null) {
      return "";
    }
    return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  };

  const oldValueStr = useMemo(() => formatValue(details.oldValue), [details.oldValue]);
  const newValueStr = useMemo(() => formatValue(details.newValue), [details.newValue]);

  const getChangeIcon = () => {
    if (isAddition) return <Plus className="h-4 w-4 text-green-500" />;
    if (isRemoval) return <Minus className="h-4 w-4 text-red-500" />;
    if (isModification) return <Edit className="h-4 w-4 text-blue-500" />;
    return null;
  };

  const getChangeBadgeVariant = () => {
    if (isAddition) return "default";
    if (isRemoval) return "destructive";
    return "secondary";
  };

  return (
    <div className="space-y-4">
      {/* Change Type Header */}
      <div className="flex items-center space-x-2">
        {getChangeIcon()}
        <Badge variant={getChangeBadgeVariant()} className="text-xs">
          {details.changeType.replace(/_/g, " ")}
        </Badge>
        <span className="text-sm font-medium">{details.itemName}</span>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">{details.description}</p>

      {/* Diff Viewer */}
      {(details.oldValue !== undefined || details.newValue !== undefined) && (
        <div className="space-y-3">
          {isModification && oldValueStr && newValueStr ? (
            // Enhanced diff view for modifications
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Changes</div>
                <button
                  onClick={() => setSplitView(!splitView)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {splitView ? "Unified view" : "Split view"}
                </button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <ReactDiffViewer
                  oldValue={oldValueStr}
                  newValue={newValueStr}
                  splitView={splitView}
                  useDarkTheme={theme === "dark"}
                  styles={{
                    variables: {
                      light: {
                        diffViewerBackground: "hsl(var(--background))",
                        diffViewerColor: "hsl(var(--foreground))",
                        addedBackground: "#e6ffed",
                        addedColor: "#24292e",
                        removedBackground: "#ffeef0",
                        removedColor: "#24292e",
                        wordAddedBackground: "#acf2bd",
                        wordRemovedBackground: "#fdb8c0",
                        addedGutterBackground: "#cdffd8",
                        removedGutterBackground: "#ffdce0",
                        gutterBackground: "hsl(var(--muted))",
                        gutterBackgroundDark: "hsl(var(--muted))",
                        highlightBackground: "#fffbdd",
                        highlightGutterBackground: "#fff5b1",
                      },
                      dark: {
                        diffViewerBackground: "hsl(var(--background))",
                        diffViewerColor: "hsl(var(--foreground))",
                        addedBackground: "rgba(34, 197, 94, 0.2)",
                        addedColor: "rgb(134, 239, 172)",
                        removedBackground: "rgba(239, 68, 68, 0.2)",
                        removedColor: "rgb(252, 165, 165)",
                        wordAddedBackground: "rgba(34, 197, 94, 0.4)",
                        wordRemovedBackground: "rgba(239, 68, 68, 0.4)",
                        addedGutterBackground: "rgba(34, 197, 94, 0.3)",
                        removedGutterBackground: "rgba(239, 68, 68, 0.3)",
                        gutterBackground: "hsl(var(--muted))",
                        gutterBackgroundDark: "hsl(var(--muted))",
                        highlightBackground: "rgba(234, 179, 8, 0.2)",
                        highlightGutterBackground: "rgba(234, 179, 8, 0.3)",
                      },
                    },
                    line: {
                      fontSize: "12px",
                      fontFamily:
                        'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                      letterSpacing: "0",
                      lineHeight: "1.6",
                      whiteSpace: "pre",
                      wordBreak: "normal",
                      wordWrap: "normal",
                    },
                    contentText: {
                      fontFamily:
                        'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                      letterSpacing: "0",
                      fontVariantLigatures: "none",
                      fontFeatureSettings: "normal",
                    },
                  }}
                />
              </div>
            </div>
          ) : (
            // Single value display for additions/removals
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {isAddition ? "Added Value" : "Removed Value"}
              </div>
              <div className="overflow-hidden rounded-md border">
                <div
                  className={`p-3 ${isAddition ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30"}`}
                >
                  <pre
                    className={`overflow-x-auto whitespace-pre-wrap font-mono text-xs ${isAddition ? "text-green-900 dark:text-green-100" : "text-red-900 dark:text-red-100"}`}
                  >
                    {isAddition ? newValueStr : oldValueStr}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full Details Section */}
      {(details.oldValue !== undefined || details.newValue !== undefined) && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            View raw JSON
          </summary>
          <div className="mt-2 rounded-md bg-muted p-3">
            <pre className="overflow-x-auto font-mono text-xs">
              {JSON.stringify(details, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
