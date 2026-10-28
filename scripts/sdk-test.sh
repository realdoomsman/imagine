#!/usr/bin/env bash
# Run the SDK's LiteSVM suites (or a name-filtered subset) under the WSL node.
#   scripts/sdk-test.sh                # everything
#   scripts/sdk-test.sh "launch"       # tests whose name matches
set -euo pipefail
export PATH=/opt/node/bin:$PATH
cd "$(dirname "${BASH_SOURCE[0]}")/../packages/sdk"
npx tsc --noEmit
if [ $# -gt 0 ]; then
  node --test --test-name-pattern="$1" test/*.test.ts
else
  node --test test/*.test.ts
fi
