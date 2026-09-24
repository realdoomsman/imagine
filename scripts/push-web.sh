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
# Helius "secure" endpoint: keyless and rate-limited per visitor IP, so it can
# ship in the client bundle. The keyed URL belongs only to the API/indexer —
# which is why this is WEB_RPC_URL and not the RPC_URL the deploy and keeper
# scripts read: an exported keyed RPC_URL must never land in the bundle.
WEB_RPC_URL="${WEB_RPC_URL:-https://harriott-ekceme-fast-mainnet.helius-rpc.com}"
if [[ "$WEB_RPC_URL" == *api-key* ]]; then
  echo "WEB_RPC_URL carries an api-key; the browser bundle is public. Use the keyless endpoint." >&2
  exit 1
fi
CLUSTER="${CLUSTER:-mainnet-beta}"

cd "$ROOT"
docker build \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=$API_URL" \
  --build-arg "NEXT_PUBLIC_RPC_URL=$WEB_RPC_URL" \
  --build-arg "NEXT_PUBLIC_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  --build-arg "NEXT_PUBLIC_CLUSTER=$CLUSTER" \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
echo "pushed $IMAGE"
