#!/usr/bin/env bash
# Run the end-to-end script N times, reporting pass/fail and, on failure, the
# writable accounts involved. Flakiness here means a real ordering or funding
# bug, so the loop exists to surface it rather than hide it.
set -u
cd /mnt/c/tech/Hold/apps/api
N="${1:-4}"
for i in $(seq 1 "$N"); do
  /opt/node/bin/node scripts/e2e.ts > "/tmp/e2e-$i.log" 2>&1
  status=$(grep -oE '^(PASS|FAIL).*' "/tmp/e2e-$i.log" | head -1)
  echo "run $i: ${status:-CRASHED}"
  if [ -z "$status" ]; then
    grep -E '^  \[[0-9]+\]|failed$|transactionMessage' "/tmp/e2e-$i.log" | head -14
  fi
done
