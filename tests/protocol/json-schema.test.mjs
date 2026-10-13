import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateJson } from '../../packages/protocol/src/json-schema.mjs';

const root = resolve(import.meta.dirname, '../..');
const rules = (errors) => errors.map((error) => error.rule);

test('exclusiveMinimum rejects values at or below the bound', () => {
  const schema = { type: 'number', exclusiveMinimum: 0 };
  assert.deepEqual(validateJson(0.5, schema), []);
  assert.deepEqual(rules(validateJson(0, schema)), ['exclusiveMinimum']);
  assert.deepEqual(rules(validateJson(-1, schema)), ['exclusiveMinimum']);
});

test('maxProperties rejects objects with too many properties', () => {
  const schema = { type: 'object', maxProperties: 2 };
  assert.deepEqual(validateJson({ a: 1, b: 2 }, schema), []);
  assert.deepEqual(rules(validateJson({ a: 1, b: 2, c: 3 }, schema)), ['maxProperties']);
});

test('dependentRequired requires dependencies only when the trigger property is present', () => {
  const schema = { type: 'object', dependentRequired: { boardId: ['reviewId', 'semanticHash'] } };
  assert.deepEqual(validateJson({}, schema), []);
  assert.deepEqual(validateJson({ reviewId: 'r' }, schema), []);
  assert.deepEqual(validateJson({ boardId: 'b', reviewId: 'r', semanticHash: 'h' }, schema), []);
  const errors = validateJson({ boardId: 'b', reviewId: 'r' }, schema);
  assert.deepEqual(rules(errors), ['dependentRequired']);
  assert.match(errors[0].detail, /'boardId' requires property 'semanticHash'/);
});

test('unevaluatedProperties sees properties evaluated through allOf and $ref', () => {
  const schema = {
    $defs: { base: { type: 'object', properties: { kind: { type: 'string' } } } },
    allOf: [
      { $ref: '#/$defs/base' },
      { type: 'object', properties: { amount: { type: 'number' } } },
    ],
    unevaluatedProperties: false,
  };
  assert.deepEqual(validateJson({ kind: 'runway', amount: 1 }, schema), []);
  const errors = validateJson({ kind: 'runway', amount: 1, extra: true }, schema);
  assert.deepEqual(rules(errors), ['unevaluatedProperties']);
  assert.match(errors[0].detail, /'extra'/);
});

test('unevaluatedProperties ignores properties from failing anyOf branches and the else of a passing if', () => {
  const anyOf = {
    anyOf: [
      { required: ['a'], properties: { a: { const: 1 }, b: true } },
      { required: ['c'], properties: { c: true } },
    ],
    unevaluatedProperties: false,
  };
  assert.deepEqual(validateJson({ a: 1, b: 2 }, anyOf), []);
  assert.deepEqual(rules(validateJson({ c: 1, b: 2 }, anyOf)), ['unevaluatedProperties']);

  const conditional = {
    if: { properties: { mode: { const: 'x' } } },
    then: { properties: { x: true } },
    else: { properties: { y: true } },
    unevaluatedProperties: false,
  };
  assert.deepEqual(validateJson({ mode: 'x', x: 1 }, conditional), []);
  assert.deepEqual(rules(validateJson({ mode: 'x', y: 1 }, conditional)), [
    'unevaluatedProperties',
  ]);
});

test('unevaluatedProperties applies a subschema to the remaining properties', () => {
  const schema = { properties: { a: true }, unevaluatedProperties: { type: 'string' } };
  assert.deepEqual(validateJson({ a: 1, b: 'x' }, schema), []);
  assert.deepEqual(rules(validateJson({ a: 1, b: 2 }, schema)), ['type']);
});

test('an unsupported keyword fails validation instead of being skipped', () => {
  const errors = validateJson(5, { type: 'number', exclusiveMaximum: 3 });
  assert.deepEqual(errors, [
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

test('an unsupported keyword is not swallowed by not, if or combinator branches', () => {
  const nested = { minProperties: 1 };
  for (const schema of [
    { not: nested },
    { if: nested, then: true },
    { anyOf: [nested, true] },
    { oneOf: [nested, { type: 'string' }] },
  ]) {
    assert.ok(
      rules(validateJson({}, schema)).includes('unsupported-keyword'),
      JSON.stringify(schema),
    );
  }
});

test('an unsupported keyword is reported once per schema node', () => {
  const errors = validateJson([1, 2, 3], { items: { type: 'number', multipleOf: 1 } });
  assert.deepEqual(errors, [
    {
      path: '$[0]',
      rule: 'unsupported-keyword',
      detail: "schema keyword 'multipleOf' is not supported by this validator",
    },
  ]);
});

test('annotations and x- extensions are not treated as unsupported keywords', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:test',
    $comment: 'c',
    title: 't',
    description: 'd',
    default: 1,
    examples: [1],
    deprecated: false,
    readOnly: true,
    writeOnly: false,
    'x-openplanr-contract': { anything: true },
    type: 'number',
  };
  assert.deepEqual(validateJson(1, schema), []);
});

test('an unsupported format fails validation while date and date-time are enforced', () => {
  assert.deepEqual(rules(validateJson('a@b.c', { type: 'string', format: 'email' })), [
    'unsupported-format',
  ]);
  assert.deepEqual(validateJson('2026-10-13', { format: 'date' }), []);
  assert.deepEqual(rules(validateJson('13/10/2026', { format: 'date' })), ['format:date']);
  assert.deepEqual(validateJson('2026-10-13T00:00:00Z', { format: 'date-time' }), []);
  assert.deepEqual(rules(validateJson('2026-10-13', { format: 'date-time' })), [
    'format:date-time',
  ]);
});

test('a schema that is neither an object nor a boolean fails validation', () => {
  assert.deepEqual(rules(validateJson({ a: 1 }, { properties: { a: 'number' } })), ['schema']);
});

const SCHEMA_MAPS = ['properties', '$defs', 'dependentSchemas', 'patternProperties'];
const SCHEMA_VALUES = [
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'contains',
  'not',
  'if',
  'then',
  'else',
];
const SCHEMA_ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

function* schemaNodes(node, pointer) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  yield [node, pointer];
  for (const key of SCHEMA_MAPS) {
    for (const [name, child] of Object.entries(node[key] ?? {})) {
      yield* schemaNodes(child, `${pointer}/${key}/${name}`);
    }
  }
  for (const key of SCHEMA_VALUES) yield* schemaNodes(node[key], `${pointer}/${key}`);
  for (const key of SCHEMA_ARRAYS) {
    for (const [index, child] of (node[key] ?? []).entries()) {
      yield* schemaNodes(child, `${pointer}/${key}/${index}`);
    }
  }
}

test('every tracked schema uses only keywords and formats the validator enforces', () => {
  const files = execFileSync('git', ['ls-files', '*.schema.json'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.ok(files.length > 300, `expected the tracked schema set, found ${files.length} files`);
  const unsupported = [];
  for (const file of files) {
    const schema = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
    for (const [node, pointer] of schemaNodes(schema, '#')) {
      for (const error of validateJson(null, node)) {
        if (error.path === '$' && error.rule.startsWith('unsupported-')) {
          unsupported.push(`${file}${pointer}: ${error.detail}`);
        }
      }
    }
  }
  assert.deepEqual(unsupported, []);
});
