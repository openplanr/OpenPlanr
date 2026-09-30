import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PROTOCOL_V115_CONTRACTS,
  protocolAssetUrl,
  validateDiagramReviewArtifact,
} from '../../packages/protocol/src/browser-contracts.mjs';
import {
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import { DIAGRAM_REVIEW_SCHEMAS } from '../../packages/protocol/src/diagram-review-contracts.mjs';
import { evaluateReviewCases, reviewContractFixtures } from './fixtures/diagram-review.mjs';

test('six native review contracts resolve and list at exact Protocol 1.15 while older diagram dispatch stays frozen', () => {
  assert.equal(Object.keys(PROTOCOL_V115_CONTRACTS).length, 6);
  const fixtures = reviewContractFixtures();
  for (const kind of Object.keys(PROTOCOL_V115_CONTRACTS)) {
    const expectedPath = `schemas/v1.15.0/${kind}.schema.json`;
    const resolved = resolveProtocolSchema(kind, { protocolVersion: '1.15.0' });
    assert.equal(resolved.path, expectedPath);
    assert.deepEqual(resolved.schema, DIAGRAM_REVIEW_SCHEMAS[kind]);
    assert.ok(
      listProtocolSchemas().some(
        (row) => row.kind === kind && row.protocolVersion === '1.15.0' && row.path === expectedPath,
      ),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(protocolAssetUrl(kind, { protocolVersion: '1.15.0' }), 'utf8')),
      resolved.schema,
    );
    assert.deepEqual(
      validateProtocolArtifact(kind, fixtures[kind], { protocolVersion: '1.15.0' }),
      [],
    );
    assert.throws(() => resolveProtocolSchema(kind, { protocolVersion: '1.15.1' }), {
      code: 'E_SCHEMA_VERSION_UNSUPPORTED',
    });
    assert.throws(
      () => validateProtocolArtifact(kind, fixtures[kind], { protocolVersion: '1.13.0' }),
      { code: 'E_SCHEMA_VERSION_UNSUPPORTED' },
    );
  }
  assert.equal(
    resolveProtocolSchema('diagram-document', { protocolVersion: '1.6.0' }).path,
    'schemas/v1.6.0/diagram-document.schema.json',
  );
  assert.throws(() => resolveProtocolSchema('diagram-document', { protocolVersion: '1.15.0' }), {
    code: 'E_SCHEMA_VERSION_UNSUPPORTED',
  });
  assert.throws(() => protocolAssetUrl('constructor', { protocolVersion: '1.15.0' }), RangeError);
  assert.throws(
    () => validateDiagramReviewArtifact('diagram-review-bundle', {}, { protocolVersion: '1.15.1' }),
    RangeError,
  );
});

test('generic review validation retains semantic custody checks and rejects accessors without invoking them', () => {
  const dedicated = evaluateReviewCases(),
    generic = evaluateReviewCases(validateProtocolArtifact);
  assert.deepEqual(generic, dedicated);
  for (const result of generic) {
    assert.equal(result.valid, result.expectedValid, result.name);
    assert.equal(result.unchanged, true, result.name);
    assert.equal(result.getterReads, 0, result.name);
    assert.ok(
      result.issues.every((issue) => issue.path === '$' && issue.rule && issue.detail),
      result.name,
    );
  }
});
