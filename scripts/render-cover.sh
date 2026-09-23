#!/usr/bin/env bash
# Render the article cover (5:2) to video/out/profile/cover.png. Runs under WSL.
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold/video
SHELL_BIN=$(ls "$HOME/.cache/vise-browser"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
corepack pnpm exec remotion still src/index.ts Cover out/profile/cover.png --browser-executable="$SHELL_BIN" --log=error
echo rendered
