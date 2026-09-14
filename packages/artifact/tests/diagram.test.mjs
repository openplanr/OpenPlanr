import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  DIAGRAM_ERROR_CODES,
  DIAGRAM_GRAMMARS,
  DIAGRAM_PRIMITIVES,
  MAX_DIAGRAM_PRIMITIVE_ITEMS,
  assertDiagramDocument,
  createDiagramDocument,
  importMermaid,
  planDiagramQuality,
  routeDiagramIntent,
  selectDiagramReferences,
  validateDiagramSvg,
} from '../lib/artifact/diagram/index.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const loadFixture = (grammarId) => JSON.parse(readFileSync(
  join(packageRoot, 'fixtures', 'diagram', 'grammars', `${grammarId}.planr-diagram.json`),
  'utf8',
));

function expectDiagramError(action, code) {
  assert.throws(action, (error) => error?.name === 'DiagramError' && error.code === code);
}

test('all 39 grammar fixtures satisfy runtime semantic and readability contracts', () => {
  assert.equal(DIAGRAM_GRAMMARS.length, 39);
  for (const grammar of DIAGRAM_GRAMMARS) {
    const fixture = loadFixture(grammar.grammarId);
    assert.strictEqual(assertDiagramDocument(fixture), fixture);
    assert.equal(planDiagramQuality(fixture).status, 'pass', grammar.grammarId);
    assert.deepEqual(selectDiagramReferences(grammar.grammarId), [
      'references/diagram/shared.md',
      grammar.reference,
    ]);
  }
});

test('semantic validation reports typed grammar, reference, and schema failures', () => {
  const flowchart = loadFixture('flowchart');
  expectDiagramError(
    () => assertDiagramDocument({ ...flowchart, grammar: { id: 'unknown', version: '1.0.0' } }),
    DIAGRAM_ERROR_CODES.GRAMMAR_UNKNOWN,
  );
  expectDiagramError(
    () => assertDiagramDocument({ ...flowchart, nodes: flowchart.nodes.slice(0, 1) }),
    DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
  );
  expectDiagramError(
    () => assertDiagramDocument({ ...flowchart, unexpected: true }),
    DIAGRAM_ERROR_CODES.SCHEMA_INVALID,
  );
  expectDiagramError(
    () => assertDiagramDocument({
      ...flowchart,
      nodes: Array.from({ length: MAX_DIAGRAM_PRIMITIVE_ITEMS + 1 }, () => flowchart.nodes[0]),
    }),
    DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
  );

  const withoutOptionalPosition = createDiagramDocument({
    ...flowchart,
    documentDigest: undefined,
    nodes: flowchart.nodes.map(({ semanticPosition: _semanticPosition, ...node }) => node),
  });
  assert.equal(withoutOptionalPosition.grammar.id, 'flowchart');
});

test('intent routing covers every registered grammar and keeps ambiguity explicit', () => {
  for (const grammar of DIAGRAM_GRAMMARS) {
    assert.equal(routeDiagramIntent({ intent: grammar.title }).grammarId, grammar.grammarId);
  }
  assert.equal(routeDiagramIntent({ intent: 'show the customer journey' }).grammarId, 'user-journey');
  expectDiagramError(
    () => routeDiagramIntent({ intent: 'show information' }),
    DIAGRAM_ERROR_CODES.GRAMMAR_AMBIGUOUS,
  );
});

test('readability produces a stable multi-panel plan instead of shrinking content', () => {
  const base = loadFixture('architecture');
  const nodes = Array.from({ length: 9 }, (_, index) => ({
    id: `item-${index + 1}`,
    label: `Architecture item ${index + 1}`,
    kind: 'component',
    description: null,
    semanticPosition: null,
  }));
  const document = createDiagramDocument({
    ...base,
    documentDigest: undefined,
    diagramId: 'large-architecture',
    nodes,
    relations: [],
    accessibility: { ...base.accessibility, readingOrder: nodes.map(({ id }) => id) },
  });
  const first = planDiagramQuality(document);
  const second = planDiagramQuality(document);
  assert.equal(first.status, 'split-required');
  assert.ok(first.splitPlan.panels.length >= 2);
  assert.deepEqual(first.splitPlan, second.splitPlan);
  assert.equal(planDiagramQuality(base, { crossings: 999 }).status, 'warning');
});

test('bounded Mermaid import preserves semantics and reports unsupported lines', () => {
  const imported = importMermaid(`flowchart LR
    A[Collect context] -->|then| B{Decision}
    classDef hidden fill:#fff`);
  assert.equal(imported.document.nodes.length, 2);
  assert.equal(imported.document.relations.length, 1);
  assert.equal(imported.document.layout.direction, 'left-right');
  assert.equal(imported.fidelity.status, 'partial');
  assert.equal(imported.fidelity.omitted.length, 1);
  assert.equal('x' in imported.document.nodes[0], false);
});

test('SVG checks enforce a static accessible rendering boundary', () => {
  const valid = '<svg role="img" viewBox="0 0 200 100" aria-labelledby="title desc"><title id="title">Flow</title><desc id="desc">A two-step flow.</desc><text font-size="14">Start</text></svg>';
  assert.equal(validateDiagramSvg(valid).ok, true);
  const invalid = '<svg><script>alert(1)</script><text font-size="8">Unreadable</text></svg>';
  const result = validateDiagramSvg(invalid, { foreground: '#777777', background: '#777777', clipped: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('external-or-executable-resource'));
  assert.ok(result.errors.includes('text-below-12px'));
  assert.ok(result.errors.includes('contrast-below-aa'));
  assert.ok(result.errors.includes('clipped-content'));
});

test('generated gallery inventory accounts for every grammar and primitive without scripts or remote assets', () => {
  const inventory = JSON.parse(readFileSync(join(packageRoot, 'gallery', 'diagram', 'inventory.json'), 'utf8'));
  assert.equal(inventory.grammarCount, 39);
  assert.equal(inventory.primitiveCount, DIAGRAM_PRIMITIVES.length);
  assert.deepEqual(inventory.grammars.map(({ grammarId }) => grammarId), DIAGRAM_GRAMMARS.map(({ grammarId }) => grammarId));
  for (const file of ['types.html', 'primitives.html']) {
    const html = readFileSync(join(packageRoot, 'gallery', 'diagram', file), 'utf8');
    assert.doesNotMatch(html, /<script\b|(?:href|src)=["'](?:https?:|\/\/)/iu, file);
  }
});
