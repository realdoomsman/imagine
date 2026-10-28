/**
 * IMAGINE's own Raydium LaunchLab PlatformConfig: every IMAGINE coin launches
 * under it.
 *
 *   RPC_URL=… CPSWAP_CONFIG=<CPMM AmmConfig> node scripts/setup-platform.ts [admin.json]
 *   RPC_URL=… node scripts/setup-platform.ts --list-cpswap-configs
 *
 * What it sets (LaunchLab reads the platform's fee rates at every trade, so
 * they apply to all IMAGINE coins, live ones included; this script never
 * changes an existing PlatformConfig):
 *  - `fee_rate` 0: IMAGINE takes no platform fee on curve trades;
 *  - `creator_fee_rate` = LaunchLab's maximum (0.5%). A launch's "creator" is
 *    the pool's reward-vault PDA, so this fee — on every curve trade anywhere,
 *    not just imagine.fun — accrues on-chain to the coin's pool; the person
 *    who launched the coin earns nothing from it;
 *  - `cpswap_config`: the CPMM AmmConfig graduated coins migrate into. Pick one
 *    with a creator fee (`--list-cpswap-configs`): CPMM creator fees then keep
 *    flowing to the pool after graduation (`platform_cp_creator` stays default,
 *    so the CPMM pool creator is the LaunchLab creator — the vault);
 *  - migrated LP: 100% locked to the platform (`platform_scale`), Fee-Key NFT
 *    and fee wallet = the treasury; creator and burn scales 0;
 *  - name IMAGINE, web https://imagine.fun, img https://imagine.fun/brand/imagine-512.png.
 *
 * The PlatformConfig address is ["platform_config", admin] under LaunchLab, so
 * the admin key (default `<repo>/.mainnet/admin.json`) fixes it. Idempotent:
 * an existing PlatformConfig is printed, never changed. Then point the IMAGINE
 * config at it: `LAUNCHLAB_PLATFORM=<address> node scripts/init-config.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  CPMM_AMM_CONFIG_LEN,
  CPMM_PROGRAM_ID,
  imaginePlatformConfigIx,
  decodeCpmmAmmConfig,
  decodePlatformConfig,
  LAUNCHLAB_PROGRAM_ID,
  platformConfigPda,
} from "@imagine/sdk";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");

const pct = (millionths: bigint) => `${Number(millionths) / 1e4}%`;

/**
 * CPMM AmmConfigs with a creator fee: the candidates for `cpswap_config`.
 * Best first: the highest creator fee (more to the pool after graduation),
 * then the lowest trade fee. LaunchLab migrates with CPMM's permissioned
 * create, so a permissioned config works too, and it is preferred on ties:
 * nobody else can open a coin's canonical pool there first.
 */
async function listCpswapConfigs() {
  const accounts = await connection.getProgramAccounts(CPMM_PROGRAM_ID, { filters: [{ dataSize: CPMM_AMM_CONFIG_LEN }] });
  const rows = accounts
    .map(({ pubkey, account }) => ({ pubkey, config: decodeCpmmAmmConfig(account.data) }))
    .filter(({ config }) => config.creatorFeeRate > 0n)
    .sort(
      (a, b) =>
        Number(b.config.creatorFeeRate - a.config.creatorFeeRate) ||
        Number(a.config.tradeFeeRate - b.config.tradeFeeRate) ||
        Number(b.config.disableCreatePool) - Number(a.config.disableCreatePool),
    );
  if (rows.length === 0) console.log("no CPMM AmmConfig with a creator fee");
  for (const { pubkey, config } of rows) {
    console.log(
      `${pubkey.toBase58()}  index ${config.index}  ${config.disableCreatePool ? "permissioned" : "open"}  ` +
        `trade ${pct(config.tradeFeeRate)}  creator ${pct(config.creatorFeeRate)}  ` +
        `protocol ${pct(config.protocolFeeRate)} of trade fee  create-pool fee ${Number(config.createPoolFee) / LAMPORTS_PER_SOL} SOL`,
    );
  }
}

async function createPlatform() {
  const adminPath = process.argv.find((arg, i) => i >= 2 && !arg.startsWith("--")) ?? resolve(root, ".mainnet/admin.json");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminPath, "utf8")) as number[]));
  const treasury = new PublicKey(process.env.TREASURY_PUBKEY || "DNGM32EBgSwaG2Cj6NhYubzFHC8FTFopqgvPqp7ESY59");
  const address = platformConfigPda(admin.publicKey, LAUNCHLAB_PROGRAM_ID);
  console.log(`admin ${admin.publicKey.toBase58()}, PlatformConfig ${address.toBase58()}`);

  const existing = await connection.getAccountInfo(address);
  if (!existing) {
    if (!process.env.CPSWAP_CONFIG) throw new Error("set CPSWAP_CONFIG (candidates: --list-cpswap-configs)");
    const cpswapConfig = new PublicKey(process.env.CPSWAP_CONFIG);
    const ammInfo = await connection.getAccountInfo(cpswapConfig);
    if (!ammInfo || !ammInfo.owner.equals(CPMM_PROGRAM_ID)) throw new Error(`${cpswapConfig.toBase58()} is not a CPMM AmmConfig here`);
    const amm = decodeCpmmAmmConfig(ammInfo.data);
    console.log(`cpswap_config ${cpswapConfig.toBase58()}: index ${amm.index}, trade ${pct(amm.tradeFeeRate)}, creator ${pct(amm.creatorFeeRate)}`);
    // IMAGINE_PLATFORM_PARAMS: platform fee 0, trading fee = LaunchLab's max
    // (0.5%) to the pool, LP 100% to the platform (locked), name/web/img.
    const ix = imaginePlatformConfigIx({ admin: admin.publicKey, nftWallet: treasury, feeWallet: treasury, cpswapConfig });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin], { commitment: "confirmed" });
    console.log(`create_platform_config: ${signature}`);
  } else {
    console.log("PlatformConfig already exists; left unchanged");
  }
  const info = await connection.getAccountInfo(address);
  const platform = decodePlatformConfig(info!.data);
  console.log({
    address: address.toBase58(),
    name: platform.name,
    web: platform.web,
    img: platform.img,
    platformFee: pct(platform.feeRate),
    poolTradingFee: pct(platform.creatorFeeRate),
    cpswapConfig: platform.cpswapConfig.toBase58(),
    feeWallet: platform.platformFeeWallet.toBase58(),
    nftWallet: platform.platformNftWallet.toBase58(),
    scales: { platform: platform.platformScale.toString(), creator: platform.creatorScale.toString(), burn: platform.burnScale.toString() },
    restrictGlobalConfig: platform.restrictGlobalConfig,
    restrictCurveParam: platform.restrictCurveParam,
  });
  console.log(`next: LAUNCHLAB_PLATFORM=${address.toBase58()} node scripts/init-config.ts`);
}

if (process.argv.includes("--list-cpswap-configs")) await listCpswapConfigs();
else await createPlatform();
