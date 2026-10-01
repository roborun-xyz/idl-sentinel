import { Connection, PublicKey, AccountInfo, type ConnectionConfig } from "@solana/web3.js";
import { inflate, ungzip } from "pako";
import bs58 from "bs58";
import { fetchWithTimeout } from "../http";

export interface IdlAccount {
  authority: PublicKey;
  data: Buffer;
}

export interface IdlInstructionAccount {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  writable?: boolean;
  signer?: boolean;
  accounts?: IdlInstructionAccount[];
  [key: string]: unknown;
}

export interface SolanaIdl {
  version?: string;
  name: string;
  address?: string;
  instructions: Array<{
    name: string;
    accounts: IdlInstructionAccount[];
    args: Array<{
      name: string;
      type: unknown;
    }>;
    [key: string]: unknown;
  }>;
  accounts?: Array<{
    name: string;
    type?: {
      kind: string;
      fields: Array<{
        name: string;
        type: unknown;
      }>;
    };
    [key: string]: unknown;
  }>;
  types?: Array<{
    name: string;
    type: {
      kind: string;
      fields?: Array<{
        name: string;
        type: unknown;
      }>;
      variants?: Array<{
        name: string;
        fields?: Array<{
          name: string;
          type: unknown;
        }>;
      }>;
    };
  }>;
  errors?: Array<{
    code?: number;
    name: string;
    msg?: string;
  }>;
  events?: unknown[];
  metadata?: {
    name?: string;
    version?: string;
    address: string;
    [key: string]: unknown;
  };
}

const PROGRAM_METADATA_PROGRAM_ID = new PublicKey("ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S");
const PROGRAM_METADATA_IDL_SEED = "idl";
const PROGRAM_METADATA_SEED_LENGTH = 16;
const PROGRAM_METADATA_HEADER_LENGTH = 96;
const PROGRAM_METADATA_DISCRIMINATOR = 2;
const SOLANA_RPC_TIMEOUT_MS = 15_000;
const PROGRAM_METADATA_URL_TIMEOUT_MS = 10_000;

enum MetadataEncoding {
  None = 0,
  Utf8 = 1,
  Base58 = 2,
  Base64 = 3,
}

enum MetadataCompression {
  None = 0,
  Gzip = 1,
  Zlib = 2,
}

enum MetadataFormat {
  None = 0,
  Json = 1,
}

enum MetadataDataSource {
  Direct = 0,
  Url = 1,
  External = 2,
}

interface ProgramMetadataAccount {
  address: PublicKey;
  program: PublicKey;
  authority: PublicKey | null;
  mutable: boolean;
  canonical: boolean;
  seed: string;
  encoding: MetadataEncoding;
  compression: MetadataCompression;
  format: MetadataFormat;
  dataSource: MetadataDataSource;
  dataLength: number;
  data: Buffer;
}

/**
 * Derives the IDL account address for a given program
 */
export async function deriveIdlAddress(programId: PublicKey): Promise<PublicKey> {
  const base = PublicKey.findProgramAddressSync([], programId)[0];
  const idlAddress = await PublicKey.createWithSeed(base, "anchor:idl", programId);

  return idlAddress;
}

/**
 * Derives the canonical Program Metadata account for a given program and seed.
 * The seed is fixed-width UTF-8, matching @solana-program/program-metadata.
 */
export function deriveProgramMetadataAddress(
  programId: PublicKey,
  seed: string = PROGRAM_METADATA_IDL_SEED,
  authority?: PublicKey | null
): PublicKey {
  const seedBytes = encodeProgramMetadataSeed(seed);
  const seeds = authority
    ? [programId.toBuffer(), authority.toBuffer(), seedBytes]
    : [programId.toBuffer(), seedBytes];

  return PublicKey.findProgramAddressSync(seeds, PROGRAM_METADATA_PROGRAM_ID)[0];
}

/**
 * Fetches and parses IDL from a Solana program's on-chain account
 */
