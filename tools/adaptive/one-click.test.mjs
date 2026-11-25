import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManifest } from './one-click.mjs';

const before = 'a'.repeat(64);
const after = 'b'.repeat(64);

test('reads the checksums and paths needed to detect an already installed patch', () => {
  const path = 'Contents/Resources/frontend/main-window.js';
  assert.deepEqual(parseManifest([before, after, path].join('\t') + '\n'), [
    { original: before, translated: after, path },
  ]);
});

test('rejects manifest paths outside app resources and duplicate paths', () => {
  const entry = path => [before, after, path].join('\t') + '\n';
  assert.throws(() => parseManifest(entry('Contents/Resources/../MacOS/Raycast')));
  assert.throws(() => parseManifest(entry('Contents/MacOS/Raycast')));
  assert.throws(() => parseManifest(entry('/Contents/Resources/file')));
  assert.throws(() => parseManifest(entry('Contents/Resources/file').repeat(2)));
});
