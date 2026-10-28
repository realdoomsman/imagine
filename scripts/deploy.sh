#!/usr/bin/env bash
#
# Deploy IMAGINE to a cluster and initialise its config.
#
#   bash scripts/deploy.sh localnet         # the mainnet fork (scripts/mainnet-fork.sh), port 8999
#   bash scripts/deploy.sh mainnet-beta     # RPC from $RPC_URL or apps/api/.mainnet-rpc.tmp
#
# Deploys the SBPF v0 binary at target/deploy/imagine.so (built here by
# scripts/anchor-build.sh, or with SKIP_BUILD=1 whatever is there; on mainnet
# that must be the verifiable build from scripts/verified-build.sh) to the
# program id of target/deploy/imagine-keypair.json
# (imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa); the deploying wallet becomes the
# upgrade authority, which is what initialize_config checks.
#
# The program is written through a fixed buffer keypair
# (target/deploy/imagine-buffer.json), so a deploy interrupted by congestion is
# resumed by re-running this script rather than stranding rent in a fresh buffer.
#
# On mainnet a first deploy needs ~4.2 SOL: rent for MAX_LEN bytes of program
# data (the buffer's rent is drained back to the payer in the deploy itself)
# plus write fees. An upgrade needs the new binary's buffer rent (~4.4 SOL for
# 632 KB, returned when it lands). On the fork the wallet is airdropped what it needs.
set -euo pipefail

CLUSTER="${1:?usage: deploy.sh localnet|mainnet-beta}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
PROGRAM_KEYPAIR="$ROOT/target/deploy/imagine-keypair.json"
PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
WALLET="${WALLET:-$HOME/.config/solana/id.json}"
BUFFER="$ROOT/target/deploy/imagine-buffer.json"
# Room for upgrades without paying rent on double the binary (the default).
# `solana program extend` grows it later if a build outgrows this.
MAX_LEN="${MAX_LEN:-800000}"
NEEDED="${NEEDED:-4.2}"

case "$CLUSTER" in
  localnet) RPC="${RPC_URL:-http://127.0.0.1:8999}" ;;
  mainnet-beta)
    RPC="${RPC_URL:-$(cat "$ROOT/apps/api/.mainnet-rpc.tmp" 2>/dev/null || true)}"
    [ -n "$RPC" ] || { echo "set RPC_URL to a paid mainnet endpoint" >&2; exit 1; }
    ;;
  *) echo "unknown cluster $CLUSTER" >&2; exit 1 ;;
esac

cd "$ROOT"
[ -f "$WALLET" ] || solana-keygen new --no-bip39-passphrase -s -o "$WALLET" >/dev/null
if [ "$CLUSTER" = localnet ]; then
  solana airdrop 20 "$(solana address -k "$WALLET")" -u "$RPC" >/dev/null
fi

EXISTS=0
solana program show "$PROGRAM_ID" -u "$RPC" >/dev/null 2>&1 && EXISTS=1
if [ "$EXISTS" = 1 ] && [ "${UPGRADE:-0}" != 1 ]; then
  echo "program already deployed on $CLUSTER; skipping deploy (UPGRADE=1 to replace it)"
else
  [ "$EXISTS" = 1 ] && NEEDED=5.3
  BALANCE=$(solana balance -u "$RPC" -k "$WALLET" | awk '{print $1}')
  echo "deploy wallet $(solana address -k "$WALLET") holds ${BALANCE} SOL on $CLUSTER"
  if ! awk -v b="$BALANCE" -v n="$NEEDED" 'BEGIN{exit !(b>=n)}'; then
    echo "need at least ${NEEDED} SOL; top up and re-run" >&2
    exit 1
  fi

  if [ "${SKIP_BUILD:-0}" != 1 ]; then
    echo "==> building"
    bash scripts/anchor-build.sh
  fi
  SIZE=$(stat -c %s target/deploy/imagine.so)
  echo "binary ${SIZE} bytes, max len ${MAX_LEN}, sha256 $(sha256sum target/deploy/imagine.so | cut -c1-16)"
  if [ "$SIZE" -gt "$MAX_LEN" ]; then
    echo "binary exceeds MAX_LEN" >&2
    exit 1
  fi

  [ -f "$BUFFER" ] || solana-keygen new --no-bip39-passphrase -s -o "$BUFFER" >/dev/null

  [ "$EXISTS" = 1 ] && echo "==> upgrading" || echo "==> deploying"
  # --max-len only applies to a first deploy; an upgrade reuses the account.
  LEN_ARGS=()
  [ "$EXISTS" = 1 ] || LEN_ARGS=(--max-len "$MAX_LEN")
  solana program deploy target/deploy/imagine.so \
    --program-id "$PROGRAM_KEYPAIR" \
    --buffer "$BUFFER" \
    "${LEN_ARGS[@]}" \
    --upgrade-authority "$WALLET" \
    --with-compute-unit-price "${CU_PRICE:-20000}" \
    --max-sign-attempts 50 \
    -k "$WALLET" -u "$RPC"
  rm -f "$BUFFER"

  # The chain pads program data to its allocated length; compare the prefix.
  solana program dump "$PROGRAM_ID" /tmp/imagine-onchain.so -u "$RPC" >/dev/null
  if cmp -s <(head -c "$SIZE" /tmp/imagine-onchain.so) target/deploy/imagine.so; then
    echo "on-chain program matches target/deploy/imagine.so"
  else
    echo "on-chain program does NOT match the local binary" >&2
    exit 1
  fi
fi

echo "==> confirming the program is live"
solana program show "$PROGRAM_ID" -u "$RPC"

# The config points at IMAGINE's LaunchLab PlatformConfig, which
# apps/api/scripts/setup-platform.ts creates (and prints) first.
if [ -z "${LAUNCHLAB_PLATFORM:-}" ]; then
  echo "==> config not initialised: create the platform (apps/api/scripts/setup-platform.ts), then"
  echo "    LAUNCHLAB_PLATFORM=<address> RPC_URL=$RPC node apps/api/scripts/init-config.ts $WALLET"
  exit 0
fi
echo "==> initialising config (upgrade authority signs)"
cd apps/api
RPC_URL="$RPC" node scripts/init-config.ts "$WALLET"
