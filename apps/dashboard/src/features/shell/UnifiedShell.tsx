import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDashboard } from '../../app/providers.js';
import { CompatibilityPage } from '../diagnostics/CompatibilityPage.js';
import { LocalOperateReviews } from '../operate/local-reviews/LocalOperateReviews.js';
import {
  planningNodesFromProductState,
  resolvePlanningWorkspace,
} from '../planning/planning-workspace.js';
import {
  COMPACT_CHROME_WIDTH,
  FloatingChrome,
  NAVIGATION_PANEL,
  PHONE_MAX_WIDTH,
  ShellChromeProvider,
  SIDEBAR_PANEL,
  useCanvasRoute,
  useChrome,
  useChromeRegions,
  useCloseUnpinnedPanels,
} from './floating-chrome.js';
import { PlanningLiveFeedback, usePlanningLiveFeedback } from './planning-live-feedback.js';
import { RouteWorkspace } from './route-workspace.js';
import {
  CommandPalette,
  clearInspector,
  PlanningDetailInspector,
  PlanningPresentationProvider,
  planningDetailTrail,
  type ShellAdapters,
  selectPlanningAttention,
  useInspectorStore,
  useSearchCoordinator,
  useShellInteractions,
} from './shell-interactions.js';
import {
  Inspector,
  InspectorContent,
  MobileNavigation,
  RouteSlotLayout,
  TopBar,
} from './shell-navigation.js';
import { BootScreen, IncompatibleNotice, PlaneBanner } from './shell-planes.js';
import './unified-shell.css';

const SERVER_VIEWPORT_WIDTH = 1440;
const CHROME_STORAGE_NOTICE = {
  get: 'Panel layout could not be read in this browser. Panels start closed.',
  set: 'Panel layout could not be saved in this browser. It applies until this page is closed.',
} as const;

