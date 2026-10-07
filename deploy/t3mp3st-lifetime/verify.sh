#!/bin/sh
set -eu
overlay="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source_dir="${1:?pass an isolated checkout of the pinned upstream commit}"
node "$overlay/prepare.mjs" "$source_dir"
cd "$source_dir"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts --no-fund
npm run typecheck
npm run lint
npm run build
npm test
npm audit --audit-level=low
T3MP3ST_TEST_APP_DIR="$source_dir" node --test "$overlay"/tests/*.test.mjs
