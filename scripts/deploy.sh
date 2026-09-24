#!/usr/bin/env bash
#
# Deploy VISE to a cluster and initialise its config.
#
#   bash scripts/deploy.sh devnet
#   bash scripts/deploy.sh mainnet-beta     # RPC from $RPC_URL or ~/.vise-mainnet-rpc
#
# Deploys the SBPF v3 binary from scripts/anchor-build.sh (target/deploy/vise.so);
# devnet and mainnet both run Agave 4 with SBPF v3 enabled.
#
# The program is written through a fixed buffer keypair
# (target/deploy/vise-buffer.json), so a deploy interrupted by congestion is
# resumed by re-running this script rather than stranding rent in a fresh buffer.
#
# Requires ~4.3 SOL for a first deploy (rent for MAX_LEN bytes plus the
# temporary buffer) and ~2.8 SOL for an upgrade (`UPGRADE=1`: the buffer only,
# refunded when it lands).
set -euo pipefail

CLUSTER="${1:?usage: deploy.sh devnet|mainnet-beta}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
PROGRAM_ID=VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb
WALLET="${WALLET:-$HOME/.config/solana/id.json}"
BUFFER="$ROOT/target/deploy/vise-buffer.json"
# Room for upgrades without paying rent on double the binary (the default).
# `solana program extend` grows it later if a build outgrows this.
MAX_LEN="${MAX_LEN:-560000}"
NEEDED=4.3

case "$CLUSTER" in
  devnet) RPC="${RPC_URL:-https://api.devnet.solana.com}" ;;
  mainnet-beta)
    RPC="${RPC_URL:-$(cat "$ROOT/apps/api/.mainnet-rpc.tmp" 2>/dev/null || true)}"
    [ -n "$RPC" ] || { echo "set RPC_URL to a paid mainnet endpoint" >&2; exit 1; }
    ;;
  *) echo "unknown cluster $CLUSTER" >&2; exit 1 ;;
esac

cd "$ROOT"

EXISTS=0
solana program show "$PROGRAM_ID" -u "$RPC" >/dev/null 2>&1 && EXISTS=1
if [ "$EXISTS" = 1 ] && [ "${UPGRADE:-0}" != 1 ]; then
  echo "program already deployed on $CLUSTER; skipping deploy (UPGRADE=1 to replace it)"
else
  # An upgrade only needs the temporary buffer (refunded when it lands), not
  # the program account's rent on top.
  [ "$EXISTS" = 1 ] && NEEDED=2.8
  BALANCE=$(solana balance -u "$RPC" -k "$WALLET" | awk '{print $1}')
  echo "deploy wallet $(solana address -k "$WALLET") holds ${BALANCE} SOL on $CLUSTER"
  if ! awk -v b="$BALANCE" -v n="$NEEDED" 'BEGIN{exit !(b>=n)}'; then
    echo "need at least ${NEEDED} SOL; top up and re-run" >&2
    exit 1
  fi

  if [ "${SKIP_BUILD:-0}" != 1 ]; then
    echo "==> building (SBPF v3)"
    bash scripts/anchor-build.sh
  fi
  SIZE=$(stat -c %s target/deploy/vise.so)
  echo "binary ${SIZE} bytes, max len ${MAX_LEN}, sha256 $(sha256sum target/deploy/vise.so | cut -c1-16)"
  if [ "$SIZE" -gt "$MAX_LEN" ]; then
    echo "binary exceeds MAX_LEN" >&2
    exit 1
  fi

  [ -f "$BUFFER" ] || solana-keygen new --no-bip39-passphrase -s -o "$BUFFER" >/dev/null

  [ "$EXISTS" = 1 ] && echo "==> upgrading" || echo "==> deploying"
  # --max-len only applies to a first deploy; an upgrade reuses the account.
  LEN_ARGS=()
  [ "$EXISTS" = 1 ] || LEN_ARGS=(--max-len "$MAX_LEN")
  solana program deploy target/deploy/vise.so \
    --program-id target/deploy/vise-keypair.json \
    --buffer "$BUFFER" \
    "${LEN_ARGS[@]}" \
    --upgrade-authority "$WALLET" \
    --with-compute-unit-price "${CU_PRICE:-20000}" \
    --max-sign-attempts 50 \
    -k "$WALLET" -u "$RPC"
  rm -f "$BUFFER"

  # The chain pads program data to its allocated length; compare the prefix.
  solana program dump "$PROGRAM_ID" /tmp/vise-onchain.so -u "$RPC" >/dev/null
  if cmp -s <(head -c "$SIZE" /tmp/vise-onchain.so) target/deploy/vise.so; then
    echo "on-chain program matches target/deploy/vise.so"
  else
    echo "on-chain program does NOT match the local binary" >&2
    exit 1
  fi
fi

echo "==> confirming the program is live"
solana program show "$PROGRAM_ID" -u "$RPC"

echo "==> initialising config (upgrade authority signs)"
cd apps/api
RPC_URL="$RPC" CLUSTER="$CLUSTER" node scripts/init-config.ts "$WALLET"
