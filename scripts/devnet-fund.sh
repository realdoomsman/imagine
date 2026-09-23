#!/usr/bin/env bash
# Patiently top up the devnet deploy wallet. The public faucet rate-limits
# aggressively, so this asks for small amounts on a long interval.
set -u
TARGET="${1:-5}"
for _ in $(seq 1 60); do
  BAL=$(solana balance -u devnet 2>/dev/null | awk '{print $1}')
  if [ -n "${BAL:-}" ] && awk -v b="$BAL" -v t="$TARGET" 'BEGIN{exit !(b>=t)}'; then
    echo "FUNDED $BAL SOL"
    exit 0
  fi
  solana airdrop 1 -u devnet >/dev/null 2>&1
  sleep 25
done
echo "FINAL $(solana balance -u devnet)"
