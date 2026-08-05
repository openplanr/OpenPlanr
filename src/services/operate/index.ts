import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAIProviderReadiness } from '../ai-service.js';
import { loadConfig } from '../config-service.js';
import { computeNextDueAt } from './cadence.js';
import { canonicalDigest, sha256Digest } from './canonical.js';
import { verifyOperatingCompletionPhases } from './completion.js';
import {
  applyOperatingInitialization,
  getOperatingProfile,
  listOperatingProfiles,
  normalizeCustomOperatingProfile,
  normalizeOperatingInitializationAnswers,
  type OperatingInitializationPreview,
  prepareOperatingInitialization,
  readOperatingLastRunAt,
  validateOperatingConfiguration,
} from './config.js';
import {
  operatingInitializationAnswersFromResearch,
  prepareOperatingContextResearch,
  readOperatingContextResearch,
  recordOperatingContextResearch,
} from './context-research.js';
import {
  approveOperatingDraft,
  discardOperatingDraft,
  listOperatingDrafts,
  materializeOperatingDrafts,
  showOperatingDraft,
} from './drafts.js';
import { runOperatingCycle } from './engine.js';
import { OperatingEventStore } from './event-store.js';
import { parseStrictJson } from './evidence-import.js';
import { createOperatingAction } from './interaction/action-service.js';
import {
  persistableOperatingInitAnswers,
  probeGitUserName,
  probePipelineInstalled,
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
  purgeBoardMachineLocalCaches,
  readPersistedOperatingRoleResults,
  reapStalledOperatingRoles,
  repairOperatingSecurity,
} from './maintenance.js';
import { migrateOperatingStorageLayoutOnOpen } from './migration.js';
import {
  applyOperatingProfileMigration,
  inspectOperatingProfileMigration,
} from './profile-migration.js';
import { OPERATING_BOARD_ROLES, renderOperatingBrief } from './projection.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { loadOperatingProtocol, resolveOperatingPipelineRoot } from './protocol.js';
import { readOperatingReport } from './reports.js';
import {
  OPERATE_AGENT_PROTOCOL_VERSION,
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

/**
 * Probe the coding-runtime identity of the host process from the environment
 * markers set by the agent that launched the CLI. Mirrors the compatible-runtime
 * detection in terminal-renderer.ts's `detectOperatingQuestionContext`, but keys
 * off the launcher's env markers so a non-interactive/JSON invocation can stamp a
 * truthful adapter block and resolve `auto` instead of stamping `unknown`/`none`
 * or silently disabling native dispatch.
 */
function detectOperatingHostRuntime(): 'claude' | 'codex' | 'cursor' | undefined {
  const env = process.env;
  const marker = (value: string | undefined): boolean => (value ?? '').length > 0;
  if (marker(env.CLAUDECODE) || marker(env.CLAUDE_CODE_ENTRYPOINT)) return 'claude';
  if (marker(env.CURSOR_TRACE_ID) || marker(env.CURSOR_AGENT)) return 'cursor';
  if (marker(env.CODEX_SANDBOX) || marker(env.CODEX_HOME)) return 'codex';
  return undefined;
}

async function resolvedOperatingRuntime(projectRoot: string, requested: string): Promise<string> {
  if (requested !== 'auto') return requested === 'claude' ? 'claude-code' : requested;
  const persisted = await readFile(
    path.join(resolveOperatingPaths(projectRoot).localRoot, 'preferences.json'),
    'utf8',
  )
    .then((raw) => {
      const runtime = (JSON.parse(raw) as { runtime?: unknown }).runtime;
      return typeof runtime === 'string' && runtime ? runtime : 'auto';
    })
    .catch(() => 'auto');
  if (persisted !== 'auto') return persisted === 'claude' ? 'claude-code' : persisted;
  // A persisted (or absent) `auto` preference must never silently disable native
  // dispatch inside a capable host: resolve it to the detected runtime identity
  // so `usesNativeOperatingAdvisors` evaluates the real host, not the `auto`
  // placeholder that always returns false.
  const detected = detectOperatingHostRuntime();
  return detected === 'claude' ? 'claude-code' : (detected ?? 'auto');
}

export async function usesNativeOperatingAdvisors(
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
    // `native-read-only` is the US-001/T-001 adapters-registry capability name that
    // supersedes the earlier isolation labels; recognize it alongside them.
    [
      'native-agent',
      'sequential-native',
      'native-isolated',
      'native-bounded',
      'native-read-only',
    ].includes(adapter.capabilities.operatingAdvisorDispatch ?? '')
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
 * A healthy continuation (FR7/E-007): a guided-stage advance
 * (`E_OPERATE_INPUT_REQUIRED`) or first-use provider consent
 * (`E_OPERATE_AUTHORITY_REQUIRED`) is not a failure. It is returned as an
 * `ok: true` handoff carrying a machine-readable `flow: 'handoff'` discriminator
 * (and the originating `code`), mirroring `run`'s adapter-handoff shape so a
 * harness reads the pause without treating it as a red exit. No `exitCode` is
 * set: the CLI leaves the process exit code at 0 for `ok: true` results.
 */
function handoffContinuation(
  action: string,
  code: 'E_OPERATE_INPUT_REQUIRED' | 'E_OPERATE_AUTHORITY_REQUIRED',
  value: Partial<
    Omit<OperateActionResult, 'schemaVersion' | 'protocolVersion' | 'ok' | 'action' | 'flow'>
  > = {},
): OperateActionResult {
  return { ...success(action, value), code, flow: 'handoff' };
}

/**
 * First-use / renewal provider consent is disclosed by
 * `ensureOperatingProviderConsent` (advisors.ts) as an
 * `E_OPERATE_AUTHORITY_REQUIRED` carrying the full policy disclosure
 * (`endpoint`, `permittedDataClasses`, `policyDigest`). That specific
 * disclosure is a continuation, not a refusal — unlike every other
 * `E_OPERATE_AUTHORITY_REQUIRED` (a mutation attempted without `--yes`), which
 * stays an `ok: false` exit-4 failure so the authority model is unchanged.
 */
function isProviderConsentHandoff(error: unknown): error is OperateError {
  if (!(error instanceof OperateError) || error.code !== 'E_OPERATE_AUTHORITY_REQUIRED') {
    return false;
  }
  const details = error.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    'policyDigest' in details &&
    'endpoint' in details &&
    'permittedDataClasses' in details
  );
}

function providerConsentContinuation(action: string, error: OperateError): OperateActionResult {
  const retry = `planr operate ${action} --yes`;
  return handoffContinuation(action, 'E_OPERATE_AUTHORITY_REQUIRED', {
    message: error.message,
    data: error.details,
    nextActions: [retry],
    next: [retry],
  });
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
 *
 * FR7/E-007 continuation note: `E_OPERATE_INPUT_REQUIRED` and
 * `E_OPERATE_AUTHORITY_REQUIRED` keep this class-4 mapping for the cases that
 * are genuine refusals — a mutation attempted without `--yes` still fails with
 * `ok: false` and exit 4. But a *healthy continuation* — a guided-stage advance
 * or first-use provider consent — is not a failure: it is returned as an
 * `ok: true` handoff (`flow: 'handoff'`) with no failure exit code, mirroring
 * `run`'s adapter handoff, so a harness never paints the happy path red. The
 * numeric class below is therefore only consulted for the failure branch.
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
  E_OPERATE_PROVIDER_DEPRECATED: 6,
  E_OPERATE_SECRET_DETECTED: 6,
  E_OPERATE_MISSION_PACKET_BUDGET: 6,
  E_OPERATE_MISSION_UNAVAILABLE: 3,
  E_OPERATE_SESSION_INVALID: 2,
  E_OPERATE_RUNTIME_MISMATCH: 5,
  E_OPERATE_DRAFT_UNAPPROVED: 4,
  E_RUNTIME_UNSUPPORTED: 3,
} as const satisfies Readonly<Record<OperateErrorCode, number>>;

function operateExitCode(code: OperateErrorCode): number {
  return OPERATE_EXIT_CODES[code];
}

export function failure(action: string, error: unknown): OperateActionResult {
  const code = error instanceof OperateError ? error.code : 'E_OPERATE_INTERNAL';
  // E_OPERATE_INTERNAL must never be zero-information: record the redacted error
  // class/name (no message or stack, which can carry paths or secrets) so the
  // diagnostics export and automation callers can classify the internal failure.
  const internalErrorClass =
    code === 'E_OPERATE_INTERNAL'
      ? error instanceof Error && typeof error.name === 'string' && error.name.length > 0
        ? error.name
        : 'Error'
      : undefined;
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
                        ? ['planr operate run --preview --json', 'planr operate diagnostics export']
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
    data:
      error instanceof OperateError
        ? error.details
        : internalErrorClass
          ? { errorClass: internalErrorClass }
          : undefined,
    next: nextActions,
    exitCode: operateExitCode(code),
  };
}

