import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import '../design-system/tokens.css';
import '../design-system/typography.css';
import { RouteAnnouncer } from '../features/accessibility/RouteAnnouncer.js';
import {
  connectionFromBootstrap,
  identityFromBootstrap,
} from '../features/diagnostics/compatibility-model.js';
import { UnifiedShell } from '../features/shell/UnifiedShell.js';
import { type DashboardBootstrap, loadDashboardBootstrapEnvelope } from '../lib/api/bootstrap.js';
import type { DashboardBootPhase, DashboardConnection, DashboardIdentity } from './providers.js';
import { DashboardProviders } from './providers.js';
import {
  DASHBOARD_DIAGNOSTICS_ROUTE,
  parseDashboardRoute,
  serializeDashboardRoute,
} from './router.js';
import { useDashboardRuntimeComposition } from './runtime-composition.js';

export type AppProps = {
  buildId: string;
  initialHash?: string;
  identity?: DashboardIdentity;
  connection?: DashboardConnection;
  bootstrap?: DashboardBootstrap | null;
  bootPhase?: DashboardBootPhase;
  bootDetail?: string | null;
};

function currentHash(initialHash?: string): string {
  if (initialHash !== undefined) return initialHash;
  return typeof window === 'undefined' ? '' : window.location.hash;
}

function subscribeToHashChange(initialHash: string | undefined, onChange: () => void): () => void {
  if (initialHash !== undefined || typeof window === 'undefined') return () => undefined;
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The only dashboard application root. Feature workspaces render inside this stable shell. */
export function App({
  buildId,
  initialHash,
  identity: identityOverride,
  connection: connectionOverride,
  bootstrap: bootstrapOverride,
  bootPhase: bootPhaseOverride,
  bootDetail: bootDetailOverride,
}: AppProps) {
  const hash = useSyncExternalStore(
    (onChange) => subscribeToHashChange(initialHash, onChange),
    () => currentHash(initialHash),
    () => currentHash(initialHash),
  );
  const managedBootstrap = bootstrapOverride === undefined && connectionOverride === undefined;
  const [bootstrap, setBootstrap] = useState<DashboardBootstrap | null>(bootstrapOverride ?? null);
  const [bootPhase, setBootPhase] = useState<DashboardBootPhase>(
    bootPhaseOverride ?? (managedBootstrap ? 'checking' : 'compatible'),
  );
  const [bootDetail, setBootDetail] = useState<string | null>(bootDetailOverride ?? null);

  useEffect(() => {
    if (!managedBootstrap) return undefined;
    const controller = new AbortController();
    setBootPhase('checking');
    setBootDetail('Waiting for OpenPlanr to return a validated bootstrap envelope.');
    void loadDashboardBootstrapEnvelope(buildId, { signal: controller.signal })
      .then((result) => {
        setBootstrap(result.bootstrap);
        setBootPhase(result.phase === 'compatible' ? 'compatible' : result.phase);
        setBootDetail(result.detail);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [buildId, managedBootstrap]);

  const connection = useMemo(
    () => connectionOverride ?? connectionFromBootstrap(bootstrap, buildId, bootDetail),
    [bootstrap, bootDetail, buildId, connectionOverride],
  );
  const identity = useMemo(
    () => identityOverride ?? identityFromBootstrap(bootstrap),
    [bootstrap, identityOverride],
  );
  const route = useMemo(() => parseDashboardRoute(hash), [hash]);
  const showDiagnostics =
    route.kind === 'system.diagnostics' ||
    bootPhase === 'incompatible' ||
    connection.state === 'incompatible';
  const runtime = useDashboardRuntimeComposition(
    bootPhase === 'compatible' && connection.state !== 'incompatible' && route.product !== null
      ? bootstrap
      : null,
    route,
  );

  return (
    <DashboardProviders
      buildId={buildId}
      initialHash={
        showDiagnostics ? serializeDashboardRoute(DASHBOARD_DIAGNOSTICS_ROUTE) : initialHash
      }
      identity={identity}
      connection={connection}
      bootstrap={bootstrap}
      bootPhase={bootPhase}
      bootDetail={bootDetail}
      binding={runtime.binding}
      projection={runtime.projection}
      planningProjection={runtime.planningProjection}
      operateCyclesProjection={runtime.operateCyclesProjection}
      operateSearchBindings={runtime.operateSearchBindings}
      operateReviewNavigation={runtime.operateReviewNavigation}
      refetchCurrent={runtime.refetchCurrent}
    >
      <RouteAnnouncer />
      <UnifiedShell />
    </DashboardProviders>
  );
}
