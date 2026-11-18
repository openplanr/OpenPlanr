import {
  ActionPill,
  ChromeProvider,
  ChromeRoot,
  FloatingToolbar,
  formatShortcut,
  HelpButton,
  Menu,
  MenuItem,
  MenuPill,
  NavigationPanel,
  Sidebar,
  ToolbarItem,
  ToolbarMore,
  useChrome,
  ZoomPill,
} from '@openplanr/canvas/react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { ChromePreference } from '../../app/browser-preferences.js';
import type { DashboardConnection } from '../../app/providers.js';
import {
  type DashboardRouteKind,
  dashboardRouteDefinition,
  type ParsedDashboardRoute,
  parseDashboardRoute,
} from '../../app/router.js';
import { PcIcon } from '../../design-system/components/index.js';
import {
  HelpCard,
  NAVIGATION_PANEL,
  PageOutline,
  paletteShortcut,
  SIDEBAR_PANEL,
  usePageChromeBehavior,
  WelcomeLabels,
} from './floating-chrome-parts.js';
import { focusViewFilter } from './keyboard-coordinator.js';
import { type RouteTool, routeSlotRef, useCanvasRoute, useRouteTools } from './route-tools.js';
import {
  CapabilityChip,
  ConnectionChip,
  type DetailTrail,
  NavigationSections,
  navigationSections,
  THEME_STORAGE_ERROR,
  type ThemePreferenceAdapter,
  TOPBAR_ROUTE_COUNT_ID,
  TOPBAR_ROUTE_TABS_ID,
  useThemeChoice,
} from './shell-navigation.js';
import '@openplanr/canvas/styles.css';
import './floating-chrome.css';

export { useChrome } from '@openplanr/canvas/react';
export {
  NAVIGATION_PANEL,
  SIDEBAR_PANEL,
  useChromeRegions,
  useCloseUnpinnedPanels,
} from './floating-chrome-parts.js';
export { useCanvasRoute } from './route-tools.js';
export { ScrollbarProbe } from './scrollbar-probe.js';

/** Widest viewport that keeps the phone top bar and bottom navigation. */
export const PHONE_MAX_WIDTH = 599;
/** Below this width the tool and action pills show icons and one group-by control. */
export const COMPACT_CHROME_WIDTH = 900;
/** Below this width only one side panel is open at a time. */
const ONE_PANEL_WIDTH = 1100;

/** Owns panel state for the project, persisted through the browser preference adapter. */
export function ShellChromeProvider({
  preference,
  projectId,
  onStorageError,
  children,
}: Readonly<{
  preference?: ChromePreference;
  projectId: string | null;
  onStorageError: (operation: 'get' | 'set') => void;
  children: ReactNode;
}>) {
  const storage = useMemo(() => {
    if (!projectId || !preference) return undefined;
    const stored = preference.storage(projectId);
    return {
      // A panel reopens on load only when pinned; an unpinned open panel was transient.
      get: (key: string) => {
        const value = stored.get(key);
        return value !== null &&
          typeof value === 'object' &&
          'open' in value &&
          value.open === true &&
          'pinned' in value &&
          value.pinned === false
          ? { open: false, pinned: false }
          : value;
      },
      set: stored.set,
    };
  }, [projectId, preference]);
  return (
    <ChromeProvider
      storage={storage}
      onStorageError={(_error, context) => onStorageError(context.operation)}
      // The kit queries max-width at the breakpoint minus 0.01px, which Chromium rounds up to
      // the whole pixel; 0.02px less keeps 600 and 1100 on the wider layout.
      mobileBreakpoint={PHONE_MAX_WIDTH + 0.98}
      onePanelBreakpoint={ONE_PANEL_WIDTH - 0.02}
    >
      {children}
    </ChromeProvider>
  );
}

export type FloatingChromeProps = Readonly<{
  projectName: string;
  route: ParsedDashboardRoute;
  routeKey: string;
  compact: boolean;
  connectionState: DashboardConnection['state'];
  counts?: Partial<Record<DashboardRouteKind, number>>;
  selectionPending: boolean;
  detailTrail: DetailTrail | null;
  /** Undefined without a selection, so the sidebar offers only its Outline tab. */
  inspector: ReactNode | undefined;
  welcome: boolean;
  status: Readonly<{
    project: string;
    buildId: string;
    branch: string | null;
    totals: string | null;
    storageNotice: string | null;
  }>;
  themePreference?: ThemePreferenceAdapter;
  main: RefObject<HTMLElement | null>;
  navigate: (href: string) => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
}>;

