import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { computeNextDueAt } from './cadence.js';
import { canonicalDigest, sha256Digest } from './canonical.js';
import {
  applyOperatingInitialization,
  getOperatingProfile,
  listOperatingProfiles,
  normalizeCustomOperatingProfile,
  normalizeOperatingInitializationAnswers,
  type OperatingInitializationPreview,
  parseOperatingDispatchModeOverrideFlags,
  prepareOperatingInitialization,
  readOperatingLastRunAt,
  validateOperatingConfiguration,
} from './config.js';
import { runOperatingCycle } from './engine.js';
import { OperatingEventStore } from './event-store.js';
import { classifyEvidenceDiagnostic } from './evidence-classifications.js';
import { listEvidenceDiagnostics, readEvidenceDiagnostic } from './evidence-diagnostics.js';
import { parseStrictJson, readImportedEvidenceFile } from './evidence-import.js';
import { createOperatingAction } from './interaction/action-service.js';
import {
  persistableOperatingInitAnswers,
  resumeGuidedSession,
  submitGuidedAnswers,
} from './interaction/answer-service.js';
import { assertOperatingConfirmation } from './interaction/confirmation-service.js';
import {
  decodeOperatingInitializationReplay,
  encodeOperatingInitializationReplay,
} from './interaction/initialization-replay.js';
import {
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
  operatingInitAnswersFromOptions,
} from './interaction/question-engine.js';
import {
  cancelGuidedSession,
  createGuidedSession,
  createGuidedSessionId,
  currentGuidedSessionBindings,
  updateGuidedSession,
} from './interaction/session-service.js';
import { assertCommittedOperatingView } from './journal.js';
import {
  applyOperatingMigration,
  inspectOperatingMigration,
  rollbackOperatingMigration,
} from './legacy-import-service.js';
import {
  answerOperatingGap,
  applyOrRollbackRoute,
  decideOperatingDecision,
  governOperatingFinding,
  readOperatingCollection,
  readOperatingReview,
  transitionOperatingCycle,
  verifyOperatingGap,
} from './lifecycle.js';
import {
  createOperatingAdapterStartHandoff,
  exportOperatingDiagnostics,
  operateAdapterLifecycle,
  operatingCacheAction,
  operatingIntegrityAction,
  repairOperatingSecurity,
} from './maintenance.js';
import { migrateOperatingStorageLayoutOnOpen } from './migration.js';
import { renderOperatingBrief } from './projection.js';
import { loadOperatingProtocol, resolveOperatingPipelineRoot } from './protocol.js';
import { executeGitHubReadOnly, executeGitReadOnly } from './read-only-providers.js';
import { readOperatingReport } from './reports.js';
import {
  type OperateActionRequest,
  type OperateActionResult,
  OperateError,
  type OperateErrorCode,
  type OperatingAdapterHandoff,
  type OperatingCharter,
  type OperatingConfig,
  type OperatingInitAnswers,
  type OperatingProfile,
  type OperatingState,
} from './types.js';
import {
  assertOperatingProject,
  resolveContainedPath,
  resolveOperatingPaths,
  resolveOperatingProject,
} from './workspace.js';

export {
  canonicalDigest,
  canonicalize,
  sha256Digest,
} from './canonical.js';
export { OperatingEventStore } from './event-store.js';
export {
  acquireOperatingLock,
  recoverStaleOperatingLock,
  withOperatingLock,
} from './lock-service.js';
export {
  assertOperatingProjectionsCurrent,
  inspectOperatingProjectionDrift,
  persistOperatingProjections,
  prepareOperatingProjectionPersistence,
  renderOperatingProjectionFiles,
} from './projection-persistence.js';
export {
  assertOperatingArtifact,
  loadOperatingProtocol,
  operatingPipelineAvailable,
} from './protocol.js';
export type {
  OperateActionRequest,
  OperateActionResult,
  OperatingConfig,
} from './types.js';

function option<T>(request: OperateActionRequest, name: string, fallback: T): T {
  return (request.options[name] as T | undefined) ?? fallback;
}

function argument(request: OperateActionRequest, name: string): string | undefined {
  const value = request.arguments?.[name];
  return typeof value === 'string' ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((entry) => entry.trim())
      .filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [];
}

async function resolvedOperatingRuntime(projectRoot: string, requested: string): Promise<string> {
  if (requested !== 'auto') return requested;
  return readFile(
    path.join(resolveOperatingPaths(projectRoot).localRoot, 'preferences.json'),
    'utf8',
  )
    .then((raw) => {
      const runtime = (JSON.parse(raw) as { runtime?: unknown }).runtime;
      return typeof runtime === 'string' && runtime ? runtime : 'auto';
    })
    .catch(() => 'auto');
}

async function usesNativeOperatingAdvisors(
  projectRoot: string,
  requestedRuntime: string,
): Promise<boolean> {
  const runtime = await resolvedOperatingRuntime(projectRoot, requestedRuntime);
  const adapterId = runtime === 'claude' ? 'claude-code' : runtime;
  if (adapterId === 'auto') return false;
  const pipelineRoot = resolveOperatingPipelineRoot();
  if (!pipelineRoot) return false;
  const registry = await readFile(path.join(pipelineRoot, 'registry', 'adapters.json'), 'utf8')
    .then(
      (raw) =>
        JSON.parse(raw) as {
          adapters?: Array<{
            id?: string;
            capabilities?: {
              toolIsolation?: string;
              operatingBoard?: boolean;
              operatingAdvisorDispatch?: string;
              subagents?: string;
              headlessBridge?: boolean;
            };
          }>;
        },
    )
    .catch(() => ({ adapters: [] }));
  const adapter = registry.adapters?.find((entry) => entry.id === adapterId);
  if (adapter?.capabilities?.operatingBoard !== true) return false;
  if (
    ['native-isolated', 'native-bounded'].includes(
      adapter.capabilities.operatingAdvisorDispatch ?? '',
    )
  ) {
    return true;
  }
  // Compatibility with Protocol v1.2 registries published before the
  // operatingAdvisorDispatch capability was added.
  return (
    adapter.capabilities.toolIsolation === 'enforced' ||
    (adapterId === 'codex' &&
      adapter.capabilities.subagents === 'dynamic' &&
      adapter.capabilities.headlessBridge === true)
  );
}

async function readOperatingLocalFile(
  projectRoot: string,
  selector: (paths: ReturnType<typeof resolveOperatingPaths>) => string,
): Promise<string> {
  const canonicalRoot = await resolveOperatingProject(projectRoot).catch(() => projectRoot);
  for (const candidate of [...new Set([projectRoot, canonicalRoot])]) {
    try {
      return await readFile(selector(resolveOperatingPaths(candidate)), 'utf8');
    } catch {
      // Try the canonical invocation path before reporting the file as absent.
    }
  }
  throw new OperateError(
    'E_OPERATE_NOT_INITIALIZED',
    'Machine-local operating source configuration is unavailable.',
  );
}

async function readCustomOperatingProfile(
  projectRoot: string,
  file: string,
): Promise<Partial<OperatingProfile>> {
  const resolved = await resolveContainedPath(projectRoot, file, { mustExist: true });
  try {
    return normalizeCustomOperatingProfile(parseStrictJson(await readFile(resolved, 'utf8')));
  } catch (error) {
    if (error instanceof OperateError && error.code === 'E_OPERATE_CONFIG_INVALID') {
      throw error;
    }
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Custom profile must be a valid bounded JSON object.',
    );
  }
}