function subscribeToResize(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function readViewportWidth(): number {
  return typeof window === 'undefined' ? SERVER_VIEWPORT_WIDTH : window.innerWidth;
}

type ShellProps = {
  fontLoadFailed?: boolean;
  adapters?: ShellAdapters;
};

/** Owns per-project floating-chrome state above every route. */
export function UnifiedShell(props: ShellProps) {
  const { binding } = useDashboard();
  const projectId = binding?.projectId ?? null;
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  return (
    <ShellChromeProvider
      preference={props.adapters?.chromePreference}
      projectId={projectId}
      onStorageError={(operation) => setStorageNotice(CHROME_STORAGE_NOTICE[operation])}
    >
      <ShellFrame {...props} chromeKey={projectId ?? ''} storageNotice={storageNotice} />
    </ShellChromeProvider>
  );
}

function ShellFrame({
  fontLoadFailed = false,
  adapters,
  chromeKey,
  storageNotice,
}: ShellProps & { chromeKey: string; storageNotice: string | null }) {
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
  const inspectorStore = useInspectorStore();
  const width = useSyncExternalStore(
    subscribeToResize,
    readViewportWidth,
    () => SERVER_VIEWPORT_WIDTH,
  );
  const phone = width <= PHONE_MAX_WIDTH;
  const chrome = useChrome();
  const [phoneInspectorOpen, setPhoneInspectorOpen] = useState(false);
  const sidebar = chrome.panels[SIDEBAR_PANEL];
  const inspectorOpen = phone ? phoneInspectorOpen : Boolean(sidebar?.open);
  const setInspectorOpen = (open: boolean) =>
    phone ? setPhoneInspectorOpen(open) : chrome.setPanelOpen(SIDEBAR_PANEL, open);
  const latestChrome = useRef({ chrome, phone });
  latestChrome.current = { chrome, phone };

  // Selection overlays belong to their originating route, never a reserved layout column.
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes the phone inspector.
  useEffect(() => {
    setPhoneInspectorOpen(false);
  }, [phone, route]);
  const requestedInspectorTick = useRef(0);
  // Runs in the selecting event's task: a later refocus restarts the canvas's 0 ms focus reveal
  // after the next frame's timestamp, which the engine turns into a NaN camera.
  useLayoutEffect(() => {
    if (requestedInspectorTick.current !== inspectorStore.openTick) {
      requestedInspectorTick.current = inspectorStore.openTick;
      if (inspectorStore.selection === null) return;
      if (latestChrome.current.phone) {
        setPhoneInspectorOpen(true);
        return;
      }
      // The kit returns focus to the element that opened the panel. Selection moves while the
      // sidebar stays open, so the shell restores focus to the latest selection on close instead.
      const origin = document.activeElement;
      if (origin instanceof HTMLElement && origin.closest('[data-keyboard-item]')) origin.blur();
      latestChrome.current.chrome.setPanelOpen(SIDEBAR_PANEL, true);
      if (origin instanceof HTMLElement && origin !== document.activeElement)
        origin.focus({ preventScroll: true });
    }
  }, [inspectorStore.openTick, inspectorStore.selection]);
  useEffect(() => {
    if (inspectorStore.selection !== null) return;
    setPhoneInspectorOpen(false);
    const current = latestChrome.current.chrome;
    const panel = current.panels[SIDEBAR_PANEL];
    if (panel?.open && !panel.pinned) current.setPanelOpen(SIDEBAR_PANEL, false);
  }, [inspectorStore.selection]);
  const closeUnpinnedPanels = useCloseUnpinnedPanels();
  const closeChromePanels = phone ? undefined : closeUnpinnedPanels;

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
      setPhoneInspectorOpen(false);
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
    closeChromePanels,
  });
  const sidebarWasOpen = useRef(false);
  const sidebarOpen = Boolean(sidebar?.open);
  const inspectedId =
    inspectorStore.selection?.kind === 'node'
      ? inspectorStore.selection.id
      : (inspectorStore.selection?.actionId ?? null);
  const latestInspectedId = useRef(inspectedId);
  latestInspectedId.current = inspectedId;
  // Focus returns to the latest selection's row or node, not the one that opened the sidebar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the sidebar closes.
  useEffect(() => {
    const closed = sidebarWasOpen.current && !sidebarOpen;
    sidebarWasOpen.current = sidebarOpen;
    const main = interactions.rootRef.current;
    const active = document.activeElement;
    // Focus the user moved to a control, or to a visible chrome button, stays there. The kit
    // parks focus on a canvas stage, which stands in for the main content here.
    if (
      !closed ||
      (active &&
        active !== document.body &&
        active !== main &&
        !active.matches('.canvas-stage') &&
        !active.closest('[inert]'))
    )
      return;
    const origin = Array.from(
      main?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? [],
    ).find(
      (item) =>
        (item.dataset.canonicalId || item.dataset.keyboardItem) === latestInspectedId.current,
    );
    (origin ?? main)?.focus({ preventScroll: true });
  }, [sidebarOpen]);
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
  const [attentionNow] = useState(() => new Date().toISOString());
  const graph = planningModel?.graph;
  const railCounts = useMemo(() => {
    if (!graph) return undefined;
    try {
      const attention = selectPlanningAttention(graph, attentionNow);
      return {
        'planning.overview': new Set([
          ...attention.waiting.map((item) => item.id),
          ...attention.stale.map((item) => item.id),
          ...attention.highPriorityNotStarted,
        ]).size,
        'planning.list': graph.nodes.length,
        'planning.activity': attention.changedToday.ids.length,
      };
    } catch {
      // Invalid attention data is explained by Home; the rail must not present it as zero.
      return { 'planning.list': graph.nodes.length };
    }
  }, [graph, attentionNow]);
  const detailRoute = route.kind === 'planning.detail' || route.kind === 'planning.spec';
  const navigationPanel = chrome.panels[NAVIGATION_PANEL];
  const navigationInset =
    !phone && chrome.layout === 'desktop' && navigationPanel?.open && navigationPanel.pinned;
  const skipLink = useRef<HTMLAnchorElement>(null);
  const canvasRoute = useCanvasRoute();
  useChromeRegions(!phone, interactions.rootRef, skipLink, canvasRoute);
  const planningInspector =
    planningModel && inspectorStore.selection?.kind === 'node' ? (
      <PlanningPresentationProvider
        scope={scope}
        view={null}
        onCopy={adapters?.copy}
        singleLetters={interactions.singleLetters}
      >
        <PlanningDetailInspector
          model={planningModel}
          nodeId={inspectorStore.selection.id}
          origin={
            bootstrap?.origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
          }
          onPromote={interactions.navigate}
        />
      </PlanningPresentationProvider>
    ) : undefined;

  return (
    <RouteSlotLayout.Provider value={phone ? 'phone' : `chrome:${chromeKey}`}>
      <div
        className="pc-shell"
        data-dashboard-build-id={buildId}
        data-shell-layout={phone ? 'phone' : 'floating'}
        data-navigation-inset={navigationInset || undefined}
        data-product={route.product ?? 'system'}
        data-detail-route={detailRoute || undefined}
      >
        {/* biome-ignore lint/a11y/useValidAnchor: a skip link must retain anchor semantics; the handler avoids hash-router navigation. */}
        <a
          ref={skipLink}
          className="pc-skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('main-content')?.focus({ preventScroll: false });
          }}
        >
          Skip to main content
        </a>
        {phone ? null : (
          <FloatingChrome
            key={chromeKey}
            projectName={identity.projectName}
            route={route}
            routeKey={routeKey}
            compact={width < COMPACT_CHROME_WIDTH}
            connectionState={connection.state}
            counts={railCounts}
            selectionPending={!detailRoute && inspectorStore.selection !== null}
            detailTrail={detailRoute ? planningDetailTrail(graph, route.subjectId) : null}
            inspector={
              inspectorStore.selection === null ? undefined : inspectorOpen ? (
                <InspectorContent
                  mode={inspectorMode}
                  selection={inspectorStore.selection}
                  onPromote={interactions.navigate}
                  planningContent={planningInspector}
                />
              ) : null
            }
            welcome={route.kind === 'planning.overview' && planningModel?.graph.nodes.length === 0}
            status={{
              project: identity.projectName,
              buildId,
              branch: bootstrap?.project.branch ?? null,
              totals:
                nodeCount === null || edgeCount === null
                  ? null
                  : `${nodeCount} nodes · ${edgeCount} edges`,
              storageNotice,
            }}
            themePreference={adapters?.themePreference}
            main={interactions.rootRef}
            navigate={interactions.navigate}
            onOpenPalette={search.show}
            onOpenHelp={interactions.openHelp}
          />
        )}
        <div className="pc-shell__column">
          {phone ? (
            <TopBar
              route={route}
              projectName={identity.projectName}
              detailTrail={detailRoute ? planningDetailTrail(graph, route.subjectId) : null}
              onCopy={adapters?.copy}
              connectionState={connection.state}
              inspectorOpen={inspectorOpen}
              inspectorAvailable={!detailRoute && inspectorStore.selection !== null}
              onToggleInspector={() => setPhoneInspectorOpen((open) => !open)}
              onOpenPalette={search.show}
              themePreference={adapters?.themePreference}
              shortcutHelp={interactions.help}
            />
          ) : (
            interactions.helpDialog
          )}
          {fontLoadFailed && !fontNoticeDismissed ? (
            <div className="pc-font-notice" role="status">
              <span>
                Some dashboard fonts could not load. You can keep working with fallback fonts.
                Reload to retry.
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
                          planningModel={
                            planningProjection.binding
                              ? resolvePlanningWorkspace(
                                  planningProjection,
                                  planningProjection.binding,
                                )
                              : null
                          }
                        />
                      </>
                    ) : (
                      <div className="op-route-frame">
                        <PlanningPresentationProvider
                          key={scope}
                          scope={scope}
                          view={presentationView}
                          invalidView={invalidView}
                          singleLetters={interactions.singleLetters}
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
            {phone && !detailRoute && phoneInspectorOpen && inspectorStore.selection !== null ? (
              <Inspector
                key={`${route.kind}:${route.subjectId ?? ''}`}
                mode={inspectorMode}
                selection={inspectorStore.selection}
                modal
                onClose={() => setPhoneInspectorOpen(false)}
                onRestoreFocus={interactions.restoreInspectorFocus}
                onPromote={interactions.navigate}
                planningContent={planningInspector}
              />
            ) : null}
          </div>
        </div>
        {phone ? (
          <MobileNavigation product={product} route={route} operateAvailable={!operateOffline} />
        ) : null}
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
          recentItems={adapters?.recentItems}
          projectId={binding?.projectId ?? null}
          operateBindings={operateSearchBindings}
          preferredOperateCycleId={route.product === 'operate' ? binding?.cycleId : null}
          connectionState={connection.state}
        />
      </div>
    </RouteSlotLayout.Provider>
  );
}
