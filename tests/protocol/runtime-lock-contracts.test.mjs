import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';

const lock = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-10-04T10:00:00Z',
  manifestDigest: `sha256:${'a'.repeat(64)}`,
  protocolVersion: '1.4.0',
  components: { cli: '2.2640.7', pipeline: '0.55.8', skills: '2.2640.7' },
  adapters: [
    { runtime: 'codex', version: '0.44.0', capabilityLevel: 'workflow', installScope: 'both' },
  ],
};
const validate = (value) =>
  validateProtocolArtifact('runtime-lock', value, { protocolVersion: '1.18.0' });

test('runtime-lock successor accepts recorded discovery modes without changing adapter compatibility', () => {
  assert.equal(
    resolveProtocolSchema('runtime-lock', { protocolVersion: '1.18.0' }).path,
    'schemas/v1.18.0/runtime-lock.schema.json',
  );
  for (const codex of ['direct', 'unified-plugin', 'project-rule']) {
    const value = {
      ...lock,
      skillModes: { 'claude-code': 'unified-plugin', codex, cursor: 'project-rule' },
    };
    assert.deepEqual(validate(value), []);
    assert.deepEqual(validateProtocolArtifact('runtime-lock', value), []);
    assert.equal(value.protocolVersion, '1.4.0');
  }
});

test('legacy runtime locks remain readable and the frozen contract remains unchanged', () => {
  assert.deepEqual(validate(lock), []);
  assert.deepEqual(validateProtocolArtifact('runtime-lock', lock), []);
  assert.deepEqual(
    validateProtocolArtifact('runtime-lock', lock, { protocolVersion: '1.1.0' }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'runtime-lock',
      { ...lock, skillModes: { codex: 'direct' } },
      { protocolVersion: '1.1.0' },
    ).some(({ rule }) => rule === 'additionalProperties'),
  );
});

test('runtime locks reject unsupported discovery modes, runtime keys and unrelated fields', () => {
  for (const skillModes of [
    { codex: 'plugin' },
    { codex: 1 },
    { 'claude-code': 'direct' },
    { cursor: 'unified-plugin' },
    { unknown: 'direct' },
    null,
    [],
  ]) {
    assert.ok(validate({ ...lock, skillModes }).length > 0, JSON.stringify(skillModes));
    assert.ok(
      validateProtocolArtifact('runtime-lock', { ...lock, skillModes }).length > 0,
      JSON.stringify(skillModes),
    );
  }
  assert.ok(validate({ ...lock, machinePath: '/tmp/private' }).length > 0);
});
