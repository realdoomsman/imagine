#!/usr/bin/env bash
#
# Render the X launch film (video/src/x-film) to video/out/x/film:
#   imagine-launch.mp4         1920×1080, H.264 + AAC, faststart, <= 50 MB
#   imagine-launch-square.mp4  1080×1080 feed cut with burned-in captions
#   imagine-launch.srt         captions for the upload
#
# Needs the screen recordings in video/out/x/raw (live imagine.fun:
# hero-long-live, pair-picker-live; mainnet fork: coin-page-local,
# coin-lock-local), Python 3 with numpy,
# scipy and edge-tts, and ffmpeg on PATH. VO=0 reuses the rendered voice lines
# (vo.py needs network).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/video"

PY=""
for candidate in python3 python python.exe; do
  if command -v "$candidate" >/dev/null && "$candidate" -c "import numpy, scipy" 2>/dev/null; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || { echo "need Python 3 with numpy and scipy" >&2; exit 1; }
if [ "${VO:-1}" != "0" ]; then "$PY" audio/vo.py; fi
"$PY" audio/launch.py

# Footage: recordings are variable-frame-rate, which Remotion's OffthreadVideo
# cannot seek reliably, and speed-ups are baked in rather than played back at
# a rate. Each clip becomes video/public/shots/<name>-x<rate>.mp4 (git-ignored).
mkdir -p public/shots
for spec in "hero-long-live 2" "pair-picker-live 1.46" "coin-page-local 1" "coin-lock-local 1.65"; do
  set -- $spec
  dest="public/shots/$1$([ "$2" = 1 ] || echo "-x$2").mp4"
  [ -f "$dest" ] && [ "$dest" -nt "out/x/raw/$1.mp4" ] && continue
  ffmpeg -hide_banner -loglevel error -y -i "out/x/raw/$1.mp4" -vf "fps=30,setpts=PTS/$2,fps=30,format=yuv420p" \
    -c:v libx264 -crf 14 -preset medium -g 15 -bf 0 -an -movflags +faststart "$dest"
done
# Proof crops from the stills: the Explorer's program rows, the GitHub repo name.
ffmpeg -hide_banner -loglevel error -y -i out/x/raw/explorer-program.png -vf "crop=900:256:391:312" public/shots/explorer-rows.png
ffmpeg -hide_banner -loglevel error -y -i out/x/raw/github.png -vf "crop=230:72:225:228" public/shots/github-name.png

OUT=out/x/film
mkdir -p "$OUT" out/x/raw
for comp in Launch LaunchSquare; do
  npx remotion render src/x-film/index.ts "$comp" "out/x/raw/master-$comp.mp4" --codec=h264 --crf=14 --concurrency=4 --bundle-cache=false --log=error
done

# Final encodes: picture from the master, sound straight from the mix, so the
# AAC is encoded once from the loudness-normalised WAV.
encode() {
  ffmpeg -hide_banner -loglevel error -y -i "out/x/raw/master-$1.mp4" -i public/launch.wav \
    -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -crf "$3" -profile:v high -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/$2"
}
encode Launch imagine-launch.mp4 16
encode LaunchSquare imagine-launch-square.mp4 16
ls -la "$OUT"
