#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  PipelineError,
  advanceInvestigation,
  advanceShip,
  bindLandingPlan,
  completePlan,
  finalizeShipClosure,
  finalizeInvestigation,
  inspectShipClosureForLanding,
  landingStatus,
  preparePlan,
  prepareShip,
  prepareLanding,
  reopenShip,
  resolveRuntimeAdapter,
  runDesignCommand,
  runShipGates,
  runSyncAudit,
  runtimeHandoff,
  startShip,
  startInvestigation,
  startDashboard,
  showLanding,
} from '../lib/pipeline/index.mjs';
import {
  prepareInvestigationFixAuthorization,
} from '../lib/pipeline/engine.mjs';
import { issueInvestigationFixStartCapability } from '../lib/pipeline/investigation-runtime.mjs';
import { composeRuntimePrompt } from '../lib/pipeline/runtime.mjs';
import { buildGraph } from '../lib/dashboard/graph-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const command = argv[0];
const json = argv.includes('--json');
const noLaunch = argv.includes('--no-launch');
const output = (value) => process.stdout.write(`${json ? JSON.stringify(value) : format(value)}\n`);
const format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function closedArguments(definitions, { maxPositionals = 1 } = {}) {
  const values = new Map();
  const positionals = [];
  let afterSeparator = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--' && !afterSeparator) {
      afterSeparator = true;
      continue;
    }
    if (afterSeparator || !token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    if (!Object.hasOwn(definitions, token)) {
      const legal = Object.keys(definitions).sort().join(', ') || 'none';
      throw new PipelineError('E_CLI_ARGUMENT_INVALID', `Unexpected option for ${command}. Legal options: ${legal}.`);
    }
    const definition = definitions[token];
    if (definition !== 'repeat' && values.has(token)) {
      throw new PipelineError('E_CLI_ARGUMENT_INVALID', `${token} may be supplied only once for ${command}.`);
    }
    if (definition === 'boolean') {
      values.set(token, true);
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new PipelineError('E_CLI_ARGUMENT_INVALID', `${token} requires a non-option value for ${command}.`);
    }
    if (definition === 'repeat') values.set(token, [...(values.get(token) ?? []), value]);
    else values.set(token, value);
  }
  if (positionals.length > maxPositionals) {
    throw new PipelineError('E_CLI_ARGUMENT_INVALID', `${command} received too many positional arguments.`);
  }
  return {
    positionals,
    has: (name) => values.has(name),
    get: (name) => values.get(name),
    all: (name) => values.get(name) ?? [],
  };
}

function featureArguments(definitions) {
  const parsed = closedArguments(definitions);
  const feature = parsed.positionals[0];
  if (!feature || feature.startsWith('-')) {
    throw new PipelineError('E_FEATURE_INVALID', `${command} requires a feature slug.`);
  }
  return { feature, options: parsed };
}

function readJsonFile(path, subject) {
  if (!path) throw new PipelineError('E_INPUT_FILE_REQUIRED', `${subject} requires a file path or - for stdin.`);
  let text;
  try {
    text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  } catch {
    throw new PipelineError('E_INPUT_FILE_UNREADABLE', `${subject} could not be read.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PipelineError('E_INPUT_JSON_INVALID', `${subject} must contain valid JSON.`);
  }
}

function exactJsonObject(value, keys, subject) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new PipelineError(
      'E_INPUT_JSON_INVALID',
      `${subject} must contain exactly ${[...keys].sort().join(', ')}.`,
    );
  }
  return value;
}

function publicText(value, fallback) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'`,:]+[\\/])*[^\s"'`,:]*/gu, '<path>')
    .slice(0, 1_000);
}

async function confirmInvestigationFixStart(preview) {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    throw new PipelineError(
      'E_INVESTIGATION_OWNER_INTERACTIVE_REQUIRED',
      'Fix-mode investigation start is owner-only and requires an interactive terminal.',
      'Run the command directly in a terminal and confirm the exact diagnosis-bound request digest.',
    );
  }
  const phrase = `AUTHORIZE FIX ${preview.requestDigest}`;
  const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  let answer;
  try {
    answer = await terminal.question(`Type ${phrase} to authorize the exact bounded fix: `);
  } finally {
    terminal.close();
  }
  if (answer.trim() !== phrase) {
    throw new PipelineError(
      'E_INVESTIGATION_OWNER_CONFIRMATION_MISMATCH',
      'Owner confirmation did not match the exact investigation fix request digest.',
    );
  }
  return issueInvestigationFixStartCapability(preview);
}

