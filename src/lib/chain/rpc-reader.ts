import { PublicKey, type Connection } from "@solana/web3.js";
import { createSolanaConnection } from "../solana/idl-fetcher";
import { decodeMultisig, findVaultIndex, SQUADS_V4_PROGRAM } from "./squads";
import { fetchVerification } from "./verify";
import type { ChainReader } from "./watch";
import type { RawAccount } from "./loaders";

const toRaw = (info: { owner: PublicKey; data: Buffer } | null): RawAccount | null =>
  info ? { owner: info.owner.toBase58(), data: info.data } : null;

/** Solana JSON-RPC implementation of the watcher's reads. */
export function createRpcChainReader(signal?: AbortSignal): ChainReader {
  const connection = createSolanaConnection(undefined, signal);
  // Deployed programs can reach 10 MiB, which is ~14 MB of base64 JSON.
  const bulk: Connection = createSolanaConnection(undefined, signal, {
    timeoutMs: 25_000,
    maxBytes: 24 * 1024 * 1024,
  });

  async function getAccounts(addresses: string[], dataSlice?: { offset: number; length: number }) {
    const results: Array<RawAccount | null> = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const keys = addresses.slice(i, i + 100).map((a) => new PublicKey(a));
      const infos = await connection.getMultipleAccountsInfo(keys, { dataSlice });
      results.push(...infos.map(toRaw));
    }
    return results;
  }

  return {
    getAccounts,
    async getFullAccount(address) {
      return toRaw(await bulk.getAccountInfo(new PublicKey(address)));
    },
    async getBlockTime(slot) {
      return connection.getBlockTime(slot);
    },
    async getLookupTable(address) {
      const table = await connection.getAddressLookupTable(new PublicKey(address));
      return table.value ? table.value.state.addresses.map((a) => a.toBase58()) : null;
    },
    async findSquadsVault(authority) {
      // A vault only signs through Squads, so its own history names the multisig.
      // Scan up to 100 recent transactions in pages and stop at the first match,
      // so incoming transfers or spam cannot push the Squads calls out of view.
      const signatures = await connection.getSignaturesForAddress(new PublicKey(authority), {
        limit: 100,
      });
      const checked = new Set<string>();
      for (let i = 0; i < signatures.length; i += 20) {
        const transactions = await connection.getTransactions(
          signatures.slice(i, i + 20).map((s) => s.signature),
          { maxSupportedTransactionVersion: 0 }
        );
        const candidates = new Set<string>();
        for (const transaction of transactions) {
          if (!transaction?.meta) continue;
          const keys = transaction.transaction.message.getAccountKeys({
            accountKeysFromLookups: transaction.meta.loadedAddresses,
          });
          for (const instruction of transaction.transaction.message.compiledInstructions) {
            if (keys.get(instruction.programIdIndex)?.toBase58() !== SQUADS_V4_PROGRAM) continue;
            // Squads v4 instructions take the multisig as their first or second account.
            for (const index of instruction.accountKeyIndexes.slice(0, 2)) {
              const key = keys.get(index)?.toBase58();
              if (key && !checked.has(key)) candidates.add(key);
            }
          }
        }
        if (!candidates.size) continue;
        const addresses = [...candidates];
        addresses.forEach((address) => checked.add(address));
        const accounts = await getAccounts(addresses);
        for (const [j, account] of accounts.entries()) {
          if (account?.owner !== SQUADS_V4_PROGRAM) continue;
          if (!decodeMultisig(addresses[j], account.data)) continue;
          const vaultIndex = findVaultIndex(addresses[j], authority);
          if (vaultIndex !== null) return { multisig: addresses[j], vaultIndex };
        }
      }
      return null;
    },
    fetchVerification(programId, codeHash) {
      return fetchVerification(programId, codeHash, signal);
    },
  };
}
