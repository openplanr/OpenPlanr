import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createOperatingArtifactGenerationPlan,
  generatedArtifactWrites,
  generateOperatingRouteArtifact,
  type OperatingArtifactGenerationPlan,
  type OperatingArtifactGeneratorAdapter,
  readStoredOperatingArtifactGeneration,
  resolveOperatingArtifactGenerator,
  type StoredOperatingArtifactGeneration,
} from './artifact-route-generation.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { operatingProjectKey } from './config.js';
import { OperatingEventStore } from './event-store.js';
import {
  applyJournalTransaction,
  prepareJournalTransaction,
  readJournal,
  rollbackJournalTransaction,
} from './journal.js';
import { withOperatingLock } from './lock-service.js';
import {
  assertPlanningProducer,
  completePipelinePoHandoff,
  hasPipelinePoCompletionProvenance,
  inspectPlanningProducer,
  loadPipelinePoBridge,
  type PipelinePoHandoff,
  preparePipelinePoHandoff,
} from './pipeline-handoff.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { assertOperatingArtifact } from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingArtifactSession,
  type OperatingConfig,
  type OperatingEventHead,
  type OperatingFinding,
  type OperatingOutcome,
  type OperatingRouteAction,
  type OperatingRoutePlan,
  type OperatingWorkspaceManifest,
} from './types.js';
import {
  refreshOperatingWorkspaceManifest,
  resolveContainedPath,
  resolveOperatingPaths,
} from './workspace.js';

const ROUTE_MANAGED_WORKSPACE_PATHS = ['.planr/specs', '.planr/provenance.jsonl'] as const;

function actionKind(finding: OperatingFinding): OperatingRouteAction['kind'] {
  if (finding.lane === 'OWNER') return 'create-decision';
  if (finding.lane === 'AGENT') return 'create-cycle-artifact';
  if (finding.category.includes('instrument')) return 'create-instrumentation-spec';
  return 'create-spec';
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'operating-action'
  );
}