export async function fetchIdlFromChain(
  connection: Connection,
  programId: string,
  maxRetries: number = 3,
  signal?: AbortSignal
): Promise<SolanaIdl | null> {
  const programPubkey = new PublicKey(programId);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();
    try {
      console.log(`Fetching IDL for program ${programId}, attempt ${attempt}/${maxRetries}`);

      const anchorIdl = await fetchAnchorIdl(connection, programPubkey);
      if (anchorIdl) {
        console.log(`Successfully fetched legacy Anchor IDL for program ${programId}`);
        return normalizeFetchedIdl(anchorIdl, programId);
      }

      const programMetadataIdl = await fetchProgramMetadataIdl(connection, programPubkey, signal);
      if (programMetadataIdl) {
        console.log(`Successfully fetched Program Metadata IDL for program ${programId}`);
        return normalizeFetchedIdl(programMetadataIdl, programId);
      }

      console.log(`No IDL account found for program ${programId}`);
      return null;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error as Error;
      console.warn(`Attempt ${attempt} failed for program ${programId}:`, error);

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    `Failed to fetch IDL for program ${programId} after ${maxRetries} attempts:`,
    lastError
  );
  throw lastError || new Error(`Failed to fetch IDL after ${maxRetries} attempts`);
}

/**
 * Fetches IDL from Anchor's legacy `anchor:idl` account.
 */
async function fetchAnchorIdl(
  connection: Connection,
  programPubkey: PublicKey
): Promise<unknown | null> {
  const idlAddress = await deriveIdlAddress(programPubkey);
  const accountInfo = await connection.getAccountInfo(idlAddress);

  if (!accountInfo) {
    return null;
  }

  return parseIdlAccount(accountInfo);
}

/**
 * Fetches IDL from @solana-program/program-metadata accounts using the `idl`
 * seed. Canonical metadata is preferred; non-canonical metadata is discovered
 * as a fallback because it requires knowing the third-party authority.
 */
async function fetchProgramMetadataIdl(
  connection: Connection,
  programPubkey: PublicKey,
  signal?: AbortSignal
): Promise<unknown | null> {
  const canonicalAddress = deriveProgramMetadataAddress(programPubkey);
  const canonicalAccount = await connection.getAccountInfo(canonicalAddress);

  if (canonicalAccount) {
    const idl = await parseProgramMetadataIdl(
      connection,
      canonicalAddress,
      canonicalAccount,
      programPubkey,
      signal
    );
    if (idl) {
      return idl;
    }
  }

  const accounts = await findProgramMetadataIdlAccounts(connection, programPubkey);
  const candidates = accounts
    .filter(({ pubkey }) => !pubkey.equals(canonicalAddress))
    .sort((a, b) => a.pubkey.toBase58().localeCompare(b.pubkey.toBase58()));

  for (const { pubkey, account } of candidates) {
    const idl = await parseProgramMetadataIdl(connection, pubkey, account, programPubkey, signal);
    if (idl) {
      console.log(`Using non-canonical Program Metadata IDL account ${pubkey.toBase58()}`);
      return idl;
    }
  }

  return null;
}

async function findProgramMetadataIdlAccounts(
  connection: Connection,
  programPubkey: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>> {
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM_METADATA_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode(Buffer.from([PROGRAM_METADATA_DISCRIMINATOR])),
          },
        },
        {
          memcmp: {
            offset: 1,
            bytes: programPubkey.toBase58(),
          },
        },
        {
          memcmp: {
            offset: 67,
            bytes: bs58.encode(encodeProgramMetadataSeed(PROGRAM_METADATA_IDL_SEED)),
          },
        },
      ],
    });

    return accounts.map(({ pubkey, account }) => ({ pubkey, account }));
  } catch (error) {
    console.warn("Failed to discover Program Metadata IDL accounts:", error);
    throw error;
  }
}

/**
 * Parses the IDL account data
 */
function parseIdlAccount(accountInfo: AccountInfo<Buffer>): SolanaIdl | null {
  try {
    const data = accountInfo.data;

    // Skip the first 8 bytes (discriminator)
    const idlData = data.slice(8);

    // The IDL data structure:
    // - 32 bytes: authority (PublicKey)
    // - 4 bytes: data length
    // - remaining: compressed IDL data

    if (idlData.length < 36) {
      throw new Error("IDL account data too short");
    }

    // Read data length (4 bytes, little endian)
    const dataLengthBytes = idlData.slice(32, 36);
    const dataLength = dataLengthBytes.readUInt32LE(0);

    // Extract compressed IDL data
    const compressedData = idlData.slice(36, 36 + dataLength);

    // Decompress the IDL data
    const decompressedData = inflate(compressedData);

    // Parse JSON
    const idlString = Buffer.from(decompressedData).toString("utf8");
    const idl = JSON.parse(idlString) as SolanaIdl;

    return idl;
  } catch (error) {
    console.error("Error parsing IDL account:", error);
    throw error;
  }
}

