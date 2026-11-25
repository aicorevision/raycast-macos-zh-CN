import { parse } from 'acorn';

const displayKeys = new Set([
  'actionBarText', 'aria-description', 'aria-label', 'buttonText', 'caption',
  'children', 'commandsTitle', 'description', 'detail', 'emptyMessage',
  'emptyTitle', 'footer', 'helpText', 'hint', 'label', 'message',
  'navigationTitle', 'placeholder', 'primaryActionLabel', 'prompt',
  'searchPlaceholder', 'secondaryLabel', 'sectionTitle', 'subtitle', 'text',
  'title', 'tooltip', 'triggerLabel',
]);
const rootPlaceholder = 'Search for apps or commands…';
const storeListView = 'SearchStoreListItem';
const storeDetailView = 'SearchStoreDetailView';

export function* walk(root) {
  const queue = [root];
  while (queue.length) {
    const node = queue.pop();
    yield node;
    for (const field of Object.values(node)) {
      if (Array.isArray(field)) {
        for (const child of field) {
          if (child?.type) queue.push(child);
        }
      } else if (field?.type) {
        queue.push(field);
      }
    }
  }
}

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
}

function* displayValues(node) {
  if (!node) return;
  if (literal(node) !== undefined) yield node;
  if (node.type === 'ConditionalExpression') {
    yield* displayValues(node.consequent);
    yield* displayValues(node.alternate);
  }
  if (node.type === 'ArrayExpression') {
    for (const element of node.elements) yield* displayValues(element);
  }
}

function property(node, key) {
  if (node?.type !== 'ObjectExpression') return;
  return node.properties.find(item => item.type === 'Property'
    && !item.computed && (item.key.name ?? item.key.value) === key)?.value;
}

function memberName(node) {
  if (node?.type === 'MemberExpression' && !node.computed) return node.property.name;
}

function collectStoreSites(viewIds, definitions) {
  const list = definitions.get(viewIds.get(storeListView));
  const details = definitions.get(viewIds.get(storeDetailView));
  const listDescriptions = [];
  const detailDescriptions = [];
  const commandTitles = [];
  for (const node of list ? walk(list.body) : []) {
    const children = property(node, 'children');
    if (memberName(children) === 'description' && memberName(children.object) === 'extension') {
      listDescriptions.push(children);
    }
  }
  for (const node of details ? walk(details.body) : []) {
    const children = property(node, 'children');
    const className = property(node, 'className');
    if (className && memberName(children) === 'description') detailDescriptions.push(children);
    if (memberName(className) !== 'commandHeader' || children?.type !== 'ArrayExpression') continue;
    commandTitles.push(...children.elements.filter(element => memberName(element) === 'title'));
  }
  return [
    ...(listDescriptions.length === 1 ? listDescriptions : []),
    ...(detailDescriptions.length === 2 && commandTitles.length === 1 ? [...detailDescriptions, ...commandTitles] : []),
  ];
}

function isCandidate(text) {
  return text.length >= 4 && text.length <= 300
    && /^[A-Za-z0-9][^<>{}]*$/u.test(text)
    && /[A-Za-z]{3}/u.test(text)
    && !/^(?:https?:|data:|file:)|^[a-z0-9]+(?:[._/-][a-z0-9]+)+$/u.test(text);
}

export function translateFrontend(source, filename, terms, storeTerms) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = new Map();
  const candidates = new Map();
  const matches = new Map();
  const viewIds = new Map();
  const definitions = new Map();
  const rootSites = [];
  const isMain = /^main-window-.*\.js$/u.test(filename);
  const counts = { static: 0, rootPlaceholder: 0, storeDescription: 0 };

  for (const node of walk(ast)) {
    if (node.type === 'Property' && !node.computed) {
      const key = node.key.name ?? node.key.value;
      if (displayKeys.has(key)) {
        for (const value of displayValues(node.value)) {
          const text = literal(value);
          const entry = Object.hasOwn(terms, text) ? terms[text] : undefined;
          if (entry?.props.includes(key)) {
            if (entry.zh === text) continue;
            edits.set(value.start, { node: value, replacement: JSON.stringify(entry.zh) });
            matches.set(text, (matches.get(text) ?? 0) + 1);
            counts.static++;
          } else if (isCandidate(text)) {
            candidates.set(key + '\t' + text, { key, text });
          }
        }
      }
    }
    if (!isMain) continue;
    if (node.type === 'VariableDeclarator' && literal(node.init) === rootPlaceholder) {
      rootSites.push(node.init);
    }
    if (node.type === 'FunctionDeclaration' && node.id) definitions.set(node.id.name, node);
    if (node.type === 'AssignmentExpression' && memberName(node.left) === 'displayName'
        && node.left.object.type === 'Identifier') {
      const name = literal(node.right);
      if (name === storeListView || name === storeDetailView) {
        viewIds.set(name, viewIds.has(name) ? null : node.left.object.name);
      }
    }
  }

  if (rootSites.length === 1 && Object.hasOwn(terms, rootPlaceholder)) {
    const node = rootSites[0];
    edits.set(node.start, { node, replacement: JSON.stringify(terms[rootPlaceholder].zh) });
    counts.rootPlaceholder = 1;
    matches.set(rootPlaceholder, (matches.get(rootPlaceholder) ?? 0) + 1);
  }
  if (isMain && Object.keys(storeTerms).length && !source.includes('__raycastZhStoreText')) {
    for (const node of collectStoreSites(viewIds, definitions)) {
      const original = source.slice(node.start, node.end);
      edits.set(node.start, { node, replacement: '__raycastZhStoreText(' + original + ')' });
      counts.storeDescription++;
    }
  }

  let output = '';
  let offset = 0;
  for (const { node, replacement } of [...edits.values()].sort((a, b) => a.node.start - b.node.start)) {
    if (offset > node.start) throw new Error('Overlapping edits in ' + filename);
    output += source.slice(offset, node.start) + replacement;
    offset = node.end;
  }
  output += source.slice(offset);
  if (counts.storeDescription > 0) {
    output += '\nfunction __raycastZhStoreText(text) {'
      + ' if (typeof text !== "string") return text;'
      + ' const table = __raycastZhStoreText.table ??= new Map('
      + 'Object.entries(' + JSON.stringify(storeTerms) + '));'
      + ' return table.get(text) ?? table.get(text.trim()) ?? text; }\n';
  }
  if (edits.size) parse(output, { ecmaVersion: 'latest', sourceType: 'module' });
  return { output, counts, candidates: [...candidates.values()], matches };
}
