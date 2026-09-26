#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIAGRAM_GRAMMAR_REGISTRY } from '@openplanr/protocol/diagram-contracts';

import {
  createDiagramDocument,
  planDiagramQuality,
  selectDiagramReferences,
} from '../lib/artifact/diagram/index.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const unsupported = process.argv.slice(2).filter((argument) => argument !== '--check');
if (unsupported.length > 0) throw new Error(`Unsupported arguments: ${unsupported.join(', ')}`);

const OWNED_ROOTS = Object.freeze([
  'fixtures/diagram/grammars',
  'fixtures/diagram/primitives',
  'references/diagram',
  'gallery/diagram',
]);
const expected = new Map();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function add(path, bytes) {
  if (expected.has(path)) throw new Error(`Duplicate generated diagram asset: ${path}`);
  expected.set(path, bytes);
}

function exampleDocument(grammar) {
  const required = new Set(grammar.requiredPrimitives);
  const needsNodes =
    required.has('node') ||
    ['relation', 'group', 'lane', 'set', 'emphasis'].some((primitive) => required.has(primitive));
  const nodes = needsNodes
    ? [
        {
          id: 'item-a',
          label: `${grammar.title} A`,
          kind: 'primary-item',
          description: `First semantic item in the ${grammar.title.toLowerCase()} fixture.`,
          semanticPosition: ['quadrant', 'scatter', 'wardley'].includes(grammar.grammarId)
            ? {
                horizontal: 0.25,
                vertical: 0.7,
                meaning: 'Semantic placement on the declared axes.',
              }
            : null,
        },
        {
          id: 'item-b',
          label: `${grammar.title} B`,
          kind: 'secondary-item',
          description: `Second semantic item in the ${grammar.title.toLowerCase()} fixture.`,
          semanticPosition: ['quadrant', 'scatter', 'wardley'].includes(grammar.grammarId)
            ? {
                horizontal: 0.75,
                vertical: 0.3,
                meaning: 'Semantic placement on the declared axes.',
              }
            : null,
        },
      ]
    : [];
  const relations = required.has('relation')
    ? [
        {
          id: 'relation-a-b',
          from: 'item-a',
          to: 'item-b',
          kind: 'flow',
          label: 'continues',
          weight: null,
        },
      ]
    : [];
  const groups = required.has('group')
    ? [{ id: 'group-main', label: 'Primary group', members: ['item-a', 'item-b'] }]
    : [];
  const lanes = required.has('lane')
    ? [{ id: 'lane-main', label: 'Primary lane', members: ['item-a', 'item-b'] }]
    : [];
  const events = required.has('event')
    ? [
        { id: 'event-start', label: 'Start', order: 0, at: null },
        { id: 'event-finish', label: 'Finish', order: 1, at: null },
      ]
    : [];
  const series = required.has('series')
    ? [
        {
          id: 'series-main',
          label: 'Primary series',
          values: [
            { key: 'A', value: 3 },
            { key: 'B', value: 5 },
          ],
        },
      ]
    : [];
  const axes = required.has('axis')
    ? [
        { id: 'axis-horizontal', label: 'Horizontal meaning', scale: 'linear' },
        { id: 'axis-vertical', label: 'Vertical meaning', scale: 'linear' },
      ]
    : [];
  const sets = required.has('set')
    ? [
        { id: 'set-a', label: 'Set A', members: ['item-a'] },
        { id: 'set-b', label: 'Set B', members: ['item-b'] },
      ]
    : [];
  const readingOrder = [
    ...nodes.map(({ id }) => id),
    ...events.map(({ id }) => id),
    ...series.map(({ id }) => id),
    ...sets.map(({ id }) => id),
  ];
  return createDiagramDocument({
    diagramId: `${grammar.grammarId}-fixture`,
    title: `${grammar.title} fixture`,
    summary: `Canonical semantic fixture for the ${grammar.title.toLowerCase()} grammar.`,
    audience: 'mixed',
    grammar: { id: grammar.grammarId, version: grammar.grammarVersion },
    layout: { direction: grammar.directions[0], detailTier: 'simplified' },
    theme: { themeId: 'openplanr-default', mode: 'auto' },
    source: { format: 'english', path: null, digest: null },
    nodes,
    relations,
    groups,
    lanes,
    events,
    series,
    axes,
    sets,
    annotations: [],
    emphasis: [],
    accessibility: {
      title: `${grammar.title} fixture`,
      description: `A compact ${grammar.title.toLowerCase()} example with semantic reading order.`,
      readingOrder,
    },
  });
}

