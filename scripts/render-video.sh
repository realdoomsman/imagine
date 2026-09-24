#!/usr/bin/env bash
#
# Regenerate the score and render every composition to video/out.
#
# Runs under WSL. Remotion's own browser download lands in node_modules under
# /mnt/c, which is slow enough over 9p to time out, so the headless shell is
# installed once into the Linux filesystem and passed explicitly.
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
ROOT=/mnt/c/tech/Hold
BROWSERS="$HOME/.cache/vise-browser"

cd "$ROOT/video"
# numpy lives in the Windows Python; the WAVs land in video/public.
(cd "$ROOT" && python.exe video/audio/score.py)

if ! ls "$BROWSERS"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell >/dev/null 2>&1; then
  corepack pnpm dlx @puppeteer/browsers install chrome-headless-shell@stable --path "$BROWSERS"
fi
SHELL_BIN=$(ls "$BROWSERS"/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)

for comp in ${COMPS:-Promo Teaser Explainer Vertical}; do
  out="out/vise-$(echo "$comp" | tr '[:upper:]' '[:lower:]').mp4"
  corepack pnpm exec remotion render src/index.ts "$comp" "$out" \
    --codec=h264 --crf=16 --browser-executable="$SHELL_BIN" --log=error
  echo "rendered $out"
done

# The site's copy of the film: smaller, faststart, with a poster from the close.
FFMPEG=$(command -v ffmpeg.exe || command -v ffmpeg)
mkdir -p "$ROOT/apps/web/public/film"
"$FFMPEG" -hide_banner -loglevel error -y -i out/vise-promo.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -movflags +faststart -c:a aac -b:a 160k "$ROOT/apps/web/public/film/vise-promo.mp4"
"$FFMPEG" -hide_banner -loglevel error -y -ss 56 -i out/vise-promo.mp4 -frames:v 1 -q:v 3 "$ROOT/apps/web/public/film/poster.jpg"
echo "web film encoded"