/**
 * Reduce recovery `nextActions` to the set of public `planr operate` commands
 * that back the structured actions. The digest-bound authority flags
 * (`--yes`, `--confirm <digest>`, `--preview-digest <digest>`) are stripped from
 * the *command* string — a raw sha256 digest must never enter a structured
 * command (it would trip the sensitive-data guard in `assertSafeCommand`).
 *
 * FR8/E-008: stripping them here no longer strands a runner. For a
 * digest-confirmable command the exact, ready-to-run argv (including the real
 * `--confirm <digest> --yes` token) is re-surfaced on the structured action as
 * `confirmArgv` in `attachStructuredActions`, so the runner never has to
 * re-synthesize a confirmation token it was handed. A command whose only
 * authority is `--yes` is never given a confirmationDigest at all.
 */
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

/**
 * The digest-bound confirmation flag a public command's CLI actually accepts, or
 * `null` when its only authority is `--yes`. A confirmationDigest is meaningful
 * only for a command that can consume it via `--confirm`; a `--yes`-only command
 * (e.g. `operate run`) must never be handed one (FR8/E-008).
 */
function commandConfirmFlag(command: string): '--confirm' | null {
  return /\boperate\s+init\b/.test(command) || /\bevidence\s+classify\b/.test(command)
    ? '--confirm'
    : null;
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
  if (result.actions?.length || result.action === 'input_required' || result.flow === 'handoff') {
    return result;
  }
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
    const confirmFlag = commandConfirmFlag(command);
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
    let action = created.action;
    // FR8/E-008: `operate run` authorizes with `--yes` alone — its CLI accepts no
    // `--confirm` flag — so it must never carry a confirmationDigest a runner
    // could never pass. It still appears as a structured action (mirroring the
    // handoff `run` continuation) but with its digest binding cleared.
    if (/\boperate\s+run\b/.test(command)) {
      action = {
        ...action,
        requiresConfirmation: false,
        confirmationScope: null,
        confirmationDigest: null,
      };
    }
    // A digest-confirmable action (`--confirm <digest>`) carries its exact,
    // ready-to-run argv so a runner never has to re-synthesize the confirmation
    // token it was already handed.
    const confirmArgv =
      confirmFlag && action.confirmationDigest
        ? [...command.split(/\s+/), confirmFlag, action.confirmationDigest, '--yes']
        : undefined;
    actions.push(confirmArgv ? { ...action, confirmArgv } : action);
  }
  if (actions.length === 0) return result;
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
        // The contract the installed pipeline ENFORCES — mandates are signed and
        // validated at the agent protocol version. This previously reported the
        // frozen on-disk artifact envelope version instead, so the first command
        // of the journey advertised a two-generation-stale capability.
        protocolVersion: pipelineRoot ? OPERATE_AGENT_PROTOCOL_VERSION : null,
      },
      commitSafeRoot: project ? '.planr/operate' : null,
      machineLocalState: customStateRoot ? paths.localRoot : '~/.planr/operate/<project-hash>',
    },
    // FND-001: an uninitialized project is pointed at the research-first entry, not
    // cold into the guided questionnaire. Bare `planr operate` auto-runs
    // `context.refresh` (which pre-fills most charter fields from the repo) before
    // init; `planr operate context refresh` is the explicit standalone step. Both
    // verified to run uninitialized. The structured `actions[]` are derived from
    // these same commands, so the text hint and the actions can never disagree.
    next: initialized
      ? ['planr operate status']
      : ['planr operate', 'planr operate context refresh'],
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
      // FR7/E-007: a guided-stage advance is a healthy continuation, not a
      // failure. Report it as an `ok: true` handoff (`flow: 'handoff'`) carrying
      // the next questionnaire, mirroring `run`'s adapter handoff.
      return handoffContinuation('input_required', 'E_OPERATE_INPUT_REQUIRED', {
        message: 'Operating Board initialization needs explicit human input.',
        state: resumedSession.session.state,
        questionnaire: resumedSession.questionnaire,
      });
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
  // Probe the real host runtime instead of stamping `unknown`/`none`: an explicit
  // --runtime flag wins, otherwise the launcher's env markers name the host so the
  // questionnaire's adapter block is truthful (and the runtime question can be a
  // detect-don't-ask suggestion rather than a required prompt).
  const detectedHostRuntime = detectOperatingHostRuntime();
  const requestedRuntimeOption = option<string>(request, 'runtime', 'auto');
  // Probe the same signals the terminal path does so the JSON/native init path is
  // equally truthful: Git can suggest the decision owner and the installed
  // pipeline can suggest the planning-engine handoff.
  const gitUserName = await probeGitUserName(request.projectRoot);
  // Agent-native bootstrap researches first and stores epistemically labelled
  // context. Use it as provisional initialization input so the old serial
  // questionnaire does not ask the owner to retype discoverable project facts.
  // Explicit user/runtime answers always win; decisionOwner is intentionally
  // never inferred here because it is an authority assignment.
  if (!resumeId) {
    const researched = await operatingInitializationAnswersFromResearch(request.projectRoot);
    if (researched) {
      supplied = normalizeOperatingInitializationAnswers({
        ...researched,
        ...supplied,
        charter: {
          ...researched.charter,
          ...supplied.charter,
        },
      });
    }
  }
  const context = {
    projectRoot: request.projectRoot,
    ...bindings,
    ...(detectedHostRuntime ? { detectedRuntime: detectedHostRuntime } : {}),
    ...(gitUserName ? { gitUserName } : {}),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pipelineInstalled: probePipelineInstalled(),
    runtime:
      requestedRuntimeOption && requestedRuntimeOption !== 'auto'
        ? requestedRuntimeOption
        : (detectedHostRuntime ?? (request.interactive ? 'terminal' : 'unknown')),
    interaction: detectedHostRuntime
      ? ('native' as const)
      : request.interactive
        ? ('terminal' as const)
        : ('none' as const),
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
    // FR7/E-007: the first guided-stage prompt is a healthy continuation — an
    // `ok: true` handoff (`flow: 'handoff'`) carrying the questionnaire, not an
    // exit-4 failure.
    //
    // FND-002 (level 1): when a terminal is present, the handoff carries a
    // human-legible message and a next step describing the interactive
    // continuation, so no renderer is left with a shapeless payload. When there is
    // no interactive continuation (a non-TTY human, or the machine `--json`
    // channel) the handoff stays lean: the CLI renderer (`renderHuman`) owns the
    // transport-correct guidance there — an interactive "answer the questions"
    // instruction would be a lie in a non-TTY shell, and a machine reads the
    // questionnaire/`flow` directly. This keeps the no-silent-success fallback in
    // `renderHuman` the single, load-bearing source for the non-interactive case.
    const interactiveGuidance = request.interactive
      ? {
          message:
            'Operating Board initialization needs a few governance answers before it can continue.',
          next: ['Answer the guided initialization questions to continue.'],
        }
      : {};
    return handoffContinuation('input_required', 'E_OPERATE_INPUT_REQUIRED', {
      ...interactiveGuidance,
      questionnaire,
    });
  }
  const profile = supplied.profile as OperatingProfile['id'];
  const decisionOwner =
    supplied.decisionOwner ?? option<string>(request, 'decisionOwner', '').trim();
  const planningEngine =
    supplied.planningEngine ??
    option<OperatingConfig['planningEngine']>(request, 'planningEngine', 'openplanr');
  const rawCharter = supplied.charter ?? option<Partial<OperatingCharter>>(request, 'charter', {});
  const preview = await prepareOperatingInitialization({
    projectRoot: request.projectRoot,
    profile,
    decisionOwner,
    planningEngine,
    runtime: supplied.runtime ?? option(request, 'runtime', 'auto'),
    cadence: supplied.cadence ?? option(request, 'cadence', 'manual'),
    timezone:
      supplied.timezone ??
      option(request, 'timezone', Intl.DateTimeFormat().resolvedOptions().timeZone),
    sensitivityCeiling:
      supplied.sensitivityCeiling ?? option(request, 'sensitivityCeiling', 'internal'),
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
    // FR5 / T-005: name the machine-local preference keys a re-init will actually
    // change (dispatch-mode overrides, adapter lease, cadence marker), so the
    // operator sees the field-level delta — not just that preferences.json is in
    // the affected-files list — before confirming.
    changedPreferenceKeys: preview.changedPreferenceKeys,
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
  // FR4: a committed init apply is a fresh (re-genesised) board. Purge the
  // machine-local advisor sessions and incremental evidence baselines a prior
  // generation left at this path so the new board never inherits a stale
  // session or a baseline bound to a superseded workspace/board identity.
  await purgeBoardMachineLocalCaches({ projectRoot: request.projectRoot, localRoot });
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
  if (!profile.enabledRoles?.length) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Custom profile is incomplete.');
  }
  return success(request.action, { data: profile, message: 'Custom profile is valid.' });
}

