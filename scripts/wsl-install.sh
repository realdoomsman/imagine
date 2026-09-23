#!/usr/bin/env bash
# Reinstall workspace dependencies under the Linux Node in WSL.
#
# The test suite needs litesvm, which ships no Windows binary, so the node_modules
# tree used for tests has to be the Linux one.
set -eu
export PATH="/opt/node/bin:$PATH"
cd /mnt/c/tech/Hold
# pnpm refuses to reuse a modules dir created with a different
# virtual-store-dir-max-length (Windows vs Linux defaults differ), and the
# prompt cannot be answered non-interactively.
rm -rf node_modules
npx --yes pnpm@10.13.1 install --no-frozen-lockfile --config.confirmModulesPurge=false
cd packages/sdk
npx --yes pnpm@10.13.1 add -D litesvm-linux-x64-gnu@0.8.0
node -e "require('litesvm'); console.log('litesvm ok')"
