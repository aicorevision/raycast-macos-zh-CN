#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
exec /bin/bash tools/adaptive/run-command.sh install "$@"
