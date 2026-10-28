import type { Keypair } from "@solana/web3.js";

/** PKCS#8 prefix of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Proof that this page holds the new coin's mint key, for the API's metadata
 * upload: the mint keypair's Ed25519 signature over `imagine-metadata:<mint>`,
 * base58. With it the upload may replace metadata stored for the mint earlier
 * (a retry after an edit); without it only a first upload is accepted. Null
 * where the browser's WebCrypto has no Ed25519.
 */
export async function signMintProof(mint: Keypair): Promise<string | null> {
  try {
    const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
    pkcs8.set(ED25519_PKCS8_PREFIX);
    pkcs8.set(mint.secretKey.subarray(0, 32), ED25519_PKCS8_PREFIX.length);
    const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
    const message = new TextEncoder().encode(`imagine-metadata:${mint.publicKey.toBase58()}`);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message));
    // Base58 of the 64 signature bytes (no leading zero bytes are dropped).
    let value = 0n;
    for (const byte of signature) value = (value << 8n) | BigInt(byte);
    let text = "";
    while (value > 0n) {
      text = BASE58[Number(value % 58n)] + text;
      value /= 58n;
    }
    for (const byte of signature) {
      if (byte !== 0) break;
      text = "1" + text;
    }
    return text;
  } catch {
    return null;
  }
}
