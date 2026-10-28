#!/usr/bin/env bash
# Print the on-chain VISE config for the API's configured cluster.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
exec /opt/node/bin/node --env-file="${1:-.env.local}" -e '
import { Connection, PublicKey } from "@solana/web3.js";
import { ViseClient } from "@imagine/sdk";
const c = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const v = new ViseClient(c);
const cfg = await v.fetchConfig();
console.log(JSON.stringify({ treasury: cfg.treasury.toBase58(), admin: cfg.admin.toBase58(), tradeFeeBps: cfg.tradeFeeBps, paused: cfg.paused }, null, 1));
' --input-type=module
