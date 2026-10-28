#!/usr/bin/env bash
# Render half-scale spot-check frames of a film: scripts/promo-frames.sh <frame> [frame...]
# COMP=Vertical scripts/promo-frames.sh 120 picks another composition (default Promo).
set -euo pipefail
cd "$(dirname "$0")/../video"
COMP="${COMP:-Promo}"
mkdir -p out/frames
for f in "$@"; do
  npx remotion still src/index.ts "$COMP" "out/frames/$(echo "$COMP" | tr '[:upper:]' '[:lower:]')-$f.png" --frame="$f" --scale=0.5 --log=error
  echo "frame $f"
done
