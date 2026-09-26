import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startDashboard as rootStartDashboard } from 'planr-pipeline';
import * as dashboardEntry from 'planr-pipeline/dashboard';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Package-relative modules reachable from `entry` through static import and export declarations. */
function staticImportGraph(entry) {
  const seen = new Set();
  const pending = [resolve(PIPELINE_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(
      /^(?:import|export)\b[^;]*?\bfrom\s+['"](\.[^'"]+)['"]/gmu,
    )) {
      pending.push(resolve(dirname(file), specifier));
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
