import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TYPE_IDS, STATUS_IDS,
  typeLabel, typePlural, typeAccent, statusLabel, statusBadge,
  typesInGraph, statusesInGraph,
  specOf, specsInGraph, sprintOf,
  groupingDimensions, groupBy, groupKeyOf, groupBucketLabel, statusColumnOf,
  filterNodes,
} from '../../lib/dashboard/app/metadata.js';

/**
 * Unit tests for the dashboard's shared artifact-metadata registry — the single
 * source of truth that makes filters / grouping / labels metadata-driven. The
 * core guarantee: every artifact type present in the graph (incl. quick/QT and
 * backlog/BL) is discoverable, groupable, and filterable, and nothing is ever
 * silently dropped (missing group keys land in an explicit "No <dim>" bucket).
 */

const N = (id, type, status, fm = {}) => ({ id, type, title: id, status, frontmatter: { id, ...fm } });

// A mixed graph spanning all nine node types + the five statuses.
const NODES = [
  N('EPIC-001', 'epic', 'in-progress'),
  N('FEAT-001', 'feature', 'done', { epicId: 'EPIC-001' }),
  N('US-001', 'story', 'outstanding', { featureId: 'FEAT-001', sprintId: 'SPRINT-001' }),
  N('T-001', 'task', 'blocked', { featureId: 'FEAT-001', sprintId: 'SPRINT-001' }),
  N('QT-001', 'quick', 'in-progress', { sprintId: 'SPRINT-001' }),
  N('QT-002', 'quick', 'outstanding'),
  N('BL-001', 'backlog', 'outstanding'),
  N('SPRINT-001', 'sprint', 'in-progress'),
  N('ADR-001', 'adr', 'addressed'),
  N('SPEC-001', 'spec', 'in-progress'),
  N('SPEC-001/US-001', 'story', 'done', { specScope: 'SPEC-001' }),
];