export async function nextOperatingSpecOrdinal(projectRoot: string): Promise<number> {
  const root = path.join(projectRoot, '.planr', 'specs');
  let maximum = 0;
  for (const name of await readdir(root).catch(() => [])) {
    const match = name.match(/^SPEC-(\d+)(?:-|$)/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum + 1;
}

function routeDestinationPaths(route: OperatingRoutePlan): string[] {
  const action = route.actions[0];
  if (!action?.targetPath) return [];
  if (action.kind === 'create-spec' || action.kind === 'create-instrumentation-spec') {
    const specId = action.targetPath.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
    if (!specId) return [action.targetPath];
    const ordinal = specId.slice('SPEC-'.length);
    return [
      action.targetPath,
      `.planr/operate/spec-links/${specId}.json`,
      `.planr/operate/outcomes/OUT-${ordinal}.json`,
      `.planr/operate/handoffs/${route.id}.json`,
    ];
  }
  if (action.kind === 'create-cycle-artifact') {
    const artifactId = `ART-${route.id.slice('ACT-'.length)}`;
    return [
      action.targetPath,
      `${path.posix.dirname(action.targetPath)}/${artifactId}.session.json`,
    ];
  }
  return [action.targetPath];
}

export async function createOperatingRoutePlan(input: {
  projectRoot: string;
  cycleId: string;
  finding: OperatingFinding;
  config: OperatingConfig;
  workspace: OperatingWorkspaceManifest;
  eventHead: OperatingEventHead;
  evidenceDigest: `sha256:${string}`;
  providerDigest: `sha256:${string}`;
  sequence: number;
  specId?: string;
  localRoot?: string;
  now?: string;
}): Promise<OperatingRoutePlan> {
  const now = input.now ?? new Date().toISOString();
  const id = `ACT-${String(input.sequence).padStart(3, '0')}`;
  const kind = actionKind(input.finding);
  const slug = slugify(input.finding.title);
  const targetPath =
    kind === 'create-spec' || kind === 'create-instrumentation-spec'
      ? `.planr/specs/${input.specId ?? `SPEC-${String(input.sequence).padStart(3, '0')}`}-${slug}/${input.specId ?? `SPEC-${String(input.sequence).padStart(3, '0')}`}-${slug}.md`
      : kind === 'create-cycle-artifact'
        ? `.planr/operate/cycles/${input.cycleId}/artifacts/ART-${id.slice('ACT-'.length)}-${slug}.md`
        : `.planr/operate/decisions/${id}.json`;
  const action: OperatingRouteAction = {
    id,
    findingId: input.finding.id,
    lane: input.finding.lane,
    owner: input.finding.owner,
    kind,
    dependsOn: [],
    evidenceRefs: [...input.finding.evidenceRefs].sort(),
    reversible: true,
    requiresConfirmation: true,
    targetPath,
  };
  const routeWorkspace = await refreshOperatingWorkspaceManifest(input.projectRoot, {
    localRoot: input.localRoot,
    ignoredControlPaths: [...ROUTE_MANAGED_WORKSPACE_PATHS],
  });
  const destinationShape = {
    actions: [action],
    id,
  } as OperatingRoutePlan;
  const destinationDigest = canonicalDigest(
    routeDestinationPaths(destinationShape).map((destination) => ({
      path: destination,
      beforeDigest: null,
    })),
  );
  const inputDigest = canonicalDigest({
    project: routeWorkspace.workspaceDigest,
    cycleId: input.cycleId,
    findingId: input.finding.id,
    evidenceHead: input.evidenceDigest,
    eventHead: input.eventHead,
    providerPolicy: input.providerDigest,
    destinations: destinationDigest,
    actions: [action],
    planningEngine: input.config.planningEngine,
  });
  const provisional: OperatingRoutePlan = {
    kind: 'operating-route-plan',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id,
    cycleId: input.cycleId,
    inputDigest,
    routeDigest: `sha256:${'0'.repeat(64)}`,
    previewDigest: `sha256:${'0'.repeat(64)}`,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: structuredClone(input.eventHead),
    state: 'proposed',
    actions: [action],
    createdAt: now,
  };
  const plannedWrites = await buildRouteWrites({
    projectRoot: input.projectRoot,
    route: provisional,
    finding: input.finding as unknown as Record<string, unknown>,
    config: input.config,
    now,
  });
  const previewDigest = routeWritesPreviewDigest(
    inputDigest,
    plannedWrites.writes,
    plannedWrites.generationPlan?.planDigest,
  );
  const routeDigest = canonicalDigest({
    id,
    cycleId: input.cycleId,
    inputDigest,
    previewDigest,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: input.eventHead,
    actions: [action],
  });
  const route: OperatingRoutePlan = {
    kind: 'operating-route-plan',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id,
    cycleId: input.cycleId,
    inputDigest,
    routeDigest,
    previewDigest,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: structuredClone(input.eventHead),
    state: 'proposed',
    actions: [action],
    createdAt: now,
  };
  return assertOperatingArtifact('operating-route-plan', route);
}

async function assertRouteWorkspaceCurrent(input: {
  projectRoot: string;
  localRoot?: string;
  route: OperatingRoutePlan;
}): Promise<void> {
  const observed = await refreshOperatingWorkspaceManifest(input.projectRoot, {
    localRoot: input.localRoot,
    ignoredControlPaths: [...ROUTE_MANAGED_WORKSPACE_PATHS],
  });
  if (observed.workspaceDigest !== input.route.workspaceDigest) {
    throw new OperateError(
      'E_OPERATE_HEAD_DIVERGED',
      'Workspace revisions, branches, remotes, or material dirty fingerprints changed after the route preview.',
      {
        expectedWorkspaceDigest: input.route.workspaceDigest,
        actualWorkspaceDigest: observed.workspaceDigest,
      },
    );
  }
}

export async function readOperatingRoute(
  projectRoot: string,
  routeId: string,
): Promise<OperatingRoutePlan> {
  const target = path.join(resolveOperatingPaths(projectRoot).routes, `${routeId}.json`);
  const route = JSON.parse(await readFile(target, 'utf8')) as OperatingRoutePlan;
  return assertOperatingArtifact('operating-route-plan', route);
}

interface OperatingSpecLink {
  kind: 'operating-spec-link';
  schemaVersion: typeof OPERATE_SCHEMA_VERSION;
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION;
  specId: string;
  sourceCycle: string;
  sourceFinding: string;
  planningEngine: 'openplanr' | 'pipeline-po';
  evidenceRefs: string[];
  outcome: {
    kind: 'metric' | 'guardrail' | 'operational';
    metric: string;
    unit: string;
    queryIdentity: string;
    direction: 'increase';
    operator: 'gte';
    aggregation: 'latest';
    baselineWindow: { from: string; to: string };
    targetWindow: { from: string; to: string };
    threshold: { value: number };
    minimumCoverage: number;
    minimumSample: number;
    stalePolicy: 'create-gap';
    missingPolicy: 'create-gap';
    guardrailPrecedence: 'block-on-breach';
    source: string;
    observationWindow: string;
    verifyAfter: string;
  };
  guardrails: string[];
  rollout: string;
  rollback: string;
}

interface BuiltRouteWrites {
  writes: Array<{
    relativePath: string;
    operation: 'create';
    content: string;
  }>;
  specLink?: OperatingSpecLink;
  outcome?: OperatingOutcome;
  artifactSession?: OperatingArtifactSession;
  generationPlan?: OperatingArtifactGenerationPlan;
}

interface StoredPlanningHandoff {
  kind: 'operating-planning-handoff';
  routeId: string;
  transactionId: string;
  cycleId: string;
  specId: string;
  feature: string;
  targetPath: string;
  planningEngine: 'openplanr' | 'pipeline-po';
  runtime: string;
  invocation: string;
  state: 'awaiting-plan';
  inputDigest: `sha256:${string}`;
  prepared: PipelinePoHandoff | null;
  shipInvoked: false;
  createdAt: string;
}

function localPlanningHandoffPath(
  projectRoot: string,
  routeId: string,
  localRoot?: string,
): string {
  return path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'planning-handoffs',
    `${routeId}.json`,
  );
}

async function readOperatingRuntime(projectRoot: string, localRoot?: string): Promise<string> {
  const target = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'preferences.json',
  );
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as { runtime?: unknown };
    return typeof parsed.runtime === 'string' && parsed.runtime.trim() ? parsed.runtime : 'auto';
  } catch {
    return 'auto';
  }
}

