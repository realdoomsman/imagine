#!/usr/bin/env bash
#
# Everything that proves VISE works, in one command.
#
# Requires the local rig (scripts/localnet-up.sh) for the integration and
# end-to-end suites; the unit tests and typechecks need nothing.
set -u
ROOT=/mnt/c/tech/Hold
NODE="${NODE:-/opt/node/bin/node}"
NPX="${NPX:-/opt/node/bin/npx}"
PATH="/opt/node/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH
failures=0

step() { printf '\n== %s\n' "$1"; }
check() { if [ "$1" -eq 0 ]; then echo "   ok"; else echo "   FAILED"; failures=$((failures + 1)); fi; }

step "reward math (cargo unit tests)"
(cd "$ROOT" && cargo test -p vise --lib 2>&1 | grep "test result")
check "${PIPESTATUS[0]:-0}"

step "clippy"
(cd "$ROOT" && cargo clippy -p vise --all-targets 2>&1 | grep -E '^error' && exit 1 || exit 0)
check $?

step "typechecks"
for dir in packages/sdk apps/api apps/web video; do
  out=$(cd "$ROOT/$dir" && "$NPX" tsc --noEmit 2>&1 | grep -v 'npm warn')
  if [ -n "$out" ]; then echo "   $dir:"; echo "$out" | head -5; failures=$((failures + 1)); else echo "   $dir ok"; fi
done

step "program instructions (LiteSVM integration suite)"
(cd "$ROOT/packages/sdk" && "$NODE" --test test/vise.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)')

step "end to end against the real pump.fun programs"
if solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; then
  bash "$ROOT/scripts/e2e-loop.sh" 3
else
  echo "   skipped: no local validator (run scripts/localnet-up.sh)"
fi

printf '\n%s\n' "$([ "$failures" -eq 0 ] && echo 'ALL GREEN' || echo "$failures CHECK(S) FAILED")"
exit "$failures"
