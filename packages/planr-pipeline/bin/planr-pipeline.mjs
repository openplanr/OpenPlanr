#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PipelineError,
  completePlan,
  finalizeShip,
  preparePlan,
  prepareShip,
  resolveRuntimeAdapter,
  runDesignCommand,
  runSyncAudit,
  runtimeHandoff,
  startDashboard,
} from '../lib/pipeline/index.mjs';
import { buildGraph } from '../lib/dashboard/graph-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const command = argv[0];
const feature = argv[1];
const json = argv.includes('--json');
const noLaunch = argv.includes('--no-launch');
const option = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const output = (value) => process.stdout.write(`${json ? JSON.stringify(value) : format(value)}\n`);
const format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function fail(error) {
  const value = error instanceof PipelineError ? error.toJSON() : { ok: false, code: 'E_PIPELINE', problem: error.message };
  process.stderr.write(`${json ? JSON.stringify(value) : format(value)}\n`);
  process.exitCode = 1;
}

function launch(adapter, phase, slug) {
  if (!adapter.capabilities.headlessLaunch || noLaunch) return runtimeHandoff(adapter, phase, slug);
  const invocations = {
    'claude-code': ['claude', ['--plugin-dir', root, '-p', `${adapter.entrypoints[phase]} ${slug}`]],
    codex: ['codex', ['exec', `${adapter.entrypoints[phase]} ${slug}`]],
  };
  const invocation = invocations[adapter.id];
  if (!invocation) return runtimeHandoff(adapter, phase, slug);
  const result = spawnSync(invocation[0], invocation[1], { stdio: 'inherit' });
  if (result.error) throw new PipelineError('E_RUNTIME_NOT_FOUND', `${invocation[0]} could not be launched: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
  return { ok: result.status === 0, action: 'runtime_launched', runtime: adapter.id, executionMode: 'headless', code: result.status };
}

try {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    output('Usage: planr-pipeline <plan|design|design-loop|design-review|ship|status|dashboard|sync|doctor> [feature] [--runtime <id>] [--json] [--no-launch]');
  } else if (command === '--version' || command === 'version') {
    output(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  } else if (command === 'doctor') {
    const result = spawnSync(process.execPath, [join(root, 'scripts/doctor.mjs'), ...argv.slice(1)], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  } else if (command === 'status') {
    output(buildGraph(join(process.cwd(), '.planr'), { preferNative: true }));
  } else if (command === 'sync') {
    output(runSyncAudit({ projectRoot: process.cwd() }));
  } else if (command === 'dashboard') {
    const dashboard = startDashboard({ planrDir: join(process.cwd(), '.planr'), watch: !argv.includes('--no-watch') });
    const port = await dashboard.listen(Number(option('--port')) || 7473);
    output({ ok: true, url: `http://127.0.0.1:${port}/`, pid: process.pid });
  } else if (command === 'design-engine') {
    const result = await runDesignCommand(argv.slice(1));
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = result.status ?? 1;
  } else if (command === 'prepare-plan') {
    if (!feature) throw new PipelineError('E_FEATURE_INVALID', 'prepare-plan requires a feature slug.');
    output(preparePlan({ projectRoot: process.cwd(), feature, scaffold: true, createStackTemplate: true }));
  } else if (command === 'complete-plan') {
    if (!feature) throw new PipelineError('E_FEATURE_INVALID', 'complete-plan requires a feature slug.');
    output(completePlan({ projectRoot: process.cwd(), feature, runtime: option('--runtime') ?? 'unknown' }));
  } else if (command === 'prepare-ship') {
    if (!feature) throw new PipelineError('E_FEATURE_INVALID', 'prepare-ship requires a feature slug.');
    output(prepareShip({ projectRoot: process.cwd(), feature, humanReviewConfirmed: true }));
  } else if (command === 'finalize-ship') {
    if (!feature) throw new PipelineError('E_FEATURE_INVALID', 'finalize-ship requires a feature slug.');
    output(finalizeShip({
      projectRoot: process.cwd(),
      feature,
      runtime: option('--runtime') ?? 'unknown',
      qaGateStatus: option('--qa') ?? 'skipped',
      dispatchStyle: option('--dispatch-style'),
    }));
  } else if (['plan', 'design', 'design-loop', 'design-review', 'ship'].includes(command)) {
    if (!feature) throw new PipelineError('E_FEATURE_INVALID', `${command} requires a feature slug.`);
    if (command === 'plan') {
      const prepared = preparePlan({ projectRoot: process.cwd(), feature, scaffold: true, createStackTemplate: true });
      if (prepared.scaffolded || prepared.stackTemplateCreated) {
        output(prepared);
        process.exitCode = 0;
      } else {
        const resolved = resolveRuntimeAdapter({ projectRoot: process.cwd(), explicit: option('--runtime') });
        const result = launch(resolved.adapter, command, feature);
        if (noLaunch || result.executionMode === 'handoff') {
          output(result);
          process.exitCode = 2;
        }
      }
    }
    if (command === 'ship') prepareShip({ projectRoot: process.cwd(), feature, humanReviewConfirmed: true });
    if (command !== 'plan') {
      const resolved = resolveRuntimeAdapter({ projectRoot: process.cwd(), explicit: option('--runtime') });
      const result = launch(resolved.adapter, command === 'design-loop' || command === 'design-review' ? 'design' : command, feature);
      if (noLaunch || result.executionMode === 'handoff') {
        output(result);
        process.exitCode = 2;
      }
    }
  } else {
    throw new PipelineError('E_COMMAND_UNKNOWN', `Unknown pipeline command: ${command}`);
  }
} catch (error) {
  fail(error);
}
