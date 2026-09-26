import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertRuntimeEventParityRules,
  RUNTIME_EVENT_COLLECTIONS,
  RUNTIME_EVENT_REGISTRY,
  runtimeEventEntityId,
  runtimeEventEntry,
} from '../lib/operate/runtime-foundation/event-registry.mjs';
import { RUNTIME_EVENT_TYPES } from './runtime-foundation-events.test-support.mjs';

const EVENT_SCHEMA = JSON.parse(
  readFileSync(
    new URL(import.meta.resolve('@openplanr/protocol/schemas/v2.0.0/operating-event.schema.json')),
    'utf8',
  ),
);
const ASSIGNMENT_EVENT_TYPES = [
  'assignment.created',
  'assignment.available',
  'assignment.claimed',
  'assignment.started',
  'assignment.submitted',
  'artifact.created',
  'assignment.validated',
  'assignment.rejected',
  'assignment.abandoned',
  'assignment.failed',
];
const PARITY_RULES = [
  ...new Set(
    Object.values(RUNTIME_EVENT_REGISTRY)
      .map(({ parity }) => parity)
      .filter((parity) => parity !== null),
  ),
];

/** Source of one function declaration, from its header to its closing brace. */
function functionSource(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  return source.slice(start, source.indexOf(`\n${indent}}\n`, start));
}

test('the registry lists exactly the Protocol 2.0 Event types in schema order', () => {
  assert.deepEqual(Object.keys(RUNTIME_EVENT_REGISTRY), EVENT_SCHEMA.properties.type.enum);
  assert.equal(Object.isFrozen(RUNTIME_EVENT_REGISTRY), true);
  for (const entry of Object.values(RUNTIME_EVENT_REGISTRY)) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.entityId), true);
  }
});

test('every Event type routes to the reducer handler that applies it', () => {
  const routed = {};
  for (const [type, { handler }] of Object.entries(RUNTIME_EVENT_REGISTRY)) {
    routed[handler] = [...(routed[handler] ?? []), type].sort();
  }
  assert.deepEqual(routed, {
    assignment: [...ASSIGNMENT_EVENT_TYPES].sort(),
    workflow: [...RUNTIME_EVENT_TYPES.workflow].sort(),
    evidenceState: [...RUNTIME_EVENT_TYPES.evidenceState].sort(),
    intelligence: [...RUNTIME_EVENT_TYPES.intelligence].sort(),
    authority: [...RUNTIME_EVENT_TYPES.authority].sort(),
    null: ['domain-projection.rebuilt'],
  });
});

test('every Event type names its entity identity and its parity rule', () => {
  for (const [type, entry] of Object.entries(RUNTIME_EVENT_REGISTRY)) {
    assert.ok(entry.entityId.length > 0, type);
    assert.equal(entry.parity === null, type === 'cycle.input-bound', type);
    if (entry.parity !== 'record') continue;
    assert.ok(Object.hasOwn(RUNTIME_EVENT_COLLECTIONS, entry.collection), type);
    assert.deepEqual(
      entry.entityId,
      [...entry.record, RUNTIME_EVENT_COLLECTIONS[entry.collection][1]],
      type,
    );
  }
  assert.equal(
    runtimeEventEntityId({ type: 'claim.recorded', payload: { record: { claimId: 'clm_0001' } } }),
    'clm_0001',
  );
  assert.equal(
    runtimeEventEntityId({
      type: 'operation.intent-recorded',
      payload: { operation: { operationId: 'op_00000001' } },
    }),
    'op_00000001',
  );
  assert.equal(runtimeEventEntityId({ type: 'cycle.retired', payload: {} }), null);
  assert.equal(runtimeEventEntry('constructor'), null);
});

test('parity rules must implement exactly the rules the registry names', async () => {
  assert.doesNotThrow(() => assertRuntimeEventParityRules(PARITY_RULES));
  assert.throws(() => assertRuntimeEventParityRules(PARITY_RULES.slice(1)), {
    name: 'TypeError',
    message: new RegExp(`missing \\[${PARITY_RULES[0]}\\], unused \\[\\]`),
  });
  assert.throws(() => assertRuntimeEventParityRules([...PARITY_RULES, 'retired']), {
    name: 'TypeError',
    message: /missing \[\], unused \[retired\]/,
  });
  // Loading the projection runs the same assertion over its implemented rules.
  await import('../lib/operate/experience-projection-v2.mjs');
});

test('Event dispatch and parity replay branch on no Event type outside the registry', () => {
  for (const [path, name] of [
    ['../lib/operate/runtime-event-reducer-v2.mjs', 'dispatchRuntimeEvent'],
    ['../lib/operate/experience-projection-v2.mjs', 'validateProjectedStateEventParity'],
  ]) {
    assert.doesNotMatch(
      functionSource(path, name),
      /event\.type\s*[!=]==|event\.type\.(?:startsWith|split)|case '/,
      name,
    );
  }
});