function grammarReference(grammar) {
  return (
    `# ${grammar.title}\n\n` +
    `- Grammar ID: \`${grammar.grammarId}\`\n` +
    `- Layout family: \`${grammar.layoutFamily}\`\n` +
    `- Required primitives: ${grammar.requiredPrimitives.map((value) => `\`${value}\``).join(', ')}\n` +
    `- Allowed primitives: ${grammar.allowedPrimitives.map((value) => `\`${value}\``).join(', ')}\n` +
    `- Directions: ${grammar.directions.map((value) => `\`${value}\``).join(', ')}\n` +
    `- Mermaid: \`${grammar.projections.mermaid}\`\n` +
    `- Excalidraw: \`${grammar.projections.excalidraw}\`\n\n` +
    `## Use this grammar\n\n${grammar.summary}\n\n` +
    `## Readability\n\n` +
    `Simplified ${grammar.detailLimits.simplified}; balanced ${grammar.detailLimits.balanced}; ` +
    `faithful ${grammar.detailLimits.faithful}; hard split threshold ${grammar.detailLimits.hard}. ` +
    `Labels stay within ${grammar.readability.maxLabelCharacters} characters, with at most ` +
    `${grammar.readability.maxCrossings} crossings and ${grammar.readability.maxFanIn} incoming relations per item.\n`
  );
}

const sharedReference =
  `# Shared diagram rules\n\n` +
  `1. Preserve semantic content in the canonical \`.planr-diagram.json\` document.\n` +
  `2. Never copy renderer coordinates, palettes, fonts, or automatic layout into canonical IR.\n` +
  `3. Use only primitives allowed by the selected grammar.\n` +
  `4. Keep SVG and HTML static, self-contained, accessible, and free of external URLs.\n` +
  `5. Return a named multi-panel split plan when a readability budget is exceeded.\n` +
  `6. Emit Mermaid or Excalidraw only with the fidelity declared by the grammar registry.\n`;
add('references/diagram/shared.md', sharedReference);

const grammarCards = [];
const grammarInventory = [];
for (const grammar of DIAGRAM_GRAMMAR_REGISTRY.grammars) {
  const fixture = exampleDocument(grammar);
  const fixtureBytes = json(fixture);
  const fixturePath = `fixtures/diagram/grammars/${grammar.grammarId}.planr-diagram.json`;
  const referencePath = `references/diagram/${grammar.grammarId}.md`;
  const referenceBytes = grammarReference(grammar);
  if (grammar.fixture !== fixturePath || grammar.reference !== referencePath) {
    throw new Error(
      `E_DIAGRAM_REFERENCE_CUSTODY_INVALID: ${grammar.grammarId} registry paths do not match generated custody.`,
    );
  }
  add(fixturePath, fixtureBytes);
  add(referencePath, referenceBytes);
  const quality = planDiagramQuality(fixture);
  if (quality.status !== 'pass')
    throw new Error(`Fixture ${grammar.grammarId} is not readable: ${quality.status}`);
  const references = selectDiagramReferences(grammar.grammarId);
  if (references.length !== 2 || references[1] !== grammar.reference) {
    throw new Error(
      `E_DIAGRAM_REFERENCE_CUSTODY_INVALID: ${grammar.grammarId} does not select one type reference.`,
    );
  }
  grammarInventory.push({
    grammarId: grammar.grammarId,
    fixture: { path: fixturePath, digest: sha256(fixtureBytes) },
    reference: { path: referencePath, digest: sha256(referenceBytes) },
    rendererContract: grammar.rendererContract,
    galleryCardId: `grammar-${grammar.grammarId}`,
  });
  grammarCards.push(
    `<article id="grammar-${escapeHtml(grammar.grammarId)}" data-search="${escapeHtml([grammar.grammarId, grammar.title, ...grammar.aliases].join(' ').toLowerCase())}"><h2>${escapeHtml(grammar.title)}</h2><p>${escapeHtml(grammar.summary)}</p><dl><dt>Layout</dt><dd>${escapeHtml(grammar.layoutFamily)}</dd><dt>Required</dt><dd>${escapeHtml(grammar.requiredPrimitives.join(', '))}</dd><dt>Mermaid</dt><dd>${escapeHtml(grammar.projections.mermaid)}</dd><dt>Excalidraw</dt><dd>${escapeHtml(grammar.projections.excalidraw)}</dd></dl></article>`,
  );
}

