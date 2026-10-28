#!/usr/bin/env bash
# Mainnet-fork validator for local development and the end-to-end run (WSL/Linux/macOS).
#
# IMAGINE runs locally against a fork of mainnet: the real Raydium LaunchLab, CPMM and Token-2022
# programs, cloned from mainnet at start, plus the accounts a launch and a trade read (the SOL and
# SPYx LaunchLab GlobalConfigs, the SPYx mint, the CPMM AmmConfigs a platform graduates into) and
# real SPYx for the test wallets, all written by apps/api/scripts/fork-fixtures.ts. Nothing else is
# preloaded: deploy the IMAGINE program (scripts/deploy.sh localnet), create the IMAGINE LaunchLab
# platform (apps/api/scripts/setup-platform.ts) and initialise the config, exactly as on mainnet.
#
#   (cd apps/api && node scripts/fork-fixtures.ts)       # once, or to refresh the snapshot
#   bash scripts/mainnet-fork.sh
#
# Env: MAINNET_RPC_URL (read-only clone source; default the public RPC), FORK_DIR (target/fork),
#      FORK_LEDGER (~/.imagine-fork-ledger), FORK_RPC_PORT (8999; PubSub on +1).
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAINNET_RPC_URL="${MAINNET_RPC_URL:-https://api.mainnet-beta.solana.com}"
FORK_DIR="${FORK_DIR:-$ROOT/target/fork}"
PORT="${FORK_RPC_PORT:-8999}"

PROGRAMS=(
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj # Raydium LaunchLab
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C # Raydium CPMM
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb # Token-2022 (ScaledUiAmount / Pausable)
)

shopt -s nullglob
FIXTURES=("$FORK_DIR"/accounts/*.json)
if [ ${#FIXTURES[@]} -eq 0 ]; then
  echo "no fixtures in $FORK_DIR/accounts; run: (cd apps/api && node scripts/fork-fixtures.ts)" >&2
  exit 1
fi

ARGS=()
for p in "${PROGRAMS[@]}"; do ARGS+=(--clone-upgradeable-program "$p"); done
for f in "${FIXTURES[@]}"; do ARGS+=(--account - "$f"); done

exec solana-test-validator \
  --reset \
  --ledger "${FORK_LEDGER:-$HOME/.imagine-fork-ledger}" \
  --url "$MAINNET_RPC_URL" \
  --clone-feature-set \
  "${ARGS[@]}" \
  --rpc-port "$PORT" \
  --faucet-port 9910 \
  --gossip-port 9920 \
  --dynamic-port-range 9930-9990 \
  --quiet
