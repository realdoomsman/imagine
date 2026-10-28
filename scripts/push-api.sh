#!/usr/bin/env bash
#
# Build the API/indexer image and push it to GHCR. The same image serves both
# Railway services; ROLE picks which entrypoint runs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/realdoomsman/imagine-api:latest}"

cd "$ROOT"
docker build -f apps/api/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
echo "pushed $IMAGE"
