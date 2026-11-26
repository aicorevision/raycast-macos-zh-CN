import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const toolDir = dirname(fileURLToPath(import.meta.url));
const executable = 'Contents/MacOS/Raycast';
const signature = 'anchor apple generic and certificate leaf[subject.OU] = "SY64MV22J9" and identifier "com.raycast.macos"';
const validHash = /^[a-f0-9]{64}$/u;
const readText = path => readFileSync(path, 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashFile = path => digest(readFileSync(path));

export function parseManifest(contents) {
  const rows = [];
  const paths = new Set();
  for (const line of contents.trimEnd().split('\n')) {
    const [original, translated, path, extra] = line.split('\t');
    if (!(original === '-' || validHash.test(original)) || !validHash.test(translated)
        || !path?.startsWith('Contents/Resources/') || path.includes('\\') || posix.normalize(path) !== path
        || paths.has(path) || extra !== undefined) {
      throw new Error('发现无效或重复的资源清单路径。');
    }
    paths.add(path);
    rows.push({ original, translated, path });
  }
  return rows;
}

function readApp(appArgument) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('请在 Apple Silicon 芯片的 Mac 上运行此安装包。');
  }
  if (!existsSync(appArgument)) throw new Error('找不到 Raycast。请先安装官方 macOS 版：' + appArgument);
  const app = realpathSync(appArgument);
  const plist = key => execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print :' + key, join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  const version = plist('CFBundleShortVersionString');
  if (plist('CFBundleIdentifier') !== 'com.raycast.macos' || !/^\d+(?:\.\d+){2,3}$/u.test(version)) {
    throw new Error('所选位置不是有效的 Raycast 版本。');
  }
  return { app, version, appKey: digest(app) };
}

function matchesPatch(app, nativeHash, packageDir) {
  const manifestPath = join(packageDir, 'manifest.tsv');
  if (!existsSync(manifestPath) || !existsSync(join(packageDir, 'patch.sh'))
      || !existsSync(join(packageDir, 'native-sha256.txt'))
      || readText(join(packageDir, 'native-sha256.txt')).trim() !== nativeHash) return false;
  return parseManifest(readText(manifestPath)).every(row => {
    const file = join(app, row.path);
    return existsSync(file) && lstatSync(file).isFile() && hashFile(file) === row.translated;
  });
}

function liveProcesses(app) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/u))
    .filter(item => item?.[2].startsWith(app + '/Contents/'))
    .map(([, pid, command]) => ({ pid: Number(pid), command }));
}

async function waitUntil(check, milliseconds) {
  const end = Date.now() + milliseconds;
  do {
    if (check()) return true;
    await pause(250);
  } while (Date.now() < end);
  return false;
}

async function stopApp(app) {
  const main = join(app, executable);
  for (const { pid } of liveProcesses(app).filter(item => item.command === main)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  if (!await waitUntil(() => liveProcesses(app).length === 0, 15000)) {
    throw new Error('Raycast 仍在运行。请从菜单退出 Raycast，再运行一次。');
  }
}

async function launchApp(app) {
  execFileSync('/usr/bin/open', [app], { stdio: 'inherit' });
  const main = join(app, executable);
  const running = () => liveProcesses(app).some(item => item.command === main);
  if (!await waitUntil(running, 12000)) throw new Error('macOS 未成功启动 Raycast。');
  await pause(1200);
  if (!running()) throw new Error('Raycast 启动后已退出。');
}

function runPatch(packageDir, mode, app) {
  execFileSync('/bin/bash', [join(packageDir, 'patch.sh'), mode, app], { stdio: 'inherit' });
}

function officialSignature(app) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '-R=' + signature, app], { stdio: 'ignore' });
}

