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

const hasRule = (errors, rule) => rules(errors).includes(rule);

test('an unresolvable $ref is not swallowed by not, if or combinator branches', () => {
  const missing = { $ref: '#/$defs/missing' };
  for (const schema of [
    missing,
    { not: missing },
    { if: missing, then: true, else: true },
    { anyOf: [missing, true] },
    { oneOf: [missing, { type: 'object' }] },
    { allOf: [true, missing] },
    { anyOf: [{ allOf: [{ not: missing }] }, true] },
    { oneOf: [{ if: { anyOf: [{ not: missing }] }, then: true }, { type: 'string' }] },
    { not: { not: { anyOf: [{ oneOf: [missing, true] }] } } },
  ]) {
    const errors = validateJson({}, schema);
    assert.ok(hasRule(errors, '$ref'), JSON.stringify(schema));
    assert.ok(
      errors.some((error) => error.detail === 'could not resolve schema reference #/$defs/missing'),
      JSON.stringify(errors),
    );
  }
});

test('an external $ref the resolver cannot resolve fails inside a negated branch', () => {
  const errors = validateJson(1, { not: { $ref: 'urn:missing' } }, { resolveRef: () => undefined });
  assert.ok(hasRule(errors, '$ref'), JSON.stringify(errors));
});

test('a circular $ref is not swallowed by a negated branch', () => {
  const schema = { $defs: { loop: { $ref: '#/$defs/loop' } }, not: { $ref: '#/$defs/loop' } };
  const errors = validateJson(1, schema);
  assert.ok(
    errors.some((error) => error.rule === '$ref' && /circular/.test(error.detail)),
    JSON.stringify(errors),
  );
});

const tree = {
  $defs: {
    node: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/$defs/node' } },
      },
      additionalProperties: false,
    },
  },
  $ref: '#/$defs/node',
};
const deepTree = {
  name: 'a',
  children: [{ name: 'b', children: [{ name: 'c', children: [] }] }, { name: 'd' }],
};

test('a recursive $ref validates an instance that recurses through nested data', () => {
  assert.deepEqual(validateJson(deepTree, tree), []);
  const errors = validateJson({ name: 'a', children: [{ name: 'b', children: [{}] }] }, tree);
  assert.deepEqual(errors, [
    {
      path: '$.children[0].children[0]',
      rule: 'required',
      detail: "missing required property 'name'",
    },
  ]);
});

test('a recursive $ref validates inside not, oneOf and an external self-reference', () => {
  assert.deepEqual(
    rules(validateJson(deepTree, { $defs: tree.$defs, not: { $ref: '#/$defs/node' } })),
    ['not'],
  );
  assert.deepEqual(
    validateJson(deepTree, {
      $defs: tree.$defs,
      oneOf: [{ $ref: '#/$defs/node' }, { type: 'string' }],
    }),
    [],
  );
  const event = {
    $id: 'urn:event',
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'inner'],
        properties: { kind: { const: 'wrap' }, inner: { $ref: 'urn:event' } },
      },
      { type: 'object', required: ['kind'], properties: { kind: { const: 'leaf' } } },
    ],
  };
  const resolveRef = (reference) => (reference === 'urn:event' ? event : undefined);
  const nested = { kind: 'wrap', inner: { kind: 'wrap', inner: { kind: 'leaf' } } };
  assert.deepEqual(validateJson(nested, event, { resolveRef }), []);
});

test('a $ref loop at the same instance location fails, including inside not and oneOf', () => {
  const loops = {
    self: { $ref: '#/$defs/self' },
    a: { $ref: '#/$defs/b' },
    b: { allOf: [{ $ref: '#/$defs/a' }] },
  };
  for (const schema of [
    { $defs: loops, $ref: '#/$defs/self' },
    { $defs: loops, $ref: '#/$defs/a' },
    { $defs: loops, not: { $ref: '#/$defs/self' } },
    { $defs: loops, oneOf: [{ $ref: '#/$defs/a' }, true] },
    { $defs: loops, anyOf: [{ not: { oneOf: [{ $ref: '#/$defs/self' }] } }, true] },
  ]) {
    const errors = validateJson({ x: [1] }, schema);
    assert.ok(
      errors.some(
        (error) => error.rule === '$ref' && /^circular schema reference/.test(error.detail),
      ),
      `${JSON.stringify(schema)} -> ${JSON.stringify(errors)}`,
    );
  }
});

test('an unresolvable $ref is reported once per schema node', () => {
  const errors = validateJson([1, 2, 3], { items: { $ref: '#/$defs/missing' } });
  assert.deepEqual(errors, [
    { path: '$[0]', rule: '$ref', detail: 'could not resolve schema reference #/$defs/missing' },
  ]);
});

test('a $ref to a boolean schema applies it instead of reporting it unresolved', () => {
  const schema = { $defs: { never: false, always: true } };
  assert.deepEqual(rules(validateJson(1, { ...schema, $ref: '#/$defs/never' })), ['schema:false']);
  assert.deepEqual(validateJson(1, { ...schema, $ref: '#/$defs/always' }), []);
  const notSchema = validateJson(1, { $defs: { n: 5 }, $ref: '#/$defs/n' });
  assert.ok(
    notSchema.some((error) => error.rule === '$ref' && /resolved to integer/.test(error.detail)),
    JSON.stringify(notSchema),
  );
});

