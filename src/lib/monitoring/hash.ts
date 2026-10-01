import { createHash } from "node:crypto";
import type { SolanaIdl } from "../solana/idl-fetcher";
/**
 * Calculates a hash of the IDL content for change detection
 */
export function calculateIdlHash(idl: SolanaIdl): string {
  const normalizedIdl = normalizeIdlForHash(idl);
  const idlString = stableStringify(normalizedIdl);

  // Create SHA-256 hash
  return createHash("sha256").update(idlString).digest("hex");
}

function normalizeIdlForHash(idl: SolanaIdl) {
  return {
    ...idl,
    name: idl.name || idl.metadata?.name,
    version: idl.version || idl.metadata?.version,
    instructions:
      idl.instructions?.map((instruction) => ({
        ...instruction,
        accounts:
          instruction.accounts?.map((account) => ({
            ...account,
            isMut: account.isMut ?? account.writable ?? false,
            isSigner: account.isSigner ?? account.signer ?? false,
          })) || [],
      })) || [],
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort();

  return `{${keys
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
    )
    .join(",")}}`;
}
