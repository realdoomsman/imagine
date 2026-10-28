#!/usr/bin/env bash
#
# Build the program and refresh the SDK's IDL.
#
# Three artefacts:
#   target/deploy/imagine.so      SBPF v3 — what deploys. Agave 4 refuses v0
#                                 through the loader.
#   target/deploy/imagine-v0.so   SBPF v0 — what LiteSVM (the integration
#                                 suite) can load; it does not execute v3 yet.
#   packages/sdk/src/idl/*        the IDL and its TypeScript types.
#
# The two archs get separate target directories: cargo's fingerprint does not
# include the SBPF arch, so building one after the other in the same tree hands
# back whichever binary was cached. They live on the Linux filesystem: large
# archive writes fail with ENOMEM on the /mnt/c mount.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

anchor build 2>&1 | grep -E "^(error|Error)" -A6 || true
cp target/idl/imagine.json packages/sdk/src/idl/imagine.json
cp target/types/imagine.ts packages/sdk/src/idl/imagine-types.ts
echo "idl refreshed"

# cargo's fingerprint can hand back a stale binary from the per-arch cache:
# touching the crate root forces the program itself to recompile;
# dependencies stay cached.
touch programs/imagine/src/lib.rs

cargo build-sbf --arch v3 --manifest-path programs/imagine/Cargo.toml -- --target-dir "$HOME/.cache/imagine/sbpf-v3" 2>&1 | grep -E "^(error|Finished)" || true
cp "$HOME/.cache/imagine/sbpf-v3/deploy/imagine.so" target/deploy/imagine.so
cargo build-sbf --arch v0 --manifest-path programs/imagine/Cargo.toml -- --target-dir "$HOME/.cache/imagine/sbpf-v0" 2>&1 | grep -E "^(error|Finished)" || true
cp "$HOME/.cache/imagine/sbpf-v0/deploy/imagine.so" target/deploy/imagine-v0.so

for f in target/deploy/imagine.so target/deploy/imagine-v0.so; do
  printf '%-30s %8s bytes  sbpf e_flags=%s\n' "$f" "$(wc -c < "$f")" "$(xxd -s 48 -l 1 -p "$f")"
done
