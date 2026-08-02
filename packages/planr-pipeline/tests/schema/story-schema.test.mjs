import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/story.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-story.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-story-bad-enum.json'), 'utf-8'));

test('Story frontmatter validates for spec-driven parent reference', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('Story frontmatter fails on invalid lifecycle enum', () => {
  assert.ok(validate(invalid, schema).length > 0);
});
