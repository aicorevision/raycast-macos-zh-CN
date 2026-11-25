#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(/usr/bin/uname -m)" != arm64 ]; then
  printf '%s\n' '本安装包需要 Apple Silicon Mac 的原生 arm64 终端。' >&2
  exit 1
fi

if [ -x ./runtime/bin/node ]; then
  runtime=./runtime/bin/node
else
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  if ! runtime=$(command -v node); then
    printf '%s\n' '请下载 GitHub Releases 的一键安装包，或先安装 Node.js 20 及以上版本。' >&2
    exit 1
  fi
  "$runtime" -e 'if (+process.versions.node.split(".")[0] < 20) { console.error("需要 Node.js 20 或以上版本。"); process.exit(1) }'
  if [ ! -f ./node_modules/acorn/package.json ]; then
    npm ci --ignore-scripts --no-audit --no-fund --omit=dev
  fi
fi

exec "$runtime" ./one-click.mjs "$@"
