import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveOperateExperienceSchemaV2,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';

test('public schema resolvers return independent mutable copies', () => {
  const first = resolveProtocolSchema('story', { protocolVersion: '1.0.0' });
  const second = resolveProtocolSchema('story', { protocolVersion: '1.0.0' });
  assert.notEqual(first.schema, second.schema);
  assert.deepEqual(first.schema, second.schema);
  assert.equal(Object.isFrozen(first.schema), false);
  assert.equal(Object.isFrozen(first.schema.properties), false);

  const view = resolveOperateExperienceSchemaV2('operate-experience-view', {
    protocolVersion: '2.0.0',
  });
  assert.equal(Object.isFrozen(view.schema), false);
  assert.notEqual(
    view.schema,
    resolveOperateExperienceSchemaV2('operate-experience-view', { protocolVersion: '2.0.0' })
      .schema,
  );
});

test('validation reads a shared schema that caller copies cannot alter', () => {
  const before = validateProtocolArtifact('story', {}, { protocolVersion: '1.0.0' });
  assert.ok(before.some(({ rule }) => rule === 'required'));

  const copy = resolveProtocolSchema('story', { protocolVersion: '1.0.0' });
  copy.schema.required = [];
  copy.schema.properties.id.type = 'integer';
  delete copy.schema.additionalProperties;

  assert.deepEqual(validateProtocolArtifact('story', {}, { protocolVersion: '1.0.0' }), before);
  assert.ok(
    validateProtocolArtifact('story', { id: 1, zz: true }, { protocolVersion: '1.0.0' }).some(
      ({ rule }) => rule === 'additionalProperties',
    ),
  );
});

test('external $ref validation is stable across repeated runs of the cached schema', () => {
  const value = { questions: [{}] };
  const first = validateProtocolArtifact('guided-questionnaire', value, {
    protocolVersion: '1.2.0',
  });
  assert.ok(
    first.some(
      ({ path, rule, detail }) =>
        path === '$.questions[0]' && rule === 'required' && detail.includes('questionId'),
    ),
  );
  for (let run = 0; run < 3; run += 1) {
    assert.deepEqual(
      validateProtocolArtifact('guided-questionnaire', value, { protocolVersion: '1.2.0' }),
      first,
    );
  }
});
