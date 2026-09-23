#!/usr/bin/env bash
# Try each public devnet endpoint in turn. They rate-limit independently, so a
# refusal from one says nothing about the next.
set -u
# Non-login shells do not pick up the Solana install dir.
PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH
ENDPOINTS="
https://api.devnet.solana.com
https://solana-devnet-rpc.publicnode.com
https://devnet.solana.rpcpool.com
https://solana-devnet.g.alchemy.com/v2/demo
https://rpc.ankr.com/solana_devnet
"
for ep in $ENDPOINTS; do
  echo "== $ep"
  solana airdrop 2 --url "$ep" 2>&1 | tail -1
  sleep 2
done
echo "balance: $(solana balance --url https://api.devnet.solana.com 2>&1)"
