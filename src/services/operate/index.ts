import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyOperatingInitialization,
  getOperatingProfile,
  listOperatingProfiles,
  normalizeCustomOperatingProfile,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from './config.js';
import { runOperatingCycle } from './engine.js';
import { OperatingEventStore } from './event-store.js';
import { parseStrictJson, readImportedEvidenceFile } from './evidence-import.js';
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
  exportOperatingDiagnostics,
  operateAdapterLifecycle,
  operatingCacheAction,
  operatingIntegrityAction,
  repairOperatingSecurity,
} from './maintenance.js';
import { renderOperatingBrief } from './projection.js';
import { loadOperatingProtocol, resolveOperatingPipelineRoot } from './protocol.js';
import { executeGitHubReadOnly, executeGitReadOnly } from './read-only-providers.js';
import {
  type OperateActionRequest,
  type OperateActionResult,
  OperateError,
  type OperateErrorCode,
  type OperatingCharter,
  type OperatingConfig,
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
            capabilities?: { toolIsolation?: string; operatingBoard?: boolean };
          }>;
        },
    )
    .catch(() => ({ adapters: [] }));
  const adapter = registry.adapters?.find((entry) => entry.id === adapterId);
  return (
    adapter?.capabilities?.operatingBoard === true &&
    adapter.capabilities.toolIsolation === 'enforced'
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
  E_OPERATE_PATH_ESCAPE: 2,
  E_OPERATE_NOT_INITIALIZED: 3,
  E_OPERATE_PROJECT_REQUIRED: 3,
  E_PIPELINE_NOT_INSTALLED: 3,
  E_OPERATE_AUTHORITY_REQUIRED: 4,
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
  E_OPERATE_TRANSACTION_INVALID: 5,
  E_OPERATE_ADVISOR_FAILED: 6,
  E_OPERATE_ADVISOR_ISOLATION: 6,
  E_OPERATE_CAP_EXCEEDED: 6,
  E_OPERATE_CRITICAL_CAP: 6,
  E_OPERATE_EVIDENCE_BUDGET: 6,
  E_OPERATE_EVIDENCE_NOT_READY: 6,
  E_OPERATE_EVIDENCE_REJECTED: 6,
  E_OPERATE_PROVIDER_READ_ONLY: 6,
  E_OPERATE_SECRET_DETECTED: 6,
} as const satisfies Readonly<Record<OperateErrorCode, number>>;

function operateExitCode(code: OperateErrorCode): number {
  return OPERATE_EXIT_CODES[code];
}

