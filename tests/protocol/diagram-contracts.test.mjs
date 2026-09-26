import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifyDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import {
  DIAGRAM_CONTRACT_FILES,
  DIAGRAM_GRAMMAR_REGISTRY,
  DIAGRAM_SEMANTIC_PATTERN_REGISTRY,
  diagramContractUrl,
  diagramDocumentPath,
  getDiagramGrammar,
} from '../../packages/protocol/src/diagram-contracts.mjs';
import {
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const protocol = join(root, 'packages', 'protocol');
const artifact = join(root, 'packages', 'artifact');

test('Protocol 1.6 exposes the complete closed diagram contract family', () => {
  assert.deepEqual(Object.keys(DIAGRAM_CONTRACT_FILES).sort(), [
    'diagram-consumer-reference',
    'diagram-document',
    'diagram-fidelity-report',
    'diagram-manifest',
    'diagram-quality-report',
    'diagram-review-binding',
    'diagram-semantic-pattern-registry',
    'diagram-type-registry',
  ]);
  for (const [kind, file] of Object.entries(DIAGRAM_CONTRACT_FILES)) {
    const schema = JSON.parse(readFileSync(join(protocol, 'schemas', 'v1.6.0', file), 'utf8'));
    assert.equal(schema['x-openplanr-contract'].id, kind);
    assert.equal(schema['x-openplanr-contract'].version, '1.6.0');
    assert.equal(schema.additionalProperties, false);
    assert.equal(diagramContractUrl(kind).protocol, 'file:');
  }
  assert.equal(
    diagramDocumentPath('system-context'),
    'diagrams/system-context/system-context.planr-diagram.json',
  );
  assert.throws(() => diagramDocumentPath('../system-context'), TypeError);
});

test('diagram grammar and semantic-pattern registries are complete and self-validating', () => {
  assert.equal(DIAGRAM_GRAMMAR_REGISTRY.grammars.length, 39);
  assert.equal(
    new Set(DIAGRAM_GRAMMAR_REGISTRY.grammars.map(({ grammarId }) => grammarId)).size,
    39,
  );
  assert.equal(DIAGRAM_GRAMMAR_REGISTRY.primitives.length, 10);
  assert.equal(DIAGRAM_GRAMMAR_REGISTRY.layoutFamilies.length, 10);
  assert.equal(DIAGRAM_SEMANTIC_PATTERN_REGISTRY.patterns.length, 7);
  assert.equal(verifyDocumentDigest(DIAGRAM_GRAMMAR_REGISTRY), true);
  assert.equal(verifyDocumentDigest(DIAGRAM_SEMANTIC_PATTERN_REGISTRY), true);
  assert.deepEqual(
    validateProtocolArtifact('diagram-type-registry', DIAGRAM_GRAMMAR_REGISTRY, {
      protocolVersion: '1.6.0',
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact(
      'diagram-semantic-pattern-registry',
      DIAGRAM_SEMANTIC_PATTERN_REGISTRY,
      { protocolVersion: '1.6.0' },
    ),
    [],
  );
  for (const grammar of DIAGRAM_GRAMMAR_REGISTRY.grammars) {
    assert.strictEqual(getDiagramGrammar(grammar.grammarId), grammar);
    assert.ok(
      grammar.requiredPrimitives.every((primitive) =>
        grammar.allowedPrimitives.includes(primitive),
      ),
    );
    assert.match(grammar.fixture, new RegExp(`/${grammar.grammarId}\\.planr-diagram\\.json$`, 'u'));
    assert.match(grammar.reference, new RegExp(`/${grammar.grammarId}\\.md$`, 'u'));
  }
});

test('every generated grammar fixture is a valid canonical diagram document', () => {
  for (const grammar of DIAGRAM_GRAMMAR_REGISTRY.grammars) {
    const document = JSON.parse(readFileSync(join(artifact, grammar.fixture), 'utf8'));
    assert.equal(document.grammar.id, grammar.grammarId);
    assert.equal(verifyDocumentDigest(document), true, grammar.grammarId);
    assert.deepEqual(
      validateProtocolArtifact('diagram-document', document, { protocolVersion: '1.6.0' }),
      [],
      grammar.grammarId,
    );
  }
});

test('canonical diagram schema rejects renderer geometry and undeclared fields', () => {
  const fixture = JSON.parse(
    readFileSync(
      join(artifact, 'fixtures', 'diagram', 'grammars', 'flowchart.planr-diagram.json'),
      'utf8',
    ),
  );
  const rendererOwned = {
    ...fixture,
    nodes: fixture.nodes.map((node, index) => (index === 0 ? { ...node, x: 20 } : node)),
  };
  assert.ok(
    validateProtocolArtifact('diagram-document', rendererOwned, { protocolVersion: '1.6.0' }).some(
      ({ rule }) => rule === 'additionalProperties',
    ),
  );
});

test('diagram authoring requires an explicit additive version and preserves legacy lookup', () => {
  const legacy = diagramContractUrl('diagram-document');
  const authoring = diagramContractUrl('diagram-document', { protocolVersion: '1.13.0' });
  assert.match(legacy.pathname, /schemas\/v1\.6\.0\/diagram-document\.schema\.json$/u);
  assert.match(authoring.pathname, /schemas\/v1\.13\.0\/diagram-document\.schema\.json$/u);
  assert.equal(
    resolveProtocolSchema('diagram-document', { protocolVersion: '1.6.0' }).schema.$id,
    JSON.parse(readFileSync(legacy, 'utf8')).$id,
  );
  assert.equal(
    resolveProtocolSchema('diagram-document', { protocolVersion: '1.13.0' }).schema.$id,
    JSON.parse(readFileSync(authoring, 'utf8')).$id,
  );
  assert.throws(
    () => diagramContractUrl('diagram-document', { protocolVersion: '9.0.0' }),
    RangeError,
  );
  assert.throws(() => diagramContractUrl('__proto__', { protocolVersion: '1.13.0' }), RangeError);
});
