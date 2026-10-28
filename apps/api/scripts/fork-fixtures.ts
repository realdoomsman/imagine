/**
 * Genesis accounts for the mainnet-fork validator (scripts/mainnet-fork.sh).
 *
 * StonkFun has no devnet, so local work runs on a fork: the validator clones
 * the real Raydium LaunchLab, CPMM and Token-2022 programs at start, and loads
 * the accounts written here, read from mainnet (read-only RPC):
 *  - StonkFun's LaunchLab PlatformConfig;
 *  - for SOL and SPYx: the LaunchLab GlobalConfig, StonkFun's allow-config and
 *    curve-rule PDAs for it, and StonkFun's platform fee vault for it;
 *  - the SPYx mint and StonkFun's CPMM AmmConfig;
 *  - real SPYx for the test wallets: the largest live mainnet SPYx account,
 *    copied to each wallet's ATA with owner and amount patched (xStocks
 *    cannot be minted).
 * The test wallets (target/fork/wallets/*.json) are created on first run.
 *
 *   MAINNET_RPC_URL=https://api.mainnet-beta.solana.com node scripts/fork-fixtures.ts
 *
 * Env: MAINNET_RPC_URL (default the public mainnet RPC), FORK_DIR (target/fork
 * at the repo root), FORK_SPYX (whole SPYx per wallet, default 2).
 * Writes $FORK_DIR/accounts/*.json in `solana account --output json` form.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  platformAllowConfigPda,
  platformCurveRulePda,
  platformFeeVaultPda,
  quoteByMint,
  STONKFUN_CPMM_CONFIG,
  STONKFUN_PLATFORM,
  WSOL_MINT,
} from "@imagine/sdk";

export const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
export const FORK_WALLETS = ["creator", "trader", "locker"] as const;

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

async function main() {
  const connection = new Connection(process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  const dir = join(FORK_DIR, "accounts");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const clones: Array<{ label: string; address: PublicKey; required: boolean }> = [
    { label: "stonkfun-platform", address: STONKFUN_PLATFORM, required: true },
    { label: "cpmm-amm-config", address: STONKFUN_CPMM_CONFIG, required: true },
    { label: "mint-spyx", address: SPYX_MINT, required: true },
  ];
  for (const [label, mint] of [
    ["wsol", WSOL_MINT],
    ["spyx", SPYX_MINT],
  ] as const) {
    const registry = quoteByMint(mint);
    if (!registry) throw new Error(`${label} is not in the quote registry`);
    const globalConfig = new PublicKey(registry.globalConfig);
    clones.push(
      { label: `globalconfig-${label}`, address: globalConfig, required: true },
      { label: `allowconfig-${label}`, address: platformAllowConfigPda(STONKFUN_PLATFORM, globalConfig), required: false },
      { label: `curverule-${label}`, address: platformCurveRulePda(STONKFUN_PLATFORM, globalConfig), required: false },
      { label: `platformfeevault-${label}`, address: platformFeeVaultPda(STONKFUN_PLATFORM, mint), required: false },
    );
  }

  const infos = await connection.getMultipleAccountsInfo(clones.map((clone) => clone.address));
  for (const [i, clone] of clones.entries()) {
    const info = infos[i];
    if (!info) {
      if (clone.required) throw new Error(`${clone.label} ${clone.address.toBase58()} does not exist on mainnet`);
      console.log(`${clone.label} ${clone.address.toBase58()}: not on mainnet, skipped`);
      continue;
    }
    writeFileSync(join(dir, `${clone.label}.json`), JSON.stringify(accountJson(clone.address, info)));
    console.log(`${clone.label} ${clone.address.toBase58()} (${info.data.length} bytes, owner ${info.owner.toBase58()})`);
  }

  // Real SPYx for the wallets. The template is StonkFun's SPYx fee vault — a
  // live, initialized SPYx Token-2022 account already read above — with owner
  // and amount patched; one fewer RPC call than hunting for a holder, which
  // the public endpoint rate-limits.
  const spyx = quoteByMint(SPYX_MINT)!;
  const perWallet = BigInt(Math.round(Number(process.env.FORK_SPYX ?? 2) * 10 ** spyx.decimals));
  const templateIndex = clones.findIndex((clone) => clone.label === "platformfeevault-spyx");
  const template = infos[templateIndex];
  if (!template || !template.owner.equals(TOKEN_2022_PROGRAM_ID) || template.data[108] !== 1) {
    throw new Error("StonkFun's SPYx fee vault is not a live Token-2022 account; cannot template SPYx balances");
  }
  const whale = { pubkey: clones[templateIndex]!.address, info: template };
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
