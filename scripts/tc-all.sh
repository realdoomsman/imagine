#!/usr/bin/env bash
# Typecheck every TypeScript package under the WSL node tree.
set -u
export PATH=/opt/node/bin:$PATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0
for dir in packages/sdk apps/api apps/web video; do
  out=$(cd "$ROOT/$dir" && npx tsc --noEmit 2>&1 | grep -v 'npm warn')
  if [ -n "$out" ]; then
    echo "== $dir"
    echo "$out" | head -20
    status=1
  else
    echo "$dir ok"
  fi
done
exit $status
