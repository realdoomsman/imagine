#!/usr/bin/env bash
#
# Bring up the full local rig: a validator carrying the real pump.fun programs,
# with pump's fee-collecting accounts pre-created.
#
# Without the seeding step, trades fail intermittently with "insufficient funds
# for rent": pump rotates its fee recipients by slot, and a recipient that does
# not exist on a fresh ledger is left rent-paying by a small fee.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${NODE:-/opt/node/bin/node}"

"$ROOT/scripts/localnet.sh" &
VALIDATOR=$!
trap 'kill "$VALIDATOR" 2>/dev/null || true' EXIT

echo "waiting for the validator..."
for _ in $(seq 1 60); do
  if solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; then break; fi
  sleep 1
done

"$NODE" "$ROOT/apps/api/scripts/seed-localnet.ts"
echo "localnet ready on http://127.0.0.1:8899"
wait "$VALIDATOR"