const MALFORMED_KEYWORDS = [
  ['$ref', 5],
  ['type', 'strnig'],
  ['type', []],
  ['enum', 'a'],
  ['minLength', '1'],
  ['maxLength', -1],
  ['pattern', '('],
  ['minimum', '3'],
  ['maximum', null],
  ['exclusiveMinimum', '0'],
  ['minItems', 1.5],
  ['maxItems', '2'],
  ['prefixItems', []],
  ['items', 5],
  ['uniqueItems', 'true'],
  ['contains', 'x'],
  ['minContains', -1],
  ['maxContains', '1'],
  ['required', 'id'],
  ['required', ['id', 'id']],
  ['properties', { a: 'number' }],
  ['additionalProperties', 'no'],
  ['maxProperties', '2'],
  ['dependentRequired', { a: 'b' }],
  ['unevaluatedProperties', 0],
  ['oneOf', {}],
  ['anyOf', []],
  ['allOf', [5]],
  ['if', 'x'],
  ['then', 1],
  ['else', null],
  ['not', []],
  ['$defs', { a: 1 }],
];

test('a supported keyword with a malformed value fails validation', () => {
  for (const [keyword, malformed] of MALFORMED_KEYWORDS) {
    const label = `${keyword}: ${JSON.stringify(malformed)}`;
    const errors = validateJson(3, { [keyword]: malformed });
    const shape = errors.filter((error) => error.rule === 'schema');
    assert.equal(shape.length, 1, `${label} -> ${JSON.stringify(errors)}`);
    assert.equal(shape[0].path, '$', label);
    assert.ok(shape[0].detail.startsWith(`schema keyword '${keyword}' must be `), label);
  }
});

test('a malformed keyword value is not swallowed by not, if or nested combinators', () => {
  const malformed = { minimum: '3' };
  for (const schema of [
    { not: malformed },
    { if: malformed, then: true },
    { anyOf: [malformed, true] },
    { oneOf: [malformed, { type: 'string' }] },
    { allOf: [{ anyOf: [{ not: malformed }] }] },
    { anyOf: [{ oneOf: [{ if: { not: malformed }, else: true }] }, true] },
  ]) {
    assert.ok(hasRule(validateJson(5, schema), 'schema'), JSON.stringify(schema));
  }
});

test('a malformed subschema is reported even when no value reaches it', () => {
  assert.deepEqual(rules(validateJson([], { items: 5 })), ['schema']);
  assert.deepEqual(rules(validateJson({}, { properties: { a: 'number' } })), ['schema']);
  assert.deepEqual(rules(validateJson('x', { required: 'id' })), ['schema']);
});

test('well-formed keyword values produce no schema errors', () => {
  const schema = {
    $defs: { s: { type: ['string', 'null'] } },
    type: 'object',
    required: ['a'],
    properties: { a: { $ref: '#/$defs/s', pattern: '^a', minLength: 0, maxLength: 3 } },
    dependentRequired: { a: [] },
    maxProperties: 2,
    additionalProperties: { type: 'array', minItems: 0, maxItems: 2, uniqueItems: false },
  };
  assert.deepEqual(validateJson({ a: 'ab', b: [1] }, schema), []);
});

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

test('a malformed schema fails on every call, frozen or mutable', () => {
  for (const schema of [
    { minimum: '3' },
    deepFreeze({ minimum: '3' }),
    deepFreeze({ type: 'object', properties: { a: { minimum: '3' } } }),
    deepFreeze({ type: 'string', pattern: '(' }),
  ]) {
    const value = schema.properties ? { a: 5 } : 'x';
    assert.deepEqual(rules(validateJson(value, schema)), ['schema'], JSON.stringify(schema));
    assert.deepEqual(rules(validateJson(value, schema)), ['schema'], JSON.stringify(schema));
  }
});

test('a mutable schema is re-checked after it changes between calls', () => {
  const schema = { type: 'number', minimum: 3 };
  assert.deepEqual(validateJson(5, schema), []);
  schema.minimum = '3';
  assert.deepEqual(rules(validateJson(5, schema)), ['schema']);

  const required = ['a'];
  const frozenParent = Object.freeze({ type: 'object', required });
  assert.deepEqual(validateJson({ a: 1 }, frozenParent), []);
  required.push('a');
  assert.deepEqual(rules(validateJson({ a: 1 }, frozenParent)), ['schema']);

  const dependencies = ['b'];
  const nested = Object.freeze({ dependentRequired: Object.freeze({ a: dependencies }) });
  assert.deepEqual(validateJson({ a: 1, b: 2 }, nested), []);
  dependencies.push('b');
  assert.deepEqual(rules(validateJson({ a: 1, b: 2 }, nested)), ['schema']);
});

test('a well-formed schema does not vouch for a distinct schema object', () => {
  const valid = deepFreeze({ type: 'number', minimum: 3 });
  assert.deepEqual(validateJson(5, valid), []);
  assert.deepEqual(rules(validateJson(5, deepFreeze({ type: 'number', minimum: '3' }))), [
    'schema',
  ]);
  const copy = { ...valid };
  copy.minimum = '3';
  assert.deepEqual(rules(validateJson(5, copy)), ['schema']);
  assert.deepEqual(validateJson(5, valid), []);
});

test('a cached pattern keeps matching each value independently', () => {
  const schema = deepFreeze({ type: 'string', pattern: '^a' });
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(validateJson('ab', schema), []);
    assert.deepEqual(rules(validateJson('b', schema)), ['pattern']);
  }
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

test('every tracked schema uses only keywords, formats and keyword values the validator enforces', () => {
  const files = execFileSync('git', ['ls-files', '*.schema.json'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.ok(files.length > 300, `expected the tracked schema set, found ${files.length} files`);
  const unsupported = [];
  for (const file of files) {
    const schema = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
    for (const [node, pointer] of schemaNodes(schema, '#')) {
      for (const error of validateJson(null, node)) {
        if (
          error.path === '$' &&
          (error.rule.startsWith('unsupported-') || error.rule === 'schema')
        ) {
          unsupported.push(`${file}${pointer}: ${error.detail}`);
        }
      }
    }
  }
  assert.deepEqual(unsupported, []);
});