/**
 * FR10 / T-009 + T-018 — the legacy `.planr/operate-profile.json` field migration
 * (`profiles migrate inspect|apply`), routed through the action map. T-009 wired
 * these directly to `profile-migration.ts`, which meant they bypassed the
 * cross-cutting handling every other action receives here — notably the
 * storage-layout auto-migration guard in `executeOperateAction`. Dispatching them
 * through the map restores that guard for the mutating `apply` (so a
 * SPEC-002-layout project is reconciled on open before the profile is rewritten),
 * plus the standard `--json` shaping and structured provenance. `inspect` stays a
 * read-only preview (`OPERATE_READ_ONLY_ACTIONS`): per FR10 it previews without
 * mutating, so it must not migrate the on-disk layout as a side effect. The
 * migration's own semantics are unchanged: still idempotent, still an exact
 * digest-verified backup before mutation, still a journalled transaction with
 * rollback — all owned by `profile-migration.ts`, which this handler only calls.
 */
async function profileMigration(request: OperateActionRequest): Promise<OperateActionResult> {
  const localRoot = option<string | undefined>(request, 'localRoot', undefined);
  const scoped = localRoot ? { localRoot } : {};
  if (request.action === 'profiles.migrate.inspect') {
    const inspection = await inspectOperatingProfileMigration({
      projectRoot: request.projectRoot,
      ...scoped,
    });
    return success(request.action, {
      message: !inspection.present
        ? 'No legacy .planr/operate-profile.json is present; nothing to migrate.'
        : inspection.changed
          ? `Legacy profile migration previewed: ${inspection.converted.length} field(s) converted, ${inspection.unsupported.length} unsupported. No change was made.`
          : 'Legacy profile already matches the current schema; nothing to migrate.',
      counts: {
        preserved: inspection.preserved.length,
        converted: inspection.converted.length,
        unsupported: inspection.unsupported.length,
      },
      warnings: inspection.unsupported.map((entry) => `${entry.field}: ${entry.reason}`),
      data: inspection,
      next:
        inspection.present && inspection.changed
          ? ['planr operate profiles migrate apply --yes']
          : [],
    });
  }
  const applied = await applyOperatingProfileMigration({
    projectRoot: request.projectRoot,
    confirmed: option(request, 'yes', false),
    ...scoped,
  });
  return success(request.action, {
    message: !applied.present
      ? 'No legacy .planr/operate-profile.json is present; nothing to migrate.'
      : applied.applied
        ? `Migrated the legacy operating profile; exact pre-migration backup written. Converted ${applied.converted.length} field(s); dropped ${applied.unsupported.length} unsupported field(s).`
        : 'Legacy operating profile already matches the current schema; no change was made.',
    paths: applied.backupPath ? { backup: applied.backupPath } : {},
    counts: {
      preserved: applied.preserved.length,
      converted: applied.converted.length,
      unsupported: applied.unsupported.length,
    },
    warnings: applied.unsupported.map((entry) => `${entry.field}: ${entry.reason}`),
    data: applied,
  });
}

