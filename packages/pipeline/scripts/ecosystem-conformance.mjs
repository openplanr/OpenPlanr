#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../conformance/json-schema-validate.mjs';
import { readGraph } from '../lib/dashboard/graph-reader.mjs';
import {
  assertPackedWorkspaceProof,
  readPackedWorkspaceProof,
} from '../lib/ecosystem/packed-workspace-proof.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '../..');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strict = args.has('--strict');
const json = args.has('--json');
const checks = [];

function optionValue(name) {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  if (index === -1) return null;
  const value = rawArgs[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

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
  const openPlanrRequire = createRequire(join(openPlanrRoot, 'package.json'));
  const tsx = openPlanrRequire.resolve('tsx');
  if (!existsSync(cli)) {
    return { skipped: true, reason: 'OpenPlanr source CLI is missing' };
  }
  if (!existsSync(tsx)) {
    return { skipped: true, reason: 'OpenPlanr local tsx binary is missing; run npm install in OpenPlanr' };
  }

  const result = spawnSync(process.execPath, ['--import', tsx, cli, '--project-dir', fixtureRoot, 'graph', '--json'], {
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

const openPlanrRoot = join(workspaceRoot, 'packages/cli');
if (!existsSync(openPlanrRoot)) {
  add('warn', 'graph.openplanr-present', 'OpenPlanr workspace package not found; CLI graph equivalence skipped', 'Restore packages/cli from migration custody.', true);
} else if (native) {
  const result = runOpenPlanrGraph(openPlanrRoot, fixtureRoot);
  if (result.skipped) {
    add('warn', 'graph.openplanr-cli', result.reason, 'Install the root workspace lockfile before strict ecosystem conformance.', true);
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

let packedWorkspaceProof = null;
const proofPath = optionValue('--proof');
if (proofPath === '') {
  add('fail', 'proof.packed-workspace', '`--proof` requires a JSON proof path.');
} else if (proofPath !== null) {
  try {
    packedWorkspaceProof = assertPackedWorkspaceProof({
      proof: readPackedWorkspaceProof(proofPath),
      workspaceRoot,
    });
    add(
      'ok',
      'proof.packed-workspace',
      `packed workspace proof binds current CLI and pipeline bytes (${packedWorkspaceProof.proofDigest})`,
    );
  } catch (error) {
    add(
      'fail',
      'proof.packed-workspace',
      error instanceof Error ? error.message : 'Packed-workspace proof validation failed.',
      'Regenerate the proof from this workspace with scripts/verify-packed-workspace.mjs.',
    );
  }
}

const ledgerArgs = [join(root, 'scripts/verify-release-ledger.mjs'), '--json'];
if (strict) ledgerArgs.push('--strict');
if (packedWorkspaceProof && proofPath) ledgerArgs.push('--proof', proofPath);
const ledger = spawnSync(process.execPath, ledgerArgs, {
  cwd: root,
  encoding: 'utf-8',
  env: { ...process.env, NO_COLOR: '1' },
});
let ledgerReport = null;
try {
  ledgerReport = JSON.parse(ledger.stdout);
} catch {
  ledgerReport = null;
}
if (ledgerReport === null) {
  add('fail', 'ledger.derivation', `release ledger derivation did not report: ${ledger.stderr || `exit ${ledger.status}`}`);
} else if (ledgerReport.refusals.length > 0) {
  add('fail', 'ledger.derivation', `published compatibility drifted from the ledger: ${ledgerReport.refusals[0].reason}`);
} else if (ledgerReport.unproven.length > 0) {
  add(
    'warn',
    'ledger.derivation',
    `${ledgerReport.projections.length} compatibility claim(s) derive, ${ledgerReport.unproven.length} release-ledger input(s) remain explicitly unproven`,
    packedWorkspaceProof
      ? 'Complete the distinct-repository release train only when publication is separately authorized.'
      : 'Run scripts/verify-packed-workspace.mjs and pass its JSON report with --proof for consolidated strict conformance.',
    packedWorkspaceProof === null,
  );
} else {
  const custodyDigest = ledgerReport.ledgerDigest ?? ledgerReport.packedProofDigest;
  add('ok', 'ledger.derivation', `every published compatibility claim derives from verified custody (${custodyDigest})`);
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
