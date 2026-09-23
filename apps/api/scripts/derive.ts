import { creatorVaultPda, feeSharingConfigPda, userVolumeAccumulatorPda } from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";

const mint = new PublicKey(process.argv[2]);
const user = process.argv[3] ? new PublicKey(process.argv[3]) : null;

const sharing = feeSharingConfigPda(mint);
console.log("sharing_config       ", sharing.toBase58());
console.log("creator_vault(sharing)", creatorVaultPda(sharing).toBase58());
if (user) console.log("user_volume_accum    ", userVolumeAccumulatorPda(user).toBase58());
