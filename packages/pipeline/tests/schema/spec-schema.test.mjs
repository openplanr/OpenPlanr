import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/spec.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-spec.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-spec-missing-fields.json'), 'utf-8'));

test('SPEC frontmatter validates when complete', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('SPEC frontmatter fails when required keys are omitted', () => {
  assert.ok(validate(invalid, schema).length > 0);
});
