#!/usr/bin/env bash
#
# Build the program and refresh the SDK's IDL.
#
# Two passes: `anchor build` for the IDL (its generator runs the program as a
# host test and rejects target flags), then `cargo build-sbf --arch` for the
# binary that actually deploys. Agave 4 refuses SBPF v0 through the loader, so
# v3 is the default; pass v0 for a cluster where v3 deployment is not yet
# feature-activated (check with `solana feature status`).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
ARCH="${1:-v3}"
cd /mnt/c/tech/Hold

anchor build 2>&1 | grep -E "^(error|Error)" -A6 || true
cp target/idl/vise.json packages/sdk/src/idl/vise.json
cp target/types/vise.ts packages/sdk/src/idl/vise-types.ts
echo "idl refreshed"

cargo build-sbf --arch "$ARCH" --manifest-path programs/vise/Cargo.toml 2>&1 | grep -E "^(error|Finished)" || true
echo "binary: $(wc -c < target/deploy/vise.so) bytes, sbpf $ARCH"