function validateStoredPlanningHandoff(
  value: unknown,
  expected: {
    route: OperatingRoutePlan;
    transactionId: string;
    planningEngine: 'openplanr' | 'pipeline-po';
  },
): StoredPlanningHandoff {
  const handoff = value as Partial<StoredPlanningHandoff>;
  if (
    !handoff ||
    handoff.kind !== 'operating-planning-handoff' ||
    handoff.routeId !== expected.route.id ||
    handoff.transactionId !== expected.transactionId ||
    handoff.cycleId !== expected.route.cycleId ||
    handoff.planningEngine !== expected.planningEngine ||
    handoff.inputDigest !== expected.route.inputDigest ||
    handoff.state !== 'awaiting-plan' ||
    handoff.shipInvoked !== false ||
    typeof handoff.specId !== 'string' ||
    typeof handoff.feature !== 'string' ||
    typeof handoff.targetPath !== 'string' ||
    typeof handoff.runtime !== 'string' ||
    typeof handoff.invocation !== 'string' ||
    typeof handoff.createdAt !== 'string'
  ) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The machine-local planning handoff does not match the accepted route.',
    );
  }
  if (
    expected.planningEngine === 'pipeline-po' &&
    (!handoff.prepared ||
      handoff.prepared.planningEngine !== 'pipeline-po' ||
      canonicalDigest(handoff.prepared.prepared) !== handoff.prepared.preparedDigest ||
      handoff.prepared.shipInvoked !== false)
  ) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The pipeline PO handoff digest is invalid.',
    );
  }
  if (expected.planningEngine === 'openplanr' && handoff.prepared !== null) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The OpenPlanr handoff contains an unexpected pipeline preparation.',
    );
  }
  return handoff as StoredPlanningHandoff;
}

async function ensurePlanningHandoff(input: {
  projectRoot: string;
  localRoot?: string;
  route: OperatingRoutePlan;
  config: OperatingConfig;
  finding: Record<string, unknown>;
  transactionId: string;
}): Promise<StoredPlanningHandoff> {
  const action = input.route.actions[0];
  const targetPath = path.posix.dirname(action.targetPath as string);
  const specId = action.targetPath?.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
  if (!specId) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      'DEV route target does not encode a canonical SPEC id.',
    );
  }
  const target = localPlanningHandoffPath(input.projectRoot, input.route.id, input.localRoot);
  const existing = await readFile(target, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    return validateStoredPlanningHandoff(JSON.parse(existing), {
      route: input.route,
      transactionId: input.transactionId,
      planningEngine: input.config.planningEngine,
    });
  }
  await assertPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath,
    selected: input.config.planningEngine,
  });
  const runtime = await readOperatingRuntime(input.projectRoot, input.localRoot);
  const feature = slugify(String(input.finding.title ?? action.findingId));
  const prepared =
    input.config.planningEngine === 'pipeline-po'
      ? await preparePipelinePoHandoff({
          bridge: await loadPipelinePoBridge(),
          projectRoot: input.projectRoot,
          feature,
          runtime,
          runId: `operate-${input.route.id.toLowerCase()}`,
          targetPath,
        })
      : null;
  const handoff: StoredPlanningHandoff = {
    kind: 'operating-planning-handoff',
    routeId: input.route.id,
    transactionId: input.transactionId,
    cycleId: input.route.cycleId,
    specId,
    feature,
    targetPath,
    planningEngine: input.config.planningEngine,
    runtime,
    invocation: prepared?.invocation ?? `planr spec decompose ${JSON.stringify(specId)}`,
    state: 'awaiting-plan',
    inputDigest: input.route.inputDigest,
    prepared,
    shipInvoked: false,
    createdAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${input.route.id}.tmp`;
  await writeFile(temporary, `${canonicalize(handoff)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return handoff;
}

async function completePlanningHandoffIfReady(input: {
  projectRoot: string;
  handoff: StoredPlanningHandoff;
}): Promise<boolean> {
  const inspection = await inspectPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath: input.handoff.targetPath,
  });
  if (!inspection.populated) return false;
  await assertPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath: input.handoff.targetPath,
    selected: input.handoff.planningEngine,
  });
  if (input.handoff.planningEngine === 'pipeline-po') {
    const completionRecorded = await hasPipelinePoCompletionProvenance({
      projectRoot: input.projectRoot,
      targetPath: input.handoff.targetPath,
      runId: input.handoff.prepared?.runId ?? input.handoff.transactionId,
    });
    if (!completionRecorded) {
      await completePipelinePoHandoff({
        bridge: await loadPipelinePoBridge(),
        projectRoot: input.projectRoot,
        runtime: input.handoff.runtime,
        handoff: input.handoff.prepared as PipelinePoHandoff,
        nativePlanCompleted: true,
      });
    }
    await assertPlanningProducer({
      projectRoot: input.projectRoot,
      targetPath: input.handoff.targetPath,
      selected: 'pipeline-po',
    });
    if (
      !(await hasPipelinePoCompletionProvenance({
        projectRoot: input.projectRoot,
        targetPath: input.handoff.targetPath,
        runId: input.handoff.prepared?.runId ?? input.handoff.transactionId,
      }))
    ) {
      throw new OperateError(
        'E_OPERATE_PLANNER_CONFLICT',
        'Pipeline PO completion did not record the expected route-bound provenance.',
      );
    }
  }
  return true;
}

