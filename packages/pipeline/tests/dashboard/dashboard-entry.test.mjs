import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startDashboard as rootStartDashboard } from 'planr-pipeline';
import * as dashboardEntry from 'planr-pipeline/dashboard';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Package-relative modules reachable from `entry` through static import and export declarations.
 * `skip(from, to)` receives package-relative paths and drops that edge when it returns true.
 */
function staticImportGraph(entry, { skip = () => false } = {}) {
  const seen = new Set();
  const pending = [resolve(PIPELINE_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(
      /^(?:(?:import|export)\b[^;]*?\bfrom\s+|import\s+)['"](\.[^'"]+)['"]/gmu,
    )) {
      const target = resolve(dirname(file), specifier);
      if (!skip(relative(PIPELINE_ROOT, file), relative(PIPELINE_ROOT, target))) {
        pending.push(target);
      }
    }
  }
  return [...seen].map((file) => relative(PIPELINE_ROOT, file));
}

test('planr-pipeline/dashboard exposes only startDashboard, the deprecated root alias', () => {
  assert.deepEqual(Object.keys(dashboardEntry), ['startDashboard']);
  assert.equal(dashboardEntry.startDashboard, createDashboardServer);
  assert.equal(rootStartDashboard, dashboardEntry.startDashboard);
});

test('the dashboard entry never loads the package root', () => {
  const graph = staticImportGraph('lib/dashboard/index.mjs');
  assert.ok(graph.includes('lib/dashboard/server.mjs'));
  assert.equal(graph.includes('lib/pipeline/index.mjs'), false);
});

test('the package root reaches the dashboard server only through the deprecated alias', () => {
  const deprecatedAlias = (from, to) =>
    from === 'lib/pipeline/index.mjs' && to === 'lib/dashboard/index.mjs';
  const graph = staticImportGraph('lib/pipeline/index.mjs', { skip: deprecatedAlias });
  // The engine and the operating-origin reader parse planning files with these two modules.
  assert.deepEqual(graph.filter((file) => file.startsWith('lib/dashboard/')).sort(), [
    'lib/dashboard/graph-engine.mjs',
    'lib/dashboard/graph-reader.mjs',
  ]);
});
