import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as operateComposition from './runtime/operate/index.js';
import * as planningComposition from './runtime/planning/index.js';
import * as dashboardComposition from './runtime/platform/index.js';

const { operateRuntime } = operateComposition;
const { planningRuntime } = planningComposition;
const { dashboardRuntime } = dashboardComposition;

type OperateActionDisplayWorkspaceV1 = operateComposition.OperateActionDisplayWorkspaceV1;
type OperateCycleDisplayWorkspaceV1 = operateComposition.OperateCycleDisplayWorkspaceV1;
type OperateExperienceAuditDisplaySurfaceV1 =
  operateComposition.OperateExperienceAuditDisplaySurfaceV1;
type OperateExperienceDisplaySurfaceV1 = operateComposition.OperateExperienceDisplaySurfaceV1;
type OperateRecoveryDisplaySurfaceV1 = operateComposition.OperateRecoveryDisplaySurfaceV1;
type OperateReviewDisplayWorkspaceV1 = operateComposition.OperateReviewDisplayWorkspaceV1;
type OperateReviewNavigation = operateComposition.OperateReviewNavigation;
type PlanningGraphEnvelope = planningComposition.PlanningGraphEnvelope;
type DashboardBootstrap = dashboardComposition.DashboardBootstrap;
type DashboardProductState<T> = dashboardComposition.DashboardProductState<T>;
type DashboardProductStateKind = dashboardComposition.DashboardProductStateKind;
type DashboardQueryIdentity = dashboardComposition.DashboardQueryIdentity;
type DashboardQueryRoot = dashboardComposition.DashboardQueryRoot;
type DashboardSafeError = dashboardComposition.DashboardSafeError;
type ParsedDashboardRoute = dashboardComposition.ParsedDashboardRoute;

type RuntimeProjection = DashboardProductState<unknown>;
type OperateBoundDisplay =
  | OperateExperienceDisplaySurfaceV1
  | OperateActionDisplayWorkspaceV1
  | OperateRecoveryDisplaySurfaceV1;

export type DashboardRuntimeComposition = Readonly<{
  binding: DashboardQueryIdentity | null;
  projection: RuntimeProjection;
  planningProjection: RuntimeProjection;
  operateCyclesProjection: RuntimeProjection;
  operateSearchBindings: readonly DashboardQueryIdentity[];
  operateReviewNavigation: OperateReviewNavigation | null;
  refetchCurrent: () => Promise<RuntimeProjection>;
}>;

type OwnerRead<T> = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'failed';
  data: T | null;
  error: DashboardSafeError | null;
  refetch: () => void;
  reconcile: () => Promise<T>;
}>;

const PRESENTATIONS = new Set<DashboardProductStateKind>([
  'ready',
  'read-only',
  'stale',
  'partial',
  'blocked',
  'offline',
]);

const BOOTING = dashboardRuntime.projection.parseState({
  kind: 'booting',
  binding: null,
  data: null,
  reasonCodes: [],
  error: null,
  mutationEnabled: false,
  policy: dashboardRuntime.projection.statePolicy('booting'),
});
const PLANNING_HOME_ROUTE = dashboardRuntime.routing.parse('#/overview');

function productStateReason(kind: DashboardProductStateKind): string {
  return `DASHBOARD_${kind.toUpperCase().replace('-', '_')}`;
}

function loading(binding: DashboardQueryIdentity): RuntimeProjection {
  return dashboardRuntime.projection.parseState(
    {
      kind: 'loading',
      binding,
      data: null,
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardRuntime.projection.statePolicy('loading'),
    },
    { currentBinding: binding },
  );
}

function unavailable(
  binding: DashboardQueryIdentity,
  error: DashboardSafeError | null = null,
): RuntimeProjection {
  return dashboardRuntime.projection.parseState(
    {
      kind: 'unavailable',
      binding,
      data: null,
      reasonCodes: ['DASHBOARD_UNAVAILABLE'],
      error,
      mutationEnabled: false,
      policy: dashboardRuntime.projection.statePolicy('unavailable'),
    },
    { currentBinding: binding },
  );
}

function projectionFailure(error: unknown, retained = false): DashboardSafeError {
  const candidate =
    error !== null && typeof error === 'object' && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : {};
  const invalid =
    candidate.code === 'DASHBOARD_RESPONSE_INVALID' ||
    error instanceof dashboardRuntime.projection.ValidationError;
  return dashboardRuntime.projection.parseSafeError({
    code: retained || !invalid ? 'DASHBOARD_READ_FAILED' : 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: { operation: 'dashboard.projection.read' },
  });
}

