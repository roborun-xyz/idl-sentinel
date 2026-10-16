import { fetchWithTimeout } from "../http";

export const VERIFY_API_URL = "https://verify.osec.io";

export type VerificationStatus = "verified" | "mismatch" | "unverified" | "unknown";

export interface Verification {
  status: VerificationStatus;
  repoUrl: string | null;
  commit: string | null;
  /** Hash of the build the repository and commit produce. */
  executableHash: string | null;
  lastVerifiedAt: string | null;
}

interface VerifyStatusResponse {
  is_verified?: boolean;
  on_chain_hash?: string;
  executable_hash?: string;
  repo_url?: string;
  commit?: string;
  last_verified_at?: string | null;
}

const blank = (value?: string | null) => (value && value.trim() ? value.trim() : null);

/**
 * Classifies a verify-API answer against the code hash we computed ourselves,
 * so a cached on-chain hash on their side cannot hide a fresh upgrade.
 * Verified builds show that published source produces the deployed code; they
 * are not a security review.
 */
export function classifyVerification(
  response: VerifyStatusResponse,
  codeHash: string | null
): Verification {
  // Third-party text ends up in links; only https URLs are kept.
  const repo = blank(response.repo_url);
  const repoUrl = repo && /^https:\/\//i.test(repo) ? repo : null;
  const executableHash = blank(response.executable_hash)?.toLowerCase() ?? null;
  const base = {
    repoUrl,
    commit: blank(response.commit),
    executableHash: executableHash && /^[0-9a-f]{64}$/.test(executableHash) ? executableHash : null,
    lastVerifiedAt: blank(response.last_verified_at),
  };
  if (!repo) return { status: "unverified", ...base };
  if (codeHash && base.executableHash) {
    return { status: base.executableHash === codeHash ? "verified" : "mismatch", ...base };
  }
  if (response.is_verified && !codeHash) return { status: "verified", ...base };
  // Source is registered but there is no build hash to compare (failed or still
  // running): inconclusive, and never reported as a lost verification.
  return { status: "unknown", ...base };
}

export async function fetchVerification(
  programId: string,
  codeHash: string | null,
  signal?: AbortSignal
): Promise<Verification> {
  const response = await fetchWithTimeout(
    `${VERIFY_API_URL}/status/${encodeURIComponent(programId)}`,
    { headers: { accept: "application/json" }, timeoutMs: 10_000, signal }
  );
  if (!response.ok) throw new Error(`Verify API returned ${response.status}`);
  return classifyVerification((await response.json()) as VerifyStatusResponse, codeHash);
}
