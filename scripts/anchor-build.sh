#!/usr/bin/env bash
#
# Build the program and refresh the SDK's IDL.
#
# Three artefacts:
#   target/deploy/vise.so      SBPF v3 — what deploys. Agave 4 refuses v0
#                              through the loader.
#   target/deploy/vise-v0.so   SBPF v0 — what LiteSVM (the integration suite)
#                              can load; it does not execute v3 yet.
#   packages/sdk/src/idl/*     the IDL and its TypeScript types.
#
# The two archs get separate target directories: cargo's fingerprint does not
# include the SBPF arch, so building one after the other in the same tree hands
# back whichever binary was cached. That is how a v3 binary ended up under a
# v0 name and took the whole integration suite down with it. They live on the
# Linux filesystem: large archive writes fail with ENOMEM on the /mnt/c mount.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd /mnt/c/tech/Hold

anchor build 2>&1 | grep -E "^(error|Error)" -A6 || true
cp target/idl/vise.json packages/sdk/src/idl/vise.json
cp target/types/vise.ts packages/sdk/src/idl/vise-types.ts
echo "idl refreshed"

# cargo's fingerprint can hand back a stale binary from the per-arch cache:
# a rebuild after source changes has copied out the previous program. Touching
# the crate root forces the program itself to recompile; dependencies stay cached.
touch programs/vise/src/lib.rs

cargo build-sbf --arch v3 --manifest-path programs/vise/Cargo.toml -- --target-dir "$HOME/.cache/vise/sbpf-v3" 2>&1 | grep -E "^(error|Finished)" || true
cp "$HOME/.cache/vise/sbpf-v3/deploy/vise.so" target/deploy/vise.so
cargo build-sbf --arch v0 --manifest-path programs/vise/Cargo.toml -- --target-dir "$HOME/.cache/vise/sbpf-v0" 2>&1 | grep -E "^(error|Finished)" || true
cp "$HOME/.cache/vise/sbpf-v0/deploy/vise.so" target/deploy/vise-v0.so

for f in target/deploy/vise.so target/deploy/vise-v0.so; do
  printf '%-26s %8s bytes  sbpf e_flags=%s\n' "$f" "$(wc -c < "$f")" "$(xxd -s 48 -l 1 -p "$f")"
done
