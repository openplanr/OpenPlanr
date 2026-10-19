import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { deriveAttention } from '@openplanr/protocol/dashboard/planning-attention.mjs';
import {
  ARTBOARD_FIXTURE_CLOCK,
  artboardManifestData,
  buildArtboardGraph,
} from '../../packages/cli/tests/dashboard/fixtures/premium-artboard-fixture.ts';

const NOW = '2026-10-18T12:00:00.000Z';
const node = (id, status = 'outstanding', frontmatter = {}, type = 'task') => ({
  id,
  type,
  title: id,
  status,
  frontmatter,
});
const dependency = (from, to) => ({ from, to, kind: 'depends_on' });
const contains = (from, to) => ({ from, to, kind: 'contains' });

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

test('distinct totals preserve addressed and normalized status with a blocked overlay', () => {
  const pending = node('T-001', 'outstanding', { status: 'pending' });
  const graph = {
    nodes: [
      pending,
      structuredClone(pending),
      node('T-002', 'in-progress'),
      node('T-003', 'done'),
      node('T-004', 'addressed', { status: 'superseded' }),
      node('T-005', 'blocked'),
      node('T-006', 'outstanding', { dependsOn: ['T-004'] }),
    ],
    edges: [dependency('T-001', 'T-002'), dependency('T-005', 'T-002')],
  };
  const result = deriveAttention(freeze(graph), NOW);
  assert.deepEqual(result.statusTotals, {
    total: 6,
    outstanding: 3,
    inProgress: 1,
    addressed: 1,
    done: 1,
    unknown: 0,
    blocked: 2,
  });
  assert.equal(result.byId['T-004'].status, 'addressed');
  assert.equal(result.byId['T-004'].readiness, 'not-applicable');
  assert.equal(result.byId['T-006'].readiness, 'ready');
});

test('waiting sorts by distinct downstream open tasks, then priority and canonical ID', () => {
  const graph = {
    nodes: [
      node('T-000'),
      node('T-001'),
      node('T-002'),
      node('T-003'),
      node('T-004', 'done'),
      node('T-005', 'addressed'),
      node('T-006', 'outstanding', { priority: 'P0' }),
      node('T-007', 'outstanding', { priority: 'critical' }),
      node('BL-001', 'outstanding', {}, 'backlog'),
    ],
    edges: [
      dependency('T-001', 'T-000'),
      dependency('T-002', 'T-001'),
      dependency('T-003', 'T-001'),
      dependency('T-003', 'T-002'),
      dependency('T-004', 'T-001'),
      dependency('T-005', 'T-001'),
      dependency('T-006', 'T-000'),
      dependency('T-007', 'T-000'),
      dependency('BL-001', 'T-001'),
      dependency('T-002', 'T-001'),
    ],
  };
  const result = deriveAttention(graph, NOW);
  assert.equal(result.byId['T-000'].downstreamUnblockCount, 5);
  assert.equal(result.byId['T-001'].downstreamUnblockCount, 2);
  assert.deepEqual(
    result.waiting.map((item) => item.id),
    ['T-001', 'T-002', 'T-006', 'T-007', 'BL-001', 'T-003'],
  );
  assert.deepEqual(result.byId['T-003'].dependencyIds, ['T-001', 'T-002']);
});

test('missing, ambiguous and invalid dependencies stay unknown and never become blockers', () => {
  const graph = {
    nodes: [
      node('SPEC-001/T-001'),
      node('SPEC-002/T-001'),
      node('T-002', 'outstanding', { dependsOn: ['T-001', 'T-999', null] }),
      node('T-003', 'outstanding', { dependsOn: ['T-001', 'SPEC-002/T-001'] }),
      node('T-004', 'blocked'),
    ],
    edges: [],
  };
  const result = deriveAttention(graph, NOW);
  assert.equal(result.byId['T-002'].readiness, 'unknown');
  assert.equal(result.byId['T-003'].readiness, 'unknown');
  assert.equal(result.byId['T-004'].readiness, 'unknown');
  assert.deepEqual(
    result.waiting.map((item) => item.id),
    ['T-003'],
  );
  assert.deepEqual(result.byId['T-002'].unresolvedDependencies, [
    { reference: 'T-001', reason: 'ambiguous', candidates: ['SPEC-001/T-001', 'SPEC-002/T-001'] },
    { reference: 'T-999', reason: 'missing', candidates: [] },
    { reference: 'null', reason: 'invalid', candidates: [] },
  ]);
});

