import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/design-manifest.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-design-manifest.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-design-manifest-missing-fields.json'), 'utf-8'));

test('A complete design manifest validates against the schema', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('A manifest with missing required fields, bad enum, and unknown keys fails', () => {
  const errs = validate(invalid, schema);
  assert.ok(errs.length > 0);
  // schema_version is a const "1.0.0" — the fixture's "2.0.0" must be rejected.
  assert.ok(errs.some((e) => e.rule === 'const'));
  // `format` must NEVER be a property name (T2); confirm the schema uses design_format.
  assert.ok(!('format' in schema.properties));
  assert.ok('design_format' in schema.properties);
});
