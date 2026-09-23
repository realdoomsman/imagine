#!/usr/bin/env bash
# Render one still by id: scripts/render-card.sh 08-vise-365
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold/video
SHELL_BIN=$(ls "$HOME/.cache/vise-browser"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
PROPS=$(node --input-type=module -e "import { CARDS } from './src/cards.ts'; console.log(JSON.stringify(CARDS.find((c) => c.id === '$1').props));")
corepack pnpm exec remotion still src/index.ts Card "out/cards/$1.png" --props="$PROPS" --browser-executable="$SHELL_BIN" --log=error
echo "rendered $1"
