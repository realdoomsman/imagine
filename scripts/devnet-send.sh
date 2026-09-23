#!/usr/bin/env bash
# Send devnet SOL from the deploy wallet: scripts/devnet-send.sh <to> <sol>
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana transfer "$1" "$2" -u devnet --allow-unfunded-recipient
solana balance "$1" -u devnet
