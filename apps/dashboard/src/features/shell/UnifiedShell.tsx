import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDashboard } from '../../app/providers.js';
import { CompatibilityPage } from '../diagnostics/CompatibilityPage.js';
import { LocalOperateReviews } from '../operate/local-reviews/LocalOperateReviews.js';
import {
  planningNodesFromProductState,
  resolvePlanningWorkspace,
} from '../planning/planning-workspace.js';
import { clearInspector, useInspectorStore } from './inspector-selection.js';
import { PlanningLiveFeedback, usePlanningLiveFeedback } from './planning-live-feedback.js';
import { hasCurrentRouteSubject, RouteWorkspace } from './route-workspace.js';
import {
  CommandPalette,
  PlanningPresentationProvider,
  type ShellAdapters,
  useSearchCoordinator,
  useShellInteractions,
} from './shell-interactions.js';
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

export function UnifiedShell({
  fontLoadFailed = false,
  adapters,
}: {
  fontLoadFailed?: boolean;
  adapters?: ShellAdapters;
}) {
  const {
    route,
    identity,
    connection,
    buildId,
    binding,
    projection,
    planningProjection,
    planningLive,
    operateSearchBindings,
    operateReviewNavigation,
    refetchCurrent,
    bootstrap,
    bootPhase,
    bootDetail,
    presentationView,
    invalidView,
  } = useDashboard();
  const search = useSearchCoordinator(planningProjection);
  const live = usePlanningLiveFeedback(planningProjection);
  const [fontNoticeDismissed, setFontNoticeDismissed] = useState(false);
  const [compactRail, setCompactRail] = useState(
    () => adapters?.railPreference?.initialCompact ?? false,
  );
  const [railPreferenceError, setRailPreferenceError] = useState(() =>
    adapters?.railPreference?.initialStorageError
      ? 'Navigation preference could not be read in this browser.'
      : null,
  );
  const toggleRail = () => {
    const next = !compactRail;
    setCompactRail(next);
    try {
      adapters?.railPreference?.save(next);
      setRailPreferenceError(null);
    } catch {
      setRailPreferenceError(
        'Navigation preference could not be saved. It applies until this page is closed.',
      );
    }
  };
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

  const scope = binding
    ? JSON.stringify([
        binding.projectId,
        binding.actorId,
        binding.scopeId,
        binding.domainId,
        binding.domainVersion,
        binding.generation,
      ])
    : identity.bindingLabel;
  const inspectorScope = useRef(scope);
  useEffect(() => {
    if (inspectorScope.current !== scope) {
      clearInspector();
      setInspectorOpen(false);
      inspectorScope.current = scope;
    }
  }, [scope]);
  const routeKey = JSON.stringify([route, presentationView]);
  const interactions = useShellInteractions({
    adapters,
    routeKey,
    scope,
    selectedId:
      inspectorStore.selection?.kind === 'node'
        ? inspectorStore.selection.id
        : (inspectorStore.selection?.actionId ?? null),
    paletteOpen: search.open,
    togglePalette: search.toggle,
    inspectorOpen,
    setInspectorOpen,
  });
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
      data-compact-rail={compactRail || undefined}
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
        compact={compactRail}
        onToggleCompact={toggleRail}
        preferenceError={railPreferenceError}
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
          themePreference={adapters?.themePreference}
          paletteIconOnly={width < 1200}
          shortcutHelp={interactions.help}
        />
        {fontLoadFailed && !fontNoticeDismissed ? (
          <div className="pc-font-notice" role="status">
            <span>
              Some dashboard fonts could not load. You can keep working with fallback fonts. Reload
              to retry.
            </span>
            <button type="button" onClick={() => setFontNoticeDismissed(true)}>
              Dismiss font notice
            </button>
          </div>
        ) : null}
        <div className="pc-shell__plane">
          <main
            ref={interactions.rootRef}
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
                {connection.state === 'stale' ||
                connection.state === 'offline' ||
                projection.kind === 'stale' ||
                planningLive.state === 'paused' ? (
                  <PlaneBanner
                    state={
                      connection.state === 'offline' ||
                      (planningLive.state === 'paused' && planningLive.attempt > 0)
                        ? 'offline'
                        : 'stale'
                    }
                    reason={
                      planningLive.state === 'paused'
                        ? 'Live file updates are paused until the connection and a current graph read are validated.'
                        : projection.kind === 'stale'
                          ? 'The latest read could not be validated for this view.'
                          : connection.reason
                    }
                    projectionKind={projection.kind}
                    errorCode={projection.error?.code}
                    lastSnapshotAt={live.lastSnapshotAt}
                    attempt={planningLive.attempt}
                    onRetry={refetchCurrent}
                  />
                ) : null}
                <div className="pc-shell__scroll" ref={interactions.scrollRef}>
                  {invalidView ? (
                    <p role="status">
                      This view link is invalid or unsupported. Default filters are shown.
                    </p>
                  ) : null}
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
                      <PlanningPresentationProvider
                        key={scope}
                        scope={scope}
                        view={presentationView}
                        invalidView={invalidView}
                        onCopy={adapters?.copy}
                      >
                        <RouteWorkspace
                          route={route}
                          projection={projection}
                          binding={binding}
                          connectionState={connection.state}
                          searchSources={search.sources}
                          onCopy={adapters?.copy}
                          operateSearchBindings={operateSearchBindings}
                          operateReviewNavigation={operateReviewNavigation}
                          refetchCurrent={refetchCurrent}
                        />
                      </PlanningPresentationProvider>
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
              onClose={() => interactions.closeInspector()}
              onPromote={interactions.navigate}
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
      <PlanningLiveFeedback
        feedback={live.feedback}
        onDismiss={live.dismiss}
        onShow={interactions.navigate}
      />
      <CommandPalette
        open={search.open}
        singleLetters={interactions.singleLetters}
        onNavigate={interactions.navigate}
        onCopy={adapters?.copy}
        onClose={search.close}
        sources={search.sources}
        operateBindings={operateSearchBindings}
        preferredOperateCycleId={route.product === 'operate' ? binding?.cycleId : null}
        connectionState={connection.state}
      />
    </div>
  );
}
