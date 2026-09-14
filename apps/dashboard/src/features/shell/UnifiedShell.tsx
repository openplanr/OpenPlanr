import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDashboard } from '../../app/providers.js';
import { CompatibilityPage } from '../diagnostics/CompatibilityPage.js';
import { LocalOperateReviews } from '../operate/local-reviews/LocalOperateReviews.js';
import {
  planningNodesFromProductState,
  resolvePlanningWorkspace,
} from '../planning/planning-workspace.js';
import { CommandPalette } from '../search/CommandPalette.js';
import { useSearchCoordinator } from '../search/search-coordinator.js';
import { useInspectorStore } from './inspector-selection.js';
import { hasCurrentRouteSubject, RouteWorkspace } from './route-workspace.js';
import { Inspector, NavRail, StatusBar, TopBar } from './shell-navigation.js';
import {
  BootScreen,
  INSPECTOR_DOCK_WIDTH,
  IncompatibleNotice,
  PlaneBanner,
} from './shell-planes.js';
import './unified-shell.css';

const SERVER_VIEWPORT_WIDTH = 1440;

function subscribeToResize(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function readViewportWidth(): number {
  return typeof window === 'undefined' ? SERVER_VIEWPORT_WIDTH : window.innerWidth;
}

export function UnifiedShell() {
  const {
    route,
    identity,
    connection,
    buildId,
    binding,
    projection,
    planningProjection,
    operateSearchBindings,
    operateReviewNavigation,
    refetchCurrent,
    bootstrap,
    bootPhase,
    bootDetail,
  } = useDashboard();
  const search = useSearchCoordinator(planningProjection);
  const inspectorStore = useInspectorStore();
  const width = useSyncExternalStore(
    subscribeToResize,
    readViewportWidth,
    () => SERVER_VIEWPORT_WIDTH,
  );
  const narrow = width < INSPECTOR_DOCK_WIDTH;
  const [inspectorOpen, setInspectorOpen] = useState(
    () => readViewportWidth() >= INSPECTOR_DOCK_WIDTH,
  );

  // A floating inspector is a transient overlay: it closes when the plane narrows or moves on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes the floating inspector.
  useEffect(() => {
    if (narrow) setInspectorOpen(false);
  }, [narrow, route]);
  useEffect(() => {
    if (inspectorStore.openTick > 0) setInspectorOpen(true);
  }, [inspectorStore.openTick]);

  const product = route.product ?? 'planning';
  const incompatible = bootPhase === 'incompatible' || connection.state === 'incompatible';
  const showDiagnostics = route.kind === 'system.diagnostics' || incompatible;
  const booting = connection.state === 'booting' && !showDiagnostics;
  const inspectorMode = booting ? 'skeleton' : incompatible ? 'stub' : 'selection';
  // The bootstrap envelope names the query roots it has. No operate root means no gateway.
  const operateOffline = bootstrap !== null && bootstrap.queryRoots.operate === null;
  const operateWithoutGateway = route.product === 'operate' && operateOffline;

  const planningModel =
    binding?.productArea === 'planning'
      ? resolvePlanningWorkspace(planningProjection, binding)
      : null;
  const planningNodes = planningModel ? null : planningNodesFromProductState(planningProjection);
  const nodeCount = planningModel
    ? planningModel.graph.nodes.length
    : planningNodes && planningNodes.length > 0
      ? planningNodes.length
      : null;
  const edgeCount = planningModel ? planningModel.graph.edges.length : null;

  return (
    <div
      className="pc-shell"
      data-dashboard-build-id={buildId}
      data-product={route.product ?? 'system'}
    >
      {/* biome-ignore lint/a11y/useValidAnchor: a skip link must retain anchor semantics; the handler avoids hash-router navigation. */}
      <a
        className="pc-skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus({ preventScroll: false });
        }}
      >
        Skip to main content
      </a>
      <NavRail
        product={product}
        route={route}
        operateAvailable={!operateOffline}
        onOpenPalette={search.show}
      />
      <div className="pc-shell__column">
        <TopBar
          route={route}
          projectName={identity.projectName}
          showSubject={hasCurrentRouteSubject({ route, projection, binding })}
          connectionState={connection.state}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onOpenPalette={search.show}
        />
        <div className="pc-shell__plane">
          <main
            id="main-content"
            className="pc-shell__main"
            tabIndex={-1}
            aria-busy={booting || undefined}
          >
            {operateWithoutGateway ? (
              <LocalOperateReviews key={route.kind} route={route} origin={bootstrap.origin} />
            ) : booting ? (
              <BootScreen route={route} phase={bootPhase} detail={bootDetail} />
            ) : (
              <>
                {connection.state === 'stale' || connection.state === 'offline' ? (
                  <PlaneBanner state={connection.state} reason={connection.reason} />
                ) : null}
                <div className="pc-shell__scroll">
                  {showDiagnostics ? (
                    <>
                      {incompatible ? <IncompatibleNotice detail={bootDetail} /> : null}
                      <CompatibilityPage
                        embeddedBuildId={buildId}
                        bootstrap={bootstrap}
                        bootPhase={bootPhase}
                        bootDetail={bootDetail}
                        connection={connection}
                      />
                    </>
                  ) : (
                    <div className="op-route-frame">
                      <RouteWorkspace
                        route={route}
                        projection={projection}
                        binding={binding}
                        connectionState={connection.state}
                        searchSources={search.sources}
                        operateSearchBindings={operateSearchBindings}
                        operateReviewNavigation={operateReviewNavigation}
                        refetchCurrent={refetchCurrent}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
          {inspectorOpen ? (
            <Inspector
              key={`${route.kind}:${route.subjectId ?? ''}:${inspectorStore.openTick}`}
              mode={inspectorMode}
              selection={inspectorStore.selection}
              floating={narrow}
            />
          ) : null}
        </div>
        <StatusBar
          branch={bootstrap?.project.branch ?? null}
          nodeCount={nodeCount}
          edgeCount={edgeCount}
          connectionState={connection.state}
          buildId={buildId}
        />
      </div>
      <CommandPalette
        open={search.open}
        onClose={search.close}
        sources={search.sources}
        operateBindings={operateSearchBindings}
        preferredOperateCycleId={route.product === 'operate' ? binding?.cycleId : null}
        connectionState={connection.state}
      />
    </div>
  );
}
