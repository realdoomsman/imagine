#!/usr/bin/env bash
# Print the on-chain IMAGINE config for the API's configured cluster.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
exec node --env-file="${1:-.env.local}" --input-type=module -e '
import { Connection } from "@solana/web3.js";
import { ImagineClient } from "@imagine/sdk";
const c = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8999", "confirmed");
const cfg = await new ImagineClient(c).fetchConfig();
if (!cfg) { console.error("config not initialised"); process.exit(1); }
console.log(JSON.stringify({ admin: cfg.admin.toBase58(), treasury: cfg.treasury.toBase58(), launchlabPlatform: cfg.launchlabPlatform.toBase58(), tradeFeeBps: cfg.tradeFeeBps, paused: cfg.paused, poolCount: cfg.poolCount.toString() }, null, 1));
'