/**
 * The cycle states a governed cycle carries while it is still mid-flight: work
 * may already be durably recorded, but no gate has been reached. The aggregate
 * surfaces (`status`, `review`) must never describe a board in one of these
 * states as quiet or as standing at the review gate — the per-lens board files
 * stay honest, so an aggregate that claims otherwise is the only thing a reader
 * can be misled by.
 */
const OPERATING_IN_FLIGHT_CYCLE_STATES = new Set([
  'preparing',
  'collecting',
  'advising',
  'consolidating',
]);

/** The only cycle states that genuinely present the mandatory human review gate. */
const OPERATING_REVIEW_GATE_CYCLE_STATES = new Set(['reviewable', 'blocked', 'failed']);

/**
 * The advisory lenses a cycle is expected to record: the roles the cycle itself
 * enabled (or every board role when it recorded no explicit selection), with
 * Chair always expected because the review gate needs the consolidation.
 */
function expectedOperatingCycleRoles(cycle: Record<string, unknown>): string[] {
  const enabled = Array.isArray(cycle.enabledRoles)
    ? cycle.enabledRoles.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const wanted = new Set<string>(
    enabled.length > 0 ? enabled : OPERATING_BOARD_ROLES.map((role) => role.id),
  );
  wanted.add('chair');
  return OPERATING_BOARD_ROLES.map((role) => role.id).filter((id) => wanted.has(id));
}

