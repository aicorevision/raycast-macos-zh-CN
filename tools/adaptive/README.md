# 按当前 Raycast 版本生成汉化包

工具读取本机 Raycast 的完整版本、arm64 原生程序和官方资源，生成该构建专用的补丁以及恢复工具。默认应用是 /Applications/Raycast.app。

## 升级后的适配流程

1. 阅读 Raycast 的新版更新日志，并运行清单生成器。可用上次的清单或保留的上一版官方应用对照。
2. 结合更新日志检查新增界面。在 reviewed-display.json 记录核实的英文、中文和显示属性。清单的 newSinceBaseline 列出新出现的候选项，reviewCoverage 记录已复核文案在当前构建中的命中数。动态内容、原生菜单和变更后的组件结构需要另行检查。在线商店简介发生变化时，将实机核对的文案补到 reviewed-store.json。
3. 生成版本专用补丁，退出 Raycast 后执行安装。实际查看主搜索、设置、商店列表、扩展详情以及本版新增页面。

在本目录运行以下命令。首次使用需要 Node.js 20 或以上版本。

```sh
npm ci
npm test
node cli.mjs inventory
node cli.mjs inventory --baseline-report /绝对路径/上次的/inventory.json --out /绝对路径/新版候选文案
node cli.mjs build
```

build 输出位于 out 下以应用版本命名的新目录。安装时运行目录内的「安装汉化.command」，或执行 /bin/bash patch.sh --apply /Applications/Raycast.app。安装器先验证版本、原生程序和逐项资源指纹，再备份每个将被修改的文件。恢复时退出 Raycast，使用同一目录的「恢复原版.command」。资源改动会影响完整签名校验，启动受阻时可以恢复原版。

默认词库从上游 2.11.1.0 的已发布补丁提取。生成时在当前构建的 Web 界面中匹配已识别的显示属性。商店简介及部分命令文案沿用上游词库，通过当前商店的列表和详情渲染位置显示。扩展内部代码、Raycast 原生程序及用户数据不在生成范围内。

## 2.14.0.0

对照 2.11.1.0 的原版资源，在 2.14.0.0 的实际应用内复核并补充浏览器连接及配对、建议快捷键、计算器区域设置、从系统文本替换或 Alfred 导入片段、MCP 服务器设置与交互表单，以及 AI 命令和更新日志入口的中文文案。使用新版本前保留生成的 inventory.json，作为后续升级的对照来源。

## Windows x64

从仓库根目录运行以下命令。需要 Node.js 20 或以上版本，以及从 Microsoft Store 安装的 Raycast x64。

```powershell
npm --prefix tools/adaptive ci
npm --prefix tools/adaptive run inventory:windows
```

默认输出为 `tools/adaptive/out/windows-x64-<版本>-inventory/inventory.json`。清单列出主程序和界面资源的 SHA-256、已复核词条的命中次数、候选文案，以及匹配主程序指纹的实机加载状态。可以指定 `--out` 新目录和 `--baseline-report` 上次生成的 Windows 清单，查找新增候选。

```powershell
npm --prefix tools/adaptive run inventory:windows -- --baseline-report D:/reports/previous/inventory.json --out D:/reports/raycast-win-next
```

macOS 和 Windows 使用同一个界面扫描器，并从同一份已复核词库读取界面及商店译文。Windows 专用译文维护在 `reviewed-windows-display.json`。命令读取本机官方资源，对内存中的译文结果做语法与指纹检查，输出清单。 [Windows 客户端](https://www.raycast.com/windows)

**2.14.0.0 x64 实测。** 本机扫描命中 137 个资源文件、20,835 处静态显示文案、1 处主搜索占位符和 4 处商店渲染位置。替换次数包括跨文件的重复文案。此前尝试通过 WebView2 调试连接加载汉化，生产版检测后退出。已移除调试配置并重新启动官方应用；Windows 适配尚未通过实机中文显示验证。 `windows-validation.json` 按版本、架构和主程序指纹记录该状态。新构建在完成实机验证前显示为 `unverified`。