/** Floating menu, tool and action pills, navigation panel, sidebar and help over a full-window page. */
export function FloatingChrome(props: FloatingChromeProps) {
  const { route, routeKey, compact, main } = props;
  const chrome = useChrome();
  const [helpOpen, setHelpOpen] = useState(false);
  const canvas = useCanvasRoute();
  usePageChromeBehavior({ routeKey, main, canvas });
  const product = route.product ?? 'system';
  const access = `${product === 'operate' ? 'Governed actions' : 'Read-only'} · ${
    props.connectionState === 'connected' || props.connectionState === 'read-only'
      ? 'Live'
      : props.connectionState
  }`;
  const sidebarOpen = Boolean(chrome.panels[SIDEBAR_PANEL]?.open);
  return (
    <ChromeRoot className={compact ? 'pc-chrome pc-chrome--compact' : 'pc-chrome'}>
      <MainMenu {...props} />
      <NavigationPanel id={NAVIGATION_PANEL}>
        <div ref={routeSlotRef('panel')} />
        <NavigationSections
          route={route}
          counts={props.counts}
          onOpenPalette={props.onOpenPalette}
          paletteKeys={formatShortcut(paletteShortcut())}
        />
      </NavigationPanel>
      <RouteToolbar compact={compact} onOpenPalette={props.onOpenPalette} main={main} />
      <ActionPill>
        <CapabilityChip product={product} iconOnly={compact} />
        <output className="pc-chrome-live" aria-live="polite">
          <ConnectionChip state={props.connectionState} compact labelHidden={compact} />
        </output>
        <button
          type="button"
          className="canvas-chrome-sidebar-toggle"
          aria-label="Sidebar"
          aria-pressed={sidebarOpen}
          title={`Sidebar (${formatShortcut(chrome.keymap.sidebar)})`}
          onClick={() => chrome.togglePanel(SIDEBAR_PANEL)}
        >
          <PcIcon name="panel-left-close" size={16} />
          {(canvas ? chrome.inspectorPending : props.selectionPending && !sidebarOpen) ? (
            <span
              className="canvas-chrome-selection-dot"
              data-inspector-pending=""
              aria-hidden="true"
            />
          ) : null}
        </button>
      </ActionPill>
      <Sidebar
        key={props.inspector === undefined ? 'outline' : 'inspector'}
        id={SIDEBAR_PANEL}
        inspector={
          props.inspector === undefined ? undefined : props.inspector ? (
            <section className="pc-shell-inspector__content" aria-label="Inspector">
              {props.inspector}
            </section>
          ) : null
        }
        outline={
          canvas ? (
            <div ref={routeSlotRef('outline')} />
          ) : (
            <PageOutline main={main} refreshKey={`${routeKey}:${sidebarOpen}`} />
          )
        }
      />
      <ZoomPill />
      <HelpButton onClick={() => setHelpOpen((open) => !open)} />
      {helpOpen ? (
        <HelpCard
          status={{ ...props.status, access }}
          onClose={() => setHelpOpen(false)}
          onAllShortcuts={() => {
            setHelpOpen(false);
            props.onOpenHelp();
          }}
        />
      ) : null}
      {props.welcome ? <WelcomeLabels /> : null}
    </ChromeRoot>
  );
}

