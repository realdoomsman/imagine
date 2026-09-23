#!/usr/bin/env bash
# Render the X avatar and banner to video/out/profile. Runs under WSL.
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold/video
SHELL_BIN=$(ls "$HOME/.cache/vise-browser"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
mkdir -p out/profile
for id in Avatar Banner OG; do
  corepack pnpm exec remotion still src/index.ts "$id" "out/profile/$(echo "$id" | tr '[:upper:]' '[:lower:]').png" --browser-executable="$SHELL_BIN" --log=error
done
echo rendered