test('local references stay in scope and explicit canonical or unique global IDs resolve', () => {
  const graph = {
    nodes: [
      node('SPEC-001/T-001'),
      node('SPEC-002/T-001'),
      node('SPEC-002/T-002'),
      node('SPEC-001/T-003', 'outstanding', { dependsOn: ['T-001', 'T-002', 'SPEC-002/T-002'] }),
      node('T-004', 'outstanding', { specScope: 'SPEC-001', dependsOn: ['T-002'] }),
      node('QT-001', 'outstanding', { dependsOn: ['T-002'] }, 'quick'),
      node('BL-001', 'outstanding', {}, 'backlog'),
    ],
    edges: [dependency('SPEC-001/T-003', 'SPEC-001/T-001'), dependency('SPEC-001/T-001', 'BL-001')],
  };
  const result = deriveAttention(graph, NOW);
  assert.deepEqual(result.byId['SPEC-001/T-003'].dependencyIds, [
    'SPEC-001/T-001',
    'SPEC-002/T-002',
  ]);
  assert.equal(result.byId['SPEC-001/T-003'].unresolvedDependencies[0].reference, 'T-002');
  assert.equal(result.byId['T-004'].readiness, 'unknown');
  assert.deepEqual(result.byId['QT-001'].dependencyIds, ['SPEC-002/T-002']);
  assert.deepEqual(result.byId['SPEC-001/T-001'].dependencyIds, ['BL-001']);
  assert.equal(result.byId['SPEC-001/T-001'].readiness, 'blocked');
});

test('cycles terminate, report all participating IDs and never count the starting task downstream', () => {
  const graph = {
    nodes: ['T-001', 'T-002', 'T-003', 'T-004', 'T-005'].map((id) => node(id)),
    edges: [
      dependency('T-001', 'T-002'),
      dependency('T-002', 'T-004'),
      dependency('T-004', 'T-001'),
      dependency('T-001', 'T-003'),
      dependency('T-003', 'T-004'),
      dependency('T-005', 'T-005'),
      contains('T-001', 'T-002'),
      contains('T-002', 'T-001'),
    ],
  };
  const result = deriveAttention(graph, NOW);
  assert.deepEqual(result.dependencyCycleIds, ['T-001', 'T-002', 'T-003', 'T-004', 'T-005']);
  assert.deepEqual(result.containmentCycleIds, ['T-001', 'T-002']);
  assert.equal(result.byId['T-001'].downstreamUnblockCount, 3);
  assert.equal(result.byId['T-005'].downstreamUnblockCount, 0);
});

test('stale uses half a supplied sprint rounded up, a seven-day default and an inclusive boundary', () => {
  const graph = {
    nodes: [
      node('T-001', 'in-progress', { updated: '2026-10-11T12:00:00.0000Z' }),
      node('T-002', 'in-progress', { updated: '2026-10-11T12:00:00.001Z' }),
      node('T-003', 'in-progress', { created: '2026-10-10' }),
      node('T-004', 'outstanding', { updated: '2020-01-01' }),
      node('T-005', 'done', { updated: '2020-01-01' }),
      node('T-006', 'addressed', { updated: '2020-01-01' }),
    ],
    edges: [],
  };
  const result = deriveAttention(graph, NOW);
  assert.equal(result.quietDays, 7);
  assert.deepEqual(
    result.stale.map((item) => item.id),
    ['T-003', 'T-001'],
  );
  assert.equal(result.stale[1].ageDays, 7);
  assert.equal(deriveAttention(graph, NOW, { sprintLengthDays: 15 }).quietDays, 8);
  assert.equal(deriveAttention(graph, NOW, { sprintLengthDays: 15, quietDays: 3 }).quietDays, 3);
});