function trustedRuntimeRequired(code, subject, recovery) {
  throw new PipelineError(
    code,
    `${subject} requires a registered trusted runtime host adapter.`,
    recovery,
  );
}

function fail(error) {
  const typed = error instanceof PipelineError ? error.toJSON() : null;
  const coded = !typed && typeof error?.code === 'string' && /^E_[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : null;
  const value = {
    ok: false,
    code: typed?.code ?? coded ?? 'E_PIPELINE_UNEXPECTED',
    problem: publicText(typed?.problem ?? (coded ? error.message : undefined), 'The pipeline command failed unexpectedly.'),
    ...(typed?.fix ? { fix: publicText(typed.fix, 'Run the command help and retry.') } : {}),
  };
  process.stderr.write(`${json ? JSON.stringify(value) : format(value)}\n`);
  process.exitCode = 1;
}

function launch(adapter, phase, slug, context, diagnostics = []) {
  const handoff = () => {
    const result = runtimeHandoff(adapter, phase, slug, context);
    return diagnostics.length ? { ...result, diagnostics } : result;
  };
  if (!adapter.capabilities.headlessBridge || noLaunch) return handoff();
  for (const diagnostic of diagnostics) {
    process.stderr.write(`Runtime diagnostic ${diagnostic.code}: ${diagnostic.problem}${diagnostic.fix ? ` ${diagnostic.fix}` : ''}\n`);
  }
  const prompt = composeRuntimePrompt(adapter, phase, slug, context);
  const invocations = {
    'claude-code': ['claude', ['--plugin-dir', root, '-p', prompt]],
    codex: ['codex', ['exec', prompt]],
  };
  const invocation = invocations[adapter.id];
  if (!invocation) return handoff();
  const result = spawnSync(invocation[0], invocation[1], { stdio: 'inherit' });
  if (result.error) throw new PipelineError('E_RUNTIME_NOT_FOUND', `${invocation[0]} could not be launched: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
  return {
    ok: result.status === 0,
    action: 'runtime_launched',
    runtime: adapter.id,
    executionMode: 'headless',
    code: result.status,
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}

try {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    output([
      'Usage: planr-pipeline <plan|plan-context|design|design-loop|design-review|ship|ship-context|status|dashboard|sync|doctor> [feature] [--runtime <id>] [--task <T-NNN>] [--json] [--no-launch]',
      'Advanced release and machine commands remain available; see docs/protocol/commands.md.',
    ].join('\n'));
  } else if (command === '--version' || command === 'version') {
    output(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  } else if (command === 'doctor') {
    const result = spawnSync(process.execPath, [join(root, 'scripts/doctor.mjs'), ...argv.slice(1)], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  } else if (command === 'status') {
    closedArguments({ '--json': 'boolean' }, { maxPositionals: 0 });
    output(buildGraph(join(process.cwd(), '.planr'), { preferNative: true }));
  } else if (command === 'sync') {
    closedArguments({ '--json': 'boolean' }, { maxPositionals: 0 });
    output(runSyncAudit({ projectRoot: process.cwd() }));
  } else if (command === 'dashboard') {
    const options = closedArguments({ '--port': 'value', '--no-watch': 'boolean', '--json': 'boolean' }, { maxPositionals: 0 });
    const dashboard = startDashboard({ planrDir: join(process.cwd(), '.planr'), watch: !options.has('--no-watch'), planningActorId: 'dashboard-local' });
    const requestedPort = Number(options.get('--port')) || Number(process.env.DASHBOARD_PORT) || 7473;
    const port = await dashboard.listen(requestedPort);
    output({ ok: true, url: `http://127.0.0.1:${port}/`, pid: dashboard.ownerPid, reused: dashboard.reused });
  } else if (command === 'design-engine') {
    const result = await runDesignCommand(argv.slice(1));
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = result.status ?? 1;
  } else if (command === 'prepare-plan') {
    const { feature } = featureArguments({ '--json': 'boolean' });
    output(preparePlan({ projectRoot: process.cwd(), feature, scaffold: true, createStackTemplate: true }));
  } else if (command === 'complete-plan') {
    const { feature, options } = featureArguments({ '--runtime': 'value', '--json': 'boolean' });
    output(completePlan({ projectRoot: process.cwd(), feature, runtime: options.get('--runtime') ?? 'unknown' }));
  } else if (command === 'investigate') {
    const parsed = closedArguments({ '--request-file': 'value', '--run-id': 'value', '--event-file': 'value', '--json': 'boolean' }, { maxPositionals: 2 });
    const [operation, feature] = parsed.positionals;
    if (!['start', 'advance', 'verify', 'finalize'].includes(operation) || !feature || feature.startsWith('-')) {
      throw new PipelineError('E_CLI_ARGUMENT_INVALID', 'investigate requires start|advance|verify|finalize followed by a feature slug.');
    }
    if (operation === 'start') {
      if (parsed.has('--run-id') || parsed.has('--event-file')) throw new PipelineError('E_CLI_ARGUMENT_INVALID', 'investigate start accepts only --request-file and --json.');
      const request = readJsonFile(parsed.get('--request-file'), '--request-file');
      if (request?.mode === 'diagnose') {
        trustedRuntimeRequired(
          'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
          'Diagnose-mode investigation start',
          'Invoke planr-investigate through a registered runtime adapter that supplies the engine-issued read-only command host; the portable CLI cannot execute commands.',
        );
      }
      if (request?.mode === 'fix' && (process.stdin.isTTY !== true || process.stderr.isTTY !== true)) {
        throw new PipelineError(
          'E_INVESTIGATION_OWNER_INTERACTIVE_REQUIRED',
          'Fix-mode investigation start is owner-only and requires an interactive terminal.',
          'Run the command directly in a terminal and confirm the exact diagnosis-bound request digest.',
        );
      }
      const preview = prepareInvestigationFixAuthorization({ projectRoot: process.cwd(), feature, request });
      const fixCapability = await confirmInvestigationFixStart(preview);
      output(startInvestigation({ projectRoot: process.cwd(), feature, request, fixCapability }));
    } else {
      if (!parsed.get('--run-id')) throw new PipelineError('E_INVESTIGATION_RUN_ID_REQUIRED', `investigate ${operation} requires --run-id.`);
      if (operation === 'advance') {
        if (parsed.has('--request-file')) throw new PipelineError('E_CLI_ARGUMENT_INVALID', 'investigate advance does not accept --request-file.');
        const event = readJsonFile(parsed.get('--event-file'), '--event-file');
        if (event?.type === 'experiment.ran') {
          trustedRuntimeRequired(
            'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
            'Investigation experiment execution',
            'Invoke planr-investigate through a registered runtime adapter that supplies the engine-issued read-only command host; the portable CLI cannot execute commands.',
          );
        }
        output(advanceInvestigation({ projectRoot: process.cwd(), feature, runId: parsed.get('--run-id'), event }));
      } else {
        if (parsed.has('--request-file') || parsed.has('--event-file')) throw new PipelineError('E_CLI_ARGUMENT_INVALID', `investigate ${operation} accepts only --run-id and --json.`);
        if (operation === 'verify') {
          trustedRuntimeRequired(
            'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
            'Investigation verification',
            'Invoke planr-investigate through a registered runtime adapter that supplies the engine-issued read-only command host; the portable CLI cannot execute commands.',
          );
        }
        output(finalizeInvestigation({ projectRoot: process.cwd(), feature, runId: parsed.get('--run-id') }));
      }
    }
  } else if (command === 'plan-context') {
    const { feature, options } = featureArguments({ '--runtime': 'value', '--json': 'boolean' });
    const { buildPlanContext, renderPlanContext } = await import('../lib/pipeline/ship-context.mjs');
    const request = { projectRoot: process.cwd(), feature, runtime: options.get('--runtime') };
    if (json) output(buildPlanContext(request));
    else process.stdout.write(`${renderPlanContext(request)}\n`);
  } else if (command === 'ship-context') {
    const { feature, options } = featureArguments({ '--runtime': 'value', '--task': 'value', '--json': 'boolean' });
    const { buildShipContext, renderShipContext } = await import('../lib/pipeline/ship-context.mjs');
    const request = {
      projectRoot: process.cwd(), feature,
      taskId: options.get('--task'), runtime: options.get('--runtime'),
    };
    if (json) output(buildShipContext(request));
    else process.stdout.write(`${renderShipContext(request)}\n`);
  } else if (command === 'prepare-ship') {
    const { feature, options } = featureArguments({ '--task': 'value', '--json': 'boolean' });
    output(prepareShip({ projectRoot: process.cwd(), feature, taskId: options.get('--task') }));
  } else if (command === 'start-ship') {
    const hiddenAuthorityFlag = ['--gates-file', '--repositories-file', '--run-id'].find((flag) => argv.includes(flag));
    if (hiddenAuthorityFlag) throw new PipelineError('E_SHIP_OWNER_CONFIG_FORBIDDEN', `${hiddenAuthorityFlag} is not agent-authorable on start-ship; repositories, gates, and run identity are runtime-owned.`);
    const { feature, options } = featureArguments({ '--reviewed': 'boolean', '--planning-review-receipt': 'value', '--runtime': 'value', '--task': 'value', '--reviewer': 'repeat', '--json': 'boolean' });
    output(startShip({
      projectRoot: process.cwd(), feature,
      runtime: options.get('--runtime') ?? 'unknown', taskId: options.get('--task'),
      reviewerRoster: options.has('--reviewer') ? ['qa-agent', ...options.all('--reviewer').filter((id) => id !== 'qa-agent')] : undefined,
      planningReviewReceiptHash: options.get('--planning-review-receipt'),
    }));
  } else if (command === 'advance-ship') {
    const { feature, options } = featureArguments({ '--run-id': 'value', '--event-file': 'value', '--json': 'boolean' });
    const runId = options.get('--run-id');
    if (!runId) throw new PipelineError('E_SHIP_RUN_ID_REQUIRED', 'advance-ship requires --run-id.');
    output(advanceShip({ projectRoot: process.cwd(), feature, runId, event: readJsonFile(options.get('--event-file'), '--event-file') }));
  } else if (command === 'prepare-browser-qa') {
    const { feature, options } = featureArguments({ '--run-id': 'value', '--json': 'boolean' });
    if (!options.get('--run-id')) throw new PipelineError('E_SHIP_RUN_ID_REQUIRED', 'prepare-browser-qa requires --run-id.');
    trustedRuntimeRequired(
      'E_BROWSER_QA_TRUSTED_HOST_REQUIRED',
      'Browser QA preparation',
      'Invoke planr-browser-qa through a registered browser runtime adapter that establishes the ephemeral session and engine-owned host capability.',
    );
  } else if (command === 'record-browser-qa') {
    const { feature, options } = featureArguments({ '--run-id': 'value', '--generation': 'value', '--result-file': 'value', '--session-file': 'value', '--json': 'boolean' });
    if (!options.get('--run-id')) throw new PipelineError('E_SHIP_RUN_ID_REQUIRED', 'record-browser-qa requires --run-id.');
    if (!/^\d+$/.test(options.get('--generation') ?? '')) throw new PipelineError('E_SHIP_GENERATION_CONFLICT', 'record-browser-qa requires a non-negative --generation.');
    trustedRuntimeRequired(
      'E_BROWSER_QA_TRUSTED_HOST_REQUIRED',
      'Completed browser QA recording',
      'Invoke planr-browser-qa through the same registered browser runtime adapter that owns the ephemeral session, raw evidence bytes, and runtime attestation.',
    );
  } else if (command === 'run-ship-gates') {
    const { feature, options } = featureArguments({ '--run-id': 'value', '--phase': 'value', '--generation': 'value', '--json': 'boolean' });
    const runId = options.get('--run-id');
    if (!runId) throw new PipelineError('E_SHIP_RUN_ID_REQUIRED', 'run-ship-gates requires --run-id.');
    output(runShipGates({
      projectRoot: process.cwd(), feature, runId, phase: options.get('--phase'), expectedGeneration: options.get('--generation'),
    }));
  } else if (command === 'finalize-ship') {
    const legacyTruthFlag = ['--qa', '--agent', '--snapshot', '--docs', '--devops', '--started-at', '--error-report', '--dispatch-style']
      .find((flag) => argv.includes(flag));
    if (legacyTruthFlag) throw new PipelineError('E_SHIP_LEGACY_TRUTH_FORBIDDEN', `${legacyTruthFlag} cannot author completion truth; finalize-ship derives it from the closure receipt.`);
    const { feature, options } = featureArguments({ '--run-id': 'value', '--json': 'boolean' });
    if (!options.get('--run-id')) throw new PipelineError('E_SHIP_RUN_ID_REQUIRED', 'finalize-ship requires --run-id; QA and completion truth come only from the closure receipt.');
    output(finalizeShipClosure({ projectRoot: process.cwd(), feature, runId: options.get('--run-id') }));
  } else if (command === 'reopen-ship') {
    const unsupported = ['--repositories-file', '--run-id'].find((flag) => argv.includes(flag));
    if (unsupported) throw new PipelineError('E_SHIP_OWNER_CONFIG_FORBIDDEN', `${unsupported} is not part of reopen-ship; the runtime derives successor custody.`);
    const { feature, options } = featureArguments({ '--receipt-hash': 'value', '--reason': 'value', '--runtime': 'value', '--json': 'boolean' });
    output(reopenShip({
      projectRoot: process.cwd(), feature, receiptHash: options.get('--receipt-hash'), reason: options.get('--reason'),
      ownerConfirmed: true, runtime: options.get('--runtime') ?? 'unknown',
    }));
  } else if (command === 'land') {
    const parsed = closedArguments({
      '--receipt-hash': 'value',
      '--request-file': 'value',
      '--json': 'boolean',
    }, { maxPositionals: 2 });
    const [operation, feature] = parsed.positionals;
    if (!['prepare', 'show', 'status', 'advance'].includes(operation)
      || !feature || feature.startsWith('-')) {
      throw new PipelineError(
        'E_CLI_ARGUMENT_INVALID',
        'land requires prepare|show|status|advance followed by a feature slug.',
      );
    }
    if (operation === 'advance') {
      if (parsed.has('--json') || process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
        throw new PipelineError(
          'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
          'Landing advance is owner-only and requires one trusted interactive non-JSON process.',
          'Run `planr land advance` directly through OpenPlanr in an attached terminal.',
        );
      }
      trustedRuntimeRequired(
        'E_LANDING_TRUSTED_HOST_REQUIRED',
        'Landing advance',
        'Run `planr land advance` through OpenPlanr so trusted local custody can persist intent before issuing the bounded runtime capability.',
      );
    }
    const receiptHash = parsed.get('--receipt-hash');
    if (!receiptHash) {
      throw new PipelineError(
        'E_SHIP_LANDING_RECEIPT_HASH_INVALID',
        `land ${operation} requires --receipt-hash.`,
      );
    }
    const closureInspection = inspectShipClosureForLanding({
      projectRoot: process.cwd(),
      feature,
      receiptHash,
    });
    const request = readJsonFile(parsed.get('--request-file'), '--request-file');
    if (operation === 'prepare') {
      exactJsonObject(request, [
        'baseRecords',
        'createdAt',
        'currentTargetHash',
        'expiresAt',
        'operations',
        'preconditions',
      ], 'land prepare request');
      output(prepareLanding({ closureInspection, ...request }));
    } else {
      exactJsonObject(request, ['baseRecords', 'events', 'plan'], `land ${operation} request`);
      const plan = bindLandingPlan({
        plan: request.plan,
        closureInspection,
        baseRecords: request.baseRecords,
      });
      output(operation === 'show'
        ? showLanding({ plan, events: request.events })
        : landingStatus({ plan, events: request.events }));
    }
  } else if (['plan', 'design', 'design-loop', 'design-review', 'ship'].includes(command)) {
    const { feature, options } = featureArguments({
      '--runtime': 'value', '--json': 'boolean', '--no-launch': 'boolean', '--release-candidate': 'boolean',
      ...(command === 'ship' ? { '--task': 'value' } : {}),
    });
    if (command === 'plan') {
      const prepared = preparePlan({ projectRoot: process.cwd(), feature, scaffold: true, createStackTemplate: true });
      if (prepared.scaffolded || prepared.stackTemplateCreated) {
        output(prepared);
        process.exitCode = 0;
      } else {
        const resolved = resolveRuntimeAdapter({
          projectRoot: process.cwd(),
          explicit: options.get('--runtime'),
          strictRuntimeLock: false,
        });
        const result = launch(resolved.adapter, command, feature, undefined, resolved.diagnostics);
        if (noLaunch || result.executionMode === 'handoff') {
          output(result);
          process.exitCode = 2;
        }
      }
    }
    let shipContext;
    let resolved;
    if (command === 'ship') {
      if (options.has('--release-candidate')) {
        prepareShip({ projectRoot: process.cwd(), feature, taskId: options.get('--task') });
      } else {
        resolved = resolveRuntimeAdapter({
          projectRoot: process.cwd(),
          explicit: options.get('--runtime'),
          strictRuntimeLock: false,
        });
        const { renderShipContext } = await import('../lib/pipeline/ship-context.mjs');
        shipContext = renderShipContext({
          projectRoot: process.cwd(), feature,
          taskId: options.get('--task'), runtime: resolved.adapter.id,
        });
      }
    }
    if (command !== 'plan') {
      resolved ??= resolveRuntimeAdapter({
        projectRoot: process.cwd(),
        explicit: options.get('--runtime'),
        strictRuntimeLock: command === 'ship' && options.has('--release-candidate'),
      });
      const result = launch(
        resolved.adapter,
        command === 'design-loop' || command === 'design-review' ? 'design' : command,
        feature,
        shipContext,
        resolved.diagnostics,
      );
      if (noLaunch || result.executionMode === 'handoff') {
        output(result);
        process.exitCode = 2;
      }
    }
  } else {
    throw new PipelineError('E_COMMAND_UNKNOWN', 'Unknown pipeline command. Run planr-pipeline help for legal commands.');
  }
} catch (error) {
  fail(error);
}
