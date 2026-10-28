#!/usr/bin/env bash
#
# Regenerate the score, render every film to video/out, and publish the web
# copies: apps/web/public/film/imagine-promo.mp4 (H.264, faststart, <= 8 MB),
# apps/web/public/film/poster.jpg, and the OG image apps/web/app/opengraph-image.png.
#
# Needs Node + pnpm deps in video/, Python 3 with numpy + scipy, and ffmpeg on PATH.
# COMPS="Promo Teaser" limits which films are rendered.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/video"

# The first Python that has the score's dependencies (Windows Python from WSL is python.exe).
PY=""
for candidate in python3 python python.exe; do
  if command -v "$candidate" >/dev/null && "$candidate" -c "import numpy, scipy" 2>/dev/null; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || { echo "need Python 3 with numpy and scipy" >&2; exit 1; }
"$PY" audio/score.py

mkdir -p out
for comp in ${COMPS:-Promo Teaser Explainer Vertical}; do
  out="out/imagine-$(echo "$comp" | tr '[:upper:]' '[:lower:]').mp4"
  npx remotion render src/index.ts "$comp" "$out" --codec=h264 --crf=16 --log=error
  echo "rendered $out"
done

if [ -f out/imagine-promo.mp4 ]; then
  mkdir -p "$ROOT/apps/web/public/film"
  ffmpeg -hide_banner -loglevel error -y -i out/imagine-promo.mp4 \
    -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart \
    -c:a aac -b:a 128k "$ROOT/apps/web/public/film/imagine-promo.mp4"
  # The poster is the close: mark, wordmark, line and domain all on screen.
  ffmpeg -hide_banner -loglevel error -y -ss 56 -i out/imagine-promo.mp4 -frames:v 1 -q:v 3 \
    "$ROOT/apps/web/public/film/poster.jpg"
  echo "web film encoded"
fi

npx remotion still src/index.ts Card "$ROOT/apps/web/app/opengraph-image.png" --log=error
echo "og image rendered"
