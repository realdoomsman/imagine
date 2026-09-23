#!/usr/bin/env bash
# Try each public devnet endpoint in turn. They rate-limit independently, so a
# refusal from one says nothing about the next.
set -u
ENDPOINTS="https://api.devnet.solana.com https://rpc.ankr.com/solana_devnet https://solana-devnet.g.alchemy.com/v2/demo"
for ep in $ENDPOINTS; do
  echo "== $ep"
  solana airdrop 2 --url "$ep" 2>&1 | tail -1
  sleep 3
done
echo "balance: $(solana balance --url https://api.devnet.solana.com 2>&1)"
