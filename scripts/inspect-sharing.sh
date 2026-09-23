#!/usr/bin/env bash
# Dump pump's fee-sharing accounts for the newest pool in the local DB.
set -eu
cd /mnt/c/tech/Hold/apps/api
MINT="${1:-$(psql postgres://postgres:vise@127.0.0.1:5432/vise -Atc 'SELECT mint FROM pools ORDER BY created_at DESC LIMIT 1')}"
echo "mint $MINT"
/opt/node/bin/node --env-file=.env.local scripts/inspect-sharing.ts "$MINT" 2>&1 | grep -v 'bigint:'