function routeWritesPreviewDigest(
  inputDigest: `sha256:${string}`,
  writes: BuiltRouteWrites['writes'],
  generationPlanDigest?: `sha256:${string}`,
): `sha256:${string}` {
  return canonicalDigest({
    inputDigest,
    generationPlanDigest: generationPlanDigest ?? null,
    writes: writes.map((write) => ({
      path: write.relativePath,
      operation: write.operation,
      contentDigest: sha256Digest(write.content),
    })),
  });
}

async function routeWriteMaterialState(
  projectRoot: string,
  writes: BuiltRouteWrites['writes'],
): Promise<'absent' | 'exact'> {
  const observed = await Promise.all(
    writes.map(async (write) => {
      const target = await resolveContainedPath(projectRoot, write.relativePath);
      const bytes = await readFile(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (!bytes) return 'absent' as const;
      return sha256Digest(bytes) === sha256Digest(write.content)
        ? ('exact' as const)
        : ('drift' as const);
    }),
  );
  if (observed.every((state) => state === 'absent')) return 'absent';
  if (observed.every((state) => state === 'exact')) return 'exact';
  throw new OperateError(
    'E_OPERATE_ROUTE_DRIFT',
    'A prepared route has partial or changed destination bytes; recover the journal before retrying.',
  );
}

async function buildRouteWrites(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  finding: Record<string, unknown>;
  config: OperatingConfig;
  now: string;
  artifactGeneration?: StoredOperatingArtifactGeneration;
}): Promise<BuiltRouteWrites> {
  const action = input.route.actions[0];
  if (!action?.targetPath) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      `Route ${input.route.id} has no target path.`,
    );
  }
  const title = sanitizeGeneratedPlainText(String(input.finding.title ?? action.findingId));
  const problem = sanitizeGeneratedPlainText(String(input.finding.problem ?? ''));
  const proposal = sanitizeGeneratedPlainText(String(input.finding.proposal ?? ''));
  if (action.kind === 'create-cycle-artifact') {
    const generationPlan = createOperatingArtifactGenerationPlan({
      cycleId: input.route.cycleId,
      destination: action.targetPath,
      evidenceRefs: action.evidenceRefs,
      title,
      proposal,
      problem,
    });
    if (!input.artifactGeneration) {
      return { writes: [], generationPlan };
    }
    if (input.artifactGeneration.planDigest !== generationPlan.planDigest) {
      throw new OperateError(
        'E_OPERATE_ROUTE_DRIFT',
        'The generated artifact no longer matches the accepted generation contract.',
      );
    }
    const writes = generatedArtifactWrites(input.artifactGeneration);
    const committedSession = input.artifactGeneration
      .session as unknown as OperatingArtifactSession;
    await assertOperatingArtifact('operating-artifact-session', committedSession);
    return {
      writes,
      artifactSession: committedSession,
      generationPlan,
    };
  }
  if (action.kind === 'create-decision') {
    return {
      writes: [
        {
          relativePath: action.targetPath,
          operation: 'create',
          content: `${canonicalize({
            id: input.route.id,
            cycleId: input.route.cycleId,
            findingId: action.findingId,
            owner: action.owner,
            question: problem,
            recommendation: proposal,
            evidenceRefs: action.evidenceRefs,
            status: 'open',
          })}\n`,
        },
      ],
    };
  }

  const specId = action.targetPath.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
  if (!specId) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      'DEV route target does not encode a canonical SPEC id.',
    );
  }
  const ordinal = specId.slice('SPEC-'.length);
  const slug = slugify(title);
  const nowDate = new Date(input.now);
  const baselineTo = new Date(nowDate.getTime() - 1).toISOString();
  const baselineFrom = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const targetFrom = nowDate.toISOString();
  const targetTo = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const verifyAfter = new Date(nowDate.getTime() + 31 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const sidecar: OperatingSpecLink = {
    kind: 'operating-spec-link',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    specId,
    sourceCycle: input.route.cycleId,
    sourceFinding: action.findingId,
    planningEngine: input.config.planningEngine,
    evidenceRefs: [...action.evidenceRefs],
    outcome: {
      kind: action.kind === 'create-instrumentation-spec' ? 'operational' : 'metric',
      metric: `validated completion of ${slug}`,
      unit: 'accepted-checks',
      queryIdentity: `openplanr.operate.${input.route.id.toLowerCase()}.v1`,
      direction: 'increase',
      operator: 'gte',
      aggregation: 'latest',
      baselineWindow: { from: baselineFrom, to: baselineTo },
      targetWindow: { from: targetFrom, to: targetTo },
      threshold: { value: 1 },
      minimumCoverage: 1,
      minimumSample: 1,
      stalePolicy: 'create-gap',
      missingPolicy: 'create-gap',
      guardrailPrecedence: 'block-on-breach',
      source: 'openplanr-operating-review',
      observationWindow: '30d',
      verifyAfter,
    },
    guardrails: ['No security, privacy, payment-integrity, or tenant-isolation regression.'],
    rollout: 'Implement through the reviewed PLAN artifact after owner acceptance.',
    rollback: 'Roll back the implementation; preserve this operating decision and its evidence.',
  };
  await assertOperatingArtifact('operating-spec-link', sidecar);
  const outcome: OperatingOutcome = {
    kind: 'operating-outcome',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: `OUT-${ordinal}`,
    sourceCycle: input.route.cycleId,
    sourceFinding: action.findingId,
    specId,
    outcomeKind: sidecar.outcome.kind,
    metric: sidecar.outcome.metric,
    unit: sidecar.outcome.unit,
    queryIdentity: sidecar.outcome.queryIdentity,
    direction: sidecar.outcome.direction,
    operator: sidecar.outcome.operator,
    aggregation: sidecar.outcome.aggregation,
    baselineWindow: sidecar.outcome.baselineWindow,
    targetWindow: sidecar.outcome.targetWindow,
    threshold: sidecar.outcome.threshold,
    minimumCoverage: sidecar.outcome.minimumCoverage,
    minimumSample: sidecar.outcome.minimumSample,
    stalePolicy: sidecar.outcome.stalePolicy,
    missingPolicy: sidecar.outcome.missingPolicy,
    guardrailPrecedence: sidecar.outcome.guardrailPrecedence,
    guardrails: [],
    source: sidecar.outcome.source,
    observationWindow: sidecar.outcome.observationWindow,
    verifyAfter: sidecar.outcome.verifyAfter,
    rollout: sidecar.rollout,
    rollback: sidecar.rollback,
    status: 'pending',
    evidenceRefs: [...action.evidenceRefs],
    createdAt: input.now,
    updatedAt: input.now,
  };
  await assertOperatingArtifact('operating-outcome', outcome);
  const spec = [
    '---',
    `id: ${JSON.stringify(specId)}`,
    `title: ${JSON.stringify(title)}`,
    `slug: ${JSON.stringify(slug)}`,
    'schemaVersion: "1.0.0"',
    'status: "shaping"',
    'priority: "P1"',
    `created: ${JSON.stringify(input.now.slice(0, 10))}`,
    `updated: ${JSON.stringify(input.now.slice(0, 10))}`,
    'ui_files: []',
    'tech_dependencies: []',
    '---',
    '',
    `# ${specId} — ${title}`,
    '',
    '## Context',
    problem,
    '',
    '## Proposed outcome',
    proposal,
    '',
    '## Functional requirements',
    '- Preserve current behavior outside the explicitly reviewed scope.',
    '- Implement the evidence-backed proposal and satisfy the outcome contract.',
    '',
    '## Evidence',
    ...action.evidenceRefs.map((reference) => `- ${reference}`),
    '',
    '## Acceptance criteria',
    `- The implementation satisfies ${sidecar.outcome.metric}.`,
    '- No listed operating guardrail regresses.',
    '- PLAN artifacts receive human review before any SHIP invocation.',
    '',
    '## Preserve',
    '- Existing hand-written project instructions and unrelated planning artifacts.',
    '',
  ].join('\n');
  const handoff = {
    operationId: input.route.id,
    cycleId: input.route.cycleId,
    findingId: action.findingId,
    specId,
    planningEngine: input.config.planningEngine,
    state: 'awaiting-plan',
    invocation:
      input.config.planningEngine === 'pipeline-po'
        ? `planr pipeline plan ${JSON.stringify(slug)} --runtime auto`
        : `planr spec decompose ${specId}`,
    pipelinePreparation: {
      required: input.config.planningEngine === 'pipeline-po',
      api: input.config.planningEngine === 'pipeline-po' ? 'preparePlan' : null,
      completeApi: input.config.planningEngine === 'pipeline-po' ? 'completePlan' : null,
    },
    shipInvoked: false,
    evidenceRefs: action.evidenceRefs,
    inputDigest: input.route.inputDigest,
  };
  return {
    writes: [
      { relativePath: action.targetPath, operation: 'create', content: spec },
      {
        relativePath: `.planr/operate/spec-links/${specId}.json`,
        operation: 'create',
        content: `${canonicalize(sidecar)}\n`,
      },
      {
        relativePath: `.planr/operate/outcomes/OUT-${ordinal}.json`,
        operation: 'create',
        content: `${canonicalize(outcome)}\n`,
      },
      {
        relativePath: `.planr/operate/handoffs/${input.route.id}.json`,
        operation: 'create',
        content: `${canonicalize(handoff)}\n`,
      },
    ],
    specLink: sidecar,
    outcome,
  };
}

