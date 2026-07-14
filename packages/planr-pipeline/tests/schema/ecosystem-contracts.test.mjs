import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const schema = (name) => readJson(`schemas/v1.1.0/${name}.schema.json`);

test('canonical adapter registry validates and names the three certified runtimes', () => {
  const registry = readJson('registry/adapters.json');
  assert.deepEqual(validate(registry, schema('adapter-registry')), []);
  assert.deepEqual(registry.adapters.map((adapter) => adapter.id), ['claude-code', 'codex', 'cursor']);
  for (const adapter of registry.adapters) {
    assert.equal(adapter.capabilities.artifactReview, true);
    assert.match(adapter.entrypoints.artifact, /(?:planr artifact|\$planr-artifact)/);
    assert.ok(adapter.healthChecks.includes('artifact-command-valid'));
  }
});

test('canonical role registry validates and contains exactly nine unique roles', () => {
  const registry = readJson('registry/roles.json');
  assert.deepEqual(validate(registry, schema('role-registry')), []);
  assert.equal(registry.roles.length, 9);
  assert.equal(new Set(registry.roles.map((role) => role.id)).size, 9);
  assert.equal(registry.roles.find((role) => role.id === 'entity-scaffold-agent').activation, 'manual');
});

test('runtime lock validates and rejects an unknown field', () => {
  const lock = {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-12T10:00:00Z',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
    protocolVersion: '1.1.0',
    components: { cli: '1.9.0', pipeline: '0.25.1', skills: '1.12.0' },
    adapters: [{ runtime: 'codex', version: '0.25.1', capabilityLevel: 'workflow', installScope: 'both' }]
  };
  assert.deepEqual(validate(lock, schema('runtime-lock')), []);
  assert.ok(validate({ ...lock, machinePath: '/tmp/private' }, schema('runtime-lock')).length > 0);
});

test('ecosystem manifest expresses independent versions and capability levels', () => {
  const manifest = {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-12T10:00:00Z',
    protocol: { current: '1.1.0', supported: ['1.0.x', '1.1.x'] },
    components: {
      cli: { version: '1.9.0', pipelineRange: '^0.25.1' },
      pipeline: { version: '0.25.1', cliRange: '^1.9.0' },
      skills: { version: '1.12.0', cliRange: '^1.9.0' },
      marketplace: { version: '1.0.0' }
    },
    adapters: [{ runtime: 'codex', version: '0.25.1', capabilityLevel: 'workflow', pipelineRange: '^0.25.1' }]
  };
  assert.deepEqual(validate(manifest, schema('ecosystem-manifest')), []);
});

test('provenance event validates without changing artifact frontmatter', () => {
  const event = {
    schema_version: '1.0.0',
    event_id: 'evt-1',
    timestamp: '2026-07-12T10:00:00Z',
    artifact_id: 'SPEC-001',
    artifact_path: '.planr/specs/SPEC-001-auth/SPEC-001-auth.md',
    operation: 'decomposed',
    producer: { product: 'planr-pipeline', version: '0.25.1', runtime: 'codex', phase: 'po' },
    run_id: 'run-1'
  };
  assert.deepEqual(validate(event, schema('provenance-event')), []);
  assert.ok(validate({ ...event, operation: 'guessed' }, schema('provenance-event')).length > 0);
});
