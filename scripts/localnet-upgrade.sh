#!/usr/bin/env bash
# Upgrade the VISE program on the running local validator in place. The
# validator loaded it as upgradeable with the local CLI key as authority, so
# this is the same path a devnet or mainnet upgrade takes.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd /mnt/c/tech/Hold
solana program deploy \
  --url http://127.0.0.1:8899 \
  --keypair "$HOME/.config/solana/id.json" \
  --program-id VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb \
  --upgrade-authority "$HOME/.config/solana/id.json" \
  target/deploy/vise.so
solana program show VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb --url http://127.0.0.1:8899 | grep -E "Program Id|Data Length|Last Deployed"