function success(
  action: string,
  value: Partial<
    Omit<OperateActionResult, 'schemaVersion' | 'protocolVersion' | 'ok' | 'action'>
  > = {},
): OperateActionResult {
  const nextActions = value.nextActions ?? value.next ?? [];
  return {
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ok: true,
    action,
    ...value,
    state: value.state ?? null,
    paths: value.paths ?? {},
    counts: value.counts ?? {},
    warnings: value.warnings ?? [],
    nextActions,
  };
}

/**
 * Stable process exit classes for automation.
 *
 * 2 — invalid invocation or configuration
 * 3 — required project/component is unavailable
 * 4 — explicit human authority or confirmation is required
 * 5 — committed state, integrity, or concurrency conflict
 * 6 — evidence/provider/advisor execution could not complete safely
 * 1 — unexpected internal failure
 *
 * Keep this exhaustive so adding a public Operate error cannot silently fall
 * through to the internal-error class.
 */
const OPERATE_EXIT_CODES = {
  E_OPERATE_INTERNAL: 1,
  E_OPERATE_ACTION_UNKNOWN: 2,
  E_OPERATE_ARTIFACT_REJECTED: 2,
  E_OPERATE_CHARTER_INCOMPLETE: 2,
  E_OPERATE_CONFIG_INVALID: 2,
  E_OPERATE_INPUT_TOO_LARGE: 2,
  E_OPERATE_QUESTIONNAIRE_INVALID: 2,
  E_OPERATE_PATH_ESCAPE: 2,
  E_OPERATE_NOT_INITIALIZED: 3,
  E_OPERATE_PROJECT_REQUIRED: 3,
  E_PIPELINE_NOT_INSTALLED: 3,
  E_PIPELINE_VERSION_INCOMPATIBLE: 3,
  E_OPERATE_AUTHORITY_REQUIRED: 4,
  E_OPERATE_INPUT_REQUIRED: 4,
  E_OPERATE_SESSION_CANCELLED: 4,
  E_OPERATE_SESSION_EXPIRED: 4,
  E_OPERATE_ROUTE_CONFIRMATION_REQUIRED: 4,
  E_OPERATE_CHECKPOINT_INVALID: 5,
  E_OPERATE_CYCLE_ACTIVE: 5,
  E_OPERATE_CYCLE_INPUT_CONFLICT: 5,
  E_OPERATE_CYCLE_NOT_DISPOSED: 5,
  E_OPERATE_HEAD_DIVERGED: 5,
  E_OPERATE_MIGRATION_CONFLICT: 5,
  E_OPERATE_OUTCOME_NOT_READY: 5,
  E_OPERATE_PLANNER_CONFLICT: 5,
  E_OPERATE_PROJECTION_DRIFT: 5,
  E_OPERATE_ROUTE_DRIFT: 5,
  E_OPERATE_SECURITY_REPAIR_REQUIRED: 5,
  E_OPERATE_STALE_LOCK_UNSAFE: 5,
  E_OPERATE_STATE_INVALID: 5,
  E_OPERATE_STATE_UNAVAILABLE: 3,
  E_OPERATE_TRANSACTION_INVALID: 5,
  E_OPERATE_SESSION_REPLAY_CONFLICT: 5,
  E_OPERATE_SESSION_STALE: 5,
  E_OPERATE_ADVISOR_FAILED: 6,
  E_OPERATE_ADVISOR_ISOLATION: 6,
  E_OPERATE_CAP_EXCEEDED: 6,
  E_OPERATE_CRITICAL_CAP: 6,
  E_OPERATE_EVIDENCE_BUDGET: 6,
  E_OPERATE_EVIDENCE_NOT_READY: 6,
  E_OPERATE_EVIDENCE_REJECTED: 6,
  E_OPERATE_PROVIDER_READ_ONLY: 6,
  E_OPERATE_SECRET_DETECTED: 6,
  E_OPERATE_MISSION_PACKET_BUDGET: 6,
  E_OPERATE_MISSION_UNAVAILABLE: 3,
  E_OPERATE_SESSION_INVALID: 2,
} as const satisfies Readonly<Record<OperateErrorCode, number>>;

function operateExitCode(code: OperateErrorCode): number {
  return OPERATE_EXIT_CODES[code];
}

function failure(action: string, error: unknown): OperateActionResult {
  const code = error instanceof OperateError ? error.code : 'E_OPERATE_INTERNAL';
  const confirmationAction =
    error instanceof OperateError &&
    error.details?.action &&
    typeof error.details.action === 'object' &&
    !Array.isArray(error.details.action)
      ? (error.details.action as { command?: unknown; confirmationDigest?: unknown })
      : null;
  const confirmationRecovery =
    code === 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED' &&
    typeof confirmationAction?.command === 'string' &&
    typeof confirmationAction.confirmationDigest === 'string'
      ? [`${confirmationAction.command} --confirm ${confirmationAction.confirmationDigest} --yes`]
      : null;
  const explicitRecovery =
    error instanceof OperateError && typeof error.details?.recoveryCommand === 'string'
      ? [error.details.recoveryCommand]
      : null;
  const nextActions =
    explicitRecovery ??
    confirmationRecovery ??
    (code === 'E_PIPELINE_NOT_INSTALLED'
      ? ['npm install -g openplanr@latest', 'planr setup --scope user', 'planr operate inspect']
      : code === 'E_OPERATE_NOT_INITIALIZED'
        ? ['planr operate init']
        : code === 'E_OPERATE_PROJECT_REQUIRED'
          ? ['cd /path/to/your/project', 'planr init', 'planr operate inspect']
          : code === 'E_OPERATE_CONFIG_INVALID' || code === 'E_OPERATE_CHARTER_INCOMPLETE'
            ? ['planr operate config validate']
            : code === 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED'
              ? ['planr operate routes apply <route-id> --preview --json']
              : code === 'E_OPERATE_MIGRATION_CONFLICT'
                ? ['planr operate migrate inspect', 'planr operate migrations list']
                : code === 'E_OPERATE_HEAD_DIVERGED' ||
                    code === 'E_OPERATE_CHECKPOINT_INVALID' ||
                    code === 'E_OPERATE_PROJECTION_DRIFT'
                  ? ['planr operate integrity status', 'planr operate cycles recover <cycle-id>']
                  : code === 'E_OPERATE_CYCLE_ACTIVE' || code === 'E_OPERATE_CYCLE_INPUT_CONFLICT'
                    ? ['planr operate status', 'planr operate cycles resume <cycle-id>']
                    : code === 'E_OPERATE_CYCLE_NOT_DISPOSED'
                      ? [
                          'planr operate findings list',
                          'planr operate decisions list',
                          'planr operate cycles close <cycle-id>',
                        ]
                      : code.startsWith('E_OPERATE_EVIDENCE') ||
                          code.startsWith('E_OPERATE_PROVIDER') ||
                          code.startsWith('E_OPERATE_ADVISOR')
                        ? ['planr operate sources list', 'planr operate run --preview --json']
                        : ['planr operate diagnostics export']);
  return {
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ok: false,
    action,
    code,
    message:
      error instanceof OperateError
        ? error.message
        : 'An unexpected internal Operating Board error occurred.',
    state: null,
    paths: {},
    counts: {},
    warnings: [],
    nextActions,
    data: error instanceof OperateError ? error.details : undefined,
    next: nextActions,
    exitCode: operateExitCode(code),
  };
}