async function parseProgramMetadataIdl(
  connection: Connection,
  address: PublicKey,
  accountInfo: AccountInfo<Buffer>,
  expectedProgram: PublicKey,
  signal?: AbortSignal
): Promise<unknown | null> {
  try {
    if (!accountInfo.owner.equals(PROGRAM_METADATA_PROGRAM_ID)) {
      return null;
    }

    const metadata = parseProgramMetadataAccount(address, accountInfo.data);

    if (!metadata.program.equals(expectedProgram)) {
      return null;
    }

    if (metadata.seed !== PROGRAM_METADATA_IDL_SEED) {
      return null;
    }

    const content = await unpackProgramMetadataContent(connection, metadata, signal);
    return parseProgramMetadataContent(content, metadata.format);
  } catch (error) {
    console.warn(`Failed to parse Program Metadata account ${address.toBase58()}:`, error);
    throw error;
  }
}

function parseProgramMetadataAccount(address: PublicKey, data: Buffer): ProgramMetadataAccount {
  if (data.length < PROGRAM_METADATA_HEADER_LENGTH) {
    throw new Error("Program Metadata account data too short");
  }

  if (data[0] !== PROGRAM_METADATA_DISCRIMINATOR) {
    throw new Error("Account is not a Program Metadata metadata account");
  }

  const program = new PublicKey(data.subarray(1, 33));
  const authorityBytes = data.subarray(33, 65);
  const authority = authorityBytes.every((byte) => byte === 0)
    ? null
    : new PublicKey(authorityBytes);
  const mutable = data[65] !== 0;
  const canonical = data[66] !== 0;
  const seed = decodeProgramMetadataSeed(data.subarray(67, 83));
  const encoding = data[83] as MetadataEncoding;
  const compression = data[84] as MetadataCompression;
  const format = data[85] as MetadataFormat;
  const dataSource = data[86] as MetadataDataSource;
  const dataLength = data.readUInt32LE(87);
  const payloadEnd = PROGRAM_METADATA_HEADER_LENGTH + dataLength;

  if (payloadEnd > data.length) {
    throw new Error("Program Metadata payload exceeds account data length");
  }

  return {
    address,
    program,
    authority,
    mutable,
    canonical,
    seed,
    encoding,
    compression,
    format,
    dataSource,
    dataLength,
    data: data.subarray(PROGRAM_METADATA_HEADER_LENGTH, payloadEnd),
  };
}

