#!/usr/bin/env bash
# Create (once) and fund the mainnet keeper key, then print what to put in
# KEEPER_KEYPAIR on the indexer service. Default key: .mainnet/keeper.json (gitignored; KEY=<path> overrides).
#
#   bash scripts/keeper.sh [sol]    # RPC from $RPC_URL or apps/api/.mainnet-rpc.tmp
#
# The keeper only pays crank fees (syncs, matured unlocks, harvests, treasury
# claims); it is deliberately not the deploy/admin key, so a leaked indexer
# environment cannot upgrade the program.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
RPC="${RPC_URL:-$(cat "$ROOT/apps/api/.mainnet-rpc.tmp")}"
KEY="${KEY:-$ROOT/.mainnet/keeper.json}"
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null
PUB=$(solana-keygen pubkey "$KEY")
echo "keeper $PUB"
solana transfer "$PUB" "${1:-0.5}" -u "$RPC" --allow-unfunded-recipient --with-compute-unit-price 20000 >/dev/null
echo "balance $(solana balance "$PUB" -u "$RPC")"