function publicActionCommands(nextActions: readonly string[]): string[] {
  return [
    ...new Set(
      nextActions
        .flatMap((value) => value.split(/\s+&&\s+/))
        .map((value) =>
          value
            .trim()
            .replace(/\s+--yes(?=\s|$)/g, '')
            .replace(/\s+--confirm\s+\S+/g, '')
            .replace(/\s+--preview-digest\s+\S+/g, ''),
        )
        .filter((value) => /^planr\s+/.test(value)),
    ),
  ];
}

function hasFlag(command: string, flag: string): boolean {
  return new RegExp(`(?:^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(
    command,
  );
}

async function actionEffect(
  request: OperateActionRequest,
  command: string,
): Promise<import('./types.js').OperatingActionEffect> {
  if (
    /\b(?:inspect|status|brief|report|review|list|show)\b/.test(command) ||
    /\bconfig validate\b/.test(command) ||
    /\bprofiles validate\b/.test(command) ||
    /\bsources test\b/.test(command) ||
    (/\brun\b/.test(command) && hasFlag(command, '--preview')) ||
    /\bmigrate inspect\b/.test(command) ||
    /\bcache status\b/.test(command) ||
    /\bintegrity status\b/.test(command)
  ) {
    return 'read-only';
  }
  if (/\boperate run\b/.test(command)) {
    if (hasFlag(command, '--offline')) return 'project-write';
    const commandRuntime = command.match(/(?:^|\s)--runtime\s+(\S+)/)?.[1];
    if (
      await usesNativeOperatingAdvisors(
        request.projectRoot,
        commandRuntime ?? option(request, 'runtime', 'auto'),
      )
    ) {
      return 'project-write';
    }
    return 'provider-call';
  }
  if (/\badapter resume\b/.test(command)) return 'read-only';
  if (/\badapter finalize\b/.test(command)) return 'project-write';
  if (/\b(?:adapter (?:prepare|record|cancel)|cache purge|diagnostics export)\b/.test(command)) {
    return 'machine-local-write';
  }
  if (/\bpipeline (?:plan|ship)\b/.test(command)) return 'external-effect';
  return 'project-write';
}

async function attachStructuredActions(
  request: OperateActionRequest,
  result: OperateActionResult,
): Promise<OperateActionResult> {
  if (result.actions?.length || result.action === 'input_required') return result;
  const commands = publicActionCommands(result.nextActions);
  if (commands.length === 0) return result;
  // Planning-only installations intentionally omit the portable pipeline and
  // therefore its Protocol v1.2 action validators. Provider-free inspection
  // and demonstration must still work; their legacy nextActions remain the
  // compatible fallback until the full package is installed.
  if (!resolveOperatingPipelineRoot()) return result;
  const bindings = await currentGuidedSessionBindings(request.projectRoot);
  const eventHead = await new OperatingEventStore(request.projectRoot)
    .replay()
    .then((value) => (value.eventHead.hash ? value.eventHead : null))
    .catch(() => null);
  const requestDigest = canonicalDigest({
    action: request.action,
    arguments: request.arguments ?? {},
    options: Object.fromEntries(
      Object.entries(request.options)
        .filter(([key]) => !['yes', 'confirm', 'stdin'].includes(key))
        .map(([key, value]) => [key, canonicalDigest({ value })]),
    ),
  });
  const sessionId = `GIS-action-${requestDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const actions = [];
  for (const [index, command] of commands.entries()) {
    const effect = await actionEffect(request, command);
    const id = `operate.next.${canonicalDigest({ command }).slice(
      'sha256:'.length,
      'sha256:'.length + 20,
    )}`.toLowerCase();
    const created = await createOperatingAction({
      id,
      label: (() => {
        const publicLabel = command.replace(/^planr\s+/, '');
        return publicLabel.length <= 160
          ? publicLabel
          : `${publicLabel.slice(0, 157).trimEnd()}...`;
      })(),
      description: `Run the named ${effect} action returned by ${request.action}.`,
      command,
      effect,
      recommended: index === 0,
      ...(effect === 'read-only'
        ? {}
        : {
            confirmation: {
              sessionId,
              confirmationScope: `${request.action}:${index + 1}`,
              projectIdentity: bindings.projectIdentity,
              projectHead: bindings.projectHead,
              configHead: bindings.configHead,
              eventHead,
              arguments: [requestDigest],
              destinations: [],
              writes: [],
            },
          }),
    });
    actions.push(created.action);
  }
  return { ...result, actions };
}

async function inspect(request: OperateActionRequest): Promise<OperateActionResult> {
  const pipelineRoot = resolveOperatingPipelineRoot();
  const localRoot = option<string | undefined>(request, 'localRoot', undefined);
  const paths = resolveOperatingPaths(request.projectRoot, { localRoot });
  const customStateRoot = Boolean(localRoot ?? process.env.OPENPLANR_STATE_ROOT);
  const initialized = await readFile(paths.config, 'utf8').then(
    () => true,
    () => false,
  );
  let project = false;
  try {
    await assertOperatingProject(request.projectRoot);
    project = true;
  } catch {
    project = false;
  }
  return success(request.action, {
    message: initialized
      ? 'Operating Board is initialized.'
      : 'Operating Board is available; initialization is optional.',
    data: {
      project,
      initialized,
      pipeline: {
        available: Boolean(pipelineRoot),
        root: pipelineRoot ? '(installed)' : null,
        protocolVersion: pipelineRoot ? '1.2.0' : null,
      },
      commitSafeRoot: project ? '.planr/operate' : null,
      machineLocalState: customStateRoot ? paths.localRoot : '~/.planr/operate/<project-hash>',
    },
    next: initialized ? ['planr operate status'] : ['planr operate init'],
  });
}

function demo(request: OperateActionRequest): OperateActionResult {
  const evidence = [
    {
      id: 'EVD-demo-activation',
      source: 'demo-fixture',
      summary: 'The product has no verified activation baseline for the current cycle.',
      observedFrom: '2026-06-01T00:00:00.000Z',
      observedTo: '2026-06-30T23:59:59.000Z',
      sensitivity: 'public',
    },
    {
      id: 'EVD-demo-delivery',
      source: 'demo-fixture',
      summary: 'Delivery capacity is already allocated to three unmeasured feature bets.',
      observedFrom: '2026-06-01T00:00:00.000Z',
      observedTo: '2026-06-30T23:59:59.000Z',
      sensitivity: 'public',
    },
  ];
  const demoState: OperatingState = {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-07-01T00:00:00.000Z',
    eventHead: { sequence: 0, hash: null },
    cycles: [{ id: 'CYCLE-001', state: 'reviewable', health: 'normal' }],
    findings: [
      {
        id: 'FND-001',
        cycleId: 'CYCLE-001',
        status: 'proposed',
        title: 'Measure activation before increasing delivery scope',
        problem: 'The product has no verified activation baseline.',
        proposal: 'Create one bounded activation instrumentation specification.',
        severity: 'high',
        sensitivity: 'public',
        score: 48,
        lane: 'DEV',
        owner: 'product-engineering',
        parked: false,
        evidenceRefs: ['EVD-demo-activation', 'EVD-demo-delivery'],
      },
    ],
    decisions: [
      {
        id: 'DEC-001',
        cycleId: 'CYCLE-001',
        status: 'open',
        question: 'Which customer event defines activation?',
        recommendation: 'Choose one observable event before planning more feature work.',
        evidenceRefs: ['EVD-demo-activation'],
      },
    ],
    dataGaps: [],
    routes: [
      {
        id: 'ACT-001',
        cycleId: 'CYCLE-001',
        state: 'proposed',
        findingIds: ['FND-001'],
      },
    ],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [{ id: 'demo-fixture', status: 'collected', itemCount: 2 }],
    summary: {
      currentCycleId: 'CYCLE-001',
      currentConstraint: 'The product has no verified activation baseline.',
      quiet: false,
      evidenceFreshness: 'fresh',
      surfacedFindings: 1,
      parkedFindings: 0,
      openDecisions: 1,
      openGaps: 0,
      stalledItems: 0,
    },
  };
  return success(request.action, {
    message: 'Generated a deterministic, credential-free Operating Board demonstration.',
    data: {
      brief: renderOperatingBrief(demoState),
      evidence,
      state: demoState,
      note: 'Demo performs no provider/model calls and writes no project state.',
    },
    next: ['planr operate init'],
  });
}

async function initializationApplyAction(input: {
  request: OperateActionRequest;
  preview: OperatingInitializationPreview;
  bindings: Awaited<ReturnType<typeof currentGuidedSessionBindings>>;
  sessionId?: string;
  answers: OperatingInitAnswers;
}): Promise<Awaited<ReturnType<typeof createOperatingAction>>> {
  const sessionId =
    input.sessionId ??
    `GIS-init-${input.preview.previewDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const command = input.sessionId
    ? `planr operate init --resume ${input.sessionId}`
    : [
        'planr operate init',
        `--answers-token ${encodeOperatingInitializationReplay(input.answers)}`,
        `--preview-created-at ${input.preview.workspace.capturedAt}`,
      ].join(' ');
  return createOperatingAction({
    id: 'operate.init.apply',
    label: 'Apply Operating Board configuration',
    description:
      'Write only the reviewed charter, workspace, configuration, and machine-local preferences.',
    command,
    effect: 'project-write',
    recommended: true,
    confirmation: {
      sessionId,
      confirmationScope: 'operate.init.apply',
      projectIdentity: input.bindings.projectIdentity,
      projectHead: input.bindings.projectHead,
      configHead: input.bindings.configHead,
      eventHead: input.preview.expectedEventHead.hash ? input.preview.expectedEventHead : null,
      arguments: [
        `answers=${canonicalDigest(input.answers)}`,
        `preview=${input.preview.previewDigest}`,
      ],
      destinations: [
        ...input.preview.changedPaths,
        ...(input.preview.preferencesChanged ? ['~/.planr/operate/preferences.json'] : []),
      ],
      writes: input.preview.writes.map(
        (write) =>
          `${write.relativePath}:${write.operation ?? 'replace'}:${sha256Digest(write.content)}`,
      ),
    },
  });
}

async function initialize(request: OperateActionRequest): Promise<OperateActionResult> {
  await loadOperatingProtocol();
  const replayToken = option<string | undefined>(request, 'answersToken', undefined);
  let supplied = replayToken
    ? decodeOperatingInitializationReplay(replayToken)
    : normalizeOperatingInitializationAnswers(operatingInitAnswersFromOptions(request.options));
  const resumeId = option<string | undefined>(request, 'resume', undefined);
  const localRoot = option<string | undefined>(request, 'localRoot', undefined);
  if (option(request, 'cancelSession', false)) {
    if (!resumeId) {
      throw new OperateError(
        'E_OPERATE_SESSION_INVALID',
        '--cancel-session requires --resume <session-id>.',
      );
    }
    return success(request.action, {
      message: 'Guided initialization session cancelled.',
      state: 'cancelled',
      data: await cancelGuidedSession({
        projectRoot: request.projectRoot,
        sessionId: resumeId,
        localRoot,
      }),
      next: ['planr operate init --json'],
    });
  }
  if (request.stdin !== undefined && !resumeId) {
    throw new OperateError('E_OPERATE_SESSION_INVALID', '--stdin requires --resume <session-id>.');
  }
  const bindings = await currentGuidedSessionBindings(request.projectRoot);
  let resumedSession:
    | Awaited<ReturnType<typeof resumeGuidedSession>>
    | Awaited<ReturnType<typeof submitGuidedAnswers>>
    | null = null;
  if (resumeId) {
    resumedSession =
      request.stdin === undefined
        ? await resumeGuidedSession({
            projectRoot: request.projectRoot,
            sessionId: resumeId,
            bindings,
            localRoot,
          })
        : await submitGuidedAnswers({
            projectRoot: request.projectRoot,
            sessionId: resumeId,
            raw: request.stdin,
            bindings,
            localRoot,
          });
    supplied = normalizeOperatingInitializationAnswers(resumedSession.answers);
    if (resumedSession.status === 'input-required') {
      return {
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        ok: false,
        action: 'input_required',
        code: 'E_OPERATE_INPUT_REQUIRED',
        message: 'Operating Board initialization needs explicit human input.',
        state: resumedSession.session.state,
        paths: {},
        counts: {},
        warnings: [],
        nextActions: [],
        next: [],
        questionnaire: resumedSession.questionnaire,
        exitCode: operateExitCode('E_OPERATE_INPUT_REQUIRED'),
      };
    }
  }
  let customProfile: Partial<OperatingProfile> | undefined;
  if (supplied.profile === 'custom' && supplied.profileFile) {
    customProfile = await readCustomOperatingProfile(request.projectRoot, supplied.profileFile);
  } else if (
    supplied.profile !== undefined &&
    supplied.profile !== 'custom' &&
    supplied.profileFile
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      '--profile-file is valid only with --profile custom.',
    );
  }
  const context = {
    projectRoot: request.projectRoot,
    ...bindings,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    availableSources: ['repository', 'planr', 'git', 'file-import'],
    runtime: option<string>(request, 'runtime', 'unknown'),
    interaction: request.interactive ? ('terminal' as const) : ('none' as const),
  };
  const questionState = await evaluateOperatingInitQuestions({
    answers: supplied,
    context,
    requireCharter: true,
  });
  if (questionState.status === 'input-required') {
    const sessionId = createGuidedSessionId();
    const questionnaire = await createOperatingInitQuestionnaire({
      context,
      questions: questionState.questions,
      stage: questionState.stage,
      sessionId,
    });
    await createGuidedSession({
      projectRoot: request.projectRoot,
      questionnaire,
      persistedAnswers: persistableOperatingInitAnswers(questionState.answers, context),
      localRoot,
    });
    return {
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      ok: false,
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      message: 'Operating Board initialization needs explicit human input.',
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: [],
      next: [],
      questionnaire,
      exitCode: operateExitCode('E_OPERATE_INPUT_REQUIRED'),
    };
  }
  const profile = supplied.profile as OperatingProfile['id'];
  const decisionOwner =
    supplied.decisionOwner ?? option<string>(request, 'decisionOwner', '').trim();
  const planningEngine =
    supplied.planningEngine ??
    option<OperatingConfig['planningEngine']>(request, 'planningEngine', 'openplanr');
  const rawCharter = supplied.charter ?? option<Partial<OperatingCharter>>(request, 'charter', {});
  // FR4 / E-004 fold-in: forward the CLI-validated per-project dispatch-mode
  // overrides into initialization so they are part of the committed machine-local
  // preferences (and thus the preview digest), rather than a separate post-apply
  // patch. Omitted entirely when no override flag was supplied, keeping the
  // no-override preview digest byte-identical.
  const dispatchModeOverrides = parseOperatingDispatchModeOverrideFlags(
    stringList(request.options.dispatchModeOverride),
  );
  const preview = await prepareOperatingInitialization({
    projectRoot: request.projectRoot,
    profile,
    decisionOwner,
    planningEngine,
    runtime: supplied.runtime ?? option(request, 'runtime', 'auto'),
    cadence: supplied.cadence ?? option(request, 'cadence', 'manual'),
    ...(Object.keys(dispatchModeOverrides).length > 0 ? { dispatchModeOverrides } : {}),
    timezone:
      supplied.timezone ??
      option(request, 'timezone', Intl.DateTimeFormat().resolvedOptions().timeZone),
    sensitivityCeiling:
      supplied.sensitivityCeiling ?? option(request, 'sensitivityCeiling', 'internal'),
    enabledProviders: (supplied.sources ?? stringList(request.options.sources)).length
      ? (supplied.sources ?? stringList(request.options.sources))
      : undefined,
    evidenceFiles: supplied.evidenceFiles ?? stringList(request.options.evidenceFile),
    charter: rawCharter,
    customProfile,
    componentRoots: supplied.componentRoots ?? stringList(request.options.components),
    localRoot,
    now:
      resumedSession?.session.createdAt ??
      option<string | undefined>(request, 'previewCreatedAt', undefined),
  });
  const legacyMigration = await inspectOperatingMigration({
    projectRoot: request.projectRoot,
  });
  const previewData = {
    previewDigest: preview.previewDigest,
    expectedEventHead: preview.expectedEventHead,
    resultingEventHead: preview.resultingEventHead,
    changedPaths: preview.changedPaths,
    localPreferencesChanged: preview.preferencesChanged,
    previewCreatedAt: preview.workspace.capturedAt,
    workspaceDigest: preview.workspace.workspaceDigest,
    config: preview.config,
    legacyMigration,
    ...(resumedSession ? { sessionId: resumedSession.session.sessionId } : {}),
  };
  const { action: applyAction, confirmation } = await initializationApplyAction({
    request,
    preview,
    bindings,
    sessionId: resumedSession?.session.sessionId,
    answers: questionState.answers,
  });
  const requestedConfirmation = option<string | undefined>(request, 'confirm', undefined);
  const confirmed = option(request, 'yes', false);
  if (resumedSession) {
    await updateGuidedSession({
      projectRoot: request.projectRoot,
      localRoot,
      session: {
        ...resumedSession.session,
        state: 'preview-ready',
        previewDigest: preview.previewDigest,
        confirmationDigest: confirmation?.confirmationDigest,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!confirmed || !requestedConfirmation) {
      return success(request.action, {
        message: 'Operating Board initialization preview is ready; no state was written.',
        state: 'preview-ready',
        preview: { ...previewData, confirmation },
        actions: [applyAction],
        next: [
          `planr operate init --resume ${resumedSession.session.sessionId} --confirm ${confirmation?.confirmationDigest} --yes --json`,
        ],
      });
    }
  }
  if (option(request, 'preview', false) || option(request, 'dryRun', false)) {
    return success(request.action, {
      message: 'Operating Board initialization preview is ready; no state was written.',
      state: 'preview-ready',
      preview: { ...previewData, confirmation },
      actions: [applyAction],
      next: [`${applyAction.command} --confirm ${confirmation?.confirmationDigest} --yes`],
    });
  }
  if (!confirmed || !requestedConfirmation || !confirmation) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Initialization requires the exact named confirmation returned by its preview.',
      {
        preview: { ...previewData, confirmation },
        action: applyAction,
      },
    );
  }
  const accepted = assertOperatingConfirmation({
    expected: confirmation,
    actionId: applyAction.id,
    confirmationDigest: requestedConfirmation,
    confirmed,
  });
  if (resumedSession) {
    await updateGuidedSession({
      projectRoot: request.projectRoot,
      localRoot,
      session: {
        ...resumedSession.session,
        state: 'confirmed',
        previewDigest: preview.previewDigest,
        confirmationDigest: accepted.confirmationDigest,
        confirmedAt: accepted.confirmedAt,
        updatedAt: accepted.confirmedAt ?? new Date().toISOString(),
      },
    });
  }
  const applied = await applyOperatingInitialization({
    projectRoot: request.projectRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  if (resumedSession) {
    const appliedAt = new Date().toISOString();
    await updateGuidedSession({
      projectRoot: request.projectRoot,
      localRoot,
      session: {
        ...resumedSession.session,
        state: 'applied',
        previewDigest: preview.previewDigest,
        confirmationDigest: accepted.confirmationDigest,
        confirmedAt: accepted.confirmedAt,
        appliedAt,
        updatedAt: appliedAt,
      },
    });
  }
  return success(request.action, {
    message: applied.initialized
      ? 'Operating Board initialized.'
      : 'Operating Board already matches this configuration.',
    data: {
      changedPaths: applied.changedPaths,
      workspaceDigest: preview.workspace.workspaceDigest,
      legacyMigration,
    },
    next: [
      ...(legacyMigration.record
        ? legacyMigration.record.state === 'conflict'
          ? ['planr operate migrate inspect']
          : ['planr operate migrate apply']
        : []),
      'planr operate run',
      'planr operate status',
    ],
  });
}

async function showConfig(request: OperateActionRequest): Promise<OperateActionResult> {
  const config = await validateOperatingConfiguration(request.projectRoot);
  if (request.action === 'config.edit') {
    return success(request.action, {
      message: 'Operating configuration is managed at .planr/operate/config.json.',
      data: { path: '.planr/operate/config.json', config },
      next: ['Edit .planr/operate/config.json', 'planr operate config validate'],
    });
  }
  return success(request.action, {
    data: config,
    message: request.action === 'config.validate' ? 'Operating configuration is valid.' : undefined,
  });
}

async function profiles(request: OperateActionRequest): Promise<OperateActionResult> {
  if (request.action === 'profiles.list') {
    return success(request.action, { data: listOperatingProfiles() });
  }
  if (request.action === 'profiles.show') {
    const profile = argument(request, 'profile');
    if (!profile) {
      throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Profile ID is required.');
    }
    return success(request.action, {
      data: getOperatingProfile(profile as OperatingProfile['id']),
    });
  }
  const file = argument(request, 'file');
  if (!file) throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Profile file is required.');
  const parsed = await readCustomOperatingProfile(request.projectRoot, file);
  const profile = { ...getOperatingProfile('custom'), ...parsed };
  if (!profile.enabledRoles?.length || !profile.enabledProviders?.length) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Custom profile is incomplete.');
  }
  return success(request.action, { data: profile, message: 'Custom profile is valid.' });
}

async function sources(request: OperateActionRequest): Promise<OperateActionResult> {
  const protocol = await loadOperatingProtocol();
  const providers = protocol.listOperatingProviders();
  if (request.action === 'sources.list') return success(request.action, { data: providers });
  const id = argument(request, 'source');
  if (request.action === 'sources.test' && !id) {
    const config = await validateOperatingConfiguration(request.projectRoot);
    const configured = providers
      .filter((entry) => config.enabledProviders.includes(entry.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const results: Array<Record<string, unknown>> = [];
    for (const provider of configured) {
      try {
        const tested = await testOperatingSource(request, provider);
        results.push(tested);
      } catch (error) {
        results.push({
          provider,
          healthy: false,
          code: error instanceof OperateError ? error.code : 'E_OPERATE_INTERNAL',
          message:
            error instanceof OperateError
              ? error.message
              : 'The evidence source test failed unexpectedly.',
          writeBoundary: 'none',
        });
      }
    }
    const failures = results.filter((entry) => entry.healthy === false);
    if (failures.length > 0) {
      const failedIds = failures
        .map((entry) => (entry.provider as { id?: unknown } | undefined)?.id)
        .filter((entry): entry is string => typeof entry === 'string')
        .sort();
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        `${failures.length} configured evidence source test(s) failed: ${failedIds.join(', ')}.`,
        {
          results,
          recoveryCommand: `planr operate sources test ${failedIds[0]} --json`,
        },
      );
    }
    return success(request.action, {
      data: {
        healthy: true,
        configuredSources: configured.map((provider) => provider.id),
        results,
      },
      message: `${configured.length} configured evidence source test(s) passed.`,
    });
  }
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', `Unknown evidence source: ${id}.`);
  }
  if (request.action !== 'sources.test') return success(request.action, { data: provider });
  return success(request.action, {
    data: await testOperatingSource(request, provider),
  });
}

async function testOperatingSource(
  request: OperateActionRequest,
  provider: Record<string, unknown> & { id: string },
): Promise<Record<string, unknown>> {
  const id = provider.id;
  let observation: string;
  if (id === 'repository' || id === 'planr') {
    observation = (await executeGitReadOnly(request.projectRoot, ['ls-files'])).trim()
      ? 'tracked-files-readable'
      : 'repository-readable-empty';
  } else if (id === 'git') {
    observation = (await executeGitReadOnly(request.projectRoot, ['rev-parse', 'HEAD'])).trim();
  } else if (id === 'github') {
    observation =
      (await executeGitHubReadOnly(request.projectRoot, ['auth', 'status'])).trim() ||
      'authenticated';
  } else if (id === 'linear') {
    const [{ resolveApiKey }, { createLinearClient, validateToken }] = await Promise.all([
      import('../credentials-service.js'),
      import('../linear-service.js'),
    ]);
    const token = await resolveApiKey('linear');
    if (!token) {
      throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Linear credentials are unavailable.');
    }
    const viewer = await validateToken(createLinearClient(token));
    observation = `viewer:${viewer.id}`;
  } else if (id === 'file-import') {
    const preferences = parseStrictJson(
      await readOperatingLocalFile(
        request.projectRoot,
        (paths) => `${paths.localRoot}/preferences.json`,
      ),
    ) as {
      importPaths?: unknown;
    };
    const workspaceRoots = parseStrictJson(
      await readOperatingLocalFile(request.projectRoot, (paths) => paths.roots),
    ) as { roots?: unknown };
    const importPaths = Array.isArray(preferences.importPaths)
      ? preferences.importPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (
      importPaths.length === 0 ||
      !workspaceRoots.roots ||
      typeof workspaceRoots.roots !== 'object' ||
      Array.isArray(workspaceRoots.roots)
    ) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        'No workspace-contained JSON/CSV evidence files are configured.',
      );
    }
    const roots = Object.entries(workspaceRoots.roots as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([componentId, root]) => ({ componentId, root }));
    for (const configuredPath of importPaths) {
      await readImportedEvidenceFile({
        projectRoot: request.projectRoot,
        configuredPath,
        roots,
        maxBytes: 1_000_000,
      });
    }
    observation = `files:${importPaths.length}`;
  } else {
    observation = 'import-parser-available';
  }
  return { provider, healthy: true, observation, writeBoundary: 'none' };
}

async function status(request: OperateActionRequest): Promise<OperateActionResult> {
  const config = await validateOperatingConfiguration(request.projectRoot);
  const localRoot = option<string | undefined>(request, 'localRoot', undefined);
  await assertCommittedOperatingView(request.projectRoot, localRoot ? { localRoot } : {});
  const store = new OperatingEventStore(request.projectRoot, localRoot ? { localRoot } : {});
  const state = await store.state();
  const activeCycle = [...state.cycles]
    .filter((cycle) => !['closed', 'cancelled'].includes(cycle.state))
    .sort((left, right) => left.id.localeCompare(right.id))
    .at(-1);
  // FR8 / E-008: surface `nextDueAt` via the pipeline's pure calculator with an
  // INJECTED clock. This CLI boundary supplies `now` (an explicit option or the
  // wall clock); the calculator itself reads no `Date.now()`. `manual` → null;
  // `weekly` / `monthly` → the computed due date from the persisted `lastRunAt`.
  const now = option<string | undefined>(request, 'now', undefined) ?? new Date().toISOString();
  const lastRunAt = await readOperatingLastRunAt(
    request.projectRoot,
    localRoot ? { localRoot } : {},
  );
  const nextDueAt = await computeNextDueAt(config.cadence, lastRunAt, now);
  return success(request.action, {
    data: { ...state, cadence: { mode: config.cadence, lastRunAt, nextDueAt } },
    message:
      activeCycle?.state === 'blocked'
        ? `Operating Board is blocked on ${state.summary.openGaps} evidence or advisor readiness gap(s).`
        : state.summary.quiet
          ? 'Operating Board is quiet.'
          : `${state.summary.surfacedFindings} finding(s) are surfaced.`,
  });
}

async function run(request: OperateActionRequest): Promise<OperateActionResult> {
  await validateOperatingConfiguration(request.projectRoot);
  const requestedRuntime = option(request, 'runtime', 'auto');
  const resolvedRuntime = await resolvedOperatingRuntime(request.projectRoot, requestedRuntime);
  const nativeAdvisors = await usesNativeOperatingAdvisors(request.projectRoot, requestedRuntime);
  const deferAdvisors =
    !option(request, 'offline', false) &&
    !option(request, 'dryRun', false) &&
    !option(request, 'reviewOnly', false) &&
    nativeAdvisors;
  const result = await runOperatingCycle({
    projectRoot: request.projectRoot,
    cycleId: option(request, 'cycleId', undefined),
    focus: stringList(request.options.focus) as Parameters<typeof runOperatingCycle>[0]['focus'],
    depth: option(request, 'depth', 'standard'),
    runtime: resolvedRuntime,
    offline: option(request, 'offline', false),
    reviewOnly: option(request, 'reviewOnly', false),
    preview: option(request, 'preview', false),
    dryRun: option(request, 'dryRun', false),
    confirmed: option(request, 'yes', false),
    quiet: option(request, 'json', false),
    deferAdvisors,
  });
  const projected = result.state?.cycles.find((cycle) => cycle.id === result.cycle.id);
  const counts = {
    findings:
      result.state?.findings.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    decisions:
      result.state?.decisions.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    gaps: result.state?.dataGaps.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    specs: result.state?.specLinks.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    artifacts: 0,
  };
  const handoff = result.nativeHandoff
    ? await createOperatingAdapterStartHandoff({
        projectRoot: request.projectRoot,
        cycleId: result.nativeHandoff.cycleId,
        evidenceDigest: result.nativeHandoff.evidenceDigest,
        runtime: result.cycle.producer.runtime,
        phase: result.nativeHandoff.phase,
        roles: result.nativeHandoff.roles,
      })
    : undefined;
  const nextActions = result.preview
    ? [
        option(request, 'offline', false)
          ? 'planr operate run --offline'
          : nativeAdvisors
            ? `planr operate run --runtime ${resolvedRuntime}`
            : 'planr operate run',
      ]
    : handoff
      ? handoff.next.map(({ argv }) => argv.join(' '))
      : [`planr operate review ${result.cycle.id}`];
  return success(request.action, {
    message: result.preview
      ? 'Operating cycle preview is ready; no provider calls or writes were made.'
      : result.dryRun
        ? 'Operating cycle dry-run completed without committing state.'
        : result.nativeHandoff
          ? `Operating cycle is awaiting isolated native ${result.nativeHandoff.phase} execution.`
          : projected?.state === 'blocked'
            ? 'Operating cycle is blocked on evidence or advisor readiness.'
            : 'Operating cycle is ready for human review.',
    cycleId: result.cycle.id,
    state: projected?.state ?? result.cycle.state,
    paths: {
      cycle: `.planr/operate/cycles/${result.cycle.id}`,
      brief: `.planr/operate/cycles/${result.cycle.id}/brief.md`,
    },
    counts,
    handoff,
    warnings: [...new Set([...(result.cycle.warnings ?? []), ...stringList(projected?.warnings)])],
    nextActions,
    data: result,
    next: nextActions,
  });
}

async function reviewOrBrief(request: OperateActionRequest): Promise<OperateActionResult> {
  const cycleId = argument(request, 'cycleId');
  const data = await readOperatingReview({
    projectRoot: request.projectRoot,
    cycleId,
    brief: request.action === 'brief',
  });
  return success(request.action, {
    data,
    message:
      request.action === 'review'
        ? 'This is the mandatory human review gate. No route has been applied.'
        : undefined,
  });
}

async function report(request: OperateActionRequest): Promise<OperateActionResult> {
  const requestedFormat = option<string | undefined>(request, 'format', undefined);
  if (requestedFormat && !['markdown', 'json'].includes(requestedFormat)) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Unknown report format ${requestedFormat}. Use markdown or json.`,
    );
  }
  const data = await readOperatingReport({
    projectRoot: request.projectRoot,
    cycleId: argument(request, 'cycleId'),
    lens: option(request, 'lens', 'all'),
    localRoot: option(request, 'localRoot', undefined),
  });
  const format = requestedFormat ?? (option(request, 'json', false) ? 'json' : 'markdown');
  return success(request.action, {
    data: format === 'json' ? data : data.markdown,
    message: `Operating report is ready for ${data.cycleId}.`,
  });
}

