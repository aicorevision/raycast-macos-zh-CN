import assert from 'node:assert/strict';
import test from 'node:test';
import { translateFrontend } from './transform.mjs';

const terms = {
  Store: { zh: '商店', props: ['title', 'children'] },
  'Search for apps or commands…': { zh: '搜索应用或命令…', props: ['placeholder'] },
};
const store = { 'Picks colors': '取色', 'Pick Color': '选取颜色' };

test('translates reviewed display properties without changing ids, paths or object keys', () => {
  const src = 'const command={id:"Store",title:"Store",href:"Store",Store:"Store"};';
  const { output } = translateFrontend(src, 'settings-window-123.js', terms, {});
  assert.equal(output, 'const command={id:"Store",title:"商店",href:"Store",Store:"Store"};');
});

test('preserves fallback condition, callbacks and interpolation', () => {
  const src = 'view({children:[locked?"Store":unknown,`Store ${id}`],onClick:()=>open("Store")});';
  const { output } = translateFrontend(src, 'any.js', terms, {});
  assert.equal(output, 'view({children:[locked?"商店":unknown,`Store ${id}`],onClick:()=>open("Store")});');
});

test('recognizes the root search placeholder in the main page only', () => {
  const source = 'const value="Search for apps or commands…";';
  assert.match(translateFrontend(source, 'main-window-123.js', terms, {}).output, /搜索应用或命令/);
  assert.equal(translateFrontend(source, 'settings-window-123.js', terms, {}).output, source);
});

test('maps live store descriptions only at recognized view render sites', () => {
  const src = 'function A({store:e}){search(e.extension.description);return view({children:e.extension.description});}A.displayName="SearchStoreListItem";';
  const { output, counts } = translateFrontend(src, 'main-window-123.js', terms, store);
  assert.equal(counts.storeDescription, 1);
  assert.match(output, /search\(e\.extension\.description\)/);
  assert.match(output, /children:__raycastZhStoreText\(e\.extension\.description\)/);
  assert.match(output, /"Picks colors":"取色"/);
});

test('skips store injections when a newer layout makes the match ambiguous', () => {
  const src = 'function A({store:e}){return view({children:e.extension.description},{children:e.extension.description});}A.displayName="SearchStoreListItem";';
  const { output, counts } = translateFrontend(src, 'main-window-123.js', terms, store);
  assert.equal(counts.storeDescription, 0);
  assert.equal(output, src);
});

test('inventories new user-facing literals without changing them', () => {
  const src = 'form({id:"new-setting",label:"Suggested Hotkeys",tooltip:"https://example.com"});';
  const { output, candidates } = translateFrontend(src, 'settings-window-123.js', terms, {});
  assert.equal(output, src);
  assert.deepEqual(candidates, [{ key: 'label', text: 'Suggested Hotkeys' }]);
});
