import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPlainData, deepFreeze } from '../../packages/protocol/src/canonical-json.mjs';

const nest = (levels) => {
  let value = 1;
  for (let index = 0; index < levels; index += 1) value = [value];
  return value;
};

test('deepFreeze freezes nested objects and arrays in place and returns its argument', () => {
  const value = { a: { b: [1, { c: 2 }] } };
  assert.equal(deepFreeze(value), value);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.a.b));
  assert.ok(Object.isFrozen(value.a.b[1]));
  for (const primitive of [null, undefined, 0, '', 'x', true]) {
    assert.equal(deepFreeze(primitive), primitive);
  }
});

test('deepFreeze does not descend into an object that is already frozen', () => {
  const child = { x: 1 };
  deepFreeze({ parent: Object.freeze({ child }) });
  assert.equal(Object.isFrozen(child), false);
});

test('assertPlainData accepts plain JSON data, shared subtrees and null-prototype objects', () => {
  const shared = { s: 1 };
  assert.doesNotThrow(() =>
    assertPlainData(
      {
        text: 'a',
        flag: false,
        none: null,
        list: [shared, shared, nest(62)],
        bare: Object.assign(Object.create(null), { n: -0 }),
      },
      'Test data',
    ),
  );
});

test('assertPlainData names the caller in every rejection', () => {
  const cycle = { a: [] };
  cycle.a.push(cycle);
  const rejected = [
    [nest(65), 'Test data exceeds the maximum nesting depth.'],
    [{ n: Number.NaN }, 'Test data must be finite, acyclic JSON.'],
    [{ u: undefined }, 'Test data must be finite, acyclic JSON.'],
    [cycle, 'Test data must be finite, acyclic JSON.'],
    [new Date(0), 'Test data must contain only plain JSON objects.'],
    [JSON.parse('{"__proto__": 1}'), 'Test data contains a forbidden property.'],
    [{ constructor: 1 }, 'Test data contains a forbidden property.'],
    [
      Object.defineProperty({}, 'a', { get: () => 1, enumerable: true }),
      'Test data contains a forbidden property.',
    ],
  ];
  for (const [value, message] of rejected) {
    assert.throws(() => assertPlainData(value, 'Test data'), { name: 'TypeError', message });
  }
});
