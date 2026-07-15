#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# The Tencent Cloud host can time out against nodejs.org. Build native modules
# with matching Node headers from the mainland mirror instead of reusing an old
# better-sqlite3 binary.
npm_config_build_from_source=true \
npm_config_disturl=https://npmmirror.com/mirrors/node \
npm ci --omit=dev --registry=https://registry.npmmirror.com