test('missing, invalid and future dates remain unknown; invalid updates never fall back to created', () => {
  const graph = {
    nodes: [
      node('T-001', 'in-progress'),
      node('T-002', 'in-progress', { updated: '2026-02-30', created: '2026-10-18' }),
      node('T-003', 'in-progress', { updated: '2026-10-18T12:00:00.001Z' }),
      node('T-004', 'in-progress', { updated: '2026-10-18T09:00:00' }),
      node('T-005', 'in-progress', { updated: '' }),
    ],
    edges: [],
  };
  const result = deriveAttention(graph, NOW);
  assert.deepEqual(result.unknownStaleIds, ['T-001', 'T-002', 'T-003', 'T-004', 'T-005']);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.changedToday.ids, []);
});

test('changed today uses UTC authored dates, created fallback, spec grouping and exact clock boundaries', () => {
  const graph = {
    nodes: [
      node('SPEC-001', 'in-progress', {}, 'spec'),
      node('SPEC-001/T-001', 'done', { updated: '2026-10-17T23:30:00-01:00' }),
      node('BL-001', 'outstanding', { created: '2026-10-18' }, 'backlog'),
      node('T-002', 'done', { updated: '2026-10-18T00:30:00+01:00' }),
      node('T-003', 'done', { updated: '2026-10-18T12:00:00.0000Z' }),
    ],
    edges: [],
  };
  const result = deriveAttention(graph, NOW);
  assert.deepEqual(result.changedToday, {
    date: '2026-10-18',
    ids: ['BL-001', 'SPEC-001/T-001', 'T-003'],
    groups: [
      { specId: 'SPEC-001', ids: ['SPEC-001/T-001'] },
      { specId: null, ids: ['BL-001', 'T-003'] },
    ],
  });
  assert.deepEqual(deriveAttention(graph, '2026-10-18T00:00:00.000Z').changedToday.ids, ['BL-001']);
});

test('spec progress counts distinct tasks only and never interprets addressed or empty as done', () => {
  const graph = {
    nodes: [
      node('SPEC-001', 'in-progress', {}, 'spec'),
      node('SPEC-002', 'outstanding', {}, 'spec'),
      node('SPEC-003', 'outstanding', {}, 'spec'),
      node('US-001', 'done', {}, 'story'),
      node('T-001', 'done'),
      node('T-002', 'addressed'),
      node('SPEC-002/T-003', 'outstanding'),
      node('SPRINT-001', 'done', {}, 'sprint'),
    ],
    edges: [
      contains('SPEC-001', 'US-001'),
      contains('US-001', 'T-001'),
      contains('SPEC-001', 'T-001'),
      contains('SPEC-001', 'T-002'),
      contains('SPEC-001', 'SPEC-002'),
      contains('SPEC-002', 'SPEC-002/T-003'),
      contains('SPEC-003', 'SPRINT-001'),
      contains('SPRINT-001', 'T-001'),
    ],
  };
  assert.deepEqual(deriveAttention(graph, NOW).perSpec, [
    { id: 'SPEC-001', done: 1, total: 2, taskIds: ['T-001', 'T-002'] },
    { id: 'SPEC-002', done: 0, total: 1, taskIds: ['SPEC-002/T-003'] },
    { id: 'SPEC-003', done: 0, total: 0, taskIds: [] },
  ]);
  assert.deepEqual(deriveAttention({ nodes: [], edges: [] }, NOW).perSpec, []);
  assert.equal(deriveAttention({ nodes: [], edges: [] }, NOW).statusTotals.total, 0);
});

test('high priority includes both priority vocabularies and excludes started or terminal work', () => {
  const graph = {
    nodes: [
      node('T-001', 'outstanding', { priority: 'high' }),
      node('T-002', 'outstanding', { priority: 'P1' }),
      node('T-003', 'outstanding', { priority: ' critical ' }),
      node('T-004', 'outstanding', { priority: 'P0' }),
      node('T-005', 'outstanding', { priority: 'P2' }),
      node('T-006', 'in-progress', { priority: 'P0' }),
      node('T-007', 'done', { priority: 'P0' }),
      node('T-008', 'addressed', { priority: 'P0' }),
    ],
    edges: [],
  };
  assert.deepEqual(deriveAttention(graph, NOW).highPriorityNotStarted, [
    'T-003',
    'T-004',
    'T-001',
    'T-002',
  ]);
});