function MainMenu({
  projectName,
  route,
  detailTrail,
  themePreference,
  navigate,
  onOpenPalette,
  onOpenHelp,
  main,
}: FloatingChromeProps) {
  const chrome = useChrome();
  const theme = useThemeChoice(themePreference);
  const navigationOpen = Boolean(chrome.panels[NAVIGATION_PANEL]?.open);
  const label = dashboardRouteDefinition(route)?.label ?? 'Closed route';
  // Menu items close the menu and restore focus to it first; focus moves on the next frame.
  const later = (action: () => void) => () => requestAnimationFrame(action);
  return (
    <MenuPill
      viewPicker={
        detailTrail ? (
          <span className="pc-chrome-trail">
            <a href={detailTrail.origin}>
              {dashboardRouteDefinition(parseDashboardRoute(detailTrail.origin))?.label ?? 'List'}
            </a>
            <span aria-hidden="true"> / </span>
            {detailTrail.spec ? (
              <>
                <a href={detailTrail.spec.href}>{detailTrail.spec.label}</a>
                <span aria-hidden="true"> / </span>
              </>
            ) : null}
            <span aria-current="page">{detailTrail.current}</span>
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={navigationOpen}
            title={projectName}
            aria-label={`${label}: ${navigationOpen ? 'hide' : 'show'} navigation`}
            onClick={() => chrome.togglePanel(NAVIGATION_PANEL)}
          >
            <span>{label}</span>
            <span id={TOPBAR_ROUTE_COUNT_ID} className="pc-topbar__count" aria-hidden="true" />
          </button>
        )
      }
    >
      <Menu label="Main menu">
        {navigationSections(route).map((section) => (
          // biome-ignore lint/a11y/useSemanticElements: a menu groups its items with role="group"; a fieldset is a form control group.
          <div key={section.label} role="group" aria-label={section.label}>
            <span className="pc-chrome-label" aria-hidden="true">
              {section.label}
            </span>
            {section.items.map((item) => (
              <MenuItem
                key={item.kind}
                icon={<PcIcon name={item.icon} size={15} />}
                onClick={() => navigate(item.href)}
              >
                {item.label}
              </MenuItem>
            ))}
          </div>
        ))}
        {/* biome-ignore lint/a11y/useSemanticElements: a menu groups its items with role="group"; a fieldset is a form control group. */}
        <div role="group" aria-label="Tools and preferences">
          <span className="pc-chrome-label" aria-hidden="true">
            Tools
          </span>
          <MenuItem
            icon={<PcIcon name="search" size={15} />}
            shortcut={paletteShortcut()}
            onClick={later(onOpenPalette)}
          >
            Search or run
          </MenuItem>
          <MenuItem
            icon={<PcIcon name="filter" size={15} />}
            onClick={later(() => {
              const root = main.current;
              if (root) focusViewFilter(root, onOpenPalette);
            })}
          >
            Find in this view
          </MenuItem>
          <MenuItem
            icon={<PcIcon name="layers" size={15} />}
            shortcut="menu"
            onClick={() => chrome.setPanelOpen(NAVIGATION_PANEL, !navigationOpen)}
          >
            {navigationOpen ? 'Hide navigation panel' : 'Show navigation panel'}
          </MenuItem>
          <MenuItem icon={<PcIcon name="info" size={15} />} onClick={later(onOpenHelp)}>
            Keyboard shortcuts
          </MenuItem>
          <MenuItem icon={<PcIcon name={theme.icon} size={15} />} onClick={theme.cycle}>
            {`Theme: ${theme.choice}`}
          </MenuItem>
        </div>
      </Menu>
      {theme.storageError ? (
        <span className="pc-visually-hidden" role="status">
          {THEME_STORAGE_ERROR}
        </span>
      ) : null}
    </MenuPill>
  );
}

function toolItem(tool: RouteTool): ReactNode {
  return (
    <ToolbarItem
      key={tool.id}
      label={tool.label}
      icon={tool.icon ? <PcIcon name={tool.icon} size={16} /> : (tool.glyph ?? tool.label)}
      shortcut={tool.shortcut}
      active={tool.active}
      onClick={tool.run}
    />
  );
}

/** The active lens name, sized to the longest name so switching lenses never resizes the pill. */
function LensLabels({
  tools,
  active,
}: Readonly<{ tools: readonly RouteTool[]; active: RouteTool }>) {
  return (
    <span style={{ display: 'inline-grid' }}>
      {tools.map((tool) => (
        <span
          key={tool.id}
          style={{ gridArea: '1 / 1', visibility: tool === active ? 'visible' : 'hidden' }}
        >
          {tool.label}
        </span>
      ))}
    </span>
  );
}

/** Tool pill forms, widest first: every tool; groups and plain toggles folded; all folded. */
const TOOLBAR_FORMS = 3;

/**
 * The tool pill's form: the widest that leaves a gap to the menu and action pills, measured
 * before paint whenever the window, the neighbouring pills or the route's tools change.
 */