async function unpackProgramMetadataContent(
  connection: Connection,
  metadata: ProgramMetadataAccount,
  signal?: AbortSignal
): Promise<string> {
  switch (metadata.dataSource) {
    case MetadataDataSource.Direct:
      return decodeProgramMetadataData(metadata.data, metadata);

    case MetadataDataSource.Url: {
      const url = decodeProgramMetadataData(metadata.data, metadata);
      const response = await fetchWithTimeout(url, {
        timeoutMs: PROGRAM_METADATA_URL_TIMEOUT_MS,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch Program Metadata URL ${url}: ${response.status}`);
      }
      return response.text();
    }

    case MetadataDataSource.External: {
      const externalData = parseExternalProgramMetadataData(metadata.data);
      const externalAccount = await connection.getAccountInfo(externalData.address);
      if (!externalAccount) {
        throw new Error(
          `External Program Metadata account not found: ${externalData.address.toBase58()}`
        );
      }

      let data = externalAccount.data.subarray(externalData.offset);
      if (externalData.length !== null) {
        data = data.subarray(0, externalData.length);
      }
      return decodeProgramMetadataData(data, metadata);
    }

    default:
      throw new Error(`Unsupported Program Metadata data source`);
  }
}

function parseExternalProgramMetadataData(data: Buffer): {
  address: PublicKey;
  offset: number;
  length: number | null;
} {
  if (data.length < 40) {
    throw new Error("External Program Metadata payload too short");
  }

  const length = data.readUInt32LE(36);
  return {
    address: new PublicKey(data.subarray(0, 32)),
    offset: data.readUInt32LE(32),
    length: length === 0 ? null : length,
  };
}

function decodeProgramMetadataData(
  data: Buffer,
  metadata: Pick<ProgramMetadataAccount, "compression" | "encoding">
): string {
  const uncompressed = uncompressProgramMetadataData(data, metadata.compression);

  switch (metadata.encoding) {
    case MetadataEncoding.None:
      return uncompressed.toString("hex");
    case MetadataEncoding.Utf8:
      return uncompressed.toString("utf8");
    case MetadataEncoding.Base58:
      return bs58.encode(uncompressed);
    case MetadataEncoding.Base64:
      return uncompressed.toString("base64");
    default:
      throw new Error(`Unsupported Program Metadata encoding`);
  }
}

function uncompressProgramMetadataData(data: Buffer, compression: MetadataCompression): Buffer {
  switch (compression) {
    case MetadataCompression.None:
      return Buffer.from(data);
    case MetadataCompression.Gzip:
      return Buffer.from(ungzip(data));
    case MetadataCompression.Zlib:
      return Buffer.from(inflate(data));
    default:
      throw new Error(`Unsupported Program Metadata compression`);
  }
}

function parseProgramMetadataContent(content: string, format: MetadataFormat) {
  if (format === MetadataFormat.Json || looksLikeJson(content)) {
    return JSON.parse(content);
  }

  throw new Error("Program Metadata IDL content is not JSON");
}

function looksLikeJson(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function encodeProgramMetadataSeed(seed: string): Buffer {
  const seedBytes = Buffer.from(seed, "utf8");
  if (seedBytes.length > PROGRAM_METADATA_SEED_LENGTH) {
    throw new Error(`Program Metadata seed must be ${PROGRAM_METADATA_SEED_LENGTH} bytes or less`);
  }

  const fixedSeed = Buffer.alloc(PROGRAM_METADATA_SEED_LENGTH);
  seedBytes.copy(fixedSeed);
  return fixedSeed;
}

function decodeProgramMetadataSeed(seedBytes: Buffer): string {
  return seedBytes.toString("utf8").replace(/\0+$/g, "");
}

function normalizeFetchedIdl(value: unknown, programId: string): SolanaIdl {
  if (!value || typeof value !== "object") throw new Error("IDL must be an object");
  const raw = value as Partial<SolanaIdl>;
  const idl = {
    ...raw,
    name: raw.name || raw.metadata?.name || programId,
    version: raw.version || raw.metadata?.version,
  };
  if (!validateIdl(idl)) throw new Error("Invalid IDL structure");
  return idl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validAccounts(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (account) =>
        isRecord(account) &&
        typeof account.name === "string" &&
        (account.accounts === undefined || validAccounts(account.accounts))
    )
  );
}
export function validateIdl(value: unknown): value is SolanaIdl {
  if (!isRecord(value)) return false;
  const name =
    value.name || (isRecord(value.metadata) ? value.metadata.name : undefined) || value.address;
  if (typeof name !== "string" || !Array.isArray(value.instructions)) return false;
  if (
    !value.instructions.every(
      (instruction) =>
        isRecord(instruction) &&
        typeof instruction.name === "string" &&
        validAccounts(instruction.accounts) &&
        Array.isArray(instruction.args) &&
        instruction.args.every(
          (arg) => isRecord(arg) && typeof arg.name === "string" && "type" in arg
        )
    )
  )
    return false;
  for (const field of ["accounts", "types", "errors"] as const) {
    if (
      value[field] !== undefined &&
      (!Array.isArray(value[field]) ||
        !value[field].every((item) => isRecord(item) && typeof item.name === "string"))
    )
      return false;
  }
  return true;
}

/**
 * Creates a connection to Solana RPC
 */
export function createSolanaConnection(rpcUrl?: string, signal?: AbortSignal): Connection {
  const url = rpcUrl || process.env.SOLANA_RPC_URL;
  if (!url)
    throw new Error("SOLANA_RPC_URL must be configured (use your Helius endpoint for mainnet)");
  const config: ConnectionConfig = {
    disableRetryOnRateLimit: true,
    commitment: "confirmed",
    fetch: (input, init) =>
      fetchWithTimeout(input, {
        ...(init || {}),
        timeoutMs: SOLANA_RPC_TIMEOUT_MS,
        signal,
      }),
  };

  return new Connection(url, config);
}