function initialProjectionFailure(
  binding: DashboardQueryIdentity,
  error: DashboardSafeError | null,
): RuntimeProjection {
  const safe = error ?? projectionFailure(undefined);
  if (safe.code !== 'DASHBOARD_RESPONSE_INVALID') return unavailable(binding, safe);
  const publicError = dashboardRuntime.projection.parseSafeError({
    code: 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: {},
  });
  return dashboardRuntime.projection.parseState({
    kind: 'corrupt',
    binding: null,
    data: null,
    reasonCodes: ['DASHBOARD_CORRUPT'],
    error: publicError,
    mutationEnabled: false,
    policy: dashboardRuntime.projection.statePolicy('corrupt'),
  });
}

function verifiedState<T>(
  kind: DashboardProductStateKind,
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
  mutationEnabled = false,
  error: DashboardSafeError | null = null,
): DashboardProductState<T> {
  if (!PRESENTATIONS.has(kind)) throw new Error('Unsupported owner presentation state.');
  return dashboardRuntime.projection.parseState<T>(
    {
      kind,
      binding,
      data,
      reasonCodes: kind === 'ready' ? [] : [productStateReason(kind)],
      error,
      mutationEnabled: kind === 'ready' && mutationEnabled,
      policy: dashboardRuntime.projection.statePolicy(kind),
    },
    { currentBinding: binding, validateData },
  );
}

function retainVerifiedProjectionAsStale(
  state: RuntimeProjection,
  error: DashboardSafeError,
): RuntimeProjection {
  if (
    !dashboardRuntime.projection.isValidatedState(state) ||
    state.binding === null ||
    state.data === null
  ) {
    return state;
  }
  return dashboardRuntime.projection.parseState(
    {
      kind: 'stale',
      binding: state.binding,
      data: state.data,
      reasonCodes: ['DASHBOARD_STALE'],
      error,
      mutationEnabled: false,
      policy: dashboardRuntime.projection.statePolicy('stale'),
    },
    {
      currentBinding: state.binding,
      validateData: (value): value is unknown => value !== null,
    },
  );
}

function contextState(
  kind: 'first-use' | 'empty',
  binding: DashboardQueryIdentity,
): RuntimeProjection {
  return dashboardRuntime.projection.parseState(
    {
      kind,
      binding,
      data: null,
      reasonCodes: [productStateReason(kind)],
      error: null,
      mutationEnabled: false,
      policy: dashboardRuntime.projection.statePolicy(kind),
    },
    { currentBinding: binding },
  );
}

function useOwnerRead<T>(
  key: string | null,
  read: (signal: AbortSignal) => Promise<T>,
): OwnerRead<T> {
  const readRef = useRef(read);
  readRef.current = read;
  const keyRef = useRef(key);
  keyRef.current = key;
  const reconciliationRef = useRef<Promise<T> | null>(null);
  const reconciliationControllerRef = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<
    Readonly<{
      key: string | null;
      revision: number;
      phase: OwnerRead<T>['phase'];
      data: T | null;
      error: DashboardSafeError | null;
    }>
  >(() => Object.freeze({ key: null, revision: 0, phase: 'idle', data: null, error: null }));
  const refetch = useCallback(() => setRevision((value) => value + 1), []);
  const reconcile = useCallback((): Promise<T> => {
    if (reconciliationRef.current !== null) return reconciliationRef.current;
    const expectedKey = keyRef.current;
    if (expectedKey === null) return Promise.reject(new Error('Owner read is unavailable.'));
    const controller = new AbortController();
    reconciliationControllerRef.current?.abort();
    reconciliationControllerRef.current = controller;
    setSnapshot((previous) =>
      Object.freeze({
        key: expectedKey,
        revision: previous.revision,
        phase: 'loading',
        data: previous.key === expectedKey ? previous.data : null,
        error: null,
      }),
    );
    const pending = readRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || keyRef.current !== expectedKey) {
          throw new DOMException('Cancelled', 'AbortError');
        }
        setSnapshot((previous) =>
          Object.freeze({
            key: expectedKey,
            revision: previous.revision,
            phase: 'ready',
            data,
            error: null,
          }),
        );
        return data;
      })
      .catch((error) => {
        if (!controller.signal.aborted && keyRef.current === expectedKey) {
          setSnapshot((previous) =>
            Object.freeze({
              key: expectedKey,
              revision: previous.revision,
              phase: 'failed',
              data: previous.key === expectedKey ? previous.data : null,
              error: projectionFailure(
                error,
                previous.key === expectedKey && previous.data !== null,
              ),
            }),
          );
        }
        throw error;
      })
      .finally(() => {
        if (reconciliationRef.current === pending) reconciliationRef.current = null;
        if (reconciliationControllerRef.current === controller) {
          reconciliationControllerRef.current = null;
        }
      });
    reconciliationRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    reconciliationControllerRef.current?.abort();
    reconciliationControllerRef.current = null;
    reconciliationRef.current = null;
    if (key === null) {
      setSnapshot(Object.freeze({ key: null, revision, phase: 'idle', data: null, error: null }));
      return undefined;
    }
    const controller = new AbortController();
    setSnapshot((previous) =>
      Object.freeze({
        key,
        revision,
        phase: 'loading',
        data: previous.key === key ? previous.data : null,
        error: null,
      }),
    );
    void readRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSnapshot(Object.freeze({ key, revision, phase: 'ready', data, error: null }));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSnapshot((previous) =>
            Object.freeze({
              key,
              revision,
              phase: 'failed',
              data: previous.key === key ? previous.data : null,
              error: projectionFailure(error, previous.key === key && previous.data !== null),
            }),
          );
        }
      });
    return () => controller.abort();
  }, [key, revision]);

  const isCurrent = snapshot.key === key && snapshot.revision === revision;
  const phase = isCurrent ? snapshot.phase : key === null ? 'idle' : 'loading';
  const data = isCurrent ? snapshot.data : null;
  const error = isCurrent ? snapshot.error : null;
  return useMemo(
    () => Object.freeze({ phase, data, error, refetch, reconcile }),
    [data, error, phase, reconcile, refetch],
  );
}