/**
 * The truthful one-line account of a mid-flight cycle for `status`: how much of
 * the board has durably recorded, and what is still outstanding before the
 * review gate. Sourced from the committed `advisor-result` records, never from
 * `state.summary.quiet` — projected findings only exist after consolidation, so
 * a board with five recorded lenses and no Chair still summarizes as quiet, and
 * reporting that summary is the false-negative this replaces.
 */
async function describeInFlightOperatingCycle(
  store: OperatingEventStore,
  cycle: Record<string, unknown> & { id: string; state: string },
): Promise<string> {
  const expected = expectedOperatingCycleRoles(cycle);
  const results = await readPersistedOperatingRoleResults(store, cycle.id);
  const recorded = new Set<string>(results.map((result) => result.roleId));
  const pending = expected.filter((roleId) => !recorded.has(roleId));
  const proposals = results.reduce((total, result) => total + result.proposals.length, 0);
  return [
    `Cycle ${cycle.id} is ${cycle.state}, not quiet:`,
    `${expected.filter((roleId) => recorded.has(roleId)).length} of ${expected.length}`,
    `advisory lens result(s) recorded, ${proposals} recorded proposal(s) awaiting consolidation.`,
    pending.length > 0
      ? `Outstanding lens(es): ${pending.join(', ')}.`
      : 'Every expected lens has recorded; consolidation into a reviewable board is outstanding.',
  ].join(' ');
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
  // A cycle that is still preparing/collecting/advising/consolidating is
  // mid-flight, so neither `quiet` nor a surfaced-findings count describes it:
  // both are projections that only become meaningful after consolidation. Report
  // the real cycle state and the outstanding lenses instead.
  const inFlightCycle =
    activeCycle && OPERATING_IN_FLIGHT_CYCLE_STATES.has(activeCycle.state)
      ? activeCycle
      : undefined;
  return success(request.action, {
    data: { ...state, cadence: { mode: config.cadence, lastRunAt, nextDueAt } },
    message:
      activeCycle?.state === 'blocked'
        ? `Operating Board is blocked on ${state.summary.openGaps} evidence or advisor readiness gap(s).`
        : inFlightCycle
          ? await describeInFlightOperatingCycle(store, inFlightCycle)
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
  if (
    resolvedRuntime !== 'auto' &&
    !nativeAdvisors &&
    !option(request, 'offline', false) &&
    !option(request, 'reviewOnly', false)
  ) {
    throw new OperateError(
      'E_RUNTIME_UNSUPPORTED',
      `Runtime ${resolvedRuntime} does not expose a compatible agent-native Operate workflow.`,
      {
        runtime: resolvedRuntime,
        recovery:
          'Run `planr setup --scope user`, then restart the runtime so its generated Operate workflow is available.',
      },
    );
  }
  const deferAdvisors =
    !option(request, 'offline', false) &&
    !option(request, 'dryRun', false) &&
    !option(request, 'reviewOnly', false) &&
    nativeAdvisors;
  // Preflight the structured-provider key on a non-offline, non-native preview so
  // `run --preview` names a missing key before any cycle starts, rather than
  // surfacing it only when a real cycle reaches the provider path. Native and
  // offline runs never need the structured key, so they skip the check.
  const previewProviderWarnings: string[] = [];
  if (
    option(request, 'preview', false) &&
    !option(request, 'offline', false) &&
    !option(request, 'reviewOnly', false) &&
    !nativeAdvisors
  ) {
    const openPlanrConfig = await loadConfig(request.projectRoot).catch(() => null);
    const readiness = openPlanrConfig
      ? await resolveAIProviderReadiness(openPlanrConfig)
      : {
          configured: false,
          keyResolvable: false,
          remedy:
            'No AI provider is configured. Run `planr config set-provider <name>` then `planr config set-key <provider>`, or run offline with --offline.',
        };
    if (!readiness.keyResolvable && readiness.remedy) {
      previewProviderWarnings.push(readiness.remedy);
    }
  }
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
  const drafts =
    !result.preview &&
    !result.dryRun &&
    !result.nativeHandoff &&
    ['reviewable', 'closed'].includes(projected?.state ?? '')
      ? await materializeOperatingDrafts({
          projectRoot: request.projectRoot,
          cycleId: result.cycle.id,
        })
      : { created: [], existing: [], rejected: [] };
  if (drafts.created.length > 0 && result.state) {
    await persistOperatingProjections({
      projectRoot: request.projectRoot,
      state: result.state,
      revalidateEventHead: async () =>
        (await new OperatingEventStore(request.projectRoot).replay()).eventHead,
    });
  }
  const counts = {
    findings:
      result.state?.findings.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    decisions:
      result.state?.decisions.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    gaps: result.state?.dataGaps.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    specs: result.state?.specLinks.filter((entry) => entry.cycleId === result.cycle.id).length ?? 0,
    artifacts: drafts.created.length + drafts.existing.length,
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
      report: `.planr/operate/cycles/${result.cycle.id}/report.md`,
      reportJson: `.planr/operate/cycles/${result.cycle.id}/report.json`,
      actions: `.planr/operate/cycles/${result.cycle.id}/actions.md`,
    },
    counts,
    handoff,
    warnings: [
      ...new Set([
        ...(result.cycle.warnings ?? []),
        ...stringList(projected?.warnings),
        ...previewProviderWarnings,
      ]),
    ],
    nextActions,
    data: { ...result, drafts },
    next: nextActions,
  });
}

