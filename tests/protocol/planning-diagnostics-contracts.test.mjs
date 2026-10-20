import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPlanningDiagnosticsEnvelope,
  PLANNING_DIAGNOSTICS_MAX_BYTES,
  PLANNING_DIAGNOSTICS_MAX_COUNT,
} from '../../packages/protocol/lib/dashboard/planning-diagnostics-contracts.mjs';

const binding = {
  actorId: 'owner',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 1,
};
const cursor = { eventHead: { sequence: 0, hash: null }, viewHash: `sha256:${'b'.repeat(64)}` };
const expected = { binding, cursor };
const diagnostic = {
  nodeId: 'item',
  sourcePath: '.planr/sprints/item.md',
  field: 'closedAt',
  reason: 'closed-before-start',
  classification: 'source-data',
};
const envelope = () => ({
  kind: 'planning-diagnostics',
  schemaVersion: '1.0.0',
  binding,
  cursor,
  sourceViewHash: cursor.viewHash,
  state: 'available',
  reason: null,
  errorCode: null,
  diagnostics: [structuredClone(diagnostic)],
  totalCount: 1,
  truncated: false,
});

test('closed diagnostics accepts bound native evidence and explicit partial or unavailable states', () => {
  const record = assertPlanningDiagnosticsEnvelope(envelope(), expected);
  assert.ok(Object.isFrozen(record.diagnostics[0]));
  assert.equal(PLANNING_DIAGNOSTICS_MAX_COUNT, 500);
  assert.equal(PLANNING_DIAGNOSTICS_MAX_BYTES, 256 * 1024);
  assertPlanningDiagnosticsEnvelope(
    { ...envelope(), totalCount: 2, truncated: true, reason: 'Additional diagnostics omitted.' },
    expected,
  );
  for (const state of ['unavailable', 'error']) {
    assertPlanningDiagnosticsEnvelope(
      {
        ...envelope(),
        state,
        reason: 'Source diagnostics unavailable.',
        errorCode: state === 'error' ? 'EACCES' : null,
        diagnostics: [],
        totalCount: null,
      },
      expected,
    );
  }
});

test('diagnostics rejects closed-shape, binding, cursor, truncation and safety violations', () => {
  for (const mutate of [
    (value) => {
      value.extra = true;
    },
    (value) => {
      value.binding.actorId = 'foreign';
    },
    (value) => {
      value.binding.generation += 1;
    },
    (value) => {
      value.cursor.eventHead.sequence = 1;
    },
    (value) => {
      value.sourceViewHash = `sha256:${'c'.repeat(64)}`;
    },
    (value) => {
      value.diagnostics[0].extra = true;
    },
    (value) => {
      value.diagnostics[0].sourcePath = '/private/source.md';
    },
    (value) => {
      value.diagnostics[0].sourcePath = '../source.md';
    },
    (value) => {
      value.diagnostics[0].sourcePath = 'C:\\source.md';
    },
    (value) => {
      value.diagnostics[0].sourcePath = 'source%2f.md';
    },
    (value) => {
      value.diagnostics[0].field = 'body';
    },
    (value) => {
      value.diagnostics[0].reason = 'invented';
    },
    (value) => {
      value.diagnostics[0].classification = 'fixed';
    },
    (value) => {
      value.totalCount = 2;
    },
    (value) => {
      value.totalCount = 0;
    },
    (value) => {
      value.totalCount = null;
    },
    (value) => {
      value.truncated = true;
    },
    (value) => {
      value.state = 'unavailable';
    },
    (value) => {
      value.errorCode = 'EACCES';
    },
    (value) => {
      value.diagnostics = Array.from({ length: PLANNING_DIAGNOSTICS_MAX_COUNT + 1 }, () =>
        structuredClone(diagnostic),
      );
      value.totalCount = value.diagnostics.length;
    },
  ]) {
    const value = structuredClone(envelope());
    mutate(value);
    assert.throws(() => assertPlanningDiagnosticsEnvelope(value, expected));
  }
  const value = envelope();
  Object.defineProperty(value, 'hidden', { value: true, enumerable: false });
  assert.throws(() => assertPlanningDiagnosticsEnvelope(value, expected));
});

test('diagnostics enforces UTF-8 byte limits and never invokes unknown accessors', () => {
  const value = envelope();
  value.diagnostics = Array.from({ length: PLANNING_DIAGNOSTICS_MAX_COUNT }, () => ({
    ...diagnostic,
    sourcePath: `folder/${'é'.repeat(900)}.md`,
  }));
  value.totalCount = value.diagnostics.length;
  assert.throws(() => assertPlanningDiagnosticsEnvelope(value, expected));
  let calls = 0;
  Object.defineProperty(value, 'hidden', {
    enumerable: true,
    get() {
      calls += 1;
      return 'secret';
    },
  });
  assert.throws(() => assertPlanningDiagnosticsEnvelope(value, expected));
  assert.equal(calls, 0);
});
