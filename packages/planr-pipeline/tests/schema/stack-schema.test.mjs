import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/stack.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-stack.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-stack-missing-fields.json'), 'utf-8'));

test('stack frontmatter validates when all required keys are present', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('stack frontmatter fails when required keys (BuildCommand, schemaVersion, Framework, ORM) are omitted', () => {
  const errors = validate(invalid, schema);
  assert.ok(errors.length > 0);
});

test('stack frontmatter rejects schemaVersion other than "1.0.0"', () => {
  const wrongVersion = { ...valid, schemaVersion: '0.9.0' };
  const errors = validate(wrongVersion, schema);
  assert.ok(errors.length > 0, 'expected schemaVersion const violation');
});

test('stack frontmatter rejects empty BuildCommand (minLength: 1)', () => {
  const emptyBuild = { ...valid, BuildCommand: '' };
  const errors = validate(emptyBuild, schema);
  assert.ok(errors.length > 0, 'expected BuildCommand minLength violation');
});

test('stack frontmatter rejects unknown additional properties', () => {
  const extra = { ...valid, RandomKey: 'should not be allowed' };
  const errors = validate(extra, schema);
  assert.ok(errors.length > 0, 'expected additionalProperties:false violation');
});
