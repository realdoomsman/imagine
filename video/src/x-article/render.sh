#!/usr/bin/env bash
# Renders the X article images into out/x/article/. Run from video/ in Git Bash:
#   bash src/x-article/render.sh            # all
#   bash src/x-article/render.sh a03-curve  # some
set -euo pipefail
cd "$(dirname "$0")/../.."
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  ids=(cover a01-hero a02-flow a03-curve a04-example a05-rules a06-launch a07-coin a08-compare a09-proof)
fi
mkdir -p out/x/article
for id in "${ids[@]}"; do
  npx remotion still src/x-article/index.ts "$id" "out/x/article/$id.png" --public-dir=out/x/raw --image-format=png
done