function rootKey(root: DashboardQueryRoot | null): string | null {
  return root === null ? null : JSON.stringify(root);
}

function routeForPlanning(route: ParsedDashboardRoute): ParsedDashboardRoute {
  return route.product === 'planning' ? route : PLANNING_HOME_ROUTE;
}

function routeKindForAudit(
  route: ParsedDashboardRoute,
): 'evidence' | 'outcomes' | 'outcome' | 'history' | null {
  if (route.kind === 'operate.evidence' || route.kind === 'operate.evidence-item') {
    return 'evidence';
  }
  if (route.kind === 'operate.outcomes') return 'outcomes';
  if (route.kind === 'operate.outcome') return 'outcome';
  return route.kind === 'operate.history' ? 'history' : null;
}

function routeNeedsBoundDisplay(route: ParsedDashboardRoute): boolean {
  return (
    route.kind === 'operate.actions' ||
    route.kind === 'operate.action' ||
    route.kind === 'operate.action-planning' ||
    route.kind === 'operate.inbox' ||
    route.kind === 'operate.inbox-item' ||
    route.kind === 'operate.recovery'
  );
}

/**
 * The Planning-handoff route is an alternate presentation of the exact same owner-issued Action
 * workspace. Its read can stay live while the target route receives a newly exact display
 * binding. Do not collapse surfaces whose payloads, cycle custody, or subject custody differ.
 */
function routeForBoundDisplayRead(route: ParsedDashboardRoute): ParsedDashboardRoute {
  if (route.kind === 'operate.action-planning') {
    return {
      kind: 'operate.action',
      product: 'operate',
      subjectId: route.subjectId,
    };
  }
  return route;
}

function displayCursor(display: {
  payload: { eventHead: DashboardQueryIdentity['eventHead']; viewHash: string };
}) {
  return Object.freeze({
    eventHead: display.payload.eventHead,
    viewHash: display.payload.viewHash,
  });
}

function displayKind(display: { payload: { status: string } }): DashboardProductStateKind {
  const kind = display.payload.status as DashboardProductStateKind;
  if (!PRESENTATIONS.has(kind)) {
    throw new dashboardRuntime.projection.ValidationError(
      '$.payload.status',
      'contains an unsupported display status',
    );
  }
  return kind;
}

function reviewDisplayKind(display: OperateReviewDisplayWorkspaceV1): DashboardProductStateKind {
  return display.payload.status === 'terminal' ? 'read-only' : displayKind(display);
}

function reviewDisplayState(
  read: OwnerRead<OperateReviewDisplayWorkspaceV1>,
  base: DashboardQueryIdentity,
): RuntimeProjection {
  if (read.data === null) {
    if (read.phase === 'loading' || read.phase === 'idle') return loading(base);
    return initialProjectionFailure(base, read.error);
  }
  const binding = dashboardRuntime.identity.create({
    ...base,
    eventHead: read.data.payload.sourceEventHead,
    viewHash: read.data.payload.sourceViewHash,
  });
  return verifiedOwnerReadState(
    read,
    binding,
    read.data,
    operateRuntime.review.createValidator(binding),
    reviewDisplayKind(read.data),
    read.data.payload.mutationEnabled,
  );
}

function verifiedOwnerReadState<T>(
  read: OwnerRead<T>,
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
  ownerKind: DashboardProductStateKind,
  mutationEnabled = false,
): RuntimeProjection {
  const kind =
    read.phase === 'failed'
      ? 'stale'
      : read.phase === 'loading' || read.phase === 'idle'
        ? 'refreshing'
        : ownerKind;
  try {
    return verifiedState(
      kind,
      binding,
      data,
      validateData,
      mutationEnabled,
      kind === 'stale' ? (read.error ?? projectionFailure(undefined, true)) : null,
    );
  } catch (error) {
    return initialProjectionFailure(binding, projectionFailure(error));
  }
}