async function drafts(request: OperateActionRequest): Promise<OperateActionResult> {
  if (request.action === 'drafts.list') {
    const records = await listOperatingDrafts(request.projectRoot);
    return success(request.action, {
      data: records.map((record) => record.draft),
      counts: { artifacts: records.length },
    });
  }
  const draftId = argument(request, 'draftId') ?? argument(request, 'id');
  if (!draftId) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Draft ID is required.');
  }
  if (request.action === 'drafts.show') {
    return success(request.action, {
      data: await showOperatingDraft(request.projectRoot, draftId),
    });
  }
  if (!option(request, 'yes', false)) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      `${request.action} requires explicit confirmation with --yes.`,
    );
  }
  if (request.action === 'drafts.approve') {
    return success(request.action, {
      data: await approveOperatingDraft(request.projectRoot, draftId),
      message: `Operating draft ${draftId} approved. PLAN and SHIP remain separate actions.`,
    });
  }
  return success(request.action, {
    data: await discardOperatingDraft(request.projectRoot, draftId),
    message: `Operating draft ${draftId} discarded.`,
  });
}

async function contextResearch(request: OperateActionRequest): Promise<OperateActionResult> {
  if (request.action === 'context.show') {
    return success(request.action, {
      data: await readOperatingContextResearch(request.projectRoot),
    });
  }
  if (request.action === 'context.review') {
    return success(request.action, {
      data: await recordOperatingContextResearch({
        projectRoot: request.projectRoot,
        stdin: request.stdin,
      }),
      message:
        'Runtime-authored context was validated against the workspace and is ready for one compact owner review.',
      next: ['planr operate init'],
    });
  }
  const runtime = await resolvedOperatingRuntime(
    request.projectRoot,
    option(request, 'runtime', 'auto'),
  );
  if (runtime === 'auto') {
    throw new OperateError(
      'E_RUNTIME_UNSUPPORTED',
      'Context research requires a selected Claude Code, Codex, or Cursor runtime.',
    );
  }
  const researchMode = option<'local' | 'connected'>(request, 'research', 'local');
  const consentDigest =
    researchMode === 'connected'
      ? canonicalDigest({
          action: 'operate.context.connected-research',
          runtime,
          project: canonicalDigest(request.projectRoot),
        })
      : null;
  const preview = option(request, 'preview', false);
  if (researchMode === 'connected' && !preview && !option(request, 'yes', false)) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Connected research requires the exact preview and explicit confirmation.',
      {
        confirmationDigest: consentDigest,
        recovery: `planr operate context refresh --research connected --runtime ${runtime} --yes --confirm ${consentDigest}`,
      },
    );
  }
  const confirmed = option<string | undefined>(request, 'confirm', undefined);
  if (researchMode === 'connected' && !preview && confirmed !== consentDigest) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Connected research confirmation does not match the current project and runtime.',
      { confirmationDigest: consentDigest },
    );
  }
  const prepared = await prepareOperatingContextResearch({
    projectRoot: request.projectRoot,
    runtime,
    researchMode,
    connectedResearchConsentDigest: consentDigest,
    preview,
  });
  return success(request.action, {
    data: { ...prepared, confirmationDigest: consentDigest },
    preview: preview ? { researchMode, runtime, confirmationDigest: consentDigest } : undefined,
    message: preview
      ? 'Context research preview is ready; no workspace or provider action occurred.'
      : 'Agent-native context research is prepared for the selected runtime.',
    next: preview
      ? [
          `planr operate context refresh --research ${researchMode} --runtime ${runtime}${researchMode === 'connected' ? ` --yes --confirm ${consentDigest}` : ''}`,
        ]
      : ['planr operate context review --stdin --json'],
  });
}

