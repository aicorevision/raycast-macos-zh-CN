import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hash, novelty, reviewTerms, scan } from './frontend-inventory.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const commandDirectory = process.env.INIT_CWD || process.cwd();
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const packageName = 'Raycast.Raycast';
const packageFamily = 'Raycast.Raycast_qypenmj9wpt2a';

function inspectApp() {
  const query = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    ConvertTo-Json -Compress -InputObject @(Get-AppxPackage -Name Raycast.Raycast |
      Select-Object Name, Version, InstallLocation, PackageFamilyName,
        @{n='Arch';e={$_.Architecture.ToString()}}, @{n='Signature';e={$_.SignatureKind.ToString()}})
  `;
  const packages = JSON.parse(execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' }));
  const supported = packages.filter(item => item.Name === packageName
    && item.PackageFamilyName === packageFamily && item.Signature === 'Store'
    && item.Arch === 'X64' && /^\d+(?:\.\d+){3}$/u.test(item.Version));
  if (supported.length !== 1) throw new Error('请先安装 Microsoft Store 的 Raycast x64。');
  const item = supported[0];
  const app = realpathSync(item.InstallLocation);
  const version = item.Version;
  const frontend = join(app, 'Raycast', 'frontend');
  const hostSha256 = hash(readFileSync(join(app, 'Raycast', 'Raycast.dll')));
  return { app, frontend, version, architecture: 'x64', hostSha256 };
}

function checkedOutput(value, installation) {
  const defaultOut = join(toolDirectory, 'out', 'windows-x64-' + installation.version + '-inventory');
  const out = value ? resolve(commandDirectory, value) : defaultOut;
  const parent = dirname(out);
  let ancestor = parent;
  while (true) {
    try {
      const fromApp = relative(installation.app, realpathSync(ancestor));
      if (!fromApp || (!isAbsolute(fromApp) && fromApp !== '..' && !fromApp.startsWith('..' + sep))) {
        throw new Error('清单目录必须位于 Raycast 安装目录之外。');
      }
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(ancestor);
      if (next === ancestor) throw error;
      ancestor = next;
    }
  }
  mkdirSync(parent, { recursive: true });
  mkdirSync(out);
  return out;
}

function main() {
  const { values } = parseArgs({
    options: {
      'baseline-report': { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (process.platform !== 'win32') throw new Error('请在安装了 Raycast x64 的 Windows 上运行。');
  const installation = inspectApp();
  const { version, architecture, hostSha256 } = installation;
  const { 'baseline-report': baselinePath } = values;
  const baseline = baselinePath ? readJson(resolve(commandDirectory, baselinePath)) : undefined;
  if (baseline && (baseline.platform !== 'windows' || baseline.architecture !== architecture || !baseline.files)) {
    throw new Error('请提供同架构的 Windows 清单作为对照。');
  }
  const reviewed = readJson(join(toolDirectory, 'reviewed-display.json'));
  const windows = readJson(join(toolDirectory, 'reviewed-windows-display.json'));
  const terms = reviewTerms(reviewTerms(readJson(join(toolDirectory, 'seed-display.json')), reviewed), windows);
  const storeTerms = {
    ...readJson(join(toolDirectory, 'seed-store.json')),
    ...readJson(join(toolDirectory, 'reviewed-store.json')),
  };
  const { files, payload, totals, matches } = scan(installation, terms, storeTerms, true);
  const verified = readJson(join(toolDirectory, 'windows-validation.json')).find(result =>
    result.version === version && result.architecture === architecture && result.hostSha256 === hostSha256);
  const runtime = verified ? { status: verified.status, reason: verified.reason } : { status: 'unverified' };
  const targets = payload.map(({ rel, original, output }) => ({
    path: rel.split(sep).join('/'), originalSha256: original, translatedSha256: hash(output),
  }));
  const reviewCoverage = Object.fromEntries(Object.keys({ ...reviewed, ...windows }).map(term => [term, matches.get(term) ?? 0]));
  const out = checkedOutput(values.out, installation);
  writeFileSync(join(out, 'inventory.json'), JSON.stringify({
    platform: 'windows', version, architecture, hostSha256, runtime, totals, reviewCoverage, targets, files,
    baseline: baseline?.version, newSinceBaseline: baseline ? novelty(files, baseline.files) : undefined,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ version, architecture, runtime, totals, files: targets.length, out }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