function failure(action: string, error: unknown): OperateActionResult {
  const code = error instanceof OperateError ? error.code : 'E_OPERATE_INTERNAL';
  const nextActions =
    code === 'E_PIPELINE_NOT_INSTALLED'
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
                        : ['planr operate diagnostics export'];
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

async function inspect(request: OperateActionRequest): Promise<OperateActionResult> {
  const pipelineRoot = resolveOperatingPipelineRoot();
  const paths = resolveOperatingPaths(request.projectRoot);
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
      machineLocalState: '~/.planr/operate/<project-hash>',
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

async function initialize(request: OperateActionRequest): Promise<OperateActionResult> {
  await loadOperatingProtocol();
  if (!request.interactive) {
    const missing = ['profile', 'decisionOwner', 'planningEngine'].filter(
      (name) =>
        !Object.hasOwn(request.options, name) ||
        String(request.options[name] ?? '').trim().length === 0,
    );
    if (missing.length > 0) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `Non-interactive initialization requires explicit ${missing
          .map((name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
          .join(', ')}.`,
        { missing },
      );
    }
  }
  const profile = option<OperatingProfile['id']>(request, 'profile', 'saas');
  let customProfile: Partial<OperatingProfile> | undefined;
  const profileFile = option<string | undefined>(request, 'profileFile', undefined);
  if (profile === 'custom') {
    if (!profileFile) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'The custom profile requires --profile-file inside the project.',
      );
    }
    customProfile = await readCustomOperatingProfile(request.projectRoot, profileFile);
  } else if (profileFile) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      '--profile-file is valid only with --profile custom.',
    );
  }
  const decisionOwner = option<string>(request, 'decisionOwner', '').trim();
  const planningEngine = option<OperatingConfig['planningEngine']>(
    request,
    'planningEngine',
    'openplanr',
  );
  const rawCharter = option<Partial<OperatingCharter>>(request, 'charter', {});
  const preview = await prepareOperatingInitialization({
    projectRoot: request.projectRoot,
    profile,
    decisionOwner,
    planningEngine,
    runtime: option(request, 'runtime', 'auto'),
    cadence: option(request, 'cadence', 'manual'),
    timezone: option(request, 'timezone', Intl.DateTimeFormat().resolvedOptions().timeZone),
    sensitivityCeiling: option(request, 'sensitivityCeiling', 'internal'),
    enabledProviders: stringList(request.options.sources).length
      ? stringList(request.options.sources)
      : undefined,
    evidenceFiles: stringList(request.options.evidenceFile),
    charter: rawCharter,
    customProfile,
    componentRoots: stringList(request.options.components),
  });
  const legacyMigration = await inspectOperatingMigration({
    projectRoot: request.projectRoot,
  });
  const previewData = {
    previewDigest: preview.previewDigest,
    changedPaths: preview.changedPaths,
    localPreferencesChanged: preview.preferencesChanged,
    workspaceDigest: preview.workspace.workspaceDigest,
    config: preview.config,
    legacyMigration,
  };
  if (option(request, 'preview', false) || option(request, 'dryRun', false)) {
    return success(request.action, {
      message: 'Operating Board initialization preview is ready; no state was written.',
      preview: previewData,
      next: ['planr operate init --yes'],
    });
  }
  if (!request.interactive && !option(request, 'yes', false)) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Non-interactive initialization requires --yes after reviewing --preview.',
      { preview: previewData },
    );
  }
  const applied = await applyOperatingInitialization({
    projectRoot: request.projectRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
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
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', `Unknown evidence source: ${id}.`);
  }
  if (request.action !== 'sources.test') return success(request.action, { data: provider });
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
  return success(request.action, {
    data: { provider, healthy: true, observation, writeBoundary: 'none' },
  });
}

async function status(request: OperateActionRequest): Promise<OperateActionResult> {
  await validateOperatingConfiguration(request.projectRoot);
  await assertCommittedOperatingView(request.projectRoot);
  const store = new OperatingEventStore(request.projectRoot);
  const state = await store.state();
  const activeCycle = [...state.cycles]
    .filter((cycle) => !['closed', 'cancelled'].includes(cycle.state))
    .sort((left, right) => left.id.localeCompare(right.id))
    .at(-1);
  return success(request.action, {
    data: state,
    message:
      activeCycle?.state === 'blocked'
        ? `Operating Board is blocked on ${state.summary.openGaps} evidence or advisor readiness gap(s).`
        : state.summary.quiet
          ? 'Operating Board is quiet.'
          : `${state.summary.surfacedFindings} finding(s) are surfaced.`,
  });
}

async function run(request: OperateActionRequest): Promise<OperateActionResult> {
  const requestedRuntime = option(request, 'runtime', 'auto');
  const deferAdvisors =
    !option(request, 'offline', false) &&
    !option(request, 'dryRun', false) &&
    !option(request, 'reviewOnly', false) &&
    (await usesNativeOperatingAdvisors(request.projectRoot, requestedRuntime));
  const result = await runOperatingCycle({
    projectRoot: request.projectRoot,
    focus: stringList(request.options.focus) as Parameters<typeof runOperatingCycle>[0]['focus'],
    depth: option(request, 'depth', 'standard'),
    runtime: requestedRuntime,
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
  const nextActions = result.preview
    ? ['planr operate run --offline']
    : result.nativeHandoff
      ? [
          `planr operate adapter prepare --cycle-id ${result.nativeHandoff.cycleId} --evidence-digest ${result.nativeHandoff.evidenceDigest} --idempotency-key native-${result.nativeHandoff.cycleId}-${result.nativeHandoff.phase} --role ${result.nativeHandoff.roles.join(',')}`,
        ]
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
  return success(request.action, {
    data: await operateAdapterLifecycle({
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
    }),
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
  'adapter.resume': maintenance,
  'adapter.finalize': maintenance,
  'adapter.cancel': maintenance,
};

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
    return await handler(request);
  } catch (error) {
    return failure(request.action, error);
  }
}