export async function applyOperatingRoute(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  config: OperatingConfig;
  confirmationDigest: string;
  localRoot?: string;
  artifactGenerator?: OperatingArtifactGeneratorAdapter;
  faultInjector?: (
    boundary:
      | 'artifact-attempt-failed'
      | 'artifact-generated'
      | 'bytes-committed'
      | 'spec-linked'
      | 'outcome-registered'
      | 'artifact-created',
  ) => void | Promise<void>;
}): Promise<{
  transactionId?: string;
  eventHead: OperatingEventHead;
  state: 'awaiting-artifact-review' | 'awaiting-plan' | 'applied';
  invocation?: string;
  previewDigest?: `sha256:${string}`;
  artifact?: {
    destination: string;
    content: string;
    outputDigest: `sha256:${string}`;
    attempts: StoredOperatingArtifactGeneration['attempts'];
  };
  shipInvoked: false;
}> {
  const isAgentArtifact = input.route.actions[0]?.kind === 'create-cycle-artifact';
  const existingGeneration = isAgentArtifact
    ? await readStoredOperatingArtifactGeneration({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        route: input.route,
      })
    : null;
  const acceptedApplyDigest =
    input.confirmationDigest === input.route.previewDigest ||
    (existingGeneration?.state === 'generated' &&
      input.confirmationDigest === existingGeneration.exactPreviewDigest);
  if (!acceptedApplyDigest) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Route application requires confirmation of the exact preview digest.',
      {
        previewDigest:
          existingGeneration?.state === 'generated'
            ? existingGeneration.exactPreviewDigest
            : input.route.previewDigest,
      },
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const initialState = await store.state();
  const projectedRoute = initialState.routes.find((route) => route.id === input.route.id);
  const finding = initialState.findings.find(
    (candidate) => candidate.id === input.route.actions[0]?.findingId,
  );
  if (!finding) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Route ${input.route.id} references an unknown finding.`,
    );
  }
  const acceptedConfirmation = projectedRoute?.confirmationDigest;
  if (projectedRoute?.state === 'applied' && projectedRoute.transactionId) {
    return {
      transactionId: String(projectedRoute.transactionId),
      eventHead: initial.eventHead,
      state: 'applied',
      shipInvoked: false,
    };
  }
  if (
    !['accepted', 'prepared'].includes(String(projectedRoute?.state)) ||
    typeof acceptedConfirmation !== 'string'
  ) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Route must be accepted or recoverably prepared before it can be applied.',
    );
  }
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      await assertRouteWorkspaceCurrent(input);
      let preparedHead = initial.eventHead;
      if (projectedRoute?.state === 'accepted') {
        const preparedEvent = await store.append({
          type: 'route.prepared',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            previewDigest: input.route.previewDigest,
          },
          expectedHead: initial.eventHead.hash,
        });
        preparedHead = {
          sequence: preparedEvent.sequence,
          hash: preparedEvent.eventHash,
        };
        await lock.advanceEventHead(initial.eventHead, preparedHead);
      }
      let committedTransaction: Awaited<ReturnType<typeof prepareJournalTransaction>> | null = null;
      let routeApplied = false;
      let bytesCommitted = false;
      try {
        let artifactGeneration = isAgentArtifact
          ? await readStoredOperatingArtifactGeneration({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              route: input.route,
            })
          : null;
        let built = await buildRouteWrites({
          projectRoot: input.projectRoot,
          route: input.route,
          finding,
          config: input.config,
          now: input.route.createdAt,
          ...(artifactGeneration?.state === 'generated' ? { artifactGeneration } : {}),
        });
        const plannedDigest = routeWritesPreviewDigest(
          input.route.inputDigest,
          built.writes,
          built.generationPlan?.planDigest,
        );
        if (!built.generationPlan && plannedDigest !== input.route.previewDigest) {
          throw new OperateError(
            'E_OPERATE_ROUTE_DRIFT',
            'The exact route write set no longer matches the accepted preview.',
          );
        }
        if (built.generationPlan) {
          const initialGenerationDigest = routeWritesPreviewDigest(
            input.route.inputDigest,
            [],
            built.generationPlan.planDigest,
          );
          if (initialGenerationDigest !== input.route.previewDigest) {
            throw new OperateError(
              'E_OPERATE_ROUTE_DRIFT',
              'The artifact generation contract no longer matches the accepted route.',
            );
          }
          if (artifactGeneration?.state !== 'generated') {
            artifactGeneration = await generateOperatingRouteArtifact({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              route: input.route,
              plan: built.generationPlan,
              adapter:
                input.artifactGenerator ??
                (await resolveOperatingArtifactGenerator({
                  projectRoot: input.projectRoot,
                  route: input.route,
                  localRoot: input.localRoot,
                })),
              now: input.route.createdAt,
              onAttemptFailed: async () => {
                await input.faultInjector?.('artifact-attempt-failed');
              },
            });
            await input.faultInjector?.('artifact-generated');
            built = await buildRouteWrites({
              projectRoot: input.projectRoot,
              route: input.route,
              finding,
              config: input.config,
              now: input.route.createdAt,
              artifactGeneration,
            });
          }
          if (artifactGeneration.state !== 'generated' || !artifactGeneration.exactPreviewDigest) {
            throw new OperateError(
              'E_OPERATE_ARTIFACT_REJECTED',
              'The AGENT artifact is not ready for exact-byte review.',
            );
          }
          const exactDigest = routeWritesPreviewDigest(
            input.route.inputDigest,
            built.writes,
            built.generationPlan?.planDigest,
          );
          if (
            exactDigest !== artifactGeneration.exactPreviewDigest ||
            input.confirmationDigest !== artifactGeneration.exactPreviewDigest
          ) {
            const preparedState = await store.state();
            await store.writeCheckpoint(preparedState);
            await persistOperatingProjections({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              state: preparedState,
              revalidateEventHead: async () => (await store.replay()).eventHead,
            });
            return {
              eventHead: preparedHead,
              state: 'awaiting-artifact-review',
              previewDigest: artifactGeneration.exactPreviewDigest,
              artifact: {
                destination: artifactGeneration.session.destination,
                content: artifactGeneration.content as string,
                outputDigest: artifactGeneration.session.outputDigest as `sha256:${string}`,
                attempts: artifactGeneration.attempts,
              },
              shipInvoked: false,
            };
          }
        }
        await assertRouteWorkspaceCurrent(input);
        const transactionPreviewDigest =
          isAgentArtifact && artifactGeneration?.state === 'generated'
            ? (artifactGeneration.exactPreviewDigest as `sha256:${string}`)
            : input.route.previewDigest;
        const transactionId = `TXN-${input.route.id}-${transactionPreviewDigest.slice(7, 23)}`;
        const materialState = await routeWriteMaterialState(input.projectRoot, built.writes);
        const transaction =
          materialState === 'exact'
            ? {
                root: path.join(
                  resolveOperatingPaths(input.projectRoot, {
                    localRoot: input.localRoot,
                  }).transactions,
                  transactionId,
                ),
                manifestPath: path.join(
                  resolveOperatingPaths(input.projectRoot, {
                    localRoot: input.localRoot,
                  }).transactions,
                  transactionId,
                  'journal.json',
                ),
                record: await readJournal(
                  path.join(
                    resolveOperatingPaths(input.projectRoot, {
                      localRoot: input.localRoot,
                    }).transactions,
                    transactionId,
                    'journal.json',
                  ),
                ),
              }
            : await prepareJournalTransaction(input.projectRoot, {
                writes: built.writes,
                eventHead: preparedHead,
                previewDigest: transactionPreviewDigest,
                transactionId,
                localRoot: input.localRoot,
              });
        if (materialState === 'exact' && transaction.record.state !== 'committed') {
          throw new OperateError(
            'E_OPERATE_TRANSACTION_INVALID',
            'Prepared route bytes exist without a committed journal.',
          );
        }
        if (materialState === 'absent') {
          await applyJournalTransaction(input.projectRoot, transaction, {
            currentEventHead: preparedHead,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          });
        }
        committedTransaction = transaction;
        bytesCommitted = true;
        await input.faultInjector?.('bytes-committed');
        if (built.specLink) {
          const handoff = await ensurePlanningHandoff({
            projectRoot: input.projectRoot,
            localRoot: input.localRoot,
            route: input.route,
            config: input.config,
            finding,
            transactionId: transaction.record.transactionId,
          });
          const planCompleted = await completePlanningHandoffIfReady({
            projectRoot: input.projectRoot,
            handoff,
          });
          if (!planCompleted) {
            const preparedState = await store.state();
            await store.writeCheckpoint(preparedState);
            await persistOperatingProjections({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              state: preparedState,
              revalidateEventHead: async () => (await store.replay()).eventHead,
            });
            return {
              transactionId: transaction.record.transactionId,
              eventHead: preparedHead,
              state: 'awaiting-plan',
              invocation: handoff.invocation,
              shipInvoked: false,
            };
          }
        }
        let finalHead = preparedHead;
        const refreshedState = await store.state();
        if (
          built.specLink &&
          !refreshedState.specLinks.some((link) => link.specId === built.specLink?.specId)
        ) {
          const linked = await store.append({
            type: 'spec.linked',
            cycleId: input.route.cycleId,
            entityId: built.specLink.specId,
            evidenceRefs: built.specLink.evidenceRefs,
            payload: { record: built.specLink },
            expectedHead: finalHead.hash,
          });
          const linkedHead = {
            sequence: linked.sequence,
            hash: linked.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, linkedHead);
          finalHead = linkedHead;
          await input.faultInjector?.('spec-linked');
        }
        const stateBeforeOutcome = await store.state();
        if (
          built.outcome &&
          !stateBeforeOutcome.outcomes.some((outcome) => outcome.id === built.outcome?.id)
        ) {
          const registered = await store.append({
            type: 'outcome.registered',
            cycleId: input.route.cycleId,
            entityId: built.outcome.id,
            evidenceRefs: built.outcome.evidenceRefs,
            payload: { record: built.outcome },
            expectedHead: finalHead.hash,
          });
          const registeredHead = {
            sequence: registered.sequence,
            hash: registered.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, registeredHead);
          finalHead = registeredHead;
          await input.faultInjector?.('outcome-registered');
        }
        const replayBeforeArtifact = await store.replay();
        if (
          built.artifactSession &&
          !replayBeforeArtifact.events.some(
            (event) =>
              event.type === 'artifact.created' && event.entityId === built.artifactSession?.id,
          )
        ) {
          const artifactRecord = await store.putRecord(
            'artifact-manifest',
            built.artifactSession as unknown as Record<string, unknown>,
            {
              correlationId: input.route.id,
              createdAt: input.route.createdAt,
            },
          );
          const created = await store.append({
            type: 'artifact.created',
            cycleId: input.route.cycleId,
            entityId: built.artifactSession.id,
            evidenceRefs: built.artifactSession.evidenceRefs,
            payload: { recordDigest: artifactRecord.digest },
            expectedHead: finalHead.hash,
          });
          const createdHead = {
            sequence: created.sequence,
            hash: created.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, createdHead);
          finalHead = createdHead;
          await input.faultInjector?.('artifact-created');
        }
        const applied = await store.append({
          type: 'route.applied',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            confirmationDigest: acceptedConfirmation,
            transactionId: transaction.record.transactionId,
          },
          expectedHead: finalHead.hash,
        });
        const appliedHead = {
          sequence: applied.sequence,
          hash: applied.eventHash,
        } satisfies OperatingEventHead;
        await lock.advanceEventHead(finalHead, appliedHead);
        finalHead = appliedHead;
        routeApplied = true;
        const appliedState = await store.state();
        await store.writeCheckpoint(appliedState);
        await persistOperatingProjections({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          state: appliedState,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        return {
          transactionId: transaction.record.transactionId,
          eventHead: finalHead,
          state: 'applied',
          shipInvoked: false,
        };
      } catch (error) {
        if (committedTransaction && !bytesCommitted && !routeApplied) {
          await rollbackJournalTransaction(input.projectRoot, committedTransaction).catch(
            () => undefined,
          );
        }
        if (routeApplied || bytesCommitted || isAgentArtifact) {
          const interruptedState = await store.state();
          await store.writeCheckpoint(interruptedState).catch(() => undefined);
          await persistOperatingProjections({
            projectRoot: input.projectRoot,
            localRoot: input.localRoot,
            state: interruptedState,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          }).catch(() => undefined);
          throw error;
        }
        const current = (await store.replay()).eventHead;
        const errorCode =
          error instanceof OperateError ? error.code : 'E_OPERATE_TRANSACTION_INVALID';
        const failed = await store.append({
          type: 'route.failed',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            errorCode,
          },
          expectedHead: current.hash,
        });
        const failedHead = {
          sequence: failed.sequence,
          hash: failed.eventHash,
        } satisfies OperatingEventHead;
        await lock.advanceEventHead(current, failedHead);
        const failedState = await store.state();
        await store.writeCheckpoint(failedState);
        await persistOperatingProjections({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          state: failedState,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        throw error;
      }
    },
  );
}

export async function rollbackOperatingRoute(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  transactionId: string;
  recoveryId: string;
  localRoot?: string;
}): Promise<OperatingEventHead> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const state = await store.state();
      const projected = state.routes.find((route) => route.id === input.route.id);
      if (
        !projected ||
        !['applied', 'failed'].includes(projected.state) ||
        projected.transactionId !== input.transactionId
      ) {
        throw new OperateError(
          'E_OPERATE_ROUTE_DRIFT',
          'The route projection no longer matches the rollback transaction.',
        );
      }
      const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
      const root = path.join(paths.transactions, input.transactionId);
      const manifestPath = path.join(root, 'journal.json');
      const record = await readJournal(manifestPath);
      const revalidated = await store.replay();
      if (
        revalidated.eventHead.sequence !== initial.eventHead.sequence ||
        revalidated.eventHead.hash !== initial.eventHead.hash
      ) {
        throw new OperateError(
          'E_OPERATE_HEAD_DIVERGED',
          'Operating state changed before route rollback.',
        );
      }
      await rollbackJournalTransaction(input.projectRoot, { root, manifestPath, record });
      const event = await store.append({
        type: 'route.rolled_back',
        cycleId: input.route.cycleId,
        entityId: input.route.id,
        payload: {
          routeDigest: input.route.routeDigest,
          recoveryId: input.recoveryId,
        },
        expectedHead: initial.eventHead.hash,
      });
      const next = { sequence: event.sequence, hash: event.eventHash };
      await lock.advanceEventHead(initial.eventHead, next);
      const rolledBackState = await store.state();
      await store.writeCheckpoint(rolledBackState);
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state: rolledBackState,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return next;
    },
  );
}

export async function routeDestinationDigest(
  projectRoot: string,
  route: OperatingRoutePlan,
): Promise<`sha256:${string}`> {
  const destinations = await Promise.all(
    routeDestinationPaths(route).map(async (relativePath) => {
      const target = await resolveContainedPath(projectRoot, relativePath);
      const content = await readFile(target).catch(() => null);
      return {
        path: relativePath,
        beforeDigest: content ? sha256Digest(content) : null,
      };
    }),
  );
  return canonicalDigest(destinations);
}
