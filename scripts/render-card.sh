#!/usr/bin/env bash
# Render one X card by id to video/out/cards: scripts/render-card.sh 02-stock
set -euo pipefail
cd "$(dirname "$0")/../video"
mkdir -p out/cards
PROPS=$(node --input-type=module -e "import { CARDS } from './src/cards.ts'; const card = CARDS.find((c) => c.id === '$1'); if (!card) { console.error('no card $1'); process.exit(1); } console.log(JSON.stringify(card.props));")
npx remotion still src/index.ts XCard "out/cards/$1.png" --props="$PROPS" --log=error
echo "rendered $1"