test('Dataset B exposes evidence-backed differences from illustrative artboard quotas', () => {
  const graph = freeze(buildArtboardGraph('attention'));
  const expected = artboardManifestData(graph).artboard.projections.Home;
  const result = deriveAttention(graph, ARTBOARD_FIXTURE_CLOCK);
  assert.deepEqual(result.statusTotals, {
    total: 708,
    outstanding: 274,
    inProgress: 16,
    addressed: 1,
    done: 417,
    unknown: 0,
    blocked: 15,
  });
  assert.equal(result.waiting.length, expected.waitingBreakdown.graph);
  assert.equal(result.waiting.length + expected.waitingBreakdown.external, expected.waiting);
  assert.equal(result.byId['BL-047'].readiness, 'unknown');
  assert.deepEqual(result.byId['BL-047'].unresolvedDependencies, [
    { reference: 'partner programme', reason: 'missing', candidates: [] },
  ]);
  assert.equal(result.stale.length, 16);
  assert.equal(deriveAttention(graph, NOW, { quietDays: 14 }).stale.length, 14);
  assert.equal(deriveAttention(graph, NOW, { quietDays: 15 }).stale.length, expected.stale);
  assert.deepEqual(
    result.stale
      .filter(
        (item) =>
          !graph.nodes.find((entry) => entry.id === item.id).frontmatter.artboardQuietExample,
      )
      .map((item) => item.id),
    ['BL-051', 'US-086', 'US-087'],
  );
  assert.equal(result.highPriorityNotStarted.length, expected.highOpen + 1);
  assert.deepEqual(
    result.highPriorityNotStarted.filter(
      (id) => !graph.nodes.find((entry) => entry.id === id).frontmatter.artboardHighPriority,
    ),
    ['SPEC-026'],
  );
  assert.equal(result.byId['SPEC-026'].status, 'outstanding');
  assert.equal(graph.nodes.find((entry) => entry.id === 'SPEC-026').frontmatter.priority, 'P1');
  assert.equal(result.changedToday.ids.length, expected.changedToday);
  assert.deepEqual(
    result.changedToday.groups.map((group) => [group.specId, group.ids.length]),
    [
      ['SPEC-025', 5],
      ['SPEC-026', 10],
      [null, 3],
    ],
  );
  for (const [id, counts] of Object.entries(expected.tasksDone)) {
    const spec = result.perSpec.find((entry) => entry.id === id);
    assert.deepEqual([spec.done, spec.total], counts);
  }
  assert.deepEqual(
    deriveAttention({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, NOW),
    result,
  );
});

test('browser execution has no imports or ambient Node dependencies and leaves graph bytes unchanged', () => {
  const source = readFileSync(
    new URL('../../packages/protocol/lib/dashboard/planning-attention.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:import|require|process|Buffer|fetch)\b/u);
  const graph = { nodes: [node('T-001', 'outstanding', { dependsOn: ['missing'] })], edges: [] };
  const before = JSON.stringify(graph);
  const browserResult = runInNewContext(
    `${source.replace('export function', 'function')}\nderiveAttention(graph, nowUTC)`,
    { graph: freeze(graph), nowUTC: NOW },
  );
  assert.equal(JSON.stringify(browserResult), JSON.stringify(deriveAttention(graph, NOW)));
  assert.equal(JSON.stringify(graph), before);
  assert.ok(Object.isFrozen(browserResult));
  assert.ok(Object.isFrozen(browserResult.byId['T-001'].unresolvedDependencies));
});

test('invalid clock, thresholds, dependency shape and conflicting identities surface errors', () => {
  const graph = { nodes: [], edges: [] };
  for (const clock of ['2026-02-30T00:00:00Z', '2026-10-18', '2026-10-18T00:00:00+00:00', 'today'])
    assert.throws(() => deriveAttention(graph, clock), TypeError);
  for (const options of [
    { quietDays: 0 },
    { quietDays: 366 },
    { quietDays: 1.5 },
    { sprintLengthDays: -1 },
    { sprintLengthDays: 367 },
  ])
    assert.throws(() => deriveAttention(graph, NOW, options), RangeError);
  assert.throws(
    () =>
      deriveAttention(
        { nodes: [node('T-001', 'outstanding', { dependsOn: 'T-002' })], edges: [] },
        NOW,
      ),
    /dependsOn must be an array/u,
  );
  assert.throws(
    () => deriveAttention({ nodes: [node('T-001'), node('T-001', 'done')], edges: [] }, NOW),
    /Conflicting graph identity/u,
  );
});
