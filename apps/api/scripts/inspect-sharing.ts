/**
 * Where did pump put the creator fee? Dumps every candidate account for the
 * most recent e2e coin so the keeper's vault arithmetic can be checked against
 * reality rather than against the SDK's opinion of it.
 *
 * Run: node --env-file=.env.local scripts/inspect-sharing.ts <mint>
 */
import {
  ammCreatorVaultPda,
  creatorVaultPda,
  feeSharingConfigPda,
  PUMP_SDK,
  quoteAta,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@imagine/sdk";

const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const mint = new PublicKey(process.argv[2]!);

const sharing = feeSharingConfigPda(mint);
const candidates: Array<[string, PublicKey]> = [
  ["sharing config", sharing],
  ["creator vault (sharing)", creatorVaultPda(sharing)],
  ["amm creator vault ata (sharing)", quoteAta(ammCreatorVaultPda(sharing), NATIVE_MINT, TOKEN_PROGRAM_ID)],
  ["bonding curve", bondingCurvePda(mint)],
];

const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
if (curveInfo) {
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  console.log("curve.creator =", curve.creator.toBase58(), "complete =", curve.complete);
  candidates.push(["creator vault (curve.creator)", creatorVaultPda(curve.creator)]);
}

const sharingInfo = await connection.getAccountInfo(sharing);
if (sharingInfo) {
  const cfg = PUMP_SDK.decodeSharingConfig(sharingInfo);
  console.log("sharing config:", JSON.stringify(cfg, (_, v) => (typeof v === "bigint" ? v.toString() : v?.toBase58?.() ?? v), 1).slice(0, 800));
}

for (const [label, key] of candidates) {
  const info = await connection.getAccountInfo(key);
  console.log(
    label.padEnd(34),
    key.toBase58(),
    info ? `${info.lamports} lamports, ${info.data.length}B, owner ${info.owner.toBase58()}` : "MISSING",
  );
}
