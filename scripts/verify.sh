#!/usr/bin/env bash
#
# Everything that proves IMAGINE works, in one command (WSL).
#
# The end-to-end suite needs the mainnet fork (scripts/mainnet-fork.sh) with
# the program deployed (scripts/deploy.sh localnet) and the API running
# against it; the unit tests and typechecks need nothing.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${NODE:-/opt/node/bin/node}"
NPX="${NPX:-/opt/node/bin/npx}"
PATH="/opt/node/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH
failures=0

step() { printf '\n== %s\n' "$1"; }
check() { if [ "$1" -eq 0 ]; then echo "   ok"; else echo "   FAILED"; failures=$((failures + 1)); fi; }

step "reward math (cargo unit tests)"
(cd "$ROOT" && cargo test -p imagine --lib 2>&1 | grep "test result")
check "${PIPESTATUS[0]:-0}"

step "clippy"
(cd "$ROOT" && cargo clippy -p imagine --all-targets 2>&1 | grep -E '^error' && exit 1 || exit 0)
check $?

step "typechecks"
for dir in packages/sdk apps/api apps/web video; do
  out=$(cd "$ROOT/$dir" && "$NPX" tsc --noEmit 2>&1 | grep -v 'npm warn')
  if [ -n "$out" ]; then echo "   $dir:"; echo "$out" | head -5; failures=$((failures + 1)); else echo "   $dir ok"; fi
done

step "program instructions (LiteSVM integration suites)"
litesvm=$(cd "$ROOT/packages/sdk" && "$NODE" --test test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)')
echo "$litesvm"
# A suite that could not load the program reports every test failed and exits
# non-zero; both must count, or a green banner over 0/N is possible.
if ! echo "$litesvm" | grep -qE '^ℹ fail 0$' || ! echo "$litesvm" | grep -qE '^ℹ pass [1-9]'; then
  echo "   FAILED"; failures=$((failures + 1))
else
  echo "   ok"
fi

step "end to end on the mainnet fork (real LaunchLab, StonkFun platform, SOL + SPYx)"
if solana -u "${RPC_URL:-http://127.0.0.1:8999}" cluster-version >/dev/null 2>&1; then
  (cd "$ROOT/apps/api" && "$NODE" scripts/e2e.ts 2>&1 | tail -40)
  check "${PIPESTATUS[0]:-0}"
else
  echo "   skipped: no fork validator (run scripts/mainnet-fork.sh)"
fi

printf '\n%s\n' "$([ "$failures" -eq 0 ] && echo 'ALL GREEN' || echo "$failures CHECK(S) FAILED")"
exit "$failures"
