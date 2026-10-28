#!/usr/bin/env bash
# Renders the X post assets into video/out/x/{posts,profile}.
# Run from anywhere with Git Bash: bash video/src/x-posts/render.sh
set -euo pipefail

VIDEO="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$VIDEO/out/x/raw"
WORK="${TMPDIR:-${TEMP:-/tmp}}/x-posts-render"
ENTRY="src/x-posts/index.ts"
mkdir -p "$WORK/public" "$VIDEO/out/x/posts" "$VIDEO/out/x/profile"
cd "$VIDEO"

# Stills read the raw captures (explorer screenshot, captured post-pivot test output) directly.
npx remotion still "$ENTRY" XP02 out/x/posts/p02.png --public-dir="$RAW"
npx remotion still "$ENTRY" XP03 out/x/posts/p03.png --public-dir="$RAW"
npx remotion still "$ENTRY" XP04 out/x/posts/p04.png --public-dir="$RAW"
npx remotion still "$ENTRY" XAvatar out/x/profile/avatar.png --public-dir="$RAW"
npx remotion still "$ENTRY" XBanner out/x/profile/banner.png --public-dir="$RAW"

# Live captures of https://imagine.fun after the Raydium deploy. Re-timed to a clean
# 30 fps CFR stream; a plain fps=30 transcode makes OffthreadVideo miss frames.
for f in hero-long-live.mp4 launch-walk-live.mp4; do
  ffmpeg -v error -y -i "$RAW/$f" -vf "fps=30,setpts=N/30/TB" -c:v libx264 -crf 12 -preset fast -g 30 -bf 0 \
    -pix_fmt yuv420p -video_track_timescale 30000 -an "$WORK/public/$f"
done
python "$VIDEO/src/x-posts/sound.py" "$WORK"

for id in 01 05; do
  npx remotion render "$ENTRY" "XP$id" "$WORK/p$id-video.mp4" --public-dir="$WORK/public" --muted --crf=16
  ffmpeg -v error -y -i "$WORK/p$id-video.mp4" -i "$WORK/p$id.wav" -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -profile:v high -r 30 \
    -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "out/x/posts/p$id.mp4"
done
