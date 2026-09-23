#!/usr/bin/env bash
# Typecheck the web app under the WSL node tree.
set -euo pipefail
export PATH=/opt/node/bin:$PATH
cd /mnt/c/tech/Hold/apps/web
npx tsc --noEmit
