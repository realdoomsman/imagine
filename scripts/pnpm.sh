#!/usr/bin/env bash
# Run pnpm (or any node CLI) inside the WSL node tree. Usage: pnpm.sh <dir> <args…>
set -euo pipefail
export PATH="/opt/node/bin:$PATH"
cd "/mnt/c/tech/Hold/$1"; shift
corepack pnpm "$@"