test('TYPE_IDS / STATUS_IDS cover the full vocabulary', () => {
  assert.deepEqual(TYPE_IDS, ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr']);
  assert.deepEqual(STATUS_IDS, ['outstanding', 'in-progress', 'blocked', 'done', 'addressed']);
});

test('labels + accents resolve, with safe fallbacks for unknown types', () => {
  assert.equal(typePlural('quick'), 'Quick tasks');
  assert.equal(typePlural('backlog'), 'Backlog');
  assert.equal(typeLabel('adr'), 'ADR');
  assert.equal(typeAccent('quick'), 'var(--warning)');
  // unknown type: never throws, never empty
  assert.equal(typeLabel('gizmo'), 'Gizmo');
  assert.equal(typeAccent('gizmo'), 'var(--muted-foreground)');
});

test('statusBadge maps each status and falls back to "to do"', () => {
  assert.deepEqual(statusBadge('done'), ['ds-badge--done', 'done']);
  assert.deepEqual(statusBadge('blocked'), ['ds-badge--blocked', 'blocked']);
  assert.deepEqual(statusBadge('addressed'), ['ds-badge--addressed', 'addressed']);
  assert.deepEqual(statusBadge('???'), ['ds-badge--todo', 'to do']);
  assert.equal(statusLabel('in-progress'), 'In progress');
});

test('typesInGraph returns present types in registry order (quick + backlog included)', () => {
  assert.deepEqual(typesInGraph(NODES), ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr']);
  // a quick/backlog-only project still surfaces them
  assert.deepEqual(typesInGraph([N('QT-9', 'quick', 'outstanding'), N('BL-9', 'backlog', 'outstanding')]), ['backlog', 'quick']);
});

test('statusesInGraph returns present statuses in canonical order', () => {
  assert.deepEqual(statusesInGraph(NODES), ['outstanding', 'in-progress', 'blocked', 'done', 'addressed']);
});

test('groupBy(status) keeps the four columns, folds addressed into done, drops nothing', () => {
  const groups = groupBy(NODES, 'status');
  assert.deepEqual(groups.map((g) => g.key), ['outstanding', 'in-progress', 'blocked', 'done']);
  const total = groups.reduce((a, g) => a + g.nodes.length, 0);
  assert.equal(total, NODES.length); // nothing silently dropped
  const done = groups.find((g) => g.key === 'done');
  assert.ok(done.nodes.some((n) => n.id === 'ADR-001')); // addressed folds in
  assert.equal(statusColumnOf('addressed'), 'done');
});

test('groupBy(type) yields one bucket per present type in registry order', () => {
  const groups = groupBy(NODES, 'type');
  assert.deepEqual(groups.map((g) => g.key), ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr']);
  assert.equal(groups.find((g) => g.key === 'quick').nodes.length, 2);
  assert.equal(groups.find((g) => g.key === 'quick').label, 'Quick tasks');
});

test('groupBy(sprint) buckets by sprintId with an explicit "No sprint" bucket last', () => {
  const groups = groupBy(NODES, 'sprint');
  const last = groups[groups.length - 1];
  assert.equal(last.key, '');
  assert.equal(last.label, 'No sprint');
  assert.ok(last.nodes.length > 0); // the unassigned items land here, not dropped
  const total = groups.reduce((a, g) => a + g.nodes.length, 0);
  assert.equal(total, NODES.length);
  assert.equal(groups.find((g) => g.key === 'SPRINT-001').nodes.length, 3);
});

test('groupKeyOf reads the right field per dimension', () => {
  const us = NODES.find((n) => n.id === 'US-001');
  assert.equal(groupKeyOf(us, 'feature'), 'FEAT-001');
  assert.equal(groupKeyOf(us, 'sprint'), 'SPRINT-001');
  assert.equal(groupKeyOf(us, 'type'), 'story');
  assert.equal(groupKeyOf(NODES.find((n) => n.id === 'QT-002'), 'sprint'), '');
  assert.equal(groupBucketLabel('feature', ''), 'No feature');
});

test('groupingDimensions: status+type always, others only when present', () => {
  const dims = groupingDimensions(NODES).map((d) => d.key);
  assert.deepEqual(dims.slice(0, 2), ['status', 'type']);
  assert.ok(dims.includes('sprint'));
  assert.ok(dims.includes('feature'));
  assert.ok(dims.includes('epic'));
  assert.ok(dims.includes('spec'));
  // a graph with no sprint/feature/epic/spec keys offers only status + type
  const flat = [N('QT-1', 'quick', 'outstanding'), N('BL-1', 'backlog', 'done')];
  assert.deepEqual(groupingDimensions(flat).map((d) => d.key), ['status', 'type']);
  assert.deepEqual(groupingDimensions([]).map((d) => d.key), []);
});

test('filterNodes: empty type = all, null status = all, then narrows', () => {
  assert.equal(filterNodes(NODES, {}).length, NODES.length);
  assert.equal(filterNodes(NODES, { typeFilter: [] }).length, NODES.length);
  const quickOnly = filterNodes(NODES, { typeFilter: ['quick'] });
  assert.equal(quickOnly.length, 2);
  assert.ok(quickOnly.every((n) => n.type === 'quick'));
  const blocked = filterNodes(NODES, { statusFilter: 'blocked' });
  assert.deepEqual(blocked.map((n) => n.id), ['T-001']);
  // combined
  assert.equal(filterNodes(NODES, { typeFilter: ['quick'], statusFilter: 'outstanding' }).length, 1);
});

test('filterNodes search folds in id + title (+ optional displayId)', () => {
  const hits = filterNodes(NODES, { search: 'epic-001' });
  assert.ok(hits.some((n) => n.id === 'EPIC-001'));
});

test('specOf / specsInGraph derive spec scope', () => {
  assert.equal(specOf(NODES.find((n) => n.id === 'SPEC-001/US-001')), 'SPEC-001');
  assert.equal(specOf(NODES.find((n) => n.id === 'SPEC-001')), 'SPEC-001');
  assert.equal(specOf(NODES.find((n) => n.id === 'QT-001')), null);
  assert.deepEqual(specsInGraph(NODES), ['SPEC-001']);
});

test('sprintOf reads sprintId or sprint frontmatter', () => {
  assert.equal(sprintOf({ frontmatter: { sprintId: 'S-1' } }), 'S-1');
  assert.equal(sprintOf({ frontmatter: { sprint: 'S-2' } }), 'S-2');
  assert.equal(sprintOf({ frontmatter: {} }), '');
});
