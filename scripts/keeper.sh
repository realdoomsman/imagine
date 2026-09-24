#!/usr/bin/env bash
# Create (once) and fund a cluster's keeper key, then print what to put in
# KEEPER_KEYPAIR on the indexer service. Key files are gitignored.
#
#   bash scripts/keeper.sh devnet [sol]
#   bash scripts/keeper.sh mainnet-beta [sol]    # RPC from apps/api/.mainnet-rpc.tmp
#
# The keeper only pays sweep fees; it is deliberately not the deploy/admin key,
# so a leaked indexer environment cannot upgrade the program.
set -euo pipefail
CLUSTER="${1:?usage: keeper.sh devnet|mainnet-beta [sol]}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
case "$CLUSTER" in
  devnet) RPC=https://api.devnet.solana.com; KEY="$ROOT/apps/api/.keeper-devnet.tmp.json" ;;
  mainnet-beta) RPC="${RPC_URL:-$(cat "$ROOT/apps/api/.mainnet-rpc.tmp")}"; KEY="$ROOT/apps/api/.keeper-mainnet.json" ;;
  *) echo "unknown cluster $CLUSTER" >&2; exit 1 ;;
esac
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null
PUB=$(solana-keygen pubkey "$KEY")
echo "keeper $PUB"
solana transfer "$PUB" "${2:-0.5}" -u "$RPC" --allow-unfunded-recipient --with-compute-unit-price 20000 >/dev/null
echo "balance $(solana balance "$PUB" -u "$RPC")"
