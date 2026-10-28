import { PublicKey } from "@solana/web3.js";
import { curveProgress, curveSpotPrice, PUMP_CURVE } from "@imagine/sdk";
import { fetchCurve } from "../src/pump.ts";

const mint = new PublicKey(process.argv[2]);
const curve = await fetchCurve(mint);
if (!curve) throw new Error("no curve");

console.log({
  virtualTokenReserves: curve.state.virtualTokenReserves.toString(),
  virtualSolReserves: curve.state.virtualSolReserves.toString(),
  realTokenReserves: curve.state.realTokenReserves.toString(),
  realSolReserves: curve.state.realSolReserves.toString(),
  tokenTotalSupply: curve.state.tokenTotalSupply.toString(),
  complete: curve.state.complete,
});
console.log("initialRealTokenReserves", PUMP_CURVE.initialRealTokenReserves.toString());
console.log("progress", curveProgress(curve.state));
console.log("spot price (lamports per token)", curveSpotPrice(curve.state));
