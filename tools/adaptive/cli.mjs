import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hash, novelty, reviewTerms, scan } from './frontend-inventory.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const readText = path => readFileSync(path, 'utf8');
const readJson = path => JSON.parse(readText(path));
const raycastSignature = 'anchor apple generic and certificate leaf[subject.OU] = "SY64MV22J9" and identifier "com.raycast.macos"';
const binaryPath = 'Contents/MacOS/Raycast';
const frontendPath = 'Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/frontend';

function inspectApp(input) {
  const app = realpathSync(input);
  const readPlist = key => execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print :' + key, join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  const version = readPlist('CFBundleShortVersionString');
  if (readPlist('CFBundleIdentifier') !== 'com.raycast.macos' || !/^\d+(?:\.\d+){2,3}$/u.test(version)) {
    throw new Error('不是受支持的 Raycast 应用：' + app);
  }
  const binary = join(app, binaryPath);
  if (!execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/u).includes('arm64')) {
    throw new Error('应用缺少 arm64 原生程序：' + app);
  }
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '-R=' + raycastSignature, app], { stdio: 'inherit' });
  return { app, version, binary, frontend: join(app, frontendPath) };
}

function packageOutput(out, version, binary, payload) {
  mkdirSync(join(out, 'payload'));
  const rows = [];
  for (const { rel, original, output } of payload) {
    const path = join(out, 'payload', rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output);
    rows.push([original, hash(output), rel].join('\t'));
  }
  writeFileSync(join(out, 'manifest.tsv'), rows.join('\n') + '\n');
  writeFileSync(join(out, 'native-sha256.txt'), hash(readFileSync(binary)) + '\n');
  const installer = readText(join(toolDirectory, 'patch.sh.in'))
    .replaceAll('@VERSION@', version).replaceAll('@FILE_COUNT@', String(payload.length));
  writeFileSync(join(out, 'patch.sh'), installer, { mode: 0o755 });
  for (const [file, action] of [['安装汉化.command', 'apply'], ['恢复原版.command', 'restore']]) {
    const command = '#!/bin/bash\nset -e\ncd "$(dirname "$0")"\nexec /bin/bash ./patch.sh --interactive-' + action + '\n';
    writeFileSync(join(out, file), command, { mode: 0o755 });
  }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: 'string', default: '/Applications/Raycast.app' },
      baseline: { type: 'string' },
      'baseline-report': { type: 'string' },
      out: { type: 'string' },
      review: { type: 'string', default: join(toolDirectory, 'reviewed-display.json') },
    },
  });
  const [action] = positionals;
  if (!['inventory', 'build'].includes(action) || positionals.length !== 1) {
    throw new Error('用法：node cli.mjs inventory|build [--app 应用] [--baseline 上一版原版 | --baseline-report 上次报告] [--out 新目录] [--review 词库]');
  }
  if (values.baseline && values['baseline-report']) throw new Error('请选择一种上一版对照来源。');
  if (platform() !== 'darwin' || arch() !== 'arm64') throw new Error('本工具适用于 Apple Silicon Mac。');
  if (!lstatSync(values.app).isDirectory()) throw new Error('请提供真实的 .app 目录。');
  const installation = inspectApp(values.app);
  const { version, binary } = installation;
  const build = action === 'build';
  const out = resolve(values.out ?? join(toolDirectory, 'out', version + '-' + action));
  const reviewed = readJson(values.review);
  const terms = reviewTerms(readJson(join(toolDirectory, 'seed-display.json')), reviewed);
  const storeTerms = {
    ...readJson(join(toolDirectory, 'seed-store.json')),
    ...readJson(join(toolDirectory, 'reviewed-store.json')),
  };
  const scanResults = scan(installation, terms, storeTerms, build);
  const { files, payload, totals, matches } = scanResults;
  const baseline = values.baseline ? inspectApp(values.baseline) : undefined;
  const baselineReport = values['baseline-report'] ? readJson(values['baseline-report']) : undefined;
  const baselineVersion = baseline?.version ?? baselineReport?.version;
  const baselineFiles = baseline ? scan(baseline, terms, storeTerms, false).files : baselineReport?.files;
  const newSinceBaseline = baselineFiles ? novelty(files, baselineFiles) : undefined;
  const reviewCoverage = Object.fromEntries(Object.keys(reviewed).map(term => [term, matches.get(term) ?? 0]));
  if (build && (!payload.some(file => /^settings-window-.*\.js$/u.test(basename(file.rel)))
      || !totals.rootPlaceholder || !totals.storeDescription)) {
    throw new Error('主界面、设置或商店的已知结构发生变化。先运行 inventory 检查当前版本。');
  }
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out, { mode: 0o700 });
  writeFileSync(join(out, 'inventory.json'), JSON.stringify({
    version, baseline: baselineVersion, totals, reviewCoverage, files, newSinceBaseline,
  }, null, 2) + '\n');
  if (build) packageOutput(out, version, binary, payload);
  console.log(JSON.stringify({ version, baseline: baselineVersion, files: payload.length, totals, out }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
