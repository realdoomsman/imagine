#!/usr/bin/env bash
# Render every X card (video/src/cards.ts, 1600×900) to video/out/cards.
set -euo pipefail
cd "$(dirname "$0")/../video"
mkdir -p out/cards
node --input-type=module -e '
import { CARDS } from "./src/cards.ts";
for (const card of CARDS) console.log(card.id + "\t" + JSON.stringify(card.props));
' | while IFS=$'\t' read -r id props; do
  npx remotion still src/index.ts XCard "out/cards/$id.png" --props="$props" --log=error
  echo "rendered $id"
done
