#!/usr/bin/env bash
#
# A local validator carrying the real pump.fun programs and their live config,
# cloned from devnet.
#
# This is the end-to-end rig: unlimited SOL, deterministic slots, and the actual
# pump program rather than a stub — so a launch here exercises the same code
# path a mainnet launch will.
set -euo pipefail

CLUSTER_URL="${CLUSTER_URL:-https://api.devnet.solana.com}"
LEDGER="${LEDGER:-/tmp/vise-ledger}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PUMP=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
PUMP_AMM=pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
PUMP_FEES=pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
MAYHEM=MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e

# Program-owned state the pump instructions read on every call.
ACCOUNTS=(
  4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf   # pump Global
  8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt   # fee config
  6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP   # quote control
  CHqnuTkj6sXDFknM652aEFPECZh9qVsBXWkhPohmV9dA   # fee program global
  HsC37rNFvJgpfH7y2Y6kqnwEQN4WfdM5FLArWnux5GUs   # amm global
  Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y   # global volume accumulator
  13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ   # mayhem global params
)

CLONE_ARGS=()
for program in "$PUMP" "$PUMP_AMM" "$PUMP_FEES" "$MAYHEM"; do
  CLONE_ARGS+=(--clone-upgradeable-program "$program")
done
for account in "${ACCOUNTS[@]}"; do
  CLONE_ARGS+=(--maybe-clone "$account")
done

rm -rf "$LEDGER"

# Loaded as *upgradeable* with a real authority: `initialize_config` may only be
# called by the program's upgrade authority, and a plain --bpf-program load has
# no ProgramData account for that check to read.
UPGRADE_AUTHORITY="${UPGRADE_AUTHORITY:-$HOME/.config/solana/id.json}"

exec solana-test-validator \
  --ledger "$LEDGER" \
  --url "$CLUSTER_URL" \
  --upgradeable-program VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb \
      "$ROOT/target/deploy/vise.so" "$UPGRADE_AUTHORITY" \
  "${CLONE_ARGS[@]}" \
  --reset \
  --quiet