function planningState(
  read: OwnerRead<PlanningGraphEnvelope>,
  binding: DashboardQueryIdentity,
): RuntimeProjection {
  if (read.data === null) {
    if (read.phase === 'loading' || read.phase === 'idle') return loading(binding);
    return initialProjectionFailure(binding, read.error);
  }
  const current = dashboardRuntime.identity.create({
    ...binding,
    eventHead: read.data.cursor.eventHead,
    viewHash: read.data.cursor.viewHash,
  });
  return verifiedOwnerReadState(
    read,
    current,
    read.data,
    (value): value is PlanningGraphEnvelope => {
      try {
        planningRuntime.parseGraphEnvelope(value, binding);
        return true;
      } catch {
        return false;
      }
    },
    'ready',
  );
}

function operateSurfaceState(
  read: OwnerRead<OperateExperienceDisplaySurfaceV1>,
  binding: DashboardQueryIdentity,
  surface: 'today' | 'cycles',
  cyclesRead?: OwnerRead<OperateExperienceDisplaySurfaceV1>,
): RuntimeProjection {
  if (read.data === null) {
    if (read.phase === 'loading' || read.phase === 'idle') return loading(binding);
    return initialProjectionFailure(binding, read.error);
  }
  const current = dashboardRuntime.identity.create({
    ...binding,
    ...displayCursor(read.data),
  });
  const validate =
    surface === 'today'
      ? operateRuntime.today.createValidator(current)
      : operateRuntime.cycles.createListValidator(current);
  if (read.phase !== 'ready') {
    return verifiedOwnerReadState(
      read,
      current,
      read.data,
      validate,
      displayKind(read.data),
      read.data.payload.mutationEnabled,
    );
  }
  if (
    surface === 'today' &&
    read.data.payload.surface === 'today' &&
    read.data.payload.status === 'ready' &&
    read.data.payload.data.activeCycle === null
  ) {
    if (!validate(read.data)) {
      return initialProjectionFailure(
        current,
        projectionFailure(
          new dashboardRuntime.projection.ValidationError(
            '$.data',
            'failed its owner-boundary contract',
          ),
        ),
      );
    }
    if (!cyclesRead) return loading(current);
    if (cyclesRead.phase === 'loading' || cyclesRead.phase === 'idle') {
      return verifiedOwnerReadState(
        Object.freeze({ ...read, phase: 'loading' as const, error: null }),
        current,
        read.data,
        validate,
        'ready',
      );
    }
    if (cyclesRead.phase === 'failed') {
      return verifiedOwnerReadState(
        Object.freeze({ ...read, phase: 'failed' as const, error: cyclesRead.error }),
        current,
        read.data,
        validate,
        'ready',
      );
    }
    if (cyclesRead.data?.payload.surface !== 'cycles') {
      return initialProjectionFailure(
        current,
        projectionFailure(
          new dashboardRuntime.projection.ValidationError(
            '$.payload.surface',
            'does not contain the required cycles display',
          ),
        ),
      );
    }
    return contextState(
      cyclesRead.data.payload.data.cycles.length === 0 ? 'first-use' : 'empty',
      current,
    );
  }
  return verifiedOwnerReadState(
    read,
    current,
    read.data,
    validate,
    displayKind(read.data),
    read.data.payload.mutationEnabled,
  );
}

function actionDisplayBinding(binding: DashboardQueryIdentity): DashboardQueryIdentity {
  if (binding.subjectId === null) throw new Error('Action display identity requires a subject.');
  return dashboardRuntime.identity.create({
    ...binding,
    route: `#/operate/actions/${encodeURIComponent(binding.subjectId)}`,
  });
}

function boundDisplayState(
  read: OwnerRead<OperateBoundDisplay | null>,
  binding: DashboardQueryIdentity,
  route: ParsedDashboardRoute,
): RuntimeProjection {
  if (read.data === null) {
    if (read.phase === 'loading' || read.phase === 'idle') return loading(binding);
    return initialProjectionFailure(binding, read.error);
  }
  const current = dashboardRuntime.identity.create({
    ...binding,
    ...displayCursor(read.data),
  });
  let validate: (value: unknown) => value is OperateBoundDisplay;
  if (route.kind === 'operate.actions') {
    validate = operateRuntime.actions.createListValidator(current);
  } else if (route.kind === 'operate.action' || route.kind === 'operate.action-planning') {
    const displayBinding =
      route.kind === 'operate.action-planning' ? actionDisplayBinding(current) : current;
    validate = operateRuntime.actions.createDetailValidator(displayBinding);
  } else if (route.kind === 'operate.inbox' || route.kind === 'operate.inbox-item') {
    validate = operateRuntime.actions.createInboxValidator(current);
  } else if (route.kind === 'operate.recovery') {
    validate = operateRuntime.actions.createRecoveryValidator(current);
  } else {
    return unavailable(current);
  }
  return verifiedOwnerReadState(
    read,
    current,
    read.data,
    validate,
    displayKind(read.data),
    route.kind === 'operate.action-planning' ? false : read.data.payload.mutationEnabled,
  );
}

