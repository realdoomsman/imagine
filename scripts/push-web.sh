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
API_URL="${API_URL:-https://api.vise.fun}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-1021573770447-apecm9eqd83amm8lf39v81blmdqcga2g.apps.googleusercontent.com}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
CLUSTER="${CLUSTER:-devnet}"

cd "$ROOT"
docker build \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=$API_URL" \
  --build-arg "NEXT_PUBLIC_RPC_URL=$RPC_URL" \
  --build-arg "NEXT_PUBLIC_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  --build-arg "NEXT_PUBLIC_CLUSTER=$CLUSTER" \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
echo "pushed $IMAGE"
