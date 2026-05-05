import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/task.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-task.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-task-structure.json'), 'utf-8'));

test('Task frontmatter validates with correlated type/agent + spec-driven specId', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('Task frontmatter fails when type and agent contradict allOf correlation', () => {
  assert.ok(validate(invalid, schema).length > 0);
});
