import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildGraph, detectMode } from '../../lib/dashboard/graph-engine.mjs';
import { readGraph } from '../../lib/dashboard/graph-reader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

// The shared fixture authored by T-002: a `.planr/` tree with a spec, story,
// tasks (with depends_on + cross-refs), a promoted backlog item, and an ADR.
const planrDir = join(root, 'conformance/fixtures/dashboard-graph/.planr');

// Collision fixture: TWO specs that BOTH restart at US-001 / T-001 — the exact
// per-spec id reuse the old global "first wins" dedup collapsed. Also carries
// loose / non-canonical files that must never be ingested as nodes.
const collisionDir = join(root, 'conformance/fixtures/dashboard-collision/.planr');

const sortedIds = (graph) => graph.nodes.map((n) => n.id).sort();
const sortedEdges = (graph) =>
  graph.edges.map((e) => `${e.kind} ${e.from} ${e.to}`).sort();

/**
 * A CLI `run` stub that emulates `planr` for the delegate path: `--version`
 * answers a sufficiently-new version, and `graph --json` returns the exact
 * native graph (the contract is that both paths yield the same data). This is
 * the spine of AC8: if the engine's two paths ever drift, the assertions below
 * fail.
 */
function makeDelegateRun() {
  // Source of truth for the stub's payload is the native reader on the fixture,
  // so the delegate "CLI" returns identical data — proving the engine plumbs
  // both paths to an equivalent shape.
  const fixtureGraph = readGraph(planrDir);
  const payload = JSON.stringify({ nodes: fixtureGraph.nodes, edges: fixtureGraph.edges });
  return (cmd, args) => {
    if (cmd !== 'planr') return { status: 1, stdout: '' };
    if (args[0] === '--version') return { status: 0, stdout: '2.0.0\n' };
    if (args[0] === 'graph' && args[1] === '--json') return { status: 0, stdout: payload };
    // Force the engine to prefer `graph --json`; refuse the status fallback.
    return { status: 1, stdout: '' };
  };
}

/** A CLI `run` stub that simulates the CLI being absent (delegate unavailable). */
function absentCliRun() {
  return () => { throw new Error('command not found: planr'); };
}

test('native-reader path and CLI-delegate path agree on the node id set', () => {
  const native = buildGraph(planrDir, { run: absentCliRun() });
  const delegate = buildGraph(planrDir, { run: makeDelegateRun() });

  // Sanity: the fixture is non-trivial (avoids a vacuous pass).
  assert.ok(native.nodes.length >= 5, `fixture should have several nodes, got ${native.nodes.length}`);

  assert.deepStrictEqual(sortedIds(native), sortedIds(delegate));
});

test('native-reader path and CLI-delegate path agree on the edge set', () => {
  const native = buildGraph(planrDir, { run: absentCliRun() });
  const delegate = buildGraph(planrDir, { run: makeDelegateRun() });

  assert.ok(native.edges.length >= 1, 'fixture should have at least one edge');
  assert.deepStrictEqual(sortedEdges(native), sortedEdges(delegate));
});

test('the equivalence assertion catches drift between the two paths', () => {
  const native = buildGraph(planrDir, { run: absentCliRun() });
  // Build a delegate graph whose payload is deliberately missing a node, to
  // prove the equivalence check is not vacuous — it must detect the drift.
  const fixtureGraph = readGraph(planrDir);
  const dropped = {
    nodes: fixtureGraph.nodes.slice(1),
    edges: fixtureGraph.edges,
  };
  const driftRun = (cmd, args) => {
    if (cmd !== 'planr') return { status: 1, stdout: '' };
    if (args[0] === '--version') return { status: 0, stdout: '2.0.0\n' };
    if (args[0] === 'graph' && args[1] === '--json') {
      return { status: 0, stdout: JSON.stringify(dropped) };
    }
    return { status: 1, stdout: '' };
  };
  const delegate = buildGraph(planrDir, { run: driftRun });
  assert.notDeepStrictEqual(sortedIds(native), sortedIds(delegate));
});

// ── Per-spec id-collision regression (the bug that miscounted the dashboard) ──

test('two specs that both restart at US-001 / T-001 keep distinct namespaced ids', () => {
  const g = readGraph(collisionDir);

  // Both specs, both stories, both tasks survive — nothing collapsed.
  const stories = g.nodes.filter((n) => n.type === 'story').map((n) => n.id).sort();
  const tasks = g.nodes.filter((n) => n.type === 'task').map((n) => n.id).sort();
  const specs = g.nodes.filter((n) => n.type === 'spec').map((n) => n.id).sort();

  assert.deepStrictEqual(specs, ['SPEC-001', 'SPEC-002']);
  assert.deepStrictEqual(stories, ['SPEC-001/US-001', 'SPEC-002/US-001'],
    'both US-001 stories must be present as distinct namespaced ids');
  assert.deepStrictEqual(tasks, ['SPEC-001/T-001', 'SPEC-002/T-001'],
    'both T-001 tasks must be present as distinct namespaced ids');

  // The displayed (local) id is preserved in frontmatter for both.
  const localStoryIds = g.nodes
    .filter((n) => n.type === 'story')
    .map((n) => n.frontmatter.id);
  assert.deepStrictEqual(localStoryIds.sort(), ['US-001', 'US-001']);
});

test('edges resolve within spec scope (a beta task storyId binds to the beta story)', () => {
  const g = readGraph(collisionDir);
  const keys = g.edges.map((e) => `${e.kind} ${e.from} ${e.to}`);

  // SPEC-002's task is contained by SPEC-002's story — never the alpha story.
  assert.ok(keys.includes('contains SPEC-002/US-001 SPEC-002/T-001'));
  assert.ok(keys.includes('contains SPEC-001/US-001 SPEC-001/T-001'));
  // No cross-spec leakage.
  assert.ok(!keys.includes('contains SPEC-001/US-001 SPEC-002/T-001'));
  assert.ok(!keys.includes('contains SPEC-002/US-001 SPEC-001/T-001'));
});

test('loose / non-canonical files are NOT ingested as nodes', () => {
  const g = readGraph(collisionDir);
  const localIds = g.nodes.map((n) => n.frontmatter && n.frontmatter.id);

  // A top-level .planr/NOTES.md, a per-spec qa-report.md, a design/design-spec.md,
  // and a checklists/ markdown are all non-canonical and must be excluded.
  assert.ok(!g.nodes.some((n) => n.id === 'NOTES'), 'loose NOTES.md must not be a node');
  assert.ok(!localIds.includes('qa-report'), 'per-spec qa-report.md must not be a node');
  assert.ok(!localIds.includes('design-spec'), 'per-spec design-spec.md must not be a node');

  // Only the canonical six nodes (2 specs + 2 stories + 2 tasks) are present.
  assert.equal(g.nodes.length, 6, `expected 6 canonical nodes, got ${g.nodes.length}`);
});

test('detectMode classifies the spec-only collision fixture as "spec"', () => {
  assert.equal(detectMode(readGraph(collisionDir)), 'spec');
  // Empty graph is "empty"; an agile fixture would be "agile" / "mixed".
  assert.equal(detectMode({ nodes: [], edges: [] }), 'empty');
  assert.equal(detectMode({ nodes: [{ type: 'epic' }], edges: [] }), 'agile');
  assert.equal(detectMode({ nodes: [{ type: 'feature' }, { type: 'spec' }], edges: [] }), 'mixed');
});
