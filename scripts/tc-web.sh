#!/usr/bin/env bash
# Typecheck the web app under the WSL node tree.
set -euo pipefail
export PATH=/opt/node/bin:$PATH
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/web"
npx tsc --noEmit
