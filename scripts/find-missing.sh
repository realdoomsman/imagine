#!/usr/bin/env bash
# Run the e2e until it fails, then print every writable account that does not
# exist on the local ledger. Those are the pump.fun fee destinations the local
# fixture still has not pre-created.
set -u
cd /mnt/c/tech/Hold/apps/api
for i in $(seq 1 "${1:-8}"); do
  /opt/node/bin/node scripts/e2e.ts > "/tmp/miss-$i.log" 2>&1
  if ! grep -q '^PASS' "/tmp/miss-$i.log"; then
    echo "run $i failed:"
    grep -E '^  \[[0-9]+\] .* MISSING' "/tmp/miss-$i.log"
    grep -E 'transactionMessage' "/tmp/miss-$i.log" | head -1
  fi
done
echo "done"
