import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react';
import type { OperateReviewNavigation } from '../features/operate/review/review-navigation.js';
import {
  LiveStateBoundary,
  type LiveSubjectTransition,
} from '../features/shell/LiveStateBoundary.js';
import type { DashboardBootstrap } from '../lib/api/bootstrap.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../lib/binding/query-identity.js';
import { type ParsedDashboardRoute, parseDashboardRoute } from './router.js';

export type DashboardIdentity = Readonly<{
  projectName: string;
  projectDetail: string;
  actorLabel: string;
  bindingLabel: string;
}>;

export type DashboardConnection = Readonly<{
  state: 'booting' | 'connected' | 'read-only' | 'stale' | 'offline' | 'incompatible';
  label: string;
  reason: string;
}>;

export type DashboardBootPhase = 'checking' | 'compatible' | 'incompatible' | 'unavailable';

export type DashboardContextValue = Readonly<{
  route: ParsedDashboardRoute;
  identity: DashboardIdentity;
  connection: DashboardConnection;
  buildId: string;
  binding: DashboardQueryIdentity | null;
  projection: DashboardProductState<unknown>;
  planningProjection: DashboardProductState<unknown>;
  operateCyclesProjection: DashboardProductState<unknown>;
  operateSearchBindings: readonly DashboardQueryIdentity[];
  operateReviewNavigation: OperateReviewNavigation | null;
  refetchCurrent: () => Promise<DashboardProductState<unknown>>;
  bootstrap: DashboardBootstrap | null;
  bootPhase: DashboardBootPhase;
  bootDetail: string | null;
}>;

const DEFAULT_IDENTITY: DashboardIdentity = Object.freeze({
  projectName: 'OpenPlanr',
  projectDetail: 'Project context pending',
  actorLabel: 'Actor binding pending',
  bindingLabel: 'Scope and domain pending',
});

const DEFAULT_CONNECTION: DashboardConnection = Object.freeze({
  state: 'booting',
  label: 'Checking local dashboard',
  reason: 'Waiting for OpenPlanr to return a validated project projection.',
});
const NOOP = () => Promise.reject(new Error('No exact dashboard refetch is available.'));

const DashboardContext = createContext<DashboardContextValue | null>(null);

function currentHash(initialHash?: string): string {
  if (initialHash !== undefined) return initialHash;
  return typeof window === 'undefined' ? '' : window.location.hash;
}

function subscribeToHashChange(initialHash: string | undefined, onChange: () => void): () => void {
  if (initialHash !== undefined || typeof window === 'undefined') return () => undefined;
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export type DashboardProvidersProps = {
  children: ReactNode;
  initialHash?: string;
  identity?: DashboardIdentity;
  connection?: DashboardConnection;
  buildId: string;
  binding?: DashboardQueryIdentity | null;
  projection?: DashboardProductState<unknown>;
  planningProjection?: DashboardProductState<unknown>;
  operateCyclesProjection?: DashboardProductState<unknown>;
  operateSearchBindings?: readonly DashboardQueryIdentity[];
  operateReviewNavigation?: OperateReviewNavigation | null;
  refetchCurrent?: () => Promise<DashboardProductState<unknown>>;
  bootstrap?: DashboardBootstrap | null;
  bootPhase?: DashboardBootPhase;
  bootDetail?: string | null;
  liveTransition?: LiveSubjectTransition;
  liveSubjectId?: string | null;
};

function projectionForConnection(connection: DashboardConnection): DashboardProductState<unknown> {
  if (connection.state === 'offline') {
    return parseDashboardProductState({
      kind: 'offline',
      binding: null,
      data: null,
      reasonCodes: ['DASHBOARD_OFFLINE'],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('offline'),
    });
  }
  if (connection.state === 'incompatible') {
    return parseDashboardProductState({
      kind: 'incompatible',
      binding: null,
      data: null,
      reasonCodes: ['DASHBOARD_INCOMPATIBLE'],
      error: Object.freeze({
        code: 'DASHBOARD_BUILD_MISMATCH',
        retryable: false,
        context: Object.freeze({}),
      }),
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('incompatible'),
    });
  }
  return parseDashboardProductState({
    kind: 'booting',
    binding: null,
    data: null,
    reasonCodes: [],
    error: null,
    mutationEnabled: false,
    policy: dashboardProductStatePolicy('booting'),
  });
}

export function DashboardProviders({
  children,
  initialHash,
  identity = DEFAULT_IDENTITY,
  connection = DEFAULT_CONNECTION,
  buildId,
  binding = null,
  projection,
  planningProjection,
  operateCyclesProjection,
  operateSearchBindings = Object.freeze([]),
  operateReviewNavigation = null,
  refetchCurrent = NOOP,
  bootstrap = null,
  bootPhase = 'checking',
  bootDetail = null,
  liveTransition,
  liveSubjectId,
}: DashboardProvidersProps) {
  const hash = useSyncExternalStore(
    (onChange) => subscribeToHashChange(initialHash, onChange),
    () => currentHash(initialHash),
    () => currentHash(initialHash),
  );
  const route = useMemo(() => parseDashboardRoute(hash), [hash]);
  const currentProjection = useMemo(
    () => projection ?? projectionForConnection(connection),
    [connection, projection],
  );
  const currentPlanningProjection = useMemo(
    () =>
      planningProjection ??
      (binding?.productArea === 'planning'
        ? currentProjection
        : projectionForConnection(connection)),
    [binding?.productArea, connection, currentProjection, planningProjection],
  );
  const currentOperateCyclesProjection = useMemo(
    () =>
      operateCyclesProjection ??
      (binding?.route === '#/operate/cycles'
        ? currentProjection
        : projectionForConnection(connection)),
    [binding?.route, connection, currentProjection, operateCyclesProjection],
  );
  const value = useMemo<DashboardContextValue>(
    () =>
      Object.freeze({
        route,
        identity,
        connection,
        buildId,
        binding,
        projection: currentProjection,
        planningProjection: currentPlanningProjection,
        operateCyclesProjection: currentOperateCyclesProjection,
        operateSearchBindings,
        operateReviewNavigation,
        refetchCurrent,
        bootstrap,
        bootPhase,
        bootDetail,
      }),
    [
      route,
      identity,
      connection,
      buildId,
      binding,
      currentProjection,
      currentPlanningProjection,
      currentOperateCyclesProjection,
      operateSearchBindings,
      operateReviewNavigation,
      refetchCurrent,
      bootstrap,
      bootPhase,
      bootDetail,
    ],
  );

  return (
    <DashboardContext.Provider value={value}>
      <LiveStateBoundary
        route={route}
        binding={binding}
        transition={liveTransition}
        trackedSubjectId={liveSubjectId}
      >
        {children}
      </LiveStateBoundary>
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error('useDashboard must be used inside DashboardProviders.');
  return context;
}
