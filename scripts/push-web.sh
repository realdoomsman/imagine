#!/usr/bin/env bash
#
# Build the web image and push it to GHCR; Railway deploys the prebuilt image.
#
#   GOOGLE_CLIENT_ID=… WEB_RPC_URL=… bash scripts/push-web.sh
#
# WEB_RPC_URL ships in the browser bundle, so it must be a keyless,
# per-visitor rate-limited endpoint — never the keyed RPC_URL the API, keeper
# and deploy scripts use.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/realdoomsman/imagine-web:latest}"
API_URL="${API_URL:-https://api.imagine.fun}"
: "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID (the OAuth web client)}"
: "${WEB_RPC_URL:?set WEB_RPC_URL (a keyless mainnet endpoint)}"
if [[ "$WEB_RPC_URL" == *api-key* ]]; then
  echo "WEB_RPC_URL carries an api-key; the browser bundle is public. Use a keyless endpoint." >&2
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
  --build-arg "NEXT_PUBLIC_OFFICIAL_MINT=${OFFICIAL_MINT:-}" \
  --build-arg "NEXT_PUBLIC_X_URL=${X_URL:-}" \
  --build-arg "NEXT_PUBLIC_TELEGRAM_URL=${TELEGRAM_URL:-}" \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
echo "pushed $IMAGE"
