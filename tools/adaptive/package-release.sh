#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  printf '%s\n' '用法：package-release.sh 已验证的Node官方解压目录 新输出目录' >&2
  exit 2
fi

project=$(cd "$(dirname "$0")/../.." && pwd -P)
runtime=$(cd "$1" && pwd -P)
mkdir "$2"
out=$(cd "$2" && pwd -P)
archive=raycast-zh-cn-one-click-macos-arm64.zip
bundle="$out/Raycast 中文一键安装"
tool="$bundle/tools/adaptive"

"$runtime/bin/node" -e 'if (process.platform !== "darwin" || process.arch !== "arm64") process.exit(1)'
/usr/bin/codesign --verify "$runtime/bin/node"
mkdir -p "$tool/runtime/bin" "$tool/node_modules"
/bin/cp "$project/安装汉化.command" "$project/恢复原版.command" "$bundle/"
/bin/chmod 755 "$bundle/安装汉化.command" "$bundle/恢复原版.command"
/bin/cp "$project/tools/adaptive/使用说明.md" "$bundle/使用说明.md"
for part in cli.mjs one-click.mjs transform.mjs run-command.sh patch.sh.in \
  reviewed-display.json reviewed-store.json seed-display.json seed-store.json; do
  /bin/cp "$project/tools/adaptive/$part" "$tool/"
done
/bin/cp "$runtime/bin/node" "$tool/runtime/bin/"
/bin/cp "$runtime/LICENSE" "$tool/runtime/LICENSE"
/usr/bin/ditto "$project/tools/adaptive/node_modules/acorn" "$tool/node_modules/acorn"
/usr/bin/ditto -c -k --keepParent "$bundle" "$out/$archive"
(
  cd "$out"
  /usr/bin/shasum -a 256 "$archive" > "$archive.sha256"
  /usr/bin/shasum -a 256 -c "$archive.sha256"
)
