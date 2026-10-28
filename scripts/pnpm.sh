#!/usr/bin/env bash
# Run pnpm (or any node CLI) inside the WSL node tree. Usage: pnpm.sh <dir> <args…>
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/../$1"; shift
corepack pnpm "$@"
