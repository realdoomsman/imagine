#!/usr/bin/env bash
# Production build of the web app under the Linux Node in WSL.
set -eu
PATH="/opt/node/bin:/usr/bin:/bin"
export PATH
cd /mnt/c/tech/Hold/apps/web
exec node node_modules/next/dist/bin/next build
