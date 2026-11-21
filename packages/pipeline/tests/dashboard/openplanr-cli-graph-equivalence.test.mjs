import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getNode } from '../../lib/dashboard/graph-engine.mjs';
import { readGraph } from '../../lib/dashboard/graph-reader.mjs';
import { validateJson } from '../../lib/protocol/json-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const workspaceRoot = resolve(root, '../..');
const openPlanrRoot = join(workspaceRoot, 'packages/cli');
const fixtureRoot = join(root, 'conformance/fixtures/dashboard-graph');
const planrDir = join(fixtureRoot, '.planr');
const graphSchema = JSON.parse(
  readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'),
);

function normalize(graph) {
  return {
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) =>
      `${a.kind} ${a.from} ${a.to}`.localeCompare(`${b.kind} ${b.from} ${b.to}`),
    ),
  };
}

function runOpenPlanrGraph(project = fixtureRoot) {
  const cli = join(openPlanrRoot, 'src/cli/index.ts');
  const openPlanrRequire = createRequire(join(openPlanrRoot, 'package.json'));
  const tsx = openPlanrRequire.resolve('tsx/cli');
  if (!existsSync(cli) || !existsSync(tsx)) return null;

  const result = spawnSync(tsx, [cli, '--project-dir', project, 'graph', '--json'], {
    cwd: openPlanrRoot,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`OpenPlanr graph command failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

test('OpenPlanr CLI graph output matches the pipeline native graph fixture from the workspace package', (t) => {
  if (!existsSync(openPlanrRoot)) {
    t.skip('OpenPlanr workspace package is not present');
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

test('delegated summaries match native task details for inline and block preserve entries', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'planning-preserve-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  cpSync(fixtureRoot, project, { recursive: true });
  const dir = join(project, '.planr');
  const task = join(dir, 'specs/SPEC-001-checkout/tasks/T-001-payment-service.md');
  const original = readFileSync(task, 'utf8');
  for (const preserve of [
    String.raw`[{"repositoryKey":"project","path":"src/a, b.ts"}]`,
    `[{repositoryKey: project, path: 'src/it''s, fine.ts'}]`,
    String.raw`[{"repositoryKey": "project", "path": "src/a,\"b\".ts"}]`,
    String.raw`[{repositoryKey: project, path: "src/a\x2cb.ts",}]`,
    "[\n  {repositoryKey: project, path: 'src/it''s.ts'}, # closing delimiter follows\n]",
    "\n  - repositoryKey: project\n    path: 'src/it''s, fine.ts'",
    '\n  - repositoryKey: project\n    path: "src/a, b.ts"',
  ]) {
    writeFileSync(task, original.replace('title:', `preserve: ${preserve}\ntitle:`));
    const id = 'SPEC-001/T-001';
    const delegated = runOpenPlanrGraph(project).nodes.find((node) => node.id === id);
    const { body, ...summary } = getNode(dir, id);
    assert.equal(body, original.split('---\n').at(-1));
    assert.deepEqual(summary, delegated);
  }
});

test('custom nested metadata does not prevent reading a neighboring task', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'planning-custom-list-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  cpSync(fixtureRoot, project, { recursive: true });
  const dir = join(project, '.planr');
  const task = join(dir, 'specs/SPEC-001-checkout/tasks/T-001-payment-service.md');
  writeFileSync(
    task,
    readFileSync(task, 'utf8').replace('title:', 'customHints: [[a, b], c]\ntitle:'),
  );
  assert.equal(getNode(dir, 'SPEC-001/T-002').title, 'Order confirmation');
});
