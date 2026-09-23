#!/usr/bin/env bash
# Render the twenty launch-week stills to video/out/cards. Runs under WSL.
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold/video
SHELL_BIN=$(ls "$HOME/.cache/vise-browser"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
mkdir -p out/cards
node --input-type=module -e '
import { CARDS } from "./src/cards.ts";
for (const card of CARDS) console.log(card.id + "\t" + JSON.stringify(card.props));
' | while IFS=$'\t' read -r id props; do
  corepack pnpm exec remotion still src/index.ts Card "out/cards/$id.png" \
    --props="$props" --browser-executable="$SHELL_BIN" --log=error
  echo "rendered $id"
done
