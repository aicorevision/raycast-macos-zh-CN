import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { translateFrontend } from './transform.mjs';

export const hash = content => createHash('sha256').update(content).digest('hex');

export function reviewTerms(seed, reviewed) {
  const terms = { ...seed };
  for (const [english, entry] of Object.entries(reviewed)) {
    if (!entry.zh || !entry.props?.length) throw new Error('译文或显示属性缺失：' + english);
    terms[english] = { ...entry, props: [...new Set([...(seed[english]?.props ?? []), ...entry.props])] };
  }
  return terms;
}

export function scan(installation, terms, storeTerms, keepPayload) {
  const files = {};
  const payload = [];
  const matches = new Map();
  const totals = { static: 0, rootPlaceholder: 0, storeDescription: 0 };
  const names = readdirSync(installation.frontend, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name).sort();
  for (const name of names) {
    const path = join(installation.frontend, name);
    const original = readFileSync(path);
    const content = original.toString('utf8');
    const result = translateFrontend(content, name, terms, storeTerms);
    const { counts, candidates } = result;
    for (const key of Object.keys(totals)) totals[key] += counts[key];
    for (const [term, count] of result.matches) matches.set(term, (matches.get(term) ?? 0) + count);
    if (counts.static || counts.rootPlaceholder || counts.storeDescription || candidates.length) {
      files[name] = { ...counts, candidates };
    }
    if (keepPayload && result.output !== content) {
      payload.push({
        rel: relative(installation.app, path),
        original: hash(original),
        output: result.output,
      });
    }
  }
  return { files, payload, totals, matches };
}

export function novelty(files, baselineFiles) {
  const key = ({ key, text }) => key + '\t' + text;
  const existing = new Set(Object.values(baselineFiles).flatMap(file => file.candidates.map(key)));
  return Object.fromEntries(Object.entries(files)
    .map(([file, data]) => [file, data.candidates.filter(entry => !existing.has(key(entry)))])
    .filter(([, candidates]) => candidates.length));
}
