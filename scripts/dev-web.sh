#!/usr/bin/env bash
# Run the Next dev server under the Linux Node in WSL.
#
# The workspace's node_modules is the Linux tree (litesvm has no Windows build),
# so the web app has to run from the same interpreter.
set -eu
PATH="/opt/node/bin:/usr/bin:/bin"
export PATH
# inotify does not fire for files on /mnt/c (9p), so the watcher must poll or
# every edit needs a server restart to be seen.
export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=true
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/web"
# pnpm links the binary into the app's own node_modules, not the workspace root.
exec node node_modules/next/dist/bin/next dev -p "${PORT:-3000}"
