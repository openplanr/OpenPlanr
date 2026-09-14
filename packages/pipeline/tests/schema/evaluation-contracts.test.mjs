import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { EVALUATION_CONTRACT_KINDS_V1, loadEvaluationContract, listProtocolSchemas } from '../../lib/protocol/loader.mjs';

const PROTOCOL_VERSION = '1.4.0';
const SCHEMA_VERSION = '1.0.0';
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$';

/**
 * Applicator keywords whose subschemas refine an already-closed record.
 * Closing them would forbid every field the parent legitimately declares, so the
 * closure and pattern guards below walk structural positions only.
 */
const APPLICATORS = Object.freeze(['allOf', 'if', 'then', 'else', 'not', 'contains']);

const schemaOf = (kind) => JSON.parse(readFileSync(
  new URL(`../../schemas/v${PROTOCOL_VERSION}/${kind}.schema.json`, import.meta.url),
  'utf8',
));
const registryOf = (name) => JSON.parse(readFileSync(
  new URL(`../../registry/${name}.json`, import.meta.url),
  'utf8',
));

function walkStructural(node, path, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walkStructural(entry, `${path}[${index}]`, visit));
    return;
  }
  visit(node, path);
  for (const [key, value] of Object.entries(node)) {
    if (APPLICATORS.includes(key)) continue;
    walkStructural(value, `${path}/${key}`, visit);
  }
}

function dereference(root, node) {
  let current = node;
  for (let hops = 0; current && typeof current.$ref === 'string' && current.$ref.startsWith('#/') && hops < 8; hops += 1) {
    current = current.$ref.slice(2).split('/').reduce((value, part) => value?.[part], root);
  }
  return current;
}

test('the frozen evaluation family is exactly fourteen kinds, each resolvable only at the explicit version', () => {
  assert.equal(EVALUATION_CONTRACT_KINDS_V1.length, 14);
  assert.equal(new Set(EVALUATION_CONTRACT_KINDS_V1).size, 14);
  for (const kind of EVALUATION_CONTRACT_KINDS_V1) {
    const resolved = loadEvaluationContract(kind, { protocolVersion: PROTOCOL_VERSION });
    assert.equal(resolved.kind, kind);
    assert.equal(resolved.protocolVersion, PROTOCOL_VERSION);
    assert.equal(resolved.path, `schemas/v${PROTOCOL_VERSION}/${kind}.schema.json`);
    assert.equal(resolved.schema.$id, `https://openplanr.dev/schemas/v${PROTOCOL_VERSION}/${kind}.schema.json`);

    const registered = listProtocolSchemas().filter((entry) => entry.kind === kind);
    assert.deepEqual(registered, [{ kind, protocolVersion: PROTOCOL_VERSION, path: resolved.path }]);
  }
});

test('an implicit version, an unsupported version, and an unknown kind are each refused', () => {
  assert.throws(
    () => loadEvaluationContract('evaluation-scenario'),
    (error) => error.code === 'E_SCHEMA_VERSION_REQUIRED',
  );
  assert.throws(
    () => loadEvaluationContract('evaluation-scenario', { protocolVersion: '1.3.0' }),
    (error) => error.code === 'E_SCHEMA_VERSION_UNSUPPORTED',
  );
  assert.throws(
    () => loadEvaluationContract('evaluation-observation-summary', { protocolVersion: PROTOCOL_VERSION }),
    (error) => error.code === 'E_SCHEMA_UNKNOWN',
  );
});

test('every schema is draft 2020-12, closed at the root, and carries no optional field', () => {
  for (const kind of EVALUATION_CONTRACT_KINDS_V1) {
    const schema = schemaOf(kind);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', kind);
    assert.equal(schema.type, 'object', kind);
    assert.equal(schema.additionalProperties, false, `${kind}: open root`);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
      `${kind}: every declared field must be required, so an absent field is never a silent default`,
    );
    assert.equal(schema.properties.kind.const, kind, kind);
    assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION, kind);
    assert.equal(schema.properties.protocolVersion.const, PROTOCOL_VERSION, `${kind}: version must be explicit`);
  }
});

test('every nested object subschema is closed', () => {
  let checked = 0;
  for (const kind of EVALUATION_CONTRACT_KINDS_V1) {
    walkStructural(schemaOf(kind), kind, (node, path) => {
      if (node.type !== 'object') return;
      checked += 1;
      assert.equal(node.additionalProperties, false, `${path}: a nested object accepts unknown fields`);
    });
  }
  assert.ok(checked >= 70, `expected the family to declare many nested objects, walked ${checked}`);
});

test('every digest field and every timestamp field is bound to its exact form', () => {
  let digests = 0;
  let timestamps = 0;
  for (const kind of EVALUATION_CONTRACT_KINDS_V1) {
    const root = schemaOf(kind);
    walkStructural(root, kind, (node, path) => {
      if (!node.properties) return;
      for (const [field, declared] of Object.entries(node.properties)) {
        const resolved = dereference(root, declared);
        if (/Digest$/u.test(field)) {
          digests += 1;
          const branches = Array.isArray(resolved?.oneOf)
            ? resolved.oneOf
              .map((branch) => dereference(root, branch))
              .filter((branch) => branch.type !== 'null' && branch.const !== null)
            : [resolved];
          for (const branch of branches) {
            assert.equal(branch.pattern, DIGEST_PATTERN, `${path}/${field}: digest is not pinned to sha256 hex`);
          }
        }
        if (/At$/u.test(field)) {
          timestamps += 1;
          assert.equal(dereference(root, declared).format, 'date-time', `${path}/${field}: timestamp is not RFC 3339`);
        }
      }
    });
  }
  assert.ok(digests >= 60, `expected the family to bind many digests, walked ${digests}`);
  assert.ok(timestamps >= 10, `expected the family to bind many timestamps, walked ${timestamps}`);
});

test('the shipped grader and host-profile registries satisfy their published schemas', () => {
  for (const [name, kind] of [
    ['evaluation-graders', 'evaluation-grader-registry'],
    ['evaluation-host-profiles', 'evaluation-host-profile-registry'],
  ]) {
    const registry = registryOf(name);
    assert.equal(registry.kind, kind);
    assert.equal(registry.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(validateProtocolArtifact(kind, registry, { protocolVersion: PROTOCOL_VERSION }), [], name);
  }
});

test('a registry member carrying an unknown field is refused by the envelope schema', () => {
  const registry = registryOf('evaluation-graders');
  const tampered = structuredClone(registry);
  tampered.graders[0].sandbox = 'none';
  const errors = validateProtocolArtifact('evaluation-grader-registry', tampered, { protocolVersion: PROTOCOL_VERSION });
  assert.ok(
    errors.some((error) => error.rule === 'additionalProperties' && error.detail.includes('sandbox')),
    `expected the member schema to refuse an unknown field, got ${JSON.stringify(errors)}`,
  );
});
