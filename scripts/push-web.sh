#!/usr/bin/env bash
#
# Build the web image and push it to GHCR; Railway deploys the prebuilt image.
#
#   GOOGLE_CLIENT_ID=… bash scripts/push-web.sh
#
# The site's RPC is the API's proxy (https://api.imagine.fun/rpc and
# wss://api.imagine.fun/rpc-ws): the keyed provider URL stays in the API's
# environment and never ships in the browser bundle. WEB_RPC_URL / WEB_WS_URL
# override that, and must then be keyless endpoints.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/realdoomsman/imagine-web:latest}"
API_URL="${API_URL:-https://api.imagine.fun}"
WEB_RPC_URL="${WEB_RPC_URL:-$API_URL/rpc}"
WEB_WS_URL="${WEB_WS_URL:-$(echo "$API_URL" | sed 's/^http/ws/')/rpc-ws}"
: "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID (the OAuth web client)}"
if [[ "$WEB_RPC_URL$WEB_WS_URL" == *api-key* ]]; then
  echo "WEB_RPC_URL / WEB_WS_URL carry an api-key; the browser bundle is public. Use the API's /rpc proxy." >&2
  exit 1
fi
CLUSTER="${CLUSTER:-mainnet-beta}"

cd "$ROOT"
docker build \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=$API_URL" \
  --build-arg "NEXT_PUBLIC_RPC_URL=$WEB_RPC_URL" \
  --build-arg "NEXT_PUBLIC_WS_URL=$WEB_WS_URL" \
  --build-arg "NEXT_PUBLIC_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  --build-arg "NEXT_PUBLIC_CLUSTER=$CLUSTER" \
  --build-arg "NEXT_PUBLIC_X_URL=${X_URL:-}" \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
echo "pushed $IMAGE"
