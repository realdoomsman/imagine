#!/usr/bin/env bash
# Run the SDK's LiteSVM suite (or a name-filtered subset) under the WSL node.
#   scripts/sdk-test.sh                # everything
#   scripts/sdk-test.sh "projects a"   # tests whose name matches
set -euo pipefail
export PATH=/opt/node/bin:$PATH
cd /mnt/c/tech/Hold/packages/sdk
npx tsc --noEmit
if [ $# -gt 0 ]; then
  node --test --test-name-pattern="$1" test/vise.test.ts
else
  node --test test/vise.test.ts
fi