async function patchInstallation(app, packageDir, action, noLaunch) {
  const wasRunning = liveProcesses(app).length > 0;
  await stopApp(app);
  try {
    runPatch(packageDir, action === 'install' ? '--apply' : '--restore', app);
  } catch (error) {
    if (wasRunning) await launchApp(app);
    throw new Error('操作未完成，请查看上面的资源校验信息。', { cause: error });
  }
  if (noLaunch) return;
  try {
    await launchApp(app);
  } catch (error) {
    if (action !== 'install') throw error;
    console.error('汉化后的 Raycast 启动失败，正在恢复官方原版。');
    await stopApp(app);
    runPatch(packageDir, '--restore', app);
    await launchApp(app);
    throw new Error('安装未完成。已恢复并打开官方原版。', { cause: error });
  }
}

async function operate(action, values) {
  const { app, version, appKey } = readApp(values.app);
  console.log('已检测到 Raycast ' + version + ' · ' + app);
  const root = join(homedir(), 'Library/Application Support/Raycast-Chinese-Patch');
  const versionDir = join(root, 'one-click', appKey, version);
  const lock = join(root, 'one-click', appKey, 'running.lock');
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('此 Raycast 已有汉化操作在进行。请等待当前窗口完成。');
  }
  try {
    const nativeHash = hashFile(join(app, executable));
    const backup = join(root, version, appKey);
    const packages = readdirSync(versionDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('build-'))
      .map(entry => join(versionDir, entry.name, 'package'));
    const completeBackup = existsSync(join(backup, 'complete'));
    const originalManifest = completeBackup ? readText(join(backup, 'manifest.tsv')) : undefined;
    const matchesActive = pkg => matchesPatch(app, nativeHash, pkg)
      && readText(join(pkg, 'manifest.tsv')) === originalManifest;
    const installed = completeBackup ? packages.find(matchesActive) : undefined;
    if (values.adopt) {
      const source = realpathSync(values.adopt);
      if (!completeBackup || !matchesActive(source)) throw new Error('现有汉化和备份与所选安装包不匹配。');
      if (!installed) {
        const destination = join(mkdtempSync(join(versionDir, 'build-')), 'package');
        mkdirSync(destination);
        for (const file of ['manifest.tsv', 'patch.sh', 'native-sha256.txt']) {
          copyFileSync(join(source, file), join(destination, file));
        }
      }
      console.log('已登记现有汉化。一键恢复现已可用。');
      return;
    }
    if (installed) {
      if (action === 'restore') await patchInstallation(app, installed, action, values['no-launch']);
      else console.log('这份 Raycast 已安装并通过汉化校验。');
      return;
    }
    try {
      officialSignature(app);
    } catch (error) {
      throw new Error('当前应用未通过官方签名验证。请使用对应的恢复工具，或重新安装 Raycast 官方原版。', { cause: error });
    }
    if (action === 'restore') {
      console.log('当前 Raycast 已是官方原版。');
      return;
    }
    if (existsSync(backup)) {
      throw new Error('当前版本已有旧备份。请用原安装包恢复或备份归档后重试。备份位置：' + backup);
    }
    const packageDir = join(mkdtempSync(join(versionDir, 'build-')), 'package');
    console.log('正在校验并生成当前版本的汉化资源，可继续使用 Raycast，生成完成后会自动重启。');
    execFileSync(process.execPath, ['--max-old-space-size=4096', join(toolDir, 'cli.mjs'), 'build',
      '--app', app, '--out', packageDir], { stdio: 'inherit' });
    await patchInstallation(app, packageDir, action, values['no-launch']);
    console.log('汉化完成。以后可双击「恢复原版.command」还原。');
  } finally {
    rmdirSync(lock);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: 'string', default: '/Applications/Raycast.app' },
      'no-launch': { type: 'boolean' },
      adopt: { type: 'string' },
    },
  });
  const [action] = positionals;
  if (positionals.length !== 1 || !['install', 'restore'].includes(action) || (values.adopt && action !== 'install')) {
    throw new Error('用法：one-click.mjs install|restore [--app 应用路径] [--no-launch]');
  }
  await operate(action, values);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
