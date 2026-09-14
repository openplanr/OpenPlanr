import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type TodayDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;
type TodaySurface = Extract<TodayDisplay['payload'], { surface: 'today' }>;
type TodayData = TodaySurface['data'];
type TodayContinuation = TodayData['allowedActions'][number];
type TodaySurfacePresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateTodayVocabulary = Readonly<{
  domain: 'business' | 'repository' | 'operating';
  title: string;
  context: string;
  signals: string;
  cycle: string;
}>;

export type OperateTodayContextModel = Readonly<{
  kind: 'first-use' | 'empty';
  source: 'current';
  binding: DashboardQueryIdentity;
  vocabulary: OperateTodayVocabulary;
  reasonCodes: readonly string[];
  continuation: null;
  continuationAvailability: 'not-returned';
}>;

export type OperateTodaySurfaceModel = Readonly<{
  kind: 'surface';
  source: 'current' | 'durable-resume';
  presentation: TodaySurfacePresentation;
  binding: DashboardQueryIdentity;
  display: TodayDisplay;
  vocabulary: OperateTodayVocabulary;
  surface: TodaySurface;
  attention: TodayData['attention'];
  domainMetrics: TodayData['domainMetrics'];
  activeCycle: NonNullable<TodayData['activeCycle']>;
  inbox: TodayData['inbox'];
  actions: TodayData['actions'];
  outcomes: TodayData['outcomes'];
  allowedActions: TodayData['allowedActions'];
  priorityAttention: TodayData['attention'][number] | null;
  currentStage: NonNullable<TodayData['activeCycle']>['stages'][number] | null;
  continuation: TodayContinuation | null;
  continuationRelationship: Readonly<{
    kind: 'same-subject' | 'different-subject';
    attentionSubjectId: string;
    continuationSubjectId: string;
  }> | null;
  mutationEnabled: boolean;
}>;

export type OperateTodayModel = OperateTodayContextModel | OperateTodaySurfaceModel;

export type OperateTodayModelSources = Readonly<{
  current: DashboardProductState<unknown>;
  resumable?: DashboardProductState<unknown> | null;
}>;

const SURFACE_PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<TodaySurfacePresentation, TodaySurfacePresentation>>);

function vocabulary(domainId: string): OperateTodayVocabulary {
  if (domainId === 'business') {
    return Object.freeze({
      domain: 'business',
      title: 'Business Today',
      context: 'Business context',
      signals: 'Business signals',
      cycle: 'Business Cycle',
    });
  }
  if (domainId === 'software') {
    return Object.freeze({
      domain: 'repository',
      title: 'Repository Today',
      context: 'Repository context',
      signals: 'Repository signals',
      cycle: 'Repository Cycle',
    });
  }
  return Object.freeze({
    domain: 'operating',
    title: 'Operate Today',
    context: 'Operating context',
    signals: 'Operating signals',
    cycle: 'Operating Cycle',
  });
}

function exactTodayBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.route === '#/operate/today' &&
      binding.subjectId === null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner schema/semantic/SHA-256-JCS verifier. */
export function createOperateTodayDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is TodayDisplay {
  const binding = exactTodayBinding(current);
  return (value: unknown): value is TodayDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
        payload.surface !== 'today' ||
        binding.eventHead === null ||
        binding.viewHash === null ||
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
        surface: 'today',
        subjectId: null,
        cycleId: binding.cycleId,
      });
      assertOperateExperienceDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

function verifiedTodayDisplay(
  value: unknown,
  binding: DashboardQueryIdentity,
): TodayDisplay | null {
  if (!createOperateTodayDisplayValidator(binding)(value)) return null;
  return value;
}

function surfaceModel(
  state: DashboardProductState<unknown>,
  currentBinding: DashboardQueryIdentity,
  source: OperateTodaySurfaceModel['source'],
): OperateTodaySurfaceModel | null {
  if (
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, currentBinding)
  ) {
    return null;
  }
  const presentation = SURFACE_PRESENTATION[state.kind as TodaySurfacePresentation];
  if (presentation === undefined) return null;
  const display = verifiedTodayDisplay(state.data, currentBinding);
  if (display?.payload.surface !== 'today') return null;
  const surface = display.payload;
  if (
    surface.status !== presentation ||
    surface.mutationEnabled !== state.mutationEnabled ||
    surface.data.activeCycle === null ||
    currentBinding.cycleId === null ||
    surface.data.activeCycle.cycleId !== currentBinding.cycleId
  ) {
    return null;
  }

  const priorityAttention = surface.data.attention[0] ?? null;
  const continuation = surface.data.allowedActions[0] ?? null;
  const continuationRelationship =
    priorityAttention && continuation
      ? Object.freeze({
          kind:
            priorityAttention.subjectId === continuation.subjectId
              ? ('same-subject' as const)
              : ('different-subject' as const),
          attentionSubjectId: priorityAttention.subjectId,
          continuationSubjectId: continuation.subjectId,
        })
      : null;

  return Object.freeze({
    kind: 'surface',
    source,
    presentation,
    binding: state.binding,
    display,
    vocabulary: vocabulary(surface.domainId),
    surface,
    attention: surface.data.attention,
    domainMetrics: surface.data.domainMetrics,
    activeCycle: surface.data.activeCycle,
    inbox: surface.data.inbox,
    actions: surface.data.actions,
    outcomes: surface.data.outcomes,
    allowedActions: surface.data.allowedActions,
    priorityAttention,
    currentStage:
      surface.data.activeCycle.stages.find((stage) => stage.state === 'current') ?? null,
    continuation,
    continuationRelationship,
    mutationEnabled: state.mutationEnabled && surface.mutationEnabled,
  });
}

function contextModel(
  state: DashboardProductState<unknown>,
  currentBinding: DashboardQueryIdentity,
): OperateTodayContextModel | null {
  if (
    !isValidatedDashboardProductState(state) ||
    (state.kind !== 'first-use' && state.kind !== 'empty') ||
    state.binding === null ||
    state.data !== null ||
    state.mutationEnabled ||
    currentBinding.cycleId !== null ||
    !isCurrentDashboardQuery(state.binding, currentBinding)
  ) {
    return null;
  }
  return Object.freeze({
    kind: state.kind,
    source: 'current',
    binding: state.binding,
    vocabulary: vocabulary(currentBinding.domainId),
    reasonCodes: state.reasonCodes,
    continuation: null,
    continuationAvailability: 'not-returned',
  });
}

/**
 * Resolve Today only from parser-issued state and an exact current query.
 * Durable verified work wins over a context-only first-use/empty presentation.
 */
export function resolveOperateTodayModel(
  sources: OperateTodayModelSources,
  current: DashboardQueryIdentity,
): OperateTodayModel | null {
  const currentBinding = exactTodayBinding(current);
  if (!currentBinding) return null;

  if (sources.resumable) {
    const resumed = surfaceModel(sources.resumable, currentBinding, 'durable-resume');
    if (resumed) return resumed;
  }
  return (
    surfaceModel(sources.current, currentBinding, 'current') ??
    contextModel(sources.current, currentBinding)
  );
}
