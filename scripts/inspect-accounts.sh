#!/usr/bin/env bash
# Show owner/size/balance for each address on devnet.
set -u
for address in "$@"; do
  echo "== $address"
  solana -u devnet account "$address" 2>&1 | grep -E 'Balance|Owner|Length' || echo "  (does not exist)"
done