function useToolbarForm(minimum: number, toolsKey: string): number {
  const [form, setForm] = useState(minimum);
  const [measure, setMeasure] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new measure, tool set or minimum restarts from the widest allowed form.
  useLayoutEffect(() => setForm(minimum), [minimum, toolsKey, measure]);
  useLayoutEffect(() => {
    const slot = (name: string) =>
      document.querySelector(`.canvas-chrome-root [data-chrome-slot="${name}"]`);
    const toolbar = slot('toolbar')?.getBoundingClientRect();
    if (!toolbar || form >= TOOLBAR_FORMS - 1) return;
    const gap = 12;
    const menu = slot('menu')?.getBoundingClientRect();
    const action = slot('action')?.getBoundingClientRect();
    if (
      (menu && menu.width > 0 && toolbar.left < menu.right + gap) ||
      (action && action.width > 0 && toolbar.right > action.left - gap)
    )
      setForm(form + 1);
  });
  useEffect(() => {
    const remeasure = () => setMeasure((count) => count + 1);
    const observer = new ResizeObserver(remeasure);
    for (const name of ['menu', 'action']) {
      const element = document.querySelector(`.canvas-chrome-root [data-chrome-slot="${name}"]`);
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', remeasure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', remeasure);
    };
  }, []);
  return form;
}

function RouteToolbar({
  compact,
  onOpenPalette,
  main,
}: Readonly<{ compact: boolean; onOpenPalette: () => void; main: RefObject<HTMLElement | null> }>) {
  const tools = useRouteTools();
  const chrome = useChrome();
  const form = useToolbarForm(
    compact ? 1 : 0,
    tools.map((tool) => `${tool.id}:${tool.label}:${tool.active === true}`).join(','),
  );
  const grouped = tools.filter((tool) => tool.group);
  const active = grouped.find((tool) => tool.active) ?? grouped[0];
  const next = active ? grouped[(grouped.indexOf(active) + 1) % grouped.length] : undefined;
  const ungrouped = tools.filter((tool) => !tool.group);
  // Folded tools move into More; tools with a shortcut stay in the pill until the last form.
  const folded = ungrouped.filter((tool) => form >= 2 || (form === 1 && !tool.shortcut));
  const shown = ungrouped.filter((tool) => !folded.includes(tool));
  return (
    <FloatingToolbar>
      {/* Route tools follow the shared tools so changing routes never moves search or More. */}
      <ToolbarItem
        label="Search or run"
        icon={<PcIcon name="search" size={16} />}
        shortcut={paletteShortcut()}
        onClick={onOpenPalette}
      />
      <ToolbarMore>
        {form > 0
          ? grouped.map((tool) => (
              <MenuItem key={tool.id} shortcut={tool.shortcut} onClick={tool.run}>
                {tool.groupLabel
                  ? `${tool.groupLabel}: ${tool.label}`
                  : `Group by ${tool.label.toLowerCase()}`}
              </MenuItem>
            ))
          : null}
        {folded.map((tool) => (
          <MenuItem
            key={tool.id}
            icon={tool.icon ? <PcIcon name={tool.icon} size={15} /> : undefined}
            shortcut={tool.shortcut}
            onClick={tool.run}
          >
            {tool.active === undefined
              ? tool.label
              : `${tool.label}: ${tool.active ? 'on' : 'off'}`}
          </MenuItem>
        ))}
        <MenuItem
          icon={<PcIcon name="filter" size={15} />}
          onClick={() =>
            requestAnimationFrame(() => {
              const root = main.current;
              if (root) focusViewFilter(root, onOpenPalette);
            })
          }
        >
          Find in this view
        </MenuItem>
        <MenuItem
          icon={<PcIcon name="square-dashed" size={15} />}
          shortcut="hideChrome"
          onClick={() => chrome.setChromeHidden(true)}
        >
          Focus mode
        </MenuItem>
      </ToolbarMore>
      {tools.length > 0 ? <span className="pc-chrome-divider" aria-hidden="true" /> : null}
      {/* The narrowest form drops route tabs; the menu and navigation panel list the same places. */}
      <div
        id={TOPBAR_ROUTE_TABS_ID}
        className="pc-chrome-route-tabs"
        hidden={form === TOOLBAR_FORMS - 1}
      />
      {form > 0 && active && next ? (
        <ToolbarItem
          label={`${active.groupLabel ?? 'Group'}: ${active.label}. Switch to ${next.label}`}
          icon={<LensLabels tools={grouped} active={active} />}
          active
          onClick={next.run}
        />
      ) : (
        grouped.map(toolItem)
      )}
      {grouped.length > 0 && shown.length > 0 ? (
        // Keyed by the route's tools so a route change replaces the divider instead of moving it.
        <span key={grouped[0]?.id} className="pc-chrome-divider" aria-hidden="true" />
      ) : null}
      {shown.map(toolItem)}
    </FloatingToolbar>
  );
}
