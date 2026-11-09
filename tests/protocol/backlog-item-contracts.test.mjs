import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PROTOCOL_SCHEMA_REGISTRY,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import * as backlog from '../../skills/shared/backlog-item.mjs';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/backlog-when.json', import.meta.url), 'utf8'),
);
const options = { protocolVersion: '1.24.0' };
const old = {
  id: 'BL-001',
  title: 'Item',
  priority: 'medium',
  tags: [],
  status: 'open',
  created: '2026-11-08',
  updated: '2026-11-08',
};

function schema() {
  assert.ok(PROTOCOL_SCHEMA_REGISTRY['backlog-item'], 'backlog-item contract must be registered');
  return resolveProtocolSchema('backlog-item', options).schema;
}

test('backlog frontmatter accepts old and new items and requires the writer fields', () => {
  const contract = schema();
  assert.equal(contract.$id, 'https://openplanr.dev/schemas/v1.24.0/backlog-item.schema.json');
  for (const value of [
    old,
    { ...old, when: 'next-unit:#612', files: ['src/a.ts'], unverified: true, epicId: 'EPIC-001' },
  ]) {
    assert.deepEqual(validateProtocolArtifact('backlog-item', value, options), []);
  }
  for (const key of Object.keys(old)) {
    const invalid = { ...old };
    delete invalid[key];
    assert.ok(
      validateProtocolArtifact('backlog-item', invalid, options).some(
        ({ rule }) => rule === 'required',
      ),
      key,
    );
  }
  assert.ok(
    validateProtocolArtifact('backlog-item', { ...old, unverified: false }, options).length,
  );
});

test('when parser and schema pattern agree on the shared valid and invalid fixtures', () => {
  assert.equal(typeof backlog.parseWhen, 'function');
  const pattern = new RegExp(schema().properties.when.pattern, 'u');
  for (const { value, valid } of fixtures) {
    assert.equal(pattern.test(value), valid, value);
    assert.equal(
      validateProtocolArtifact('backlog-item', { ...old, when: value }, options).length === 0,
      valid,
      value,
    );
    if (valid) assert.doesNotThrow(() => backlog.parseWhen(value), value);
    else assert.throws(() => backlog.parseWhen(value), /when/, value);
  }
});

test('files reject traversal, absolute paths, line references and non-string arrays', () => {
  schema();
  for (const files of [
    ['../a.ts'],
    ['src/../a.ts'],
    ['/a.ts'],
    ['C:\\a.ts'],
    ['src/a.ts:2'],
    ['src/a.ts:2:3'],
    ['src/a.ts:2-8'],
    [12],
    'a.ts',
  ]) {
    assert.ok(
      validateProtocolArtifact('backlog-item', { ...old, files }, options).length,
      JSON.stringify(files),
    );
  }
});

test('existing backlog frontmatter retains owner and tracker metadata', () => {
  const existing = JSON.parse(
    readFileSync(new URL('./fixtures/backlog-existing-frontmatter.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(validateProtocolArtifact('backlog-item', existing, options), []);
});
