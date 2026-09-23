#!/usr/bin/env bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
cd /mnt/c/tech/Hold
solana --version
cargo build-sbf --help 2>&1 | grep -iE -A2 "arch|tools-version" | head -20
echo "--- validator feature flags"
solana-test-validator --help 2>&1 | grep -iE "deactivate-feature" -A2 | head -6
echo "--- deployed program header"
solana program dump VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb /tmp/deployed.so --url http://127.0.0.1:8899 >/dev/null 2>&1 && xxd -l 64 /tmp/deployed.so | head -4
echo "--- new build header"
xxd -l 64 target/deploy/vise.so | head -4
