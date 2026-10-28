#!/usr/bin/env bash
# Unit tests and clippy for the on-chain program, under WSL.
set -u
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
cargo test -p imagine --lib 2>&1 | grep -E "^(test |error|warning: unused|test result)|panicked|assert" | head -60
echo "== clippy"
cargo clippy -p imagine --all-targets 2>&1 | grep -E "^(error|warning)" -A4 | head -60
echo "clippy done"
