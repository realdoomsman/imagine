import { PublicKey } from "@solana/web3.js";

/**
 * Little-endian readers for decoding foreign program accounts (Raydium LaunchLab, CPMM) by fixed byte
 * offset, without their Anchor IDLs. Offsets include the 8-byte Anchor discriminator.
 */
export class AccountReader {
  readonly data: Buffer;

  constructor(data: Buffer | Uint8Array, what: string, discriminator: Uint8Array, minLen: number) {
    this.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (this.data.length < minLen) throw new Error(`${what}: account is ${this.data.length} bytes, expected ≥ ${minLen}`);
    if (!this.data.subarray(0, 8).equals(Buffer.from(discriminator))) throw new Error(`${what}: wrong account discriminator`);
  }

  u8(at: number): number {
    return this.data.readUInt8(at);
  }

  u16(at: number): number {
    return this.data.readUInt16LE(at);
  }

  /** Through a DataView: browser Buffer polyfills lack the BigInt readers. */
  u64(at: number): bigint {
    return new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength).getBigUint64(at, true);
  }

  bool(at: number): boolean {
    return this.data.readUInt8(at) !== 0;
  }

  pubkey(at: number): PublicKey {
    return new PublicKey(this.data.subarray(at, at + 32));
  }

  /** A fixed-size, zero-padded UTF-8 field. */
  fixedString(at: number, len: number): string {
    const raw = this.data.subarray(at, at + len);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? len : end).toString("utf8");
  }
}

/** Anchor discriminator from its hex form. */
export function disc(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** Borsh writer for hand-encoded instruction data (u64 args, strings, u8 enum tags). */
export class BorshWriter {
  private readonly parts: Buffer[] = [];

  constructor(discriminator: Uint8Array) {
    this.parts.push(Buffer.from(discriminator));
  }

  u8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v);
    this.parts.push(b);
    return this;
  }

  u64(v: bigint): this {
    if (v < 0n || v >= 1n << 64n) throw new Error(`u64 out of range: ${v}`);
    const b = Buffer.alloc(8);
    new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, v, true);
    this.parts.push(b);
    return this;
  }

  pubkey(k: PublicKey): this {
    this.parts.push(k.toBuffer());
    return this;
  }

  string(s: string): this {
    const bytes = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    this.parts.push(len, bytes);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}