/**
 * Whether `review` is genuinely standing at the mandatory human review gate —
 * and, when it is not, the exact phase the cycle actually reached plus the
 * artifacts still missing. Verified from the committed cycle state and the
 * on-disk artifacts (`verifyOperatingCompletionPhases`), never from the fact
 * that the command ran: announcing the gate for a cycle still in `advising`
 * tells a reader the board is done deliberating when five lenses are recorded
 * and the Chair has not run.
 */
async function operatingReviewGateMessage(input: {
  projectRoot: string;
  cycleId?: string;
  localRoot?: string;
}): Promise<{ message: string; warnings: string[] }> {
  const scoped = input.localRoot ? { localRoot: input.localRoot } : {};
  const state = await new OperatingEventStore(input.projectRoot, scoped).state();
  const targetId = input.cycleId ?? state.summary.currentCycleId ?? undefined;
  const cycle = targetId ? state.cycles.find((entry) => entry.id === targetId) : undefined;
  if (!cycle) {
    return {
      message:
        'No governed operating cycle exists yet, so no review gate has been reached. No route has been applied.',
      warnings: [],
    };
  }
  if (OPERATING_REVIEW_GATE_CYCLE_STATES.has(cycle.state)) {
    return {
      message: 'This is the mandatory human review gate. No route has been applied.',
      warnings: [],
    };
  }
  const completion = await verifyOperatingCompletionPhases(
    state,
    cycle.id,
    resolveOperatingPaths(input.projectRoot, scoped),
  );
  return {
    message: [
      `Cycle ${cycle.id} is ${cycle.state} and has NOT reached the human review gate.`,
      `Verified on disk: reached phase ${completion.reachedPhase ?? 'none'} (${completion.reachedLabel}).`,
      ...(completion.nextPhase
        ? [`Current phase: ${completion.nextPhase} — ${completion.nextLabel}.`]
        : []),
      ...(completion.missing.length > 0
        ? [`Still missing: ${completion.missing.join('; ')}.`]
        : []),
      'No route has been applied.',
    ].join(' '),
    warnings: completion.missing.map((item) => `Missing before the review gate: ${item}`),
  };
}

