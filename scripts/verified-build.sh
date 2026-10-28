#!/usr/bin/env bash
#
# Reproducible (verifiable) build of the program, bit for bit what
# `solana-verify verify-from-repo` rebuilds from GitHub (WSL/Linux, Docker).
#
#   bash scripts/verified-build.sh            # HEAD
#   COMMIT=<sha> bash scripts/verified-build.sh
#
# Builds a clean clone of the commit (on the Linux filesystem, as the remote
# verifier does) with `solana-verify build --library-name imagine`, inside the
# solana-verifiable-build image of the Agave release pinned in Cargo.toml
# `[workspace.metadata.cli]` (cargo build-sbf, SBPF v0). Uncommitted changes
# are not in the artifact; commit (and push, before verifying) first.
#
# Artefacts (what scripts/deploy.sh deploys with SKIP_BUILD=1, and what the
# LiteSVM suites load):
#   target/deploy/imagine.so      the verifiable build
#   target/deploy/imagine-v0.so   the same binary
# Prints its size, ELF e_flags (00 = SBPF v0), sha256 and the executable hash
# that `solana-verify get-program-hash` must report once it is deployed.
#
# Needs: docker, solana-verify (`cargo install solana-verify --locked`).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMIT="$(git -C "$ROOT" rev-parse "${COMMIT:-HEAD}")"
SRC="${VERIFY_SRC:-$HOME/.cache/imagine/verified-src}"

if ! git -C "$ROOT" diff --quiet "$COMMIT" -- programs Cargo.toml Cargo.lock; then
  echo "warning: programs/ or Cargo.* differ from $COMMIT; building the commit, not the working tree" >&2
fi

rm -rf "$SRC"
git -c safe.directory='*' clone --quiet --no-checkout "$ROOT" "$SRC"
git -C "$SRC" checkout --quiet --detach "$COMMIT"
echo "==> solana-verify build of $COMMIT"
(cd "$SRC" && solana-verify build --library-name imagine)

mkdir -p "$ROOT/target/deploy"
cp "$SRC/target/deploy/imagine.so" "$ROOT/target/deploy/imagine.so"
cp "$SRC/target/deploy/imagine.so" "$ROOT/target/deploy/imagine-v0.so"

SO="$ROOT/target/deploy/imagine.so"
echo "commit           $COMMIT"
echo "artifact         target/deploy/imagine.so (and imagine-v0.so)"
echo "size             $(stat -c %s "$SO") bytes"
echo "sbpf e_flags     $(xxd -s 48 -l 1 -p "$SO")"
echo "sha256           $(sha256sum "$SO" | cut -d' ' -f1)"
echo "executable hash  $(solana-verify get-executable-hash "$SO")"
