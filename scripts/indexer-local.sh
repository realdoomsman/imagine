#!/usr/bin/env bash
# Run the indexer (with the keeper) against the local rig, signing cranks with
# the local CLI keypair — the same wallet the validator was seeded with.
set -eu
cd /mnt/c/tech/Hold/apps/api
export KEEPER_KEYPAIR="$(cat "$HOME/.config/solana/id.json")"
export KEEPER_INTERVAL_MS="${KEEPER_INTERVAL_MS:-30000}"
# Localnet trades are tiny; sweep anything above rent so the path is exercised.
export SWEEP_MIN_LAMPORTS="${SWEEP_MIN_LAMPORTS:-100000}"
/opt/node/bin/node --env-file=.env.local src/migrate.ts
exec /opt/node/bin/node --env-file=.env.local src/indexer.ts