async function reviewOrBrief(request: OperateActionRequest): Promise<OperateActionResult> {
  const cycleId = argument(request, 'cycleId');
  // FR3/E-003: the human review gate renders report Markdown (brief + per-role
  // lens reports + exact next actions), never a raw `JSON.stringify` of the
  // state. `--json` keeps returning the exact raw state object, byte-unchanged.
  const human = request.action === 'review' && !option(request, 'json', false);
  const localRoot = option<string | undefined>(request, 'localRoot', undefined);
  const data = await readOperatingReview({
    projectRoot: request.projectRoot,
    cycleId,
    brief: request.action === 'brief',
    human,
    localRoot,
  });
  if (request.action !== 'review') return success(request.action, { data });
  const gate = await operatingReviewGateMessage({
    projectRoot: request.projectRoot,
    cycleId,
    localRoot,
  });
  return success(request.action, { data, message: gate.message, warnings: gate.warnings });
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

async function abandonStalledRole(request: OperateActionRequest): Promise<OperateActionResult> {
  // SPEC-005 T-020 — the operator escape for a cycle stranded at `phase: advisors`
  // because a runtime dispatched a lens and reported nothing. Gated on a lapsed
  // adapter lease + `--yes`, it terminally governs the still-unrecorded lenses
  // `not_evaluated` so a following `planr operate run` (offline when no runtime is
  // available) reaches a reviewable cycle without discarding the recorded work. It
  // never invokes the runtime lifecycle, so it works when the runtime is gone.
  const cycleId = argument(request, 'cycleId');
  if (!cycleId) throw new OperateError('E_OPERATE_STATE_INVALID', 'Cycle ID is required.');
  const data = await reapStalledOperatingRoles({
    projectRoot: request.projectRoot,
    cycleId,
    role: option(request, 'role', undefined),
    reason: option(request, 'reason', undefined),
    confirmed: option(request, 'yes', false),
  });
  return success(request.action, { data, nextActions: data.next, next: data.next });
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
  const lifecycleNamespace = request.action.startsWith('harness.') ? 'harness.' : 'adapter.';
  const data = await operateAdapterLifecycle({
    projectRoot: request.projectRoot,
    action: request.action.slice(lifecycleNamespace.length) as
      | 'prepare'
      | 'record'
      | 'validate'
      | 'resume'
      | 'finalize'
      | 'cancel'
      | 'heartbeat'
      | 'abandon',
    cycleId: option(request, 'cycleId', undefined),
    evidenceDigest: option(request, 'evidenceDigest', undefined),
    lease: option(request, 'lease', undefined),
    idempotencyKey: option(request, 'idempotencyKey', undefined),
    role: option(request, 'role', undefined),
    reason: option(request, 'reason', undefined),
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
  'profiles.migrate.inspect': profileMigration,
  'profiles.migrate.apply': profileMigration,
  'context.show': contextResearch,
  'context.refresh': contextResearch,
  'context.review': contextResearch,
  'drafts.list': drafts,
  'drafts.show': drafts,
  'drafts.approve': drafts,
  'drafts.discard': drafts,
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
  'adapter.validate': maintenance,
  'adapter.resume': maintenance,
  'adapter.finalize': maintenance,
  'adapter.cancel': maintenance,
  'adapter.heartbeat': maintenance,
  'adapter.abandon': maintenance,
  'harness.prepare': maintenance,
  'harness.record': maintenance,
  'harness.validate': maintenance,
  'harness.resume': maintenance,
  'harness.finalize': maintenance,
  'harness.cancel': maintenance,
  'harness.heartbeat': maintenance,
  'harness.abandon': maintenance,
  'cycles.abandon-role': abandonStalledRole,
};

/**
 * Actions that only read committed state. A SPEC-002-layout project stays
 * readable through these without being migrated; only a mutating action opening
 * such a project triggers the automatic, journal-safe v1.3 migration (FR5/E-005).
 *
 * T-018: `profiles.migrate.inspect` is listed here — it previews the profile
 * migration without writing (FR10), so it must not reconcile the storage layout
 * as a side effect. Only the mutating `profiles.migrate.apply` is absent, so it
 * receives the guard the T-009 direct wiring skipped before it rewrites the
 * profile on a SPEC-002-layout project.
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
  'profiles.migrate.inspect',
  'context.show',
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
  'migrate.inspect',
  'migrations.list',
  'migrations.show',
  'cache.status',
  'integrity.status',
  'adapter.resume',
  'harness.resume',
  // US-T1: the harness/adapter response dry-run reads the prepared session, takes
  // no lease, and mutates nothing — so it must not trigger the mutating-action
  // storage-layout migration on open.
  'adapter.validate',
  'harness.validate',
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
    // FR7/E-007: first-use provider consent is a healthy continuation, not a
    // failure — return the `ok: true` handoff shape instead of an exit-4 error.
    // Every other authority/error stays a genuine failure.
    if (isProviderConsentHandoff(error)) {
      const continuation = providerConsentContinuation(request.action, error);
      try {
        return await attachStructuredActions(request, continuation);
      } catch {
        return continuation;
      }
    }
    try {
      return await attachStructuredActions(request, failure(request.action, error));
    } catch {
      return failure(request.action, error);
    }
  }
}