async function collections(request: OperateActionRequest): Promise<OperateActionResult> {
  const [collection, operation] = request.action.split('.');
  const singular =
    collection === 'cycles'
      ? 'cycleId'
      : collection === 'findings'
        ? 'findingId'
        : collection === 'decisions'
          ? 'decisionId'
          : collection === 'gaps'
            ? 'gapId'
            : collection === 'routes'
              ? 'routeId'
              : collection === 'evidence'
                ? 'evidenceId'
                : 'migrationId';
  const id = argument(request, singular) ?? argument(request, 'id');
  const data = await readOperatingCollection({
    projectRoot: request.projectRoot,
    collection: collection as Parameters<typeof readOperatingCollection>[0]['collection'],
    ...(operation === 'show' ? { id } : {}),
  });
  if (operation === 'show' && !data) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown ${collection} record ${id}.`);
  }
  return success(request.action, { data });
}

async function evidenceRecovery(request: OperateActionRequest): Promise<OperateActionResult> {
  const candidateId = argument(request, 'candidateId');
  if (request.action === 'evidence.diagnose') {
    const data = candidateId
      ? await readEvidenceDiagnostic({
          projectRoot: request.projectRoot,
          candidateId,
          localRoot: option(request, 'localRoot', undefined),
        })
      : await listEvidenceDiagnostics({
          projectRoot: request.projectRoot,
          localRoot: option(request, 'localRoot', undefined),
        });
    const diagnostic = Array.isArray(data) ? null : data;
    return success(request.action, {
      data: {
        diagnostic: data,
        valueDisclosed: false,
        recovery: diagnostic
          ? {
              repairOrRemove: diagnostic.location
                ? `Repair or remove the candidate at ${diagnostic.location}${diagnostic.line ? `:${diagnostic.line}` : ''}, then rerun.`
                : 'Repair or remove the candidate in the identified component, then rerun.',
              rotateCredential:
                'If this is a real credential, rotate it before removing it from source history.',
              eligibleExclusion:
                'Exclude only the exact eligible source path through operating source policy; broad scanner bypasses are not supported.',
              falsePositive: `planr operate evidence classify ${diagnostic.candidateId} --status false-positive --reason "<reason>" --json`,
              rerun: 'planr operate run --offline',
            }
          : null,
      },
      actions: diagnostic?.actions,
      next: diagnostic
        ? [
            `planr operate evidence classify ${diagnostic.candidateId} --status false-positive --reason "<reason>" --json`,
            'planr operate run --offline',
          ]
        : [],
    });
  }
  if (!candidateId) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Evidence candidate ID is required.');
  }
  const status = option<string>(request, 'status', '');
  if (status !== 'false-positive' && status !== 'confirmed-secret') {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Evidence classification status must be false-positive or confirmed-secret.',
    );
  }
  const config = await validateOperatingConfiguration(request.projectRoot);
  const data = await classifyEvidenceDiagnostic({
    projectRoot: request.projectRoot,
    candidateId,
    status,
    reason: option(request, 'reason', ''),
    classifiedBy: config.decisionOwner,
    confirmationDigest: option(request, 'confirm', undefined),
    confirmed: option(request, 'yes', false),
    localRoot: option(request, 'localRoot', undefined),
  });
  return success(request.action, {
    data,
    actions: data.state === 'preview' && data.action ? [data.action] : undefined,
    message:
      data.state === 'classified'
        ? `Evidence candidate ${candidateId} was classified without storing or exposing its value.`
        : 'Review and confirm the exact evidence classification action.',
  });
}

async function cycleMutation(request: OperateActionRequest): Promise<OperateActionResult> {
  const cycleId = argument(request, 'cycleId');
  if (!cycleId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Cycle ID is required.');
  const action = request.action.slice('cycles.'.length) as
    | 'resume'
    | 'cancel'
    | 'recover'
    | 'close';
  return success(request.action, {
    data: await transitionOperatingCycle({
      projectRoot: request.projectRoot,
      cycleId,
      action,
      confirmed: option(request, 'yes', false),
    }),
  });
}

async function findingMutation(request: OperateActionRequest): Promise<OperateActionResult> {
  const findingId = argument(request, 'findingId');
  if (!findingId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Finding ID is required.');
  return success(request.action, {
    data: await governOperatingFinding({
      projectRoot: request.projectRoot,
      findingId,
      action: request.action.slice('findings.'.length) as 'accept' | 'reject' | 'supersede',
      confirmed: option(request, 'yes', false),
      reason: option(request, 'reason', undefined),
      impact: request.options.impact,
      confidence: request.options.confidence,
      ease: request.options.ease,
    }),
  });
}

async function routeMutation(request: OperateActionRequest): Promise<OperateActionResult> {
  const routeId = argument(request, 'routeId');
  if (!routeId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Route ID is required.');
  const data = (await applyOrRollbackRoute({
    projectRoot: request.projectRoot,
    routeId,
    action: request.action.endsWith('.apply') ? 'apply' : 'rollback',
    previewDigest: option(request, 'previewDigest', undefined),
    preview: option(request, 'preview', false) || option(request, 'dryRun', false),
    confirmed: option(request, 'yes', false),
  })) as { state?: unknown };
  return success(request.action, {
    data,
    nextActions:
      data.state === 'awaiting-artifact-review'
        ? [
            `planr operate routes apply ${routeId} --preview`,
            `planr operate routes apply ${routeId} --preview-digest <generated-preview-digest> --yes`,
          ]
        : [],
  });
}

async function answerMutation(request: OperateActionRequest): Promise<OperateActionResult> {
  if (request.action === 'gaps.verify') {
    const gapId = argument(request, 'gapId');
    if (!gapId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Gap ID is required.');
    return success(request.action, {
      data: await verifyOperatingGap({
        projectRoot: request.projectRoot,
        gapId,
        evidenceRefs: stringList(request.options.evidenceRef),
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  const value = String(option(request, 'value', request.stdin ?? '')).trim();
  if (request.action === 'decisions.decide') {
    const decisionId = argument(request, 'decisionId');
    if (!decisionId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Decision ID is required.');
    return success(request.action, {
      data: await decideOperatingDecision({
        projectRoot: request.projectRoot,
        decisionId,
        value,
        reason: option(request, 'reason', undefined),
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  const gapId = argument(request, 'gapId');
  if (!gapId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Gap ID is required.');
  return success(request.action, {
    data: await answerOperatingGap({
      projectRoot: request.projectRoot,
      gapId,
      value,
      confirmed: option(request, 'yes', false),
    }),
  });
}

async function maintenance(request: OperateActionRequest): Promise<OperateActionResult> {
  if (request.action.startsWith('cache.')) {
    return success(request.action, {
      data: await operatingCacheAction({
        projectRoot: request.projectRoot,
        action: request.action.endsWith('purge') ? 'purge' : 'status',
        confirmed: option(request, 'yes', false),
        localRoot: option(request, 'localRoot', undefined),
      }),
    });
  }
  if (request.action.startsWith('integrity.')) {
    return success(request.action, {
      data: await operatingIntegrityAction({
        projectRoot: request.projectRoot,
        action: request.action.endsWith('enable') ? 'enable' : 'status',
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  if (request.action === 'diagnostics.export') {
    return success(request.action, {
      data: await exportOperatingDiagnostics({
        projectRoot: request.projectRoot,
        output: option(request, 'output', undefined),
      }),
    });
  }
  if (request.action === 'security.repair') {
    return success(request.action, {
      data: await repairOperatingSecurity({
        projectRoot: request.projectRoot,
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  if (request.action === 'migrate.inspect') {
    return success(request.action, {
      data: await inspectOperatingMigration({ projectRoot: request.projectRoot }),
    });
  }
  if (request.action === 'migrate.apply') {
    return success(request.action, {
      data: await applyOperatingMigration({
        projectRoot: request.projectRoot,
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  if (request.action === 'migrations.rollback') {
    const migrationId = argument(request, 'migrationId');
    if (!migrationId) {
      throw new OperateError('E_OPERATE_STATE_INVALID', 'Migration ID is required.');
    }
    return success(request.action, {
      data: await rollbackOperatingMigration({
        projectRoot: request.projectRoot,
        migrationId,
        confirmed: option(request, 'yes', false),
      }),
    });
  }
  const data = await operateAdapterLifecycle({
    projectRoot: request.projectRoot,
    action: request.action.slice('adapter.'.length) as
      | 'prepare'
      | 'record'
      | 'resume'
      | 'finalize'
      | 'cancel',
    cycleId: option(request, 'cycleId', undefined),
    evidenceDigest: option(request, 'evidenceDigest', undefined),
    lease: option(request, 'lease', undefined),
    idempotencyKey: option(request, 'idempotencyKey', undefined),
    role: option(request, 'role', undefined),
    stdin: request.stdin,
  });
  const handoff =
    data && typeof data === 'object' && 'handoff' in data && (data as { handoff?: unknown }).handoff
      ? (data as { handoff: OperatingAdapterHandoff }).handoff
      : undefined;
  const nextActions = handoff?.next.map(({ argv }) => argv.join(' ')) ?? [];
  return success(request.action, {
    data,
    handoff,
    nextActions,
    next: nextActions,
  });
}

const HANDLERS: Record<
  string,
  (request: OperateActionRequest) => Promise<OperateActionResult> | OperateActionResult
> = {
  inspect,
  demo,
  init: initialize,
  'config.show': showConfig,
  'config.validate': showConfig,
  'config.edit': showConfig,
  'profiles.list': profiles,
  'profiles.show': profiles,
  'profiles.validate': profiles,
  'sources.list': sources,
  'sources.show': sources,
  'sources.test': sources,
  run,
  review: reviewOrBrief,
  brief: reviewOrBrief,
  report,
  status,
  'cycles.list': collections,
  'cycles.show': collections,
  'cycles.resume': cycleMutation,
  'cycles.cancel': cycleMutation,
  'cycles.recover': cycleMutation,
  'cycles.close': cycleMutation,
  'findings.list': collections,
  'findings.show': collections,
  'findings.accept': findingMutation,
  'findings.reject': findingMutation,
  'findings.supersede': findingMutation,
  'routes.list': collections,
  'routes.show': collections,
  'routes.apply': routeMutation,
  'routes.rollback': routeMutation,
  'decisions.list': collections,
  'decisions.show': collections,
  'decisions.decide': answerMutation,
  'gaps.list': collections,
  'gaps.show': collections,
  'gaps.answer': answerMutation,
  'gaps.verify': answerMutation,
  'evidence.list': collections,
  'evidence.show': collections,
  'evidence.diagnose': evidenceRecovery,
  'evidence.classify': evidenceRecovery,
  'migrate.inspect': maintenance,
  'migrate.apply': maintenance,
  'migrations.list': collections,
  'migrations.show': collections,
  'migrations.rollback': maintenance,
  'cache.status': maintenance,
  'cache.purge': maintenance,
  'integrity.status': maintenance,
  'integrity.enable': maintenance,
  'diagnostics.export': maintenance,
  'security.repair': maintenance,
  'adapter.prepare': maintenance,
  'adapter.record': maintenance,
  'adapter.resume': maintenance,
  'adapter.finalize': maintenance,
  'adapter.cancel': maintenance,
};

/**
 * Actions that only read committed state. A SPEC-002-layout project stays
 * readable through these without being migrated; only a mutating action opening
 * such a project triggers the automatic, journal-safe v1.3 migration (FR5/E-005).
 */
const OPERATE_READ_ONLY_ACTIONS = new Set<string>([
  'inspect',
  'demo',
  'config.show',
  'config.validate',
  'config.edit',
  'profiles.list',
  'profiles.show',
  'profiles.validate',
  'sources.list',
  'sources.show',
  'sources.test',
  'status',
  'review',
  'brief',
  'report',
  'cycles.list',
  'cycles.show',
  'findings.list',
  'findings.show',
  'routes.list',
  'routes.show',
  'decisions.list',
  'decisions.show',
  'gaps.list',
  'gaps.show',
  'evidence.list',
  'evidence.show',
  'evidence.diagnose',
  'migrate.inspect',
  'migrations.list',
  'migrations.show',
  'cache.status',
  'integrity.status',
  'adapter.resume',
]);

/**
 * Stable runtime-neutral Operating Board facade. Public CLI adapters only parse
 * arguments and render this structured result; all state and security semantics
 * live behind this function.
 */
export async function executeOperateAction(
  request: OperateActionRequest,
): Promise<OperateActionResult> {
  try {
    const handler = HANDLERS[request.action];
    if (!handler) {
      throw new OperateError(
        'E_OPERATE_ACTION_UNKNOWN',
        `Unknown Operating Board action: ${request.action}.`,
      );
    }
    // Any mutating action that opens a SPEC-002-layout project migrates it to the
    // v1.3 storage layout, through the write-ahead journal, before proceeding.
    if (!OPERATE_READ_ONLY_ACTIONS.has(request.action)) {
      await migrateOperatingStorageLayoutOnOpen(request.projectRoot, {
        localRoot: option<string | undefined>(request, 'localRoot', undefined),
      });
    }
    return await attachStructuredActions(request, await handler(request));
  } catch (error) {
    try {
      return await attachStructuredActions(request, failure(request.action, error));
    } catch {
      return failure(request.action, error);
    }
  }
}
