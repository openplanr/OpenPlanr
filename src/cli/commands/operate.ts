import type { Command, OptionValues } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import {
  executeOperateAction,
  type OperateActionRequest,
  type OperateActionResult,
} from '../../services/operate/index.js';
import {
  evaluateOperatingInitQuestions,
  mergeOperatingInitAnswersIntoOptions,
  operatingInitAnswersFromOptions,
} from '../../services/operate/interaction/question-engine.js';
import {
  detectOperatingQuestionContext,
  renderOperatingInitQuestions,
} from '../../services/operate/interaction/terminal-renderer.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

const MAX_STDIN_BYTES = 64 * 1024;

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function projectDir(program: Command): string {
  return String(program.opts().projectDir);
}

function wantsJson(command: Command, options: OptionValues): boolean {
  return Boolean(options.json || command.optsWithGlobals().json);
}

async function readBoundedStdin(enabled: boolean): Promise<string | undefined> {
  if (!enabled) return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > MAX_STDIN_BYTES) {
      const error = new Error(`Standard input exceeds the ${MAX_STDIN_BYTES}-byte limit.`);
      error.name = 'E_OPERATE_INPUT_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trimEnd();
}

function renderHuman(result: OperateActionResult): void {
  if (result.message) {
    if (result.ok) logger.success(result.message);
    else logger.warn(result.message);
  }
  if (result.lines) {
    for (const line of result.lines) display.line(line);
  }
  if (result.data !== undefined) {
    if (
      result.action === 'inspect' &&
      typeof result.data === 'object' &&
      result.data !== null &&
      !Array.isArray(result.data)
    ) {
      const data = result.data as Record<string, unknown>;
      const pipeline =
        typeof data.pipeline === 'object' && data.pipeline !== null
          ? (data.pipeline as Record<string, unknown>)
          : {};
      display.line(`Project context: ${data.project === true ? 'detected' : 'not detected'}`);
      display.line(
        `Initialization: ${data.initialized === true ? 'configured' : 'not configured'}`,
      );
      display.line(
        pipeline.available === true
          ? `Pipeline: Protocol ${String(pipeline.protocolVersion ?? 'compatible')} ready`
          : 'Pipeline: not installed (read-only inspection remains available)',
      );
      if (typeof data.commitSafeRoot === 'string') {
        display.line(`Commit-safe state: ${data.commitSafeRoot}`);
      }
      if (typeof data.machineLocalState === 'string') {
        display.line(`Machine-local data: ${data.machineLocalState}`);
      }
    } else if (
      result.action === 'demo' &&
      typeof result.data === 'object' &&
      result.data !== null &&
      !Array.isArray(result.data)
    ) {
      const data = result.data as Record<string, unknown>;
      if (typeof data.brief === 'string') display.line(data.brief);
      const evidenceCount = Array.isArray(data.evidence) ? data.evidence.length : 0;
      display.line(
        `Evidence: ${evidenceCount} sanitized deterministic record${evidenceCount === 1 ? '' : 's'}`,
      );
      if (typeof data.note === 'string') display.line(data.note);
    } else if (typeof result.data === 'string') display.line(result.data);
    else display.line(JSON.stringify(result.data, null, 2));
  }
  if (result.preview !== undefined) {
    display.heading('Preview:');
    display.line(JSON.stringify(result.preview, null, 2));
  }
  if (result.next?.length) {
    display.blank();
    display.heading('Next:');
    for (const command of result.next) display.line(`  ${command}`);
  }
}

