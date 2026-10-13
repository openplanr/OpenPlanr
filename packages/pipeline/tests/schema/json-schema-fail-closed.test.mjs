import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate, validateJson } from '../../lib/protocol/json-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rules = (errors) => errors.map((error) => error.rule);

test('an unsupported keyword fails pipeline validation instead of being skipped', () => {
  assert.deepEqual(validate(5, { type: 'number', exclusiveMaximum: 3 }), [
    {
      path: '$',
      rule: 'unsupported-keyword',
      detail: "schema keyword 'exclusiveMaximum' is not supported by this validator",
    },
  ]);
  assert.deepEqual(rules(validateJson({ a: 1 }, { properties: { a: { multipleOf: 2 } } })), [
    'unsupported-keyword',
  ]);
});

test('an unsupported keyword inside not, if or a combinator still fails pipeline validation', () => {
  const nested = { minProperties: 1 };
  for (const schema of [
    { not: nested },
    { if: nested, then: true },
    { anyOf: [nested, true] },
    { oneOf: [nested, { type: 'string' }] },
  ]) {
    assert.ok(rules(validate({}, schema)).includes('unsupported-keyword'), JSON.stringify(schema));
  }
});

test('an unsupported format fails pipeline validation', () => {
  assert.deepEqual(rules(validate('x', { type: 'string', format: 'uuid' })), [
    'unsupported-format',
  ]);
});

test('a shipped schema with an unsupported keyword rejects data it otherwise accepts', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/spec.schema.json'), 'utf8'));
  const spec = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-spec.json'), 'utf8'));
  assert.deepEqual(validate(spec, schema), []);
  assert.deepEqual(rules(validate(spec, { ...schema, exclusiveMaximum: 1 })), [
    'unsupported-keyword',
  ]);
});

test('the pipeline defines no JSON Schema validator besides the protocol projection', () => {
  const definitions = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (
        entry.name.endsWith('.mjs') &&
        /export\s+(?:const|function)\s+validateJson\b/u.test(readFileSync(path, 'utf8'))
      ) {
        definitions.push(relative(root, path));
      }
    }
  };
  for (const directory of ['conformance', 'lib', 'scripts', 'tests']) visit(join(root, directory));
  assert.deepEqual(definitions, ['lib/protocol/json-schema.mjs']);
});