const primitiveGrammar = Object.freeze({
  node: 'flowchart',
  relation: 'flowchart',
  group: 'nested',
  lane: 'swimlane',
  event: 'timeline',
  series: 'bar',
  axis: 'bar',
  set: 'venn',
  annotation: 'architecture',
  emphasis: 'architecture',
});
const primitiveCards = [];
const primitiveInventory = [];
for (const primitive of DIAGRAM_GRAMMAR_REGISTRY.primitives) {
  const grammarId = primitiveGrammar[primitive];
  const value = {
    kind: 'diagram-primitive-fixture',
    schemaVersion: '1.0.0',
    primitive,
    grammarId,
    fixture: `fixtures/diagram/grammars/${grammarId}.planr-diagram.json`,
    description: `Canonical ${primitive} primitive example in the ${grammarId} grammar.`,
  };
  const path = `fixtures/diagram/primitives/${primitive}.json`;
  const bytes = json(value);
  add(path, bytes);
  primitiveInventory.push({
    primitive,
    grammarId,
    path,
    digest: sha256(bytes),
    galleryCardId: `primitive-${primitive}`,
  });
  primitiveCards.push(
    `<article id="primitive-${escapeHtml(primitive)}" data-search="${escapeHtml(`${primitive} ${grammarId}`)}"><h2>${escapeHtml(primitive)}</h2><p>${escapeHtml(value.description)}</p></article>`,
  );
}

const galleryShell = (title, summary, cards) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>\n:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1200px;margin:auto;padding:32px;background:#f7f6f2;color:#171717}header{margin-bottom:28px}.index{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.index a{color:inherit;border:1px solid #999;padding:6px 9px;text-decoration:none}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}article{background:#fff;color:#171717;border:1px solid #c9c7bf;padding:18px}h1,h2{line-height:1.15}h2{font-size:1.1rem}dt{font-weight:700}dd{margin:0 0 8px}@media(prefers-color-scheme:dark){body{background:#171717;color:#f7f6f2}article{background:#232323;color:#f7f6f2;border-color:#555}}\n</style>\n</head>\n<body>\n<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p><p>Use browser find to search the indexed card text. This gallery is static and script-free.</p></header>\n<nav class="index" aria-label="Card index">${cards.map((card) => `<a href="#${card.match(/id="([^"]+)/u)[1]}">${escapeHtml(card.match(/<h2>([^<]+)/u)[1])}</a>`).join('')}</nav>\n<main>${cards.join('\n')}</main>\n</body>\n</html>\n`;

add(
  'gallery/diagram/types.html',
  galleryShell(
    'OpenPlanr diagram grammar gallery',
    `${grammarCards.length} semantic visual grammars generated from Protocol 1.6.`,
    grammarCards,
  ),
);
add(
  'gallery/diagram/primitives.html',
  galleryShell(
    'OpenPlanr diagram primitive gallery',
    `${primitiveCards.length} canonical semantic primitive families.`,
    primitiveCards,
  ),
);
add(
  'gallery/diagram/inventory.json',
  json({
    kind: 'openplanr-diagram-gallery-inventory',
    schemaVersion: '1.0.0',
    grammarCount: grammarInventory.length,
    primitiveCount: primitiveInventory.length,
    grammars: grammarInventory,
    primitives: primitiveInventory,
  }),
);

function walk(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  if (lstatSync(directory).isSymbolicLink())
    throw new Error(`Generated diagram root is a symlink: ${directory}`);
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = join(directory, entry.name);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Generated diagram asset is a symlink: ${absolute}`);
    if (entry.isDirectory()) paths.push(...walk(absolute, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

const drift = [];
for (const [path, bytes] of expected) {
  const absolute = resolve(packageRoot, path);
  const containment = relative(packageRoot, absolute);
  if (containment.startsWith('..') || containment.split(sep).includes('..'))
    throw new Error(`Generated diagram path escapes package: ${path}`);
  if (
    !existsSync(absolute) ||
    lstatSync(absolute).isSymbolicLink() ||
    readFileSync(absolute, 'utf8') !== bytes
  )
    drift.push(path);
  if (!check) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
  }
}
for (const root of OWNED_ROOTS) {
  const absoluteRoot = resolve(packageRoot, root);
  for (const path of walk(absoluteRoot)) {
    const ownedPath = `${root}/${path}`;
    if (expected.has(ownedPath)) continue;
    drift.push(ownedPath);
    if (!check) unlinkSync(resolve(packageRoot, ownedPath));
  }
}

if (check && drift.length > 0) {
  throw new Error(
    `Diagram asset drift:\n${[...new Set(drift)]
      .sort()
      .map((path) => `- ${path}`)
      .join('\n')}`,
  );
}

process.stdout.write(
  `${check ? 'Checked' : 'Generated'} ${grammarInventory.length} grammar fixtures/references, ${primitiveInventory.length} primitive fixtures, and 2 static galleries.\n`,
);
