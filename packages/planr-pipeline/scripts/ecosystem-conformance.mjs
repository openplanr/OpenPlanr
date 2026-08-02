#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../conformance/json-schema-validate.mjs';
import { readGraph } from '../lib/dashboard/graph-reader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workRoot = resolve(root, '..');
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const json = args.has('--json');
const checks = [];

function add(status, id, message, fix = '', strictFail = false) {
  const promoted = strict && status === 'warn' && strictFail;
  checks.push({
    id,
    status: promoted ? 'fail' : status,
    message: promoted ? `${message} (strict mode)` : message,
    ...(fix ? { fix } : {}),
  });
}

function normalize(graph) {
  return {
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) =>
      `${a.kind} ${a.from} ${a.to}`.localeCompare(`${b.kind} ${b.from} ${b.to}`),
    ),
  };
}

function runOpenPlanrGraph(openPlanrRoot, fixtureRoot) {
  const cli = join(openPlanrRoot, 'src/cli/index.ts');
  const tsx = join(openPlanrRoot, 'node_modules/.bin/tsx');
  if (!existsSync(cli)) {
    return { skipped: true, reason: 'OpenPlanr source CLI is missing' };
  }
  if (!existsSync(tsx)) {
    return { skipped: true, reason: 'OpenPlanr local tsx binary is missing; run npm install in OpenPlanr' };
  }

  const result = spawnSync(tsx, [cli, '--project-dir', fixtureRoot, 'graph', '--json'], {
    cwd: openPlanrRoot,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    return { error: result.stderr || result.stdout || `exit ${result.status}` };
  }

  try {
    return { graph: JSON.parse(result.stdout) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const fixtureRoot = join(root, 'conformance/fixtures/dashboard-graph');
const planrDir = join(fixtureRoot, '.planr');
const graphSchema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'));

let native = null;
try {
  native = readGraph(planrDir);
  const errors = validateJson(native, graphSchema);
  if (errors.length === 0) {
    add('ok', 'graph.native-schema', 'pipeline native dashboard graph fixture validates against graph schema');
  } else {
    add('fail', 'graph.native-schema', `pipeline native graph fixture failed schema validation: ${errors[0].path} ${errors[0].rule}`);
  }
} catch (error) {
  add('fail', 'graph.native-read', `pipeline native graph fixture could not be read: ${error instanceof Error ? error.message : String(error)}`);
}

const openPlanrRoot = join(workRoot, 'OpenPlanr');
if (!existsSync(openPlanrRoot)) {
  add('warn', 'graph.openplanr-present', 'OpenPlanr sibling repo not found; CLI graph equivalence skipped', 'Clone openplanr/OpenPlanr next to planr-pipeline.', true);
} else if (native) {
  const result = runOpenPlanrGraph(openPlanrRoot, fixtureRoot);
  if (result.skipped) {
    add('warn', 'graph.openplanr-cli', result.reason, 'Install OpenPlanr dependencies before strict ecosystem conformance.', true);
  } else if (result.error) {
    add('fail', 'graph.openplanr-cli', `OpenPlanr graph command failed: ${result.error}`);
  } else {
    const errors = validateJson(result.graph, graphSchema);
    if (errors.length > 0) {
      add('fail', 'graph.openplanr-schema', `OpenPlanr graph output failed schema validation: ${errors[0].path} ${errors[0].rule}`);
    } else if (JSON.stringify(normalize(result.graph)) === JSON.stringify(normalize(native))) {
      add('ok', 'graph.openplanr-equivalence', 'OpenPlanr CLI graph output matches pipeline native graph fixture');
    } else {
      add('fail', 'graph.openplanr-equivalence', 'OpenPlanr CLI graph output differs from pipeline native graph fixture');
    }
  }
}

const summary = {
  ok: checks.every((check) => check.status !== 'fail'),
  failures: checks.filter((check) => check.status === 'fail').length,
  warnings: checks.filter((check) => check.status === 'warn').length,
  checks,
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`OpenPlanr ecosystem conformance: ${summary.ok ? 'ok' : 'failed'} (${summary.failures} failure(s), ${summary.warnings} warning(s))`);
  for (const check of checks) {
    console.log(`[${check.status}] ${check.message}`);
    if (check.fix && check.status !== 'ok') console.log(`      fix: ${check.fix}`);
  }
}

process.exit(summary.ok ? 0 : 1);
