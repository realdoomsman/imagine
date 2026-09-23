#!/usr/bin/env bash
#
# Build the web image and push it to GHCR.
#
# Railway's own builder rejects every build on this project in about a second
# with no logs, including a three-line Dockerfile, so the service deploys from a
# prebuilt image instead.
set -euo pipefail

ROOT=/mnt/c/tech/Hold
IMAGE=ghcr.io/realdoomsman/vise-web:latest
API_URL="${API_URL:-https://api-production-885d.up.railway.app}"
RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}"

cd "$ROOT"
docker build \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=$API_URL" \
  --build-arg "NEXT_PUBLIC_RPC_URL=$RPC_URL" \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
echo "pushed $IMAGE"
