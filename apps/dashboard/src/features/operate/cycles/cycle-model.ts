import {
  assertOperateCycleDisplayWorkspaceV1,
  type OperateCycleDisplayWorkspacePayloadV1,
  type OperateCycleDisplayWorkspaceV1,
  type OperateDisplayBindingV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type CyclePresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';
type CycleDisplay = Readonly<OperateCycleDisplayWorkspaceV1>;
type CycleWorkspace = Readonly<OperateCycleDisplayWorkspacePayloadV1>;

export type OperateCycleVocabulary = Readonly<{
  domain: 'business' | 'repository' | 'operating';
  title: string;
  assignment: string;
  outcome: string;
}>;

/** The complete owner-issued display envelope accepted at the parser boundary. */
export type OperateCycleWorkspaceProjection = CycleDisplay;

export type OperateCycleProjectionSet = Readonly<{
  workspace: DashboardProductState<unknown>;
  executiveBoard?: DashboardProductState<unknown> | null;
}>;

export type OperateCycleModelSources = Readonly<{
  current: OperateCycleProjectionSet;
  resumable?: OperateCycleProjectionSet | null;
}>;

export type OperateCycleModel = Readonly<{
  kind: 'cycle';
  source: 'current' | 'durable-resume';
  presentation: CyclePresentation;
  binding: DashboardQueryIdentity;
  display: CycleDisplay;
  workspace: CycleWorkspace;
  vocabulary: OperateCycleVocabulary;
  cycle: CycleWorkspace['data']['cycle'];
  progress: CycleWorkspace['data']['progress'];
  stages: CycleWorkspace['data']['cycle']['stages'];
  assignments: CycleWorkspace['data']['cycle']['assignments'];
  dependencies: CycleWorkspace['data']['cycle']['dependencies'];
  blockers: CycleWorkspace['data']['cycle']['blockers'];
  currentStage: CycleWorkspace['data']['cycle']['stages'][number] | null;
  persistentWork: CycleWorkspace['data']['persistentWork'];
  replay: CycleWorkspace['data']['replay'];
  verification: CycleWorkspace['data']['verification'];
  allowedActions: CycleWorkspace['data']['allowedActions'];
  mutationEnabled: false;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<CyclePresentation, CyclePresentation>>);

function vocabulary(domainId: string): OperateCycleVocabulary {
  if (domainId === 'business') {
    return Object.freeze({
      domain: 'business',
      title: 'Business Cycle',
      assignment: 'Business assignment',
      outcome: 'Business outcome',
    });
  }
  if (domainId === 'software') {
    return Object.freeze({
      domain: 'repository',
      title: 'Repository Cycle',
      assignment: 'Repository assignment',
      outcome: 'Repository outcome',
    });
  }
  return Object.freeze({
    domain: 'operating',
    title: 'Operating Cycle',
    assignment: 'Operating assignment',
    outcome: 'Operating outcome',
  });
}

function exactCycleBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.cycleId !== null &&
      binding.subjectId === binding.cycleId &&
      binding.route === `#/operate/cycles/${encodeURIComponent(binding.cycleId)}` &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner schema/semantic/SHA-256-JCS verifier. */
export function createOperateCycleDisplayWorkspaceValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is CycleDisplay {
  const binding = exactCycleBinding(current);
  return (value: unknown): value is CycleDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateCycleDisplayWorkspaceV1(value);
      const payload = display.payload;
      if (
        binding.eventHead === null ||
        binding.viewHash === null ||
        binding.cycleId === null ||
        binding.subjectId === null ||
        payload.eventHead.sequence !== binding.eventHead.sequence ||
        payload.eventHead.hash !== binding.eventHead.hash
      ) {
        return false;
      }
      const expected: OperateDisplayBindingV1 = Object.freeze({
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        generatedAt: payload.generatedAt,
        eventHead: payload.eventHead,
        viewHash: binding.viewHash,
        surface: 'cycle',
        subjectId: binding.subjectId,
        cycleId: binding.cycleId,
      });
      assertOperateCycleDisplayWorkspaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

/** Backward test/helper name; verification now requires the exact current identity. */
export function isOperateCycleWorkspaceProjection(
  value: unknown,
  current: DashboardQueryIdentity,
): value is OperateCycleWorkspaceProjection {
  return createOperateCycleDisplayWorkspaceValidator(current)(value);
}

function model(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
  source: OperateCycleModel['source'],
): OperateCycleModel | null {
  if (
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, current) ||
    !createOperateCycleDisplayWorkspaceValidator(current)(state.data)
  ) {
    return null;
  }
  const display = state.data;
  const workspace = display.payload;
  const presentation = PRESENTATION[state.kind as CyclePresentation];
  if (
    presentation === undefined ||
    workspace.status !== presentation ||
    workspace.mutationEnabled !== false ||
    state.mutationEnabled
  ) {
    return null;
  }
  const cycle = workspace.data.cycle;
  return Object.freeze({
    kind: 'cycle',
    source,
    presentation,
    binding: state.binding,
    display,
    workspace,
    vocabulary: vocabulary(workspace.domainId),
    cycle,
    progress: workspace.data.progress,
    stages: cycle.stages,
    assignments: cycle.assignments,
    dependencies: cycle.dependencies,
    blockers: cycle.blockers,
    currentStage: cycle.stages.find((stage) => stage.state === 'current') ?? null,
    persistentWork: workspace.data.persistentWork,
    replay: workspace.data.replay,
    verification: workspace.data.verification,
    allowedActions: workspace.data.allowedActions,
    mutationEnabled: false,
  });
}

/** Resolve one exact Cycle route from a parser-issued, owner-verified display workspace. */
export function resolveOperateCycleModel(
  sources: OperateCycleModelSources,
  current: DashboardQueryIdentity,
): OperateCycleModel | null {
  const binding = exactCycleBinding(current);
  if (!binding) return null;
  if (sources.resumable) {
    const resumed = model(sources.resumable.workspace, binding, 'durable-resume');
    if (resumed) return resumed;
  }
  return model(sources.current.workspace, binding, 'current');
}
