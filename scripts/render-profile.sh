#!/usr/bin/env bash
# Render the X avatar (400×400), banner (1500×500) and OG card (1200×630) to video/out/profile.
set -euo pipefail
cd "$(dirname "$0")/../video"
mkdir -p out/profile
for id in Avatar Banner Card; do
  npx remotion still src/index.ts "$id" "out/profile/$(echo "$id" | tr '[:upper:]' '[:lower:]').png" --log=error
done
echo rendered
