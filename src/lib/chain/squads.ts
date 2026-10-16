import { PublicKey } from "@solana/web3.js";
import { ByteReader, hasDiscriminator, u64LE } from "./bytes";
import { isOpenProposal, type ProposalStatus } from "./proposal-status";
import { UPGRADEABLE_LOADER, classifyLoaderInstruction, type LoaderInstruction } from "./loaders";

export { isOpenProposal, type ProposalStatus };

export const SQUADS_V4_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
const SQUADS = new PublicKey(SQUADS_V4_PROGRAM);
// Anchor discriminators: sha256("account:<Name>")[0..8].
const MULTISIG_DISCRIMINATOR = "e07479ba44a14fec";
const VAULT_TRANSACTION_DISCRIMINATOR = "a8faa264510ea2cf";
const PROPOSAL_DISCRIMINATOR = "1a5ebdbb74883521";

export interface SquadsMultisig {
  address: string;
  threshold: number;
  timeLock: number;
  transactionIndex: number;
  staleTransactionIndex: number;
  configAuthority: string | null;
  members: string[];
}

export interface SquadsProposal {
  status: ProposalStatus;
  /** Unix seconds when the proposal entered its current status, when recorded. */
  statusAt: number | null;
  approvals: number;
  rejections: number;
}

export interface VaultTransaction {
  multisig: string;
  creator: string;
  index: number;
  vaultIndex: number;
  accountKeys: string[];
  instructions: Array<{ programIdIndex: number; accountIndexes: number[]; data: Uint8Array }>;
  addressTableLookups: Array<{ accountKey: string; writable: number[]; readonly: number[] }>;
}

const PROPOSAL_STATUSES: ProposalStatus[] = [
  "draft",
  "active",
  "rejected",
  "approved",
  "executing",
  "executed",
  "cancelled",
];

export function vaultAddress(multisig: string, vaultIndex: number): string {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      new PublicKey(multisig).toBuffer(),
      Buffer.from("vault"),
      Buffer.from([vaultIndex]),
    ],
    SQUADS
  )[0].toBase58();
}

export function transactionAddress(multisig: string, index: number): string {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      new PublicKey(multisig).toBuffer(),
      Buffer.from("transaction"),
      u64LE(index),
    ],
    SQUADS
  )[0].toBase58();
}

export function proposalAddress(multisig: string, index: number): string {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      new PublicKey(multisig).toBuffer(),
      Buffer.from("transaction"),
      u64LE(index),
      Buffer.from("proposal"),
    ],
    SQUADS
  )[0].toBase58();
}

/** Returns the vault index whose PDA equals `authority`, or null. */
export function findVaultIndex(multisig: string, authority: string, maxIndex = 8): number | null {
  for (let index = 0; index <= maxIndex; index++) {
    if (vaultAddress(multisig, index) === authority) return index;
  }
  return null;
}

export function decodeMultisig(address: string, data: Uint8Array): SquadsMultisig | null {
  if (!hasDiscriminator(data, MULTISIG_DISCRIMINATOR)) return null;
  const reader = new ByteReader(data, 8);
  reader.pubkey(); // create_key
  const configAuthority = reader.pubkey();
  const threshold = reader.u16();
  const timeLock = reader.u32();
  const transactionIndex = reader.u64();
  const staleTransactionIndex = reader.u64();
  reader.optionPubkey(); // rent_collector
  reader.u8(); // bump
  const members: string[] = [];
  const count = reader.vecLength(65_535);
  for (let i = 0; i < count; i++) {
    members.push(reader.pubkey());
    reader.u8(); // permissions mask
  }
  return {
    address,
    threshold,
    timeLock,
    transactionIndex,
    staleTransactionIndex,
    // The default pubkey means the multisig is autonomous: only its members can reconfigure it.
    configAuthority:
      configAuthority === "11111111111111111111111111111111" ? null : configAuthority,
    members: members.sort(),
  };
}

export function decodeVaultTransaction(data: Uint8Array): VaultTransaction | null {
  if (!hasDiscriminator(data, VAULT_TRANSACTION_DISCRIMINATOR)) return null;
  const reader = new ByteReader(data, 8);
  const multisig = reader.pubkey();
  const creator = reader.pubkey();
  const index = reader.u64();
  reader.u8(); // bump
  const vaultIndex = reader.u8();
  reader.u8(); // vault_bump
  reader.bytes(reader.vecLength()); // ephemeral_signer_bumps
  reader.u8(); // num_signers
  reader.u8(); // num_writable_signers
  reader.u8(); // num_writable_non_signers
  const accountKeys = Array.from({ length: reader.vecLength(256) }, () => reader.pubkey());
  const instructions = Array.from({ length: reader.vecLength(256) }, () => ({
    programIdIndex: reader.u8(),
    accountIndexes: Array.from(reader.bytes(reader.vecLength(256))),
    data: reader.bytes(reader.vecLength(1_232_000)),
  }));
  const addressTableLookups = Array.from({ length: reader.vecLength(256) }, () => ({
    accountKey: reader.pubkey(),
    writable: Array.from(reader.bytes(reader.vecLength(256))),
    readonly: Array.from(reader.bytes(reader.vecLength(256))),
  }));
  return { multisig, creator, index, vaultIndex, accountKeys, instructions, addressTableLookups };
}

export function decodeProposal(data: Uint8Array | null): SquadsProposal {
  if (!data) return { status: "none", statusAt: null, approvals: 0, rejections: 0 };
  if (!hasDiscriminator(data, PROPOSAL_DISCRIMINATOR)) throw new Error("Not a Squads proposal");
  const reader = new ByteReader(data, 8);
  reader.pubkey(); // multisig
  reader.u64(); // transaction_index
  const status = PROPOSAL_STATUSES[reader.u8()];
  if (!status) throw new Error("Unknown Squads proposal status");
  // Every variant except the deprecated `Executing` carries a timestamp.
  const statusAt = status === "executing" ? null : reader.i64();
  reader.u8(); // bump
  const approvals = reader.vecLength();
  reader.bytes(approvals * 32);
  const rejections = reader.vecLength();
  return { status, statusAt, approvals, rejections };
}

/**
 * Resolves the vault transaction's account list, including lookup-table
 * entries, in the order the compiled indexes refer to.
 */
export function resolveTransactionAccounts(
  transaction: VaultTransaction,
  lookupTables: Map<string, string[]>
): string[] | null {
  const writable: string[] = [];
  const readonly: string[] = [];
  for (const lookup of transaction.addressTableLookups) {
    const table = lookupTables.get(lookup.accountKey);
    if (!table) return null;
    for (const i of lookup.writable) writable.push(table[i]);
    for (const i of lookup.readonly) readonly.push(table[i]);
  }
  return [...transaction.accountKeys, ...writable, ...readonly];
}

/** Upgradeable-loader actions in a vault transaction that touch the given program. */
export function programActions(
  transaction: VaultTransaction,
  accounts: string[],
  program: { programId: string; programDataAddress: string | null }
): LoaderInstruction[] {
  const actions: LoaderInstruction[] = [];
  for (const instruction of transaction.instructions) {
    if (accounts[instruction.programIdIndex] !== UPGRADEABLE_LOADER) continue;
    const action = classifyLoaderInstruction(
      instruction.data,
      instruction.accountIndexes.map((i) => accounts[i]),
      program
    );
    if (action && action.action !== "other") actions.push(action);
  }
  return actions;
}