async function executeForResult(
  program: Command,
  command: Command,
  action: string,
  args: Record<string, string | undefined>,
  options: OptionValues,
): Promise<OperateActionResult> {
  const json = wantsJson(command, options);
  let stdin: string | undefined;
  try {
    stdin = await readBoundedStdin(Boolean(options.stdin));
  } catch (error) {
    const result: OperateActionResult = {
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action,
      code:
        error instanceof Error && error.name.startsWith('E_')
          ? error.name
          : 'E_OPERATE_INPUT_TOO_LARGE',
      message: error instanceof Error ? error.message : String(error),
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: ['Reduce the stdin payload to 65536 bytes or fewer and retry.'],
      next: ['Reduce the stdin payload to 65536 bytes or fewer and retry.'],
      exitCode: 2,
    };
    if (json) display.line(JSON.stringify(result));
    else renderHuman(result);
    process.exitCode = result.exitCode;
    return result;
  }
  const request: OperateActionRequest = {
    action,
    projectRoot: projectDir(program),
    arguments: Object.fromEntries(
      Object.entries(args).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    options: {
      ...options,
      ...(Array.isArray(options.source) ? { sources: options.source } : {}),
      ...(Array.isArray(options.component) ? { components: options.component } : {}),
      json,
      yes: Boolean(options.yes || program.opts().yes),
    },
    interactive: !json && !isNonInteractive(),
    ...(stdin === undefined ? {} : { stdin }),
  };
  const result = await executeOperateAction(request);
  if (json) display.line(JSON.stringify(result));
  else renderHuman(result);
  if (!result.ok) process.exitCode = result.exitCode ?? 1;
  return result;
}

async function execute(
  program: Command,
  command: Command,
  action: string,
  args: Record<string, string | undefined>,
  options: OptionValues,
): Promise<void> {
  await executeForResult(program, command, action, args, options);
}

async function executeRunWithProviderConsent(
  program: Command,
  command: Command,
  options: OptionValues,
): Promise<OperateActionResult> {
  const first = await executeForResult(program, command, 'run', {}, options);
  if (
    first.ok ||
    first.code !== 'E_OPERATE_AUTHORITY_REQUIRED' ||
    wantsJson(command, options) ||
    isNonInteractive()
  ) {
    return first;
  }
  const approved = await promptConfirm(
    'Approve the disclosed provider policy for this operating run?',
    false,
  );
  if (!approved) return first;
  process.exitCode = undefined;
  return executeForResult(
    program,
    command,
    'run',
    {},
    {
      ...options,
      yes: true,
    },
  );
}

async function guidedInitOptions(program: Command, options: OptionValues): Promise<OptionValues> {
  if (options.resume || options.cancelSession || options.stdin) return options;
  if (isNonInteractive() || options.json === true || program.opts().json === true) return options;
  const answers = operatingInitAnswersFromOptions(options);
  const context = await detectOperatingQuestionContext(projectDir(program));
  const state = await evaluateOperatingInitQuestions({
    answers,
    context,
    requireCharter: true,
  });
  if (state.status === 'preview-ready') {
    return mergeOperatingInitAnswersIntoOptions(options, state.answers);
  }
  const resolved = await renderOperatingInitQuestions({ initialAnswers: answers, context });
  return mergeOperatingInitAnswersIntoOptions(options, resolved);
}

function json(command: Command): Command {
  return command.option('--json', 'emit one versioned machine-readable result', false);
}

function preview(command: Command): Command {
  return command
    .option('--preview', 'inspect without writes or provider/model calls', false)
    .option('--dry-run', 'allow disclosed model calls but commit no state', false);
}

function confirmed(command: Command): Command {
  return command.option('--yes', 'confirm this named action non-interactively', false);
}

function stdin(command: Command): Command {
  return command.option(
    '--stdin',
    `read the sensitive answer from standard input (maximum ${MAX_STDIN_BYTES} bytes)`,
    false,
  );
}

function machineBinding(command: Command): Command {
  return command
    .option('--cycle-id <cycleId>', 'prepared operating cycle')
    .option('--evidence-digest <digest>', 'immutable evidence snapshot digest')
    .option('--lease <lease>', 'active adapter lease')
    .option('--idempotency-key <key>', 'idempotent lifecycle call key');
}

function readGroup(
  program: Command,
  parent: Command,
  noun: string,
  singularArgument: string,
): Command {
  json(parent.command('list').description(`List ${noun}`)).action(function (this: Command, opts) {
    return execute(program, this, `${noun}.list`, {}, opts);
  });
  json(
    parent.command(`show <${singularArgument}>`).description(`Show one ${noun.replace(/s$/, '')}`),
  ).action(function (this: Command, id: string, opts) {
    return execute(program, this, `${noun}.show`, { id }, opts);
  });
  return parent;
}

export function registerOperateCommand(program: Command): void {
  const operate = program
    .command('operate')
    .description('Turn verified product evidence into governed DEV, OWNER, and AGENT routes');

  json(
    operate
      .command('inspect')
      .description('Inspect Operating Board readiness without initialization or credentials'),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'inspect', {}, opts);
  });

  json(
    operate
      .command('demo')
      .description(
        'Produce a deterministic credential-free operating brief without project writes',
      ),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'demo', {}, opts);
  });

  json(
    operate
      .command('report [cycleId]')
      .description('Print the cycle brief and CEO/CTO/CPO/CMO/COO/Chair reports')
      .option('--lens <lens>', 'CEO, CTO, CPO, CMO, COO, Chair, or all', 'all')
      .option('--format <format>', 'markdown or json'),
  ).action(function (this: Command, cycleId: string | undefined, opts) {
    return execute(program, this, 'report', { cycleId }, opts);
  });

  json(
    confirmed(
      preview(
        operate
          .command('init')
          .description('Initialize the product charter, workspace, privacy, and runtime policy')
          .option('--profile <profile>', 'saas, product, engineering, or custom')
          .option('--profile-file <path>', 'custom operating profile')
          .option('--decision-owner <name>', 'human decision owner')
          .option('--planning-engine <engine>', 'openplanr or pipeline-po')
          .option('--runtime <runtime>', 'auto, claude, codex, or cursor')
          .option('--cadence <cadence>', 'manual, weekly, or monthly')
          .option('--timezone <zone>', 'IANA display timezone')
          .option('--component <path>', 'read-only component repository (repeatable)', collect, [])
          .option('--source <source>', 'evidence source (repeatable)', collect, [])
          .option(
            '--evidence-file <path>',
            'workspace-contained JSON/CSV evidence file (repeatable)',
            collect,
            [],
          )
          .option('--sensitivity-ceiling <class>', 'public, internal, confidential, or restricted')
          .option('--purpose <text>', 'product outcome for the operating charter')
          .option('--product-stage <stage>', 'current product stage')
          .option('--business-model <model>', 'explicit business model')
          .option('--ideal-customer <profile>', 'explicit ideal customer profile')
          .option('--goal <text>', 'current product goal (repeatable)', collect, [])
          .option('--success-metric <text>', 'success metric (repeatable)', collect, [])
          .option(
            '--guardrail <text>',
            'human authority or product guardrail (repeatable)',
            collect,
            [],
          )
          .option('--known-unknown <text>', 'known unknown (repeatable)', collect, [])
          .option('--resume <session-id>', 'resume a machine-local guided initialization session')
          .option(
            '--stdin',
            `read one guided answer envelope (maximum ${MAX_STDIN_BYTES} bytes)`,
            false,
          )
          .option('--cancel-session', 'cancel and remove the resumed guided session', false)
          .option(
            '--preview-created-at <timestamp>',
            'bind a direct flag-based apply to the timestamp returned by its preview',
          )
          .option(
            '--answers-token <token>',
            'replay the exact non-secret initialization answers returned by a preview',
          )
          .option('--confirm <digest>', 'confirm the exact session preview digest'),
      ),
    ),
  ).action(function (this: Command, opts) {
    return (async () => {
      const resolved = await guidedInitOptions(program, opts);
      const interactive =
        !wantsJson(this, resolved) && !isNonInteractive() && !resolved.yes && !program.opts().yes;
      let result: OperateActionResult;
      if (interactive && !resolved.preview && !resolved.dryRun) {
        const previewResult = await executeForResult(
          program,
          this,
          'init',
          {},
          {
            ...resolved,
            preview: true,
          },
        );
        if (!previewResult.ok) return;
        if (!(await promptConfirm('Apply this exact Operating Board configuration?', true))) {
          return;
        }
        const confirmationDigest = (
          previewResult.actions?.find((action) => action.id === 'operate.init.apply') ?? null
        )?.confirmationDigest;
        const previewCreatedAt = (
          previewResult.preview as { previewCreatedAt?: string } | undefined
        )?.previewCreatedAt;
        if (!confirmationDigest) {
          throw new Error('Initialization preview did not return a confirmation digest.');
        }
        result = await executeForResult(
          program,
          this,
          'init',
          {},
          {
            ...resolved,
            preview: false,
            yes: true,
            confirm: confirmationDigest,
            previewCreatedAt,
          },
        );
      } else {
        result = await executeForResult(program, this, 'init', {}, resolved);
      }
      const legacyMigration = (
        result.data as
          | {
              legacyMigration?: {
                record?: { id?: string; state?: string } | null;
                counts?: { importable?: number; duplicates?: number; conflicts?: number };
              };
            }
          | undefined
      )?.legacyMigration;
      if (
        result.ok &&
        !resolved.preview &&
        !resolved.dryRun &&
        !resolved.json &&
        !isNonInteractive() &&
        legacyMigration?.record?.state === 'previewed'
      ) {
        const count = legacyMigration.counts?.importable ?? 0;
        if (
          await promptConfirm(
            `Import ${count} unambiguous legacy .planr/board record(s) now? Original files will remain untouched.`,
            false,
          )
        ) {
          const migrationResult = await executeForResult(
            program,
            this,
            'migrate.apply',
            {},
            { yes: true },
          );
          if (!migrationResult.ok) return;
        }
      }
      if (
        result.ok &&
        !resolved.preview &&
        !resolved.dryRun &&
        !resolved.json &&
        !isNonInteractive() &&
        (await promptConfirm('Run the first operating cycle now?', true))
      ) {
        await executeRunWithProviderConsent(program, this, {
          runtime: resolved.runtime ?? 'auto',
          depth: 'standard',
          focus: [],
          offline: false,
          reviewOnly: false,
          preview: false,
          dryRun: false,
          yes: false,
          json: false,
        });
      }
    })();
  });

  const config = operate
    .command('config')
    .description('Inspect or validate operating configuration');
  json(config.command('show')).action(function (this: Command, opts) {
    return execute(program, this, 'config.show', {}, opts);
  });
  json(config.command('edit')).action(function (this: Command, opts) {
    return execute(program, this, 'config.edit', {}, opts);
  });
  json(config.command('validate')).action(function (this: Command, opts) {
    return execute(program, this, 'config.validate', {}, opts);
  });

  const profiles = operate.command('profiles').description('Inspect operating profiles');
  json(profiles.command('list')).action(function (this: Command, opts) {
    return execute(program, this, 'profiles.list', {}, opts);
  });
  json(profiles.command('show <profile>')).action(function (this: Command, profile: string, opts) {
    return execute(program, this, 'profiles.show', { profile }, opts);
  });
  json(profiles.command('validate <path>')).action(function (this: Command, file: string, opts) {
    return execute(program, this, 'profiles.validate', { file }, opts);
  });

  const sources = operate.command('sources').description('Inspect and test evidence sources');
  json(sources.command('list')).action(function (this: Command, opts) {
    return execute(program, this, 'sources.list', {}, opts);
  });
  json(sources.command('show <source>')).action(function (this: Command, source: string, opts) {
    return execute(program, this, 'sources.show', { source }, opts);
  });
  json(sources.command('test <source>')).action(function (this: Command, source: string, opts) {
    return execute(program, this, 'sources.test', { source }, opts);
  });

  json(
    confirmed(
      preview(
        operate
          .command('run')
          .description('Collect evidence and produce a reviewable operating cycle')
          .option('--focus <lens>', 'evaluate one lens (repeatable)', collect, [])
          .option('--depth <depth>', 'standard or deep', 'standard')
          .option('--runtime <runtime>', 'auto, claude, codex, or cursor', 'auto')
          .option('--offline', 'use local evidence and deterministic providers only', false)
          .option('--review-only', 'reconcile existing routes and outcomes only', false),
      ),
    ),
  ).action(function (this: Command, opts) {
    return executeRunWithProviderConsent(program, this, opts).then(() => undefined);
  });

  json(operate.command('review [cycleId]').description('Review a cycle at the human gate')).action(
    function (this: Command, cycleId: string | undefined, opts) {
      return execute(program, this, 'review', { cycleId }, opts);
    },
  );
  json(operate.command('status').description('Show current operating status')).action(function (
    this: Command,
    opts,
  ) {
    return execute(program, this, 'status', {}, opts);
  });
  json(operate.command('brief [cycleId]').description('Render the concise operating brief')).action(
    function (this: Command, cycleId: string | undefined, opts) {
      return execute(program, this, 'brief', { cycleId }, opts);
    },
  );

  const cycles = readGroup(
    program,
    operate.command('cycles').description('Manage operating cycle lifecycle'),
    'cycles',
    'cycleId',
  );
  for (const action of ['resume', 'cancel', 'recover', 'close']) {
    json(
      confirmed(cycles.command(`${action} <cycleId>`).description(`${action} an operating cycle`)),
    ).action(function (this: Command, cycleId: string, opts) {
      return execute(program, this, `cycles.${action}`, { cycleId }, opts);
    });
  }

  const findings = readGroup(
    program,
    operate.command('findings').description('Govern operating findings'),
    'findings',
    'findingId',
  );
  for (const action of ['accept', 'reject', 'supersede']) {
    json(
      confirmed(
        findings
          .command(`${action} <findingId>`)
          .description(
            action === 'accept'
              ? 'Accept governance for a finding without applying its route'
              : `${action} a finding`,
          )
          .option('--impact <score>', 'audited Impact amendment')
          .option('--confidence <score>', 'audited Confidence amendment')
          .option('--ease <score>', 'audited Ease amendment')
          .option('--reason <text>', 'audit reason for the decision'),
      ),
    ).action(function (this: Command, findingId: string, opts) {
      return execute(program, this, `findings.${action}`, { findingId }, opts);
    });
  }

  const routes = readGroup(
    program,
    operate.command('routes').description('Preview, apply, or roll back governed routes'),
    'routes',
    'routeId',
  );
  json(
    confirmed(
      preview(
        routes
          .command('apply <routeId>')
          .description('Preview or apply the exact digest-bound route')
          .option('--preview-digest <digest>', 'digest returned by the route preview'),
      ),
    ),
  ).action(function (this: Command, routeId: string, opts) {
    return (async () => {
      const interactive =
        !wantsJson(this, opts) && !isNonInteractive() && !opts.yes && !program.opts().yes;
      if (!interactive || opts.preview || opts.dryRun) {
        await execute(program, this, 'routes.apply', { routeId }, opts);
        return;
      }
      let previewDigest = opts.previewDigest;
      if (!previewDigest) {
        const previewResult = await executeForResult(
          program,
          this,
          'routes.apply',
          { routeId },
          { ...opts, preview: true },
        );
        if (!previewResult.ok) return;
        previewDigest = (previewResult.data as { previewDigest?: string } | undefined)
          ?.previewDigest;
      }
      if (
        !previewDigest ||
        !(await promptConfirm(`Apply route ${routeId} using this exact preview digest?`, true))
      ) {
        return;
      }
      await execute(
        program,
        this,
        'routes.apply',
        { routeId },
        {
          ...opts,
          preview: false,
          previewDigest,
          yes: true,
        },
      );
    })();
  });
  json(confirmed(routes.command('rollback <routeId>'))).action(function (
    this: Command,
    routeId: string,
    opts,
  ) {
    return execute(program, this, 'routes.rollback', { routeId }, opts);
  });

  const decisions = readGroup(
    program,
    operate.command('decisions').description('Inspect and answer owner decisions'),
    'decisions',
    'decisionId',
  );
  json(
    confirmed(
      stdin(
        decisions
          .command('decide <decisionId>')
          .description('Record an owner decision')
          .option('--value <value>', 'decision value')
          .option('--reason <text>', 'decision rationale'),
      ),
    ),
  ).action(function (this: Command, decisionId: string, opts) {
    return execute(program, this, 'decisions.decide', { decisionId }, opts);
  });

  const gaps = readGroup(
    program,
    operate.command('gaps').description('Inspect and answer evidence gaps'),
    'gaps',
    'gapId',
  );
  json(
    confirmed(
      stdin(
        gaps
          .command('answer <gapId>')
          .description('Answer an evidence or charter gap')
          .option('--value <value>', 'answer value'),
      ),
    ),
  ).action(function (this: Command, gapId: string, opts) {
    return execute(program, this, 'gaps.answer', { gapId }, opts);
  });
  json(
    confirmed(
      gaps
        .command('verify <gapId>')
        .description('Verify an answered gap against collected evidence')
        .option('--evidence-ref <id>', 'verified evidence identifier (repeatable)', collect, []),
    ),
  ).action(function (this: Command, gapId: string, opts) {
    return execute(program, this, 'gaps.verify', { gapId }, opts);
  });

  const evidence = readGroup(
    program,
    operate.command('evidence').description('Inspect sanitized evidence metadata'),
    'evidence',
    'evidenceId',
  );
  json(
    evidence
      .command('diagnose [candidateId]')
      .description('Inspect value-free evidence diagnostics and supported recovery actions'),
  ).action(function (this: Command, candidateId: string | undefined, opts) {
    return execute(program, this, 'evidence.diagnose', { candidateId }, opts);
  });
  json(
    confirmed(
      evidence
        .command('classify <candidateId>')
        .description('Classify one exact evidence candidate without weakening scanner policy')
        .requiredOption('--status <status>', 'false-positive or confirmed-secret')
        .requiredOption('--reason <text>', 'bounded audit reason')
        .option('--confirm <digest>', 'confirm the exact classification preview digest'),
    ),
  ).action(function (this: Command, candidateId: string, opts) {
    return execute(program, this, 'evidence.classify', { candidateId }, opts);
  });

  const migrate = operate.command('migrate').description('Inspect or apply legacy board migration');
  json(migrate.command('inspect')).action(function (this: Command, opts) {
    return execute(program, this, 'migrate.inspect', {}, opts);
  });
  json(confirmed(migrate.command('apply'))).action(function (this: Command, opts) {
    return (async () => {
      const interactive =
        !wantsJson(this, opts) && !isNonInteractive() && !opts.yes && !program.opts().yes;
      if (!interactive) {
        await execute(program, this, 'migrate.apply', {}, opts);
        return;
      }
      const inspection = await executeForResult(program, this, 'migrate.inspect', {}, opts);
      if (!inspection.ok) return;
      const record = (
        inspection.data as { record?: { id?: string; state?: string } | null } | undefined
      )?.record;
      if (!record) return;
      if (
        record.state !== 'previewed' ||
        !(await promptConfirm(
          `Apply legacy migration ${record.id}? Exact source bytes will be backed up and left untouched.`,
          false,
        ))
      ) {
        return;
      }
      await execute(program, this, 'migrate.apply', {}, { ...opts, yes: true });
    })();
  });

  const migrations = readGroup(
    program,
    operate.command('migrations').description('Inspect or roll back operating migrations'),
    'migrations',
    'migrationId',
  );
  json(confirmed(migrations.command('rollback <migrationId>'))).action(function (
    this: Command,
    migrationId: string,
    opts,
  ) {
    return (async () => {
      const interactive =
        !wantsJson(this, opts) && !isNonInteractive() && !opts.yes && !program.opts().yes;
      if (
        interactive &&
        !(await promptConfirm(
          `Roll back imported state for ${migrationId}? Legacy source files will not be changed.`,
          false,
        ))
      ) {
        return;
      }
      await execute(
        program,
        this,
        'migrations.rollback',
        { migrationId },
        interactive ? { ...opts, yes: true } : opts,
      );
    })();
  });

  const cache = operate.command('cache').description('Inspect or purge machine-local evidence');
  json(cache.command('status')).action(function (this: Command, opts) {
    return execute(program, this, 'cache.status', {}, opts);
  });
  json(confirmed(cache.command('purge'))).action(function (this: Command, opts) {
    return execute(program, this, 'cache.purge', {}, opts);
  });

  const integrity = operate
    .command('integrity')
    .description('Inspect or enable signed checkpoints');
  json(integrity.command('status')).action(function (this: Command, opts) {
    return execute(program, this, 'integrity.status', {}, opts);
  });
  json(confirmed(integrity.command('enable'))).action(function (this: Command, opts) {
    return execute(program, this, 'integrity.enable', {}, opts);
  });

  const diagnostics = operate.command('diagnostics').description('Export redacted diagnostics');
  json(
    diagnostics.command('export').option('--output <path>', 'output archive or JSON path'),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'diagnostics.export', {}, opts);
  });

  const security = operate.command('security').description('Exceptional sensitive-data repair');
  json(confirmed(security.command('repair'))).action(function (this: Command, opts) {
    return execute(program, this, 'security.repair', {}, opts);
  });

  const adapter = operate
    .command('adapter')
    .description('Machine-only, lease-bound runtime adapter lifecycle');
  json(
    machineBinding(adapter.command('prepare')).option(
      '--role <roles>',
      'comma-separated advisor roles bound to this isolated dispatch',
    ),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'adapter.prepare', {}, { ...opts, json: true });
  });
  json(
    stdin(
      machineBinding(
        adapter.command('record').requiredOption('--role <role>', 'operating advisor role'),
      ),
    ),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'adapter.record', {}, { ...opts, json: true });
  });
  for (const action of ['finalize', 'resume', 'cancel']) {
    json(machineBinding(adapter.command(action))).action(function (this: Command, opts) {
      return execute(program, this, `adapter.${action}`, {}, { ...opts, json: true });
    });
  }
}
