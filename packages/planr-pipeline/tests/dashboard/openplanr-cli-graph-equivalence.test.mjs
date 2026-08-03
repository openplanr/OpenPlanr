import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import { readGraph } from '../../lib/dashboard/graph-reader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const workRoot = resolve(root, '..');
const openPlanrRoot = join(workRoot, 'OpenPlanr');
const fixtureRoot = join(root, 'conformance/fixtures/dashboard-graph');
const planrDir = join(fixtureRoot, '.planr');
const graphSchema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'));

function normalize(graph) {
  return {
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) =>
      `${a.kind} ${a.from} ${a.to}`.localeCompare(`${b.kind} ${b.from} ${b.to}`),
    ),
  };
}

function runOpenPlanrGraph() {
  const cli = join(openPlanrRoot, 'src/cli/index.ts');
  const tsx = join(openPlanrRoot, 'node_modules/.bin/tsx');
  if (!existsSync(cli) || !existsSync(tsx)) return null;

  const result = spawnSync(tsx, [cli, '--project-dir', fixtureRoot, 'graph', '--json'], {
    cwd: openPlanrRoot,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`OpenPlanr graph command failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

test('OpenPlanr CLI graph output matches the pipeline native graph fixture when sibling repo exists', (t) => {
  if (!existsSync(openPlanrRoot)) {
    t.skip('OpenPlanr sibling repo is not present');
    return;
  }

  const cliGraph = runOpenPlanrGraph();
  if (!cliGraph) {
    t.skip('OpenPlanr source CLI or local tsx binary is not available');
    return;
  }

  const native = readGraph(planrDir);
  assert.deepEqual(validateJson(cliGraph, graphSchema), []);
  assert.deepEqual(normalize(cliGraph), normalize(native));
});
