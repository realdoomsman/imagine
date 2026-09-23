#!/usr/bin/env bash
# Create (once) and fund the devnet keeper key, then print what to put in
# KEEPER_KEYPAIR on the indexer service. The key file is gitignored (*.tmp*).
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
KEY=/mnt/c/tech/Hold/apps/api/.keeper-devnet.tmp.json
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null
PUB=$(solana-keygen pubkey "$KEY")
echo "keeper $PUB"
solana transfer "$PUB" "${1:-0.5}" -u devnet --allow-unfunded-recipient >/dev/null
echo "balance $(solana balance "$PUB" -u devnet)"
