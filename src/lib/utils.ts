import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import bs58 from "bs58";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date for display
 */
export function formatDate(date: string | Date | null | undefined): string {
  // Handle null/undefined input
  if (!date) {
    return "Unknown";
  }

  // Convert to Date object
  const d = typeof date === "string" ? new Date(date) : date;

  // Check if the Date object is valid
  if (!d || isNaN(d.getTime())) {
    return "Invalid date";
  }

  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formats a relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
  // Handle null/undefined input
  if (!date) {
    return "Unknown";
  }

  // Convert to Date object
  const d = typeof date === "string" ? new Date(date) : date;

  // Check if the Date object is valid
  if (!d || isNaN(d.getTime())) {
    return "Invalid date";
  }

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else {
    return formatDate(d);
  }
}

/**
 * Truncates a string to a specified length
 */
export function truncateString(str: string | null | undefined, length: number): string {
  if (!str) return "";
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

/**
 * Validates a Solana program ID
 */
export function isValidProgramId(programId: string): boolean {
  try {
    // Basic length check (Solana addresses are base58 encoded and typically 32-44 characters)
    if (programId.length < 32 || programId.length > 44) {
      return false;
    }

    // Check if it's valid base58
    const decoded = bs58.decode(programId);

    // Solana public keys are 32 bytes
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Generates a random UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Debounce function for search inputs
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Gets severity color for UI display
 */
export function getSeverityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800";
    case "high":
      return "text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800";
    case "medium":
      return "text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950 dark:border-yellow-800";
    case "low":
      return "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800";
    default:
      return "text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-900 dark:border-gray-700";
  }
}

/**
 * Severity dot color classes - using const object for Tailwind's static analyzer
 */
export const severityDotColors = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
} as const;

/**
 * Severity badge color classes - using const object for Tailwind's static analyzer
 */
export const severityBadgeColors = {
  critical:
    "bg-red-500 text-white border-red-500 hover:bg-red-600 dark:bg-red-500 dark:text-white dark:border-red-500",
  high: "bg-orange-500 text-white border-orange-500 hover:bg-orange-600 dark:bg-orange-500 dark:text-white dark:border-orange-500",
  medium:
    "bg-yellow-500 text-white border-yellow-500 hover:bg-yellow-600 dark:bg-yellow-500 dark:text-white dark:border-yellow-500",
  low: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600 dark:bg-blue-500 dark:text-white dark:border-blue-500",
} as const;

/**
 * Gets severity dot color for severity indicators
 * @deprecated Use severityDotColors object directly for better Tailwind detection
 */
export function getSeverityDotColor(severity: string): string {
  return severityDotColors[severity as keyof typeof severityDotColors] || "bg-gray-500";
}

/**
 * Gets severity badge color classes
 * @deprecated Use severityBadgeColors object directly for better Tailwind detection
 */
export function getSeverityBadgeColor(severity: string): string {
  return (
    severityBadgeColors[severity as keyof typeof severityBadgeColors] ||
    "bg-gray-500 text-white border-gray-500 hover:bg-gray-600"
  );
}

/**
 * Supported Solana explorers
 */
export type SolanaExplorer = "explorer.solana.com" | "solscan.io";

/**
 * Generates a Solana explorer URL for a given address
 * @param address - The Solana address (program, account, transaction, etc.)
 * @param explorer - The preferred explorer
 * @param network - The Solana network (optional, defaults to mainnet-beta)
 * @returns The full URL to view the address in the explorer
 */
export function getExplorerUrl(
  address: string,
  explorer: SolanaExplorer = "explorer.solana.com",
  network?: string
): string {
  const networkParam = network && network !== "mainnet-beta" ? `?cluster=${network}` : "";

  if (explorer === "solscan.io") {
    const clusterParam = network && network !== "mainnet-beta" ? `?cluster=${network}` : "";
    return `https://solscan.io/account/${address}${clusterParam}`;
  }

  // Default to explorer.solana.com
  return `https://explorer.solana.com/address/${address}${networkParam}`;
}
