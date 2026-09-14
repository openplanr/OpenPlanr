import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import {
  RELEASE_LEDGER_CONTRACT_KINDS_V1,
  listProtocolSchemas,
  loadReleaseLedgerContract,
} from '../../lib/protocol/loader.mjs';

const CONTRACT_VERSION = '1.3.0';
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$';
const APPLICATORS = Object.freeze(['allOf', 'if', 'then', 'else', 'not', 'contains']);

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const schemaOf = (kind) => readJson(`schemas/v${CONTRACT_VERSION}/${kind}.schema.json`);
const fixture = (name) => readJson(`conformance/fixtures/release-ledger/${name}`);

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

test('the release-ledger family resolves only at its explicit contract version', () => {
  assert.equal(RELEASE_LEDGER_CONTRACT_KINDS_V1.length, 4);
  assert.equal(new Set(RELEASE_LEDGER_CONTRACT_KINDS_V1).size, 4);
  for (const kind of RELEASE_LEDGER_CONTRACT_KINDS_V1) {
    const resolved = loadReleaseLedgerContract(kind, { protocolVersion: CONTRACT_VERSION });
    assert.equal(resolved.path, `schemas/v${CONTRACT_VERSION}/${kind}.schema.json`);
    assert.equal(resolved.schema.$id, `https://openplanr.dev/${resolved.path}`);
    assert.equal(resolved.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(resolved.schema['x-openplanr-contract'].version, CONTRACT_VERSION);
  }
});

test('an implicit version, an unsupported version, and an unknown kind are each refused', () => {
  assert.throws(
    () => loadReleaseLedgerContract('release-ledger'),
    (error) => error.code === 'E_SCHEMA_VERSION_REQUIRED',
  );
  assert.throws(
    () => loadReleaseLedgerContract('release-ledger', { protocolVersion: '1.2.0' }),
    (error) => error.code === 'E_SCHEMA_VERSION_UNSUPPORTED',
  );
  assert.throws(
    () => loadReleaseLedgerContract('release-ledger-summary', { protocolVersion: CONTRACT_VERSION }),
    (error) => error.code === 'E_SCHEMA_UNKNOWN',
  );
});

test('every release-ledger schema is closed, fully required, and binds digests exactly', () => {
  for (const kind of RELEASE_LEDGER_CONTRACT_KINDS_V1) {
    const schema = schemaOf(kind);
    walkStructural(schema, kind, (node, path) => {
      if (node.type !== 'object' || node.$ref !== undefined) return;
      assert.equal(node.additionalProperties, false, `${path} must be closed`);
      assert.deepEqual(
        [...(node.required ?? [])].sort(),
        Object.keys(node.properties ?? {}).sort(),
        `${path} must require every property it declares`,
      );
    });
    for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
      if (name !== 'digest') continue;
      assert.equal(definition.pattern, DIGEST_PATTERN, `${kind} digests must be exact SHA-256 digests`);
    }
  }
});

test('the frozen ecosystem-manifest 1.1.0 contract stays registered alongside the new revision', () => {
  const registered = listProtocolSchemas().filter(({ kind }) => kind === 'ecosystem-manifest');
  assert.deepEqual(registered.map(({ protocolVersion }) => protocolVersion).sort(), ['1.1.0', '1.3.0']);
  const frozen = readJson('schemas/v1.1.0/ecosystem-manifest.schema.json');
  assert.equal(frozen.$id, 'https://openplanr.dev/schemas/v1.1.0/ecosystem-manifest.schema.json');
  assert.equal(frozen.properties.schemaVersion.const, '1.0.0');
  assert.equal(Object.hasOwn(frozen.properties, 'professionalSkills'), false);
});

test('the reference ledger, claim, and receipt satisfy their published schemas', () => {
  const valid = fixture('ledger-valid.json');
  const claims = fixture('compatibility-claims-valid.json');
  for (const [kind, record] of [
    ['release-ledger', valid['release-ledger']],
    ['release-ledger-receipt', valid['release-ledger-receipt']],
    ['ecosystem-manifest', valid['ecosystem-manifest']],
    ['release-compatibility-claim', claims['release-compatibility-claim']],
  ]) {
    assert.deepEqual(validateProtocolArtifact(kind, record, { protocolVersion: CONTRACT_VERSION }), []);
  }
});

test('the manifest contract validates the manifest the marketplace generator emits', () => {
  const emitted = resolve(root, '..', 'marketplace', 'ecosystem.json');
  if (!existsSync(emitted)) return;
  const manifest = JSON.parse(readFileSync(emitted, 'utf8'));
  assert.deepEqual(
    validateProtocolArtifact('ecosystem-manifest', manifest, { protocolVersion: CONTRACT_VERSION }),
    [],
    'the published manifest must validate against the contract it is published under',
  );
});
