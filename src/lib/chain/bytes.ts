import { PublicKey } from "@solana/web3.js";

/** Bounds-checked little-endian reader for Borsh-style account layouts. */
export class ByteReader {
  offset: number;

  constructor(
    readonly data: Uint8Array,
    offset = 0
  ) {
    this.offset = offset;
  }

  private take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new RangeError(
        `Account data ended at ${this.data.length}; needed ${this.offset + length}`
      );
    }
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  private view(length: number) {
    const bytes = this.take(length);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    return this.take(1)[0];
  }

  u16(): number {
    return this.view(2).getUint16(0, true);
  }

  u32(): number {
    return this.view(4).getUint32(0, true);
  }

  /** u64 as a JS number; slots and indexes stay far below 2^53. */
  u64(): number {
    const value = this.view(8).getBigUint64(0, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("u64 exceeds safe integer");
    return Number(value);
  }

  i64(): number {
    return Number(this.view(8).getBigInt64(0, true));
  }

  bytes(length: number): Uint8Array {
    return this.take(length);
  }

  pubkey(): string {
    return new PublicKey(this.take(32)).toBase58();
  }

  optionPubkey(): string | null {
    return this.u8() ? this.pubkey() : null;
  }

  /** Borsh Vec length (u32), capped so corrupt data cannot allocate unbounded arrays. */
  vecLength(max = 10_000): number {
    const length = this.u32();
    if (length > max) throw new RangeError(`Vector length ${length} exceeds ${max}`);
    return length;
  }
}

export function hasDiscriminator(data: Uint8Array, hex: string): boolean {
  return data.length >= 8 && Buffer.from(data.subarray(0, 8)).toString("hex") === hex;
}

export function u64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}
