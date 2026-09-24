#!/usr/bin/env bash
# Render spot-check frames of the promo: scripts/promo-frames.sh <frame> [frame...]
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold/video
SHELL_BIN=$(ls "$HOME/.cache/vise-browser"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
mkdir -p out/frames
for f in "$@"; do
  corepack pnpm exec remotion still src/index.ts Promo "out/frames/promo-$f.png" --frame="$f" --browser-executable="$SHELL_BIN" --log=error --scale=0.5
  echo "frame $f"
done