/** Production owner-bound composition. Every slot keeps its own identity, read and lifecycle. */
export function useDashboardRuntimeComposition(
  bootstrap: DashboardBootstrap | null,
  route: ParsedDashboardRoute,
): DashboardRuntimeComposition {
  const origin = bootstrap?.origin ?? null;
  const routeKey = JSON.stringify(route);
  const [retainedRoute, setRetainedRoute] = useState<Readonly<{
    routeKey: string;
    binding: DashboardQueryIdentity;
    projection: RuntimeProjection;
  }> | null>(null);
  const planningRoot = bootstrap?.queryRoots.planning ?? null;
  const operateRoot = bootstrap?.queryRoots.operate ?? null;
  const planningRoute = useMemo(() => routeForPlanning(route), [route]);
  // The Planning graph is a product-root snapshot: its owner-issued payload is not scoped to a
  // dashboard route or subject. Keep that read anchored to the root so a view-only route change
  // does not discard a still-valid graph before rebinding it to the next page's exact identity.
  const planningReadBase = useMemo(
    () =>
      planningRoot
        ? operateRuntime.transport.identityFromRoot(planningRoot, PLANNING_HOME_ROUTE)
        : null,
    [planningRoot],
  );
  const planningBase = useMemo(
    () =>
      planningRoot ? operateRuntime.transport.identityFromRoot(planningRoot, planningRoute) : null,
    [planningRoot, planningRoute],
  );
  const planningRead = useOwnerRead<PlanningGraphEnvelope>(
    planningReadBase ? JSON.stringify(planningReadBase) : null,
    (signal) => {
      if (!origin || !planningReadBase) throw new Error('Planning query root is unavailable.');
      return planningRuntime.fetchGraph({ origin, identity: planningReadBase, signal });
    },
  );

  const operateKey = rootKey(operateRoot);
  const todayRead = useOwnerRead<OperateExperienceDisplaySurfaceV1>(operateKey, (signal) => {
    if (!origin || !operateRoot) throw new Error('Operate query root is unavailable.');
    return operateRuntime.transport.fetchRootDisplay({
      origin,
      root: operateRoot,
      surface: 'today',
      signal,
    });
  });
  const cyclesRead = useOwnerRead<OperateExperienceDisplaySurfaceV1>(operateKey, (signal) => {
    if (!origin || !operateRoot) throw new Error('Operate query root is unavailable.');
    return operateRuntime.transport.fetchRootDisplay({
      origin,
      root: operateRoot,
      surface: 'cycles',
      signal,
    });
  });

  const today = todayRead.data?.payload.surface === 'today' ? todayRead.data : null;
  const activeCycleId =
    today?.payload.surface === 'today' ? (today.payload.data.activeCycle?.cycleId ?? null) : null;
  const routeCycleId =
    route.kind === 'operate.cycle'
      ? route.subjectId
      : route.kind === 'operate.review'
        ? route.cycleId
        : activeCycleId;
  const operateCursor = today ? displayCursor(today) : null;
  const boundRouteBase = useMemo(
    () =>
      operateRoot && route.product === 'operate' && routeCycleId && operateCursor
        ? operateRuntime.transport.identityFromRoot(operateRoot, route, {
            cycleId: routeCycleId,
            eventHead: operateCursor.eventHead,
            viewHash: operateCursor.viewHash,
          })
        : null,
    [operateCursor, operateRoot, route, routeCycleId],
  );
  const routeReadKey =
    origin && operateRoot && boundRouteBase
      ? JSON.stringify({ root: operateRoot, binding: boundRouteBase })
      : null;
  const reviewReadBase = useMemo(
    () =>
      operateRoot && route.kind === 'operate.review'
        ? operateRuntime.transport.identityFromRoot(operateRoot, route, { cycleId: route.cycleId })
        : null,
    [operateRoot, route],
  );
  const reviewReadKey =
    origin && reviewReadBase
      ? JSON.stringify({ root: operateRoot, route: reviewReadBase.route })
      : null;
  const reviewRead = useOwnerRead<OperateReviewDisplayWorkspaceV1>(reviewReadKey, (signal) => {
    if (!origin || !operateRoot || route.kind !== 'operate.review') {
      throw new Error('Operate Review query custody is incomplete.');
    }
    return operateRuntime.review.fetch({
      origin,
      root: operateRoot,
      cycleId: route.cycleId,
      reviewId: route.subjectId,
      signal,
    });
  });
  const boundDisplayReadRoute = useMemo(() => routeForBoundDisplayRead(route), [route]);
  const boundDisplayReadBase = useMemo(
    () =>
      operateRoot && routeNeedsBoundDisplay(route) && routeCycleId && operateCursor
        ? operateRuntime.transport.identityFromRoot(operateRoot, boundDisplayReadRoute, {
            cycleId: routeCycleId,
            eventHead: operateCursor.eventHead,
            viewHash: operateCursor.viewHash,
          })
        : null,
    [boundDisplayReadRoute, operateCursor, operateRoot, route, routeCycleId],
  );
  const boundDisplayReadKey =
    origin && operateRoot && boundDisplayReadBase
      ? JSON.stringify({ root: operateRoot, binding: boundDisplayReadBase })
      : null;
  const auditSurface = routeKindForAudit(route);
  const auditRead = useOwnerRead<OperateExperienceAuditDisplaySurfaceV1>(
    auditSurface ? routeReadKey : null,
    (signal) => {
      if (!origin || !operateRoot || !routeCycleId || !auditSurface) {
        throw new Error('Operate audit query custody is incomplete.');
      }
      return operateRuntime.transport.fetchAuditDisplay({
        origin,
        root: operateRoot,
        route,
        surface: auditSurface,
        cycleId: routeCycleId,
        signal,
      });
    },
  );
  const cycleRead = useOwnerRead<OperateCycleDisplayWorkspaceV1>(
    route.kind === 'operate.cycle' ? routeReadKey : null,
    (signal) => {
      if (!origin || !operateRoot || route.kind !== 'operate.cycle') {
        throw new Error('Operate Cycle query custody is incomplete.');
      }
      return operateRuntime.transport.fetchCycleDisplay({
        origin,
        root: operateRoot,
        cycleId: route.subjectId,
        signal,
      });
    },
  );
  const boundDisplayRead = useOwnerRead<OperateBoundDisplay | null>(
    routeNeedsBoundDisplay(route) ? boundDisplayReadKey : null,
    (signal) => {
      if (!origin || !boundDisplayReadBase) {
        throw new Error('Operate route display custody is incomplete.');
      }
      if (route.kind === 'operate.actions') {
        return operateRuntime.actions.fetchList({ origin, identity: boundDisplayReadBase, signal });
      }
      if (route.kind === 'operate.action' || route.kind === 'operate.action-planning') {
        return operateRuntime.actions.fetchDetail({
          origin,
          identity: boundDisplayReadBase,
          signal,
        });
      }
      if (route.kind === 'operate.inbox' || route.kind === 'operate.inbox-item') {
        return operateRuntime.actions.fetchInbox({
          origin,
          identity: boundDisplayReadBase,
          signal,
        });
      }
      if (route.kind === 'operate.recovery') {
        return operateRuntime.actions.fetchRecovery({
          origin,
          identity: boundDisplayReadBase,
          signal,
        });
      }
      throw new Error('Operate route does not own a bound display read.');
    },
  );

  const planningProjection = useMemo<RuntimeProjection>(() => {
    if (!planningBase) return BOOTING;
    return planningState(planningRead, planningBase);
  }, [planningBase, planningRead]);

  const todayBase = useMemo(() => {
    if (!operateRoot) return null;
    const todayRoute = dashboardRuntime.routing.parse('#/operate/today');
    return operateRuntime.transport.identityFromRoot(operateRoot, todayRoute, {
      cycleId: activeCycleId,
    });
  }, [activeCycleId, operateRoot]);
  const todayProjection = useMemo<RuntimeProjection>(() => {
    if (!todayBase) return BOOTING;
    return operateSurfaceState(todayRead, todayBase, 'today', cyclesRead);
  }, [cyclesRead, todayBase, todayRead]);
  const operateReviewNavigation = useMemo(() => {
    if (!todayProjection.binding || !routeCycleId) return null;
    const model = operateRuntime.today.resolveModel(
      { current: todayProjection },
      todayProjection.binding,
    );
    return model?.kind === 'surface'
      ? operateRuntime.review.uniqueNavigationForCycle(model, routeCycleId)
      : null;
  }, [routeCycleId, todayProjection]);

  const cyclesBase = useMemo(() => {
    if (!operateRoot) return null;
    return operateRuntime.transport.identityFromRoot(
      operateRoot,
      dashboardRuntime.routing.parse('#/operate/cycles'),
    );
  }, [operateRoot]);
  const operateCyclesProjection = useMemo<RuntimeProjection>(() => {
    if (!cyclesBase) return BOOTING;
    return operateSurfaceState(cyclesRead, cyclesBase, 'cycles');
  }, [cyclesBase, cyclesRead]);

  const operateSearchBindings = useMemo(() => {
    if (!operateRoot || cyclesRead.data?.payload.surface !== 'cycles') {
      return Object.freeze([]);
    }
    const cursor = displayCursor(cyclesRead.data);
    const cyclesRoute = dashboardRuntime.routing.parse('#/operate/cycles');
    return Object.freeze(
      cyclesRead.data.payload.data.cycles.map((cycle) =>
        operateRuntime.transport.identityFromRoot(operateRoot, cyclesRoute, {
          cycleId: cycle.cycleId,
          eventHead: cursor.eventHead,
          viewHash: cursor.viewHash,
        }),
      ),
    );
  }, [cyclesRead, operateRoot]);

  const routeComposition = useMemo<
    Readonly<{
      binding: DashboardQueryIdentity | null;
      projection: RuntimeProjection;
    }>
  >(() => {
    if (route.product === 'planning') {
      return Object.freeze({ binding: planningProjection.binding, projection: planningProjection });
    }
    if (route.product !== 'operate' || !operateRoot) {
      return Object.freeze({ binding: null, projection: BOOTING });
    }
    if (route.kind === 'operate.today') {
      return Object.freeze({ binding: todayProjection.binding, projection: todayProjection });
    }
    if (route.kind === 'operate.cycles') {
      return Object.freeze({
        binding: operateCyclesProjection.binding,
        projection: operateCyclesProjection,
      });
    }
    if (route.kind === 'operate.review') {
      if (!reviewReadBase) return Object.freeze({ binding: null, projection: BOOTING });
      const projection = reviewDisplayState(reviewRead, reviewReadBase);
      return Object.freeze({ binding: projection.binding, projection });
    }
    if (!operateCursor || !routeCycleId) {
      return Object.freeze({ binding: null, projection: BOOTING });
    }
    const base = boundRouteBase;
    if (!base) return Object.freeze({ binding: null, projection: BOOTING });
    if (route.kind === 'operate.cycle') {
      if (cycleRead.data === null) {
        const projection =
          cycleRead.phase === 'loading' || cycleRead.phase === 'idle'
            ? loading(base)
            : initialProjectionFailure(base, cycleRead.error);
        return Object.freeze({ binding: projection.binding, projection });
      }
      const binding = dashboardRuntime.identity.create({
        ...base,
        ...displayCursor(cycleRead.data),
      });
      return Object.freeze({
        binding,
        projection: verifiedOwnerReadState(
          cycleRead,
          binding,
          cycleRead.data,
          operateRuntime.cycles.createDetailValidator(binding),
          displayKind(cycleRead.data),
          cycleRead.data.payload.mutationEnabled,
        ),
      });
    }
    if (auditSurface) {
      if (auditRead.data === null) {
        const projection =
          auditRead.phase === 'loading' || auditRead.phase === 'idle'
            ? loading(base)
            : initialProjectionFailure(base, auditRead.error);
        return Object.freeze({ binding: projection.binding, projection });
      }
      const binding = dashboardRuntime.identity.create({
        ...base,
        ...displayCursor(auditRead.data),
      });
      const validate =
        auditSurface === 'evidence'
          ? operateRuntime.audit.createEvidenceValidator(binding)
          : auditSurface === 'outcomes' || auditSurface === 'outcome'
            ? operateRuntime.audit.createOutcomeValidator(binding)
            : operateRuntime.audit.createHistoryValidator(binding);
      return Object.freeze({
        binding,
        projection: verifiedOwnerReadState(
          auditRead,
          binding,
          auditRead.data,
          validate,
          displayKind(auditRead.data),
          false,
        ),
      });
    }
    if (routeNeedsBoundDisplay(route)) {
      return Object.freeze({
        binding: base,
        projection: boundDisplayState(boundDisplayRead, base, route),
      });
    }
    return Object.freeze({ binding: base, projection: loading(base) });
  }, [
    auditRead,
    auditSurface,
    boundDisplayRead,
    boundRouteBase,
    cycleRead,
    operateCursor,
    operateCyclesProjection,
    operateRoot,
    planningProjection,
    reviewRead,
    reviewReadBase,
    route,
    routeCycleId,
    todayProjection,
  ]);

  useEffect(() => {
    setRetainedRoute((retained) =>
      retained !== null && retained.routeKey !== routeKey ? null : retained,
    );
  }, [routeKey]);

  const effectiveRouteComposition = useMemo(() => {
    if (
      retainedRoute !== null &&
      retainedRoute.routeKey === routeKey &&
      (!dashboardRuntime.projection.isValidatedState(routeComposition.projection) ||
        routeComposition.projection.data === null)
    ) {
      return Object.freeze({
        binding: retainedRoute.binding,
        projection: retainedRoute.projection,
      });
    }
    return routeComposition;
  }, [retainedRoute, routeComposition, routeKey]);

  useEffect(() => {
    if (!origin || !planningRead.data || planningRead.phase !== 'ready' || !planningReadBase) {
      return undefined;
    }
    const identity = dashboardRuntime.identity.create({
      ...planningReadBase,
      eventHead: planningRead.data.cursor.eventHead,
      viewHash: planningRead.data.cursor.viewHash,
    });
    let active = true;
    const reconciler = planningRuntime.createSseReconciler({
      identity,
      initial: planningRead.data,
      isCurrent: () => active,
      onSnapshot: () => undefined,
      onPatch: () => planningRead.refetch(),
      onRefetch: () => planningRead.refetch(),
      onStale: () => planningRead.refetch(),
    });
    const stream = planningRuntime.connectSse({
      origin,
      identity,
      reconciler,
      lastEventId: planningRuntime.encodeCheckpoint(planningRead.data.cursor),
    });
    void stream.completion.catch(() => undefined);
    return () => {
      active = false;
      stream.close();
    };
  }, [origin, planningReadBase, planningRead]);

  useEffect(() => {
    if (!origin || !operateRoot || !today || !todayBase) return undefined;
    const cursor = displayCursor(today);
    const identity = dashboardRuntime.identity.create({ ...todayBase, ...cursor });
    let active = true;
    const reconciler = dashboardRuntime.transport.createSseReconciler({
      identity,
      isCurrent: () => active,
      onSnapshot: (_surface, next) => {
        if (
          next.eventHead.sequence !== cursor.eventHead?.sequence ||
          next.eventHead.hash !== cursor.eventHead?.hash ||
          next.viewHash !== cursor.viewHash
        ) {
          todayRead.refetch();
          cyclesRead.refetch();
        }
      },
      onPatch: () => {
        todayRead.refetch();
        cyclesRead.refetch();
      },
      onRefetch: () => {
        todayRead.refetch();
        cyclesRead.refetch();
      },
      onStale: () => {
        todayRead.refetch();
        cyclesRead.refetch();
      },
    });
    const stream = dashboardRuntime.transport.connectSse({ origin, identity, reconciler });
    void stream.completion.catch(() => undefined);
    return () => {
      active = false;
      stream.close();
    };
  }, [cyclesRead, origin, operateRoot, today, todayBase, todayRead]);

  const refetchCurrent = useCallback(async (): Promise<RuntimeProjection> => {
    const retained = effectiveRouteComposition;
    if (
      retained.binding !== null &&
      dashboardRuntime.projection.isValidatedState(retained.projection) &&
      retained.projection.data !== null
    ) {
      setRetainedRoute(
        Object.freeze({
          routeKey,
          binding: retained.binding,
          projection: retained.projection,
        }),
      );
    }
    try {
      let exact: RuntimeProjection;
      if (route.kind === 'operate.review' && reviewReadBase) {
        const data = await reviewRead.reconcile();
        exact = reviewDisplayState(
          Object.freeze({
            phase: 'ready' as const,
            data,
            error: null,
            refetch: reviewRead.refetch,
            reconcile: reviewRead.reconcile,
          }),
          reviewReadBase,
        );
      } else if (routeNeedsBoundDisplay(route) && boundRouteBase) {
        const data = await boundDisplayRead.reconcile();
        exact = boundDisplayState(
          Object.freeze({
            phase: 'ready' as const,
            data,
            error: null,
            refetch: boundDisplayRead.refetch,
            reconcile: boundDisplayRead.reconcile,
          }),
          boundRouteBase,
          route,
        );
      } else if (route.product === 'planning' && planningBase) {
        const data = await planningRead.reconcile();
        exact = planningState(
          Object.freeze({
            phase: 'ready' as const,
            data,
            error: null,
            refetch: planningRead.refetch,
            reconcile: planningRead.reconcile,
          }),
          planningBase,
        );
      } else {
        throw new dashboardRuntime.projection.ValidationError(
          '$.route',
          'does not own an exact reconciliation read',
        );
      }
      if (!dashboardRuntime.projection.isValidatedState(exact) || exact.data === null) {
        throw new dashboardRuntime.projection.ValidationError(
          '$.projection',
          'did not return a verified projection',
        );
      }
      setRetainedRoute(null);
      return exact;
    } catch (error) {
      const hasVerifiedBytes =
        retained.binding !== null &&
        dashboardRuntime.projection.isValidatedState(retained.projection) &&
        retained.projection.data !== null;
      const failure = projectionFailure(error, hasVerifiedBytes);
      const failed = hasVerifiedBytes
        ? retainVerifiedProjectionAsStale(retained.projection, failure)
        : retained.binding === null
          ? retained.projection
          : initialProjectionFailure(retained.binding, failure);
      if (hasVerifiedBytes && retained.binding !== null) {
        setRetainedRoute(
          Object.freeze({ routeKey, binding: retained.binding, projection: failed }),
        );
      }
      return failed;
    }
  }, [
    boundDisplayRead,
    boundRouteBase,
    effectiveRouteComposition,
    planningBase,
    planningRead,
    reviewRead,
    reviewReadBase,
    route,
    routeKey,
  ]);

  return Object.freeze({
    binding: effectiveRouteComposition.binding,
    projection: effectiveRouteComposition.projection,
    planningProjection,
    operateCyclesProjection,
    operateSearchBindings,
    operateReviewNavigation,
    refetchCurrent,
  });
}
