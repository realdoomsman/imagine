#!/usr/bin/env bash
#
# Build the program and refresh the SDK's IDL.
#
# Artefacts:
#   target/deploy/imagine.so      SBPF v0 — what deploys (scripts/deploy.sh).
#   target/deploy/imagine-v0.so   the same binary under the name the LiteSVM
#                                 suites load.
#   packages/sdk/src/idl/*        the IDL and its TypeScript types.
#
# The SBPF build gets its own target directory on the Linux filesystem: large
# archive writes fail with ENOMEM on the /mnt/c mount.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

anchor build 2>&1 | grep -E "^(error|Error)" -A6 || true
cp target/idl/imagine.json packages/sdk/src/idl/imagine.json
cp target/types/imagine.ts packages/sdk/src/idl/imagine-types.ts
echo "idl refreshed"

# cargo's fingerprint can hand back a stale binary from the cache: touching
# the crate root forces the program itself to recompile; dependencies stay
# cached.
touch programs/imagine/src/lib.rs

cargo build-sbf --arch v0 --manifest-path programs/imagine/Cargo.toml -- --target-dir "$HOME/.cache/imagine/sbpf-v0" 2>&1 | grep -E "^(error|Finished)" || true
cp "$HOME/.cache/imagine/sbpf-v0/deploy/imagine.so" target/deploy/imagine.so
cp target/deploy/imagine.so target/deploy/imagine-v0.so

for f in target/deploy/imagine.so target/deploy/imagine-v0.so; do
  printf '%-30s %8s bytes  sbpf e_flags=%s  sha256 %s\n' "$f" "$(wc -c < "$f")" "$(xxd -s 48 -l 1 -p "$f")" "$(sha256sum "$f" | cut -c1-16)"
done
