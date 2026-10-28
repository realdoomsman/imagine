/**
 * Genesis accounts for the mainnet-fork validator (scripts/mainnet-fork.sh).
 *
 * Local work runs on a fork of mainnet: the validator clones the real Raydium
 * LaunchLab, CPMM and Token-2022 programs at start, and loads the accounts
 * written here, read from mainnet (read-only):
 *  - the LaunchLab GlobalConfigs of SOL and SPYx;
 *  - the SPYx mint;
 *  - the CPMM AmmConfigs a platform may graduate into (CPSWAP_CONFIGS:
 *    default the chosen FMmwToGq… and Raydium's index-0 D4FPEruK…);
 *  - real SPYx for the test wallets: the largest live mainnet SPYx account,
 *    copied to each wallet's ATA with owner and amount patched (xStocks
 *    cannot be minted).
 * The IMAGINE PlatformConfig is not cloned: scripts/setup-platform.ts creates
 * it on the fork exactly as on mainnet. The test wallets
 * (target/fork/wallets/*.json) are created on first run.
 *
 *   node scripts/fork-fixtures.ts
 *
 * Env: MAINNET_RPC_URL (default apps/api/.mainnet-rpc.tmp if present, else the
 * public mainnet RPC), FORK_DIR (target/fork at the repo root), FORK_SPYX
 * (whole SPYx per wallet, default 2), CPSWAP_CONFIGS (comma-separated).
 * Writes $FORK_DIR/accounts/*.json in `solana account --output json` form.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { quoteByMint, WSOL_MINT } from "@imagine/sdk";

export const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
export const FORK_WALLETS = ["creator", "trader", "locker"] as const;
/** CPMM AmmConfigs cloned onto the fork: the chosen cpswap config (index 16) and Raydium's index 0. */
export const FORK_CPSWAP_CONFIGS = (process.env.CPSWAP_CONFIGS ?? "FMmwToGqT9iwDgsqvzLg65vcKSzKme4szbWqX1kyCBCJ,D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2")
  .split(",")
  .map((key) => new PublicKey(key.trim()));

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FORK_DIR = process.env.FORK_DIR ?? join(root, "target", "fork");

/** A fork test wallet, created on first use. */
export function forkWallet(name: (typeof FORK_WALLETS)[number]): Keypair {
  const path = join(FORK_DIR, "wallets", `${name}.json`);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  mkdirSync(dirname(path), { recursive: true });
  const keypair = Keypair.generate();
  writeFileSync(path, JSON.stringify([...keypair.secretKey]));
  return keypair;
}

function accountJson(pubkey: PublicKey, info: Pick<AccountInfo<Buffer>, "lamports" | "data" | "owner" | "executable">) {
  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports: info.lamports,
      data: [Buffer.from(info.data).toString("base64"), "base64"],
      owner: info.owner.toBase58(),
      executable: info.executable,
      rentEpoch: 0,
      space: info.data.length,
    },
  };
}

function mainnetRpc(): string {
  if (process.env.MAINNET_RPC_URL) return process.env.MAINNET_RPC_URL;
  const keyed = join(root, "apps", "api", ".mainnet-rpc.tmp");
  return existsSync(keyed) ? readFileSync(keyed, "utf8").trim() : "https://api.mainnet-beta.solana.com";
}

async function main() {
  const connection = new Connection(mainnetRpc(), "confirmed");
  const dir = join(FORK_DIR, "accounts");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const clones: Array<{ label: string; address: PublicKey }> = [
    { label: "mint-spyx", address: SPYX_MINT },
    ...FORK_CPSWAP_CONFIGS.map((address) => ({ label: `cpmm-amm-config-${address.toBase58().slice(0, 8)}`, address })),
  ];
  for (const [label, mint] of [
    ["wsol", WSOL_MINT],
    ["spyx", SPYX_MINT],
  ] as const) {
    const registry = quoteByMint(mint);
    if (!registry) throw new Error(`${label} is not in the quote registry`);
    clones.push({ label: `globalconfig-${label}`, address: new PublicKey(registry.globalConfig) });
  }

  const infos = await connection.getMultipleAccountsInfo(clones.map((clone) => clone.address));
  for (const [i, clone] of clones.entries()) {
    const info = infos[i];
    if (!info) throw new Error(`${clone.label} ${clone.address.toBase58()} does not exist on mainnet`);
    writeFileSync(join(dir, `${clone.label}.json`), JSON.stringify(accountJson(clone.address, info)));
    console.log(`${clone.label} ${clone.address.toBase58()} (${info.data.length} bytes, owner ${info.owner.toBase58()})`);
  }

  // Real SPYx for the wallets: the largest initialized (not frozen) SPYx
  // account on mainnet as the template, owner and amount patched.
  const spyx = quoteByMint(SPYX_MINT)!;
  const perWallet = BigInt(Math.round(Number(process.env.FORK_SPYX ?? 2) * 10 ** spyx.decimals));
  const largest = await connection.getTokenLargestAccounts(SPYX_MINT);
  const holders = await connection.getMultipleAccountsInfo(largest.value.map(({ address }) => address));
  const index = holders.findIndex((info) => info?.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data[108] === 1);
  if (index < 0) throw new Error("no usable SPYx holder account on mainnet");
  const whale = { pubkey: largest.value[index]!.address, info: holders[index]! };
  for (const name of FORK_WALLETS) {
    const owner = forkWallet(name).publicKey;
    const ata = getAssociatedTokenAddressSync(SPYX_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
    const data = Buffer.from(whale.info.data);
    owner.toBuffer().copy(data, 32); // owner
    data.writeBigUInt64LE(perWallet, 64); // amount
    data.fill(0, 72, 108); // delegate: None
    data.fill(0, 109, 121); // is_native: None
    data.writeBigUInt64LE(0n, 121); // delegated_amount
    data.fill(0, 129, 165); // close_authority: None
    writeFileSync(join(dir, `spyx-${name}.json`), JSON.stringify(accountJson(ata, { ...whale.info, data })));
    console.log(`${name} ${owner.toBase58()}: SPYx ATA ${ata.toBase58()} (${perWallet} raw, from ${whale.pubkey.toBase58()})`);
  }
  console.log(`fixtures in ${dir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
