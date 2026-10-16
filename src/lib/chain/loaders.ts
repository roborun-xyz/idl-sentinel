import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { ByteReader } from "./bytes";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const LOADER_V4 = "LoaderV411111111111111111111111111111111111";
export const LEGACY_LOADERS = new Set([
  "BPFLoader2111111111111111111111111111111111",
  "BPFLoader1111111111111111111111111111111111",
]);
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** ProgramData header: u32 tag, u64 slot, Option<Pubkey> authority. */
export const PROGRAM_DATA_HEADER = 45;
/** Loader v4 program header: u64 slot, Pubkey authority, u64 status. */
export const LOADER_V4_HEADER = 48;

export type LoaderKind = "upgradeable" | "loader-v4" | "immutable" | "native" | "unknown";
export type DeployStatus = "deployed" | "closed" | "retracted" | "missing";

/** What the loader accounts say about who can change a program's code. */
export interface LoaderState {
  loader: LoaderKind;
  status: DeployStatus;
  programDataAddress: string | null;
  deploySlot: number | null;
  upgradeAuthority: string | null;
}

export interface RawAccount {
  owner: string;
  data: Uint8Array;
}

export function programDataAddress(programId: string): string {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(programId).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER)
  )[0].toBase58();
}

/**
 * Reads the program account. For the upgradeable loader it returns the
 * ProgramData address that `decodeProgramData` must be given next.
 */
export function decodeProgramAccount(account: RawAccount | null): LoaderState {
  const empty = { programDataAddress: null, deploySlot: null, upgradeAuthority: null };
  if (!account) return { loader: "unknown", status: "missing", ...empty };
  if (account.owner === UPGRADEABLE_LOADER) {
    const reader = new ByteReader(account.data);
    const tag = reader.u32();
    if (tag !== 2) return { loader: "upgradeable", status: "missing", ...empty };
    return {
      loader: "upgradeable",
      status: "deployed",
      ...empty,
      programDataAddress: reader.pubkey(),
    };
  }
  if (account.owner === LOADER_V4) {
    const reader = new ByteReader(account.data);
    const deploySlot = reader.u64();
    const authority = reader.pubkey();
    const status = reader.u64();
    // 0 retracted, 1 deployed, 2 finalized (immutable; the field names a next version).
    return {
      loader: "loader-v4",
      status: status === 0 ? "retracted" : "deployed",
      programDataAddress: null,
      deploySlot,
      upgradeAuthority: status === 2 ? null : authority,
    };
  }
  if (LEGACY_LOADERS.has(account.owner))
    return { loader: "immutable", status: "deployed", ...empty };
  if (account.owner === NATIVE_LOADER) return { loader: "native", status: "deployed", ...empty };
  return { loader: "unknown", status: "deployed", ...empty };
}

/** Applies the ProgramData header; a missing or closed account means the program was closed. */
export function decodeProgramData(state: LoaderState, account: RawAccount | null): LoaderState {
  if (state.loader !== "upgradeable" || !state.programDataAddress) return state;
  if (!account || account.data.length < 4) {
    return { ...state, status: "closed", deploySlot: null, upgradeAuthority: null };
  }
  const reader = new ByteReader(account.data);
  if (reader.u32() !== 3)
    return { ...state, status: "closed", deploySlot: null, upgradeAuthority: null };
  return { ...state, deploySlot: reader.u64(), upgradeAuthority: reader.optionPubkey() };
}

/**
 * SHA-256 of the deployed ELF with trailing zero padding removed. This matches
 * `solana-verify get-program-hash` and the OtterSec verify API's on-chain hash.
 */
export function programCodeHash(loader: LoaderKind, accountData: Uint8Array): string | null {
  const header =
    loader === "upgradeable"
      ? PROGRAM_DATA_HEADER
      : loader === "loader-v4"
        ? LOADER_V4_HEADER
        : null;
  if (header === null || accountData.length <= header) return null;
  let end = accountData.length;
  while (end > header && accountData[end - 1] === 0) end--;
  return createHash("sha256").update(accountData.subarray(header, end)).digest("hex");
}

export interface LoaderInstruction {
  action: "upgrade" | "set_authority" | "close" | "extend" | "other";
  newAuthority?: string | null;
  buffer?: string;
}

/**
 * Classifies an upgradeable-loader instruction that touches `program`.
 * Returns null when the instruction targets another program.
 */
export function classifyLoaderInstruction(
  data: Uint8Array,
  accounts: string[],
  program: { programId: string; programDataAddress: string | null }
): LoaderInstruction | null {
  const targets = new Set([program.programId, program.programDataAddress].filter(Boolean));
  if (!accounts.some((account) => targets.has(account)) || data.length < 4) return null;
  const tag = new ByteReader(data).u32();
  switch (tag) {
    case 3: // Upgrade: programdata, program, buffer, spill, rent, clock, authority
      return { action: "upgrade", buffer: accounts[2] };
    case 4: // SetAuthority: account, current authority, optional new authority
    case 7: // SetAuthorityChecked: account, current authority, new authority (signer)
      if (!targets.has(accounts[0])) return null;
      return { action: "set_authority", newAuthority: accounts[2] ?? null };
    case 5: // Close: account, recipient, authority, program
      return { action: "close" };
    case 6: // ExtendProgram
    case 9: // ExtendProgramChecked
      return { action: "extend" };
    default:
      return { action: "other" };
  }
}
