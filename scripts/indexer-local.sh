#!/usr/bin/env bash
# Run the indexer (with the keeper) against the mainnet fork, signing cranks
# with the local CLI keypair. Reads apps/api/.env.local for the database and
# the fork's RPC.
set -eu
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/api"
export KEEPER_KEYPAIR="$(cat "$HOME/.config/solana/id.json")"
export KEEPER_INTERVAL_MS="${KEEPER_INTERVAL_MS:-30000}"
# Fork trades are tiny; sync anything worth a cent so the path is exercised.
export SYNC_MIN_USD="${SYNC_MIN_USD:-0.01}"
node --env-file=.env.local src/migrate.ts
exec node --env-file=.env.local src/indexer.ts
