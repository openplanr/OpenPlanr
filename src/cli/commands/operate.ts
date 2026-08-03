import { readFile } from 'node:fs/promises';
import type { Command, OptionValues } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { writeOperatingDecisionBriefArtifact } from '../../services/operate/decision-brief.js';
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
import { readOperatingDecisionBriefSource } from '../../services/operate/reports.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

// Runtime-authored Protocol v1.4 reports can carry rich Markdown and typed
// sidecars. This bounds only the returned report document; agents inspect the
// workspace directly, so repository size is never serialized through stdin.
const MAX_GUIDED_ANSWER_BYTES = 64 * 1024;
const MAX_AGENT_REPORT_BYTES = 256 * 1024;

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function projectDir(program: Command): string {
  return String(program.opts().projectDir);
}

function wantsJson(command: Command, options: OptionValues): boolean {
  return Boolean(options.json || command.optsWithGlobals().json);
}

async function readBoundedStdin(
  enabled: boolean,
  maxBytes = MAX_GUIDED_ANSWER_BYTES,
): Promise<string | undefined> {
  if (!enabled) return undefined;
  if (process.stdin.isTTY) {
    const error = new Error(
      'No piped JSON input is connected. Attach the complete bounded document and EOF before launching a --stdin action.',
    );
    error.name = 'E_OPERATE_STDIN_REQUIRED';
    throw error;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      const error = new Error(`Standard input exceeds the ${maxBytes}-byte limit.`);
      error.name = 'E_OPERATE_INPUT_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trimEnd();
}

/**
 * Resolve one bounded guided-answer document for the init flow. `--answers-file
 * <path>` is a stdin-parity alias: it reads the same 64 KiB-bounded UTF-8 string
 * `--stdin` would, so the downstream strict parser and digest binding are
 * identical — it never introduces an inline-JSON code path. TTY-guard semantics
 * are preserved: only `--stdin` requires a connected non-TTY pipe. This transport
 * is now discoverable: the questionnaire advertises it in
 * `submission.transport.alternates` (kind `answers-file`) alongside the stdin
 * entry, so a contract-conformant runtime never has to assume stdin is the only
 * channel. Exported for direct parity testing.
 */
export async function readBoundedInitAnswers(
  options: OptionValues,
  maxBytes = MAX_GUIDED_ANSWER_BYTES,
): Promise<string | undefined> {
  const answersFile =
    typeof options.answersFile === 'string' && options.answersFile.trim()
      ? options.answersFile
      : undefined;
  if (answersFile === undefined) return readBoundedStdin(Boolean(options.stdin), maxBytes);
  const buffer = await readFile(answersFile).catch(() => {
    const error = new Error(
      `Unable to read the answers file at ${answersFile}. Provide a readable bounded JSON document.`,
    );
    error.name = 'E_OPERATE_STDIN_REQUIRED';
    throw error;
  });
  if (buffer.byteLength > maxBytes) {
    const error = new Error(`The answers file exceeds the ${maxBytes}-byte limit.`);
    error.name = 'E_OPERATE_INPUT_TOO_LARGE';
    throw error;
  }
  return buffer.toString('utf8').trimEnd();
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
  // FR10 / T-008: surface the adapter session lease (expiry + remaining) as a
  // plain human line so an operator inspecting a lifecycle result sees, without
  // reading raw JSON, how long the prepared session is still valid.
  if (
    typeof result.action === 'string' &&
    (result.action.startsWith('adapter.') || result.action.startsWith('harness.')) &&
    result.data &&
    typeof result.data === 'object' &&
    !Array.isArray(result.data)
  ) {
    const lease = (result.data as Record<string, unknown>).leaseStatus;
    if (lease && typeof lease === 'object' && !Array.isArray(lease)) {
      const status = lease as {
        expiresAt?: unknown;
        remainingSeconds?: unknown;
        expired?: unknown;
      };
      const remaining =
        typeof status.remainingSeconds === 'number' ? `${status.remainingSeconds}s` : 'unknown';
      display.line(
        status.expired === true
          ? `Adapter lease: expired at ${String(status.expiresAt)}`
          : `Adapter lease: expires ${String(status.expiresAt)} (${remaining} remaining)`,
      );
    }
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
  // Commander keeps options declared on `planr operate` (focus/depth/research/
  // runtime) on the parent command. Merge the complete command chain here so a
  // subcommand never silently loses an explicitly selected runtime and falls
  // back to `auto`/`unknown`. Leaf options retain precedence.
  const resolvedOptions: OptionValues = { ...command.optsWithGlobals(), ...options };
  const json = wantsJson(command, resolvedOptions);
  let stdin: string | undefined;
  try {
    const richAgentDocument = ['context.review', 'harness.record', 'adapter.record'].includes(
      action,
    );
    stdin = await readBoundedInitAnswers(
      resolvedOptions,
      richAgentDocument ? MAX_AGENT_REPORT_BYTES : MAX_GUIDED_ANSWER_BYTES,
    );
  } catch (error) {
    const code =
      error instanceof Error && error.name.startsWith('E_')
        ? error.name
        : 'E_OPERATE_INPUT_TOO_LARGE';
    const recovery =
      code === 'E_OPERATE_STDIN_REQUIRED'
        ? 'Attach one bounded JSON document to stdin before launching this exact command.'
        : `Reduce the stdin payload to ${
            ['context.review', 'harness.record', 'adapter.record'].includes(action)
              ? MAX_AGENT_REPORT_BYTES
              : MAX_GUIDED_ANSWER_BYTES
          } bytes or fewer and retry.`;
    const result: OperateActionResult = {
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action,
      code,
      message: error instanceof Error ? error.message : String(error),
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: [recovery],
      next: [recovery],
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
      ...resolvedOptions,
      ...(Array.isArray(resolvedOptions.component)
        ? { components: resolvedOptions.component }
        : {}),
      json,
      yes: Boolean(resolvedOptions.yes || program.opts().yes),
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

/**
 * FR14 (T-005): before the human review gate presents a cycle as reviewable, the
 * CLI — not the orchestrating model — verifies from on-disk artifacts which
 * completion phase the cycle actually reached. When phase F is not met it prints
 * the real current phase, the next required phase, and the exact missing
 * artifacts first, so a cycle is never presented as review-ready on the strength
 * of a successful `run`, a successful `harness prepare`, or launched advisors
 * alone. `--json` is untouched: it keeps returning the exact raw state object.
 */
async function reviewWithCompletionGate(
  program: Command,
  command: Command,
  cycleId: string | undefined,
  options: OptionValues,
): Promise<void> {
  if (!wantsJson(command, options)) {
    try {
      const { inspectOperatingCompletion, renderOperatingReviewGateNotice } = await import(
        '../../services/operate/completion.js'
      );
      const completion = await inspectOperatingCompletion({
        projectRoot: projectDir(program),
        cycleId,
        localRoot: typeof options.localRoot === 'string' ? options.localRoot : undefined,
      });
      if (completion) {
        for (const line of renderOperatingReviewGateNotice(completion)) display.line(line);
      }
    } catch {
      // If committed state cannot be read here, the review execution below
      // surfaces the real, actionable error rather than a phase banner.
    }
  }
  return execute(program, command, 'review', { cycleId }, options);
}

/**
 * FR7 / E-007 — render `operate brief` / `operate decisions show` into a
 * self-contained, offline artifact via the pipeline builder, then write it to
 * the operator-supplied `--render <path>`. This is a share-on-request boundary:
 * it runs only when `--render` is present and never publishes. Sensitivity
 * ceilings are enforced during rendering (above-ceiling evidence is dropped),
 * and an external `http(s)://` reference fails closed via the pipeline error.
 */
async function renderDecisionBriefArtifact(
  program: Command,
  command: Command,
  target: { cycleId?: string; decisionId?: string; destination: string },
  options: OptionValues,
): Promise<OperateActionResult> {
  const action = target.decisionId ? 'decisions.render' : 'brief.render';
  const json = wantsJson(command, options);
  const localRoot = typeof options.localRoot === 'string' ? { localRoot: options.localRoot } : {};
  try {
    const source = await readOperatingDecisionBriefSource({
      projectRoot: projectDir(program),
      ...(target.cycleId ? { cycleId: target.cycleId } : {}),
      ...(target.decisionId ? { decisionId: target.decisionId } : {}),
      ...localRoot,
    });
    const written = await writeOperatingDecisionBriefArtifact({
      projectRoot: projectDir(program),
      destination: target.destination,
      source,
      ...localRoot,
    });
    const result: OperateActionResult = {
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: true,
      action,
      message: `Rendered a self-contained offline decision brief to ${target.destination}.`,
      cycleId: source.cycleId || null,
      state: null,
      paths: { artifact: written.path },
      counts: { redactedEvidence: written.redactedEvidenceRefs.length },
      warnings:
        written.redactedEvidenceRefs.length > 0
          ? [
              `Withheld ${written.redactedEvidenceRefs.length} citation(s) above the ${written.sensitivityCeiling} sensitivity ceiling.`,
            ]
          : [],
      nextActions: [`Open ${target.destination} in a browser to review it offline.`],
      next: [],
      data: {
        path: written.path,
        sha256: written.sha256,
        offline: written.offline,
        sandbox: written.sandbox,
        sensitivityCeiling: written.sensitivityCeiling,
        redactedEvidenceRefs: written.redactedEvidenceRefs,
      },
      exitCode: 0,
    };
    if (json) display.line(JSON.stringify(result));
    else renderHuman(result);
    return result;
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string' &&
      /^E_[A-Z0-9_]+$/.test((error as { code: string }).code)
        ? (error as { code: string }).code
        : 'E_OPERATE_INTERNAL';
    const result: OperateActionResult = {
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action,
      code,
      message: error instanceof Error ? error.message : String(error),
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: [],
      next: [],
      exitCode: 1,
    };
    if (json) display.line(JSON.stringify(result));
    else renderHuman(result);
    process.exitCode = result.exitCode;
    return result;
  }
}

async function executeRunWithProviderConsent(
  program: Command,
  command: Command,
  options: OptionValues,
): Promise<OperateActionResult> {
  const first = await executeForResult(program, command, 'run', {}, options);
  // FR7/E-007: first-use provider consent now returns an `ok: true` handoff
  // (`flow: 'handoff'`, code `E_OPERATE_AUTHORITY_REQUIRED`), not a failure.
  // Detect that continuation to disclose the policy and retry with authority.
  const consentHandoff = first.flow === 'handoff' && first.code === 'E_OPERATE_AUTHORITY_REQUIRED';
  if (!consentHandoff || wantsJson(command, options) || isNonInteractive()) {
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
  if (options.resume || options.cancelSession || options.stdin || options.answersFile)
    return options;
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
    `read one runtime-authored document from standard input (maximum ${MAX_AGENT_REPORT_BYTES} bytes)`,
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
  configure: {
    augmentShow?: (command: Command) => Command;
    showAction?: (context: {
      command: Command;
      id: string;
      opts: OptionValues;
    }) => Promise<boolean> | boolean;
  } = {},
): Command {
  json(parent.command('list').description(`List ${noun}`)).action(function (this: Command, opts) {
    return execute(program, this, `${noun}.list`, {}, opts);
  });
  const showCommand = parent
    .command(`show <${singularArgument}>`)
    .description(`Show one ${noun.replace(/s$/, '')}`);
  json(configure.augmentShow ? configure.augmentShow(showCommand) : showCommand).action(function (
    this: Command,
    id: string,
    opts,
  ) {
    if (configure.showAction) {
      return (async () => {
        const handled = await configure.showAction?.({ command: this, id, opts });
        if (!handled) await execute(program, this, `${noun}.show`, { id }, opts);
      })();
    }
    return execute(program, this, `${noun}.show`, { id }, opts);
  });
  return parent;
}

export function registerOperateCommand(program: Command): void {
  const operate = json(
    program
      .command('operate')
      .description(
        'Turn verified product evidence into governed DEV, OWNER, and AGENT routes through the agent-native Operating Board',
      )
      .option('--focus <lens>', 'evaluate one lens (repeatable)', collect, [])
      .option('--depth <depth>', 'standard or deep', 'standard')
      .option('--research <mode>', 'local or connected', 'local')
      .option('--runtime <runtime>', 'auto, claude, codex, or cursor', 'auto'),
  );

  operate.action(function (this: Command, opts) {
    return (async () => {
      const inspected = await executeOperateAction({
        action: 'inspect',
        projectRoot: projectDir(program),
        options: {},
        interactive: false,
      });
      const initialized = Boolean(
        inspected.data &&
          typeof inspected.data === 'object' &&
          (inspected.data as { initialized?: unknown }).initialized,
      );
      if (initialized) {
        await executeRunWithProviderConsent(program, this, opts);
        return;
      }
      await execute(
        program,
        this,
        'context.refresh',
        {},
        {
          ...opts,
          preview: false,
          yes: opts.research === 'connected' ? Boolean(opts.yes) : true,
        },
      );
    })();
  });

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
            `read one guided answer envelope (maximum ${MAX_GUIDED_ANSWER_BYTES} bytes)`,
            false,
          )
          .option(
            '--answers-file <path>',
            `read one guided answer envelope from a file (stdin parity, maximum ${MAX_GUIDED_ANSWER_BYTES} bytes)`,
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
        // A guided-stage advance is now an `ok: true` handoff (FR7/E-007), not a
        // failure: it still carries no apply action, so stop before confirming.
        if (!previewResult.ok || previewResult.flow === 'handoff') return;
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
  // FR10 / T-009: a distinct legacy operating-profile field migration under the
  // `profiles` namespace. This is NOT the unrelated `operate migrate` command
  // (legacy PLAN-era board-data import); it reconciles a stale
  // `.planr/operate-profile.json` whose `enabledProviders`/`budgets` the current
  // CLI would otherwise reject.
  const profilesMigrate = profiles
    .command('migrate')
    .description('Inspect or apply legacy operating-profile field migration');
  json(profilesMigrate.command('inspect')).action(function (this: Command, opts) {
    return execute(program, this, 'profiles.migrate.inspect', {}, opts);
  });
  // T-018: route apply through the action map so it receives the storage-layout
  // auto-migration guard. The interactive preview/confirm flow mirrors the sibling
  // `operate migrate apply` command; the migration's idempotent backup/rollback
  // semantics are unchanged (still enforced in profile-migration.ts).
  json(confirmed(profilesMigrate.command('apply'))).action(function (this: Command, opts) {
    return (async () => {
      const interactive =
        !wantsJson(this, opts) && !isNonInteractive() && !opts.yes && !program.opts().yes;
      if (!interactive) {
        await execute(program, this, 'profiles.migrate.apply', {}, opts);
        return;
      }
      const inspection = await executeForResult(
        program,
        this,
        'profiles.migrate.inspect',
        {},
        opts,
      );
      if (!inspection.ok) return;
      const data = inspection.data as
        | { present?: boolean; changed?: boolean; sourcePath?: string }
        | undefined;
      if (!data?.present || !data.changed) return;
      if (
        !(await promptConfirm(
          `Migrate ${data.sourcePath ?? '.planr/operate-profile.json'}? The exact pre-migration bytes are backed up first.`,
          false,
        ))
      ) {
        return;
      }
      await execute(program, this, 'profiles.migrate.apply', {}, { ...opts, yes: true });
    })();
  });

  const context = operate
    .command('context')
    .description('Research, validate, and review runtime-authored product context');
  json(context.command('show')).action(function (this: Command, opts) {
    return execute(program, this, 'context.show', {}, opts);
  });
  json(
    preview(
      confirmed(
        context
          .command('refresh')
          .option('--research <mode>', 'local or connected', 'local')
          .option('--runtime <runtime>', 'auto, claude, codex, or cursor', 'auto')
          .option('--confirm <digest>', 'confirm the exact connected-research preview'),
      ),
    ),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'context.refresh', {}, opts);
  });
  json(
    stdin(
      context
        .command('review')
        .description('Validate runtime-authored context claims against the prepared workspace'),
    ),
  ).action(function (this: Command, opts) {
    return execute(program, this, 'context.review', {}, opts);
  });

  const drafts = readGroup(
    program,
    operate.command('drafts').description('Inspect and govern provisional Operate drafts'),
    'drafts',
    'draftId',
  );
  json(
    confirmed(drafts.command('approve <draftId>').description('Approve one proposed draft')),
  ).action(function (this: Command, draftId: string, opts) {
    return execute(program, this, 'drafts.approve', { draftId }, opts);
  });
  json(
    confirmed(drafts.command('discard <draftId>').description('Discard one proposed draft')),
  ).action(function (this: Command, draftId: string, opts) {
    return execute(program, this, 'drafts.discard', { draftId }, opts);
  });

  json(
    confirmed(
      preview(
        operate
          .command('run')
          .description('Collect evidence and produce a reviewable operating cycle')
          .option('--cycle-id <cycleId>', 'resume exactly this operating cycle')
          .option('--offline', 'use local evidence and deterministic providers only', false)
          .option('--review-only', 'reconcile existing routes and outcomes only', false),
      ),
    ),
  ).action(function (this: Command, _opts) {
    // Commander passes parent option values when a subcommand repeats option
    // names declared on `operate`. Read the concrete `run` command directly so
    // explicit focus/depth/runtime flags are never replaced by parent defaults.
    return executeRunWithProviderConsent(program, this, {
      ...operate.opts(),
      ...this.opts(),
    }).then(() => undefined);
  });

  json(operate.command('review [cycleId]').description('Review a cycle at the human gate')).action(
    function (this: Command, cycleId: string | undefined, opts) {
      return reviewWithCompletionGate(program, this, cycleId, opts);
    },
  );
  json(operate.command('status').description('Show current operating status')).action(function (
    this: Command,
    opts,
  ) {
    return execute(program, this, 'status', {}, opts);
  });
  json(
    operate
      .command('brief [cycleId]')
      .description('Render the concise operating brief')
      .option(
        '--render <path>',
        'render a self-contained, offline decision brief to <path> (project-relative)',
      ),
  ).action(function (this: Command, cycleId: string | undefined, opts) {
    if (typeof opts.render === 'string' && opts.render.trim()) {
      return renderDecisionBriefArtifact(
        program,
        this,
        { cycleId, destination: opts.render },
        opts,
      ).then(() => undefined);
    }
    return execute(program, this, 'brief', { cycleId }, opts);
  });

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
  // SPEC-005 T-020: the operator escape for a cycle stranded at the advisors phase
  // because a runtime dispatched a lens and reported nothing. Valid once the
  // adapter lease has lapsed; terminally governs the still-unrecorded lenses
  // `not_evaluated` so consolidation can reach a reviewable cycle without discarding
  // the recorded siblings. Omit `--role` to reap every stalled lens at once.
  json(
    confirmed(
      cycles
        .command('abandon-role <cycleId>')
        .description('Terminally mark stalled lenses not_evaluated after the adapter lease lapsed')
        .option('--role <role>', 'a single stalled lens to abandon (default: every stalled lens)')
        .option('--reason <text>', 'why the lens is recorded not_evaluated'),
    ),
  ).action(function (this: Command, cycleId: string, opts) {
    return execute(program, this, 'cycles.abandon-role', { cycleId }, opts);
  });

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
    {
      augmentShow: (command) =>
        command.option(
          '--render <path>',
          'render a self-contained, offline decision brief to <path> (project-relative)',
        ),
      showAction: async ({ command, id, opts }) => {
        if (typeof opts.render !== 'string' || !opts.render.trim()) return false;
        await renderDecisionBriefArtifact(
          program,
          command,
          { decisionId: id, destination: opts.render },
          opts,
        );
        return true;
      },
    },
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

  readGroup(
    program,
    operate.command('evidence').description('Inspect sanitized evidence metadata'),
    'evidence',
    'evidenceId',
  );
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

  const lifecycle = (namespace: 'harness' | 'adapter', description: string): void => {
    const group = operate.command(namespace).description(description);
    json(
      machineBinding(
        group
          .command('prepare')
          .description('Prepare immutable Protocol v1.4 runtime-native role mandates'),
      ).option('--role <roles>', 'comma-separated operating roles bound to this dispatch'),
    ).action(function (this: Command, opts) {
      return execute(program, this, `${namespace}.prepare`, {}, { ...opts, json: true });
    });
    json(
      stdin(
        machineBinding(
          group
            .command('record')
            .description('Record one cited runtime-authored result for its prepared mandate')
            .requiredOption('--role <role>', 'operating advisor role'),
        ),
      ),
    ).action(function (this: Command, opts) {
      return execute(program, this, `${namespace}.record`, {}, { ...opts, json: true });
    });
    // `abandon` (FR13/SPEC-005 T-020) governs one dispatched-but-unrecorded lens
    // terminal `not_evaluated` with a reason, so a genuinely stalled lens no longer
    // strands the cycle. Same lease-bound machine binding as record; the runtime
    // invokes it when a lens exceeds its budget and never returns.
    json(
      machineBinding(
        group
          .command('abandon')
          .description('Govern one stalled runtime-dispatched lens terminal not_evaluated')
          .requiredOption('--role <role>', 'the stalled operating advisor role')
          .requiredOption('--reason <text>', 'why the lens is recorded not_evaluated'),
      ),
    ).action(function (this: Command, opts) {
      return execute(program, this, `${namespace}.abandon`, {}, { ...opts, json: true });
    });
    // `heartbeat` (FR2/SPEC-005) renews the lease with no role result and no
    // stdin — same lease-bound machine binding as resume/cancel/finalize.
    for (const action of ['finalize', 'resume', 'cancel', 'heartbeat']) {
      json(machineBinding(group.command(action))).action(function (this: Command, opts) {
        return execute(program, this, `${namespace}.${action}`, {}, { ...opts, json: true });
      });
    }
  };
  lifecycle('harness', 'Machine-only, runtime-bound agent harness lifecycle');
  lifecycle('adapter', 'Deprecated Protocol v1.3 lifecycle alias; use harness');
}
