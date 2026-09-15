import { useEffect, useState } from 'react';
import type { DashboardConnection } from '../../app/providers.js';
import {
  DASHBOARD_ROUTE_DEFINITIONS,
  type DashboardProduct,
  type DashboardRouteDefinition,
  type DashboardRouteKind,
  dashboardRouteDefinition,
  type ParsedDashboardRoute,
} from '../../app/router.js';
import {
  Absent,
  ArtifactStatus,
  Button,
  EmptyState,
  Field,
  IconButton,
  Kbd,
  PcIcon,
  type PcIconName,
  Skeleton,
  StateBadge,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { InspectorSelection } from './inspector-selection.js';
import './console-shell.css';

type ConnectionState = DashboardConnection['state'];

// ---------------------------------------------------------------- rail

type RailItem = Readonly<{ kind: DashboardRouteKind; icon: PcIconName }>;
type RailSection = Readonly<{ label: string; items: readonly RailItem[] }>;

const PLANNING_SECTIONS: readonly RailSection[] = Object.freeze([
  {
    label: 'Plan',
    items: [
      { kind: 'planning.overview', icon: 'gauge' },
      { kind: 'planning.list', icon: 'list' },
      { kind: 'planning.graph', icon: 'workflow' },
      { kind: 'planning.board', icon: 'columns-3' },
      { kind: 'planning.sprints', icon: 'calendar-range' },
      { kind: 'planning.activity', icon: 'activity' },
    ],
  },
]);
const OPERATE_SECTIONS: readonly RailSection[] = Object.freeze([
  {
    label: 'Work',
    items: [
      { kind: 'operate.today', icon: 'target' },
      { kind: 'operate.inbox', icon: 'inbox' },
      { kind: 'operate.actions', icon: 'git-pull-request' },
      { kind: 'operate.cycles', icon: 'calendar-days' },
    ],
  },
  {
    label: 'Record',
    items: [
      { kind: 'operate.evidence', icon: 'file-check' },
      { kind: 'operate.outcomes', icon: 'flag' },
      { kind: 'operate.history', icon: 'history' },
      { kind: 'operate.recovery', icon: 'life-buoy' },
    ],
  },
]);
const REFERENCE_ITEMS: readonly RailItem[] = Object.freeze([
  { kind: 'planning.console', icon: 'terminal' },
  { kind: 'system.diagnostics', icon: 'life-buoy' },
]);
const DEFINITION_BY_KIND = new Map(
  DASHBOARD_ROUTE_DEFINITIONS.map((definition) => [definition.kind, definition]),
);
const COLLECTION_FOR_DETAIL: Partial<Record<ParsedDashboardRoute['kind'], DashboardRouteKind>> = {
  'planning.detail': 'planning.list',
  'planning.spec': 'planning.list',
  'operate.cycle': 'operate.cycles',
  'operate.review': 'operate.cycles',
  'operate.inbox-item': 'operate.inbox',
  'operate.action': 'operate.actions',
  'operate.action-planning': 'operate.actions',
  'operate.evidence-item': 'operate.evidence',
  'operate.outcome': 'operate.outcomes',
};

function navigationIsCurrent(
  definition: DashboardRouteDefinition,
  route: ParsedDashboardRoute,
): boolean {
  if (route.kind === 'not-found') return false;
  if (definition.kind === route.kind) return true;
  return COLLECTION_FOR_DETAIL[route.kind] === definition.kind;
}

function RailLink({ item, route }: Readonly<{ item: RailItem; route: ParsedDashboardRoute }>) {
  const definition = DEFINITION_BY_KIND.get(item.kind);
  if (!definition) return null;
  return (
    <a
      className="pc-rail__item"
      href={definition.href}
      aria-current={navigationIsCurrent(definition, route) ? 'page' : undefined}
    >
      <PcIcon name={item.icon} size={14} />
      <span>{definition.label}</span>
    </a>
  );
}

function MobileRailLink({
  item,
  route,
  onNavigate,
}: Readonly<{
  item: RailItem;
  route: ParsedDashboardRoute;
  onNavigate?: () => void;
}>) {
  const definition = DEFINITION_BY_KIND.get(item.kind);
  if (!definition) return null;
  return (
    <a
      className="pc-mobile-nav__item"
      href={definition.href}
      aria-current={navigationIsCurrent(definition, route) ? 'page' : undefined}
      onClick={onNavigate}
    >
      <PcIcon name={item.icon} size={16} />
      <span>{definition.label}</span>
    </a>
  );
}

function MobileNavigation({
  product,
  route,
  operateAvailable,
}: Readonly<{
  product: DashboardProduct;
  route: ParsedDashboardRoute;
  operateAvailable: boolean;
}>) {
  const [moreOpen, setMoreOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes the secondary sheet.
  useEffect(() => setMoreOpen(false), [route.kind]);
  const primary =
    product === 'operate'
      ? (OPERATE_SECTIONS[0]?.items.slice(0, 3) ?? [])
      : (PLANNING_SECTIONS[0]?.items.slice(0, 3) ?? []);
  const secondary =
    product === 'operate'
      ? [
          ...(OPERATE_SECTIONS[0]?.items.slice(3) ?? []),
          ...(OPERATE_SECTIONS[1]?.items ?? []),
          ...REFERENCE_ITEMS,
        ]
      : [...(PLANNING_SECTIONS[0]?.items.slice(3) ?? []), ...REFERENCE_ITEMS];
  const productLabel = product === 'operate' ? 'Operate' : 'Planning';
  const alternateProduct =
    product === 'operate'
      ? { href: '#/overview', icon: 'list-tree' as const, label: 'Planning', unavailable: false }
      : {
          href: '#/operate/today',
          icon: operateAvailable ? ('gauge' as const) : ('unplug' as const),
          label: 'Operate',
          unavailable: !operateAvailable,
        };
  return (
    <nav className="pc-mobile-nav" aria-label={`Mobile ${productLabel} navigation`}>
      {primary.map((item) => (
        <MobileRailLink key={item.kind} item={item} route={route} />
      ))}
      <a
        className="pc-mobile-nav__item"
        href={alternateProduct.href}
        data-unavailable={alternateProduct.unavailable || undefined}
        title={
          alternateProduct.unavailable
            ? 'operate — local reviews available; actions require a command gateway'
            : undefined
        }
      >
        <PcIcon name={alternateProduct.icon} size={16} />
        <span>{alternateProduct.label}</span>
      </a>
      <details
        className="pc-mobile-more"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary className="pc-mobile-nav__item" aria-label={`More ${productLabel} destinations`}>
          <PcIcon name="layers" size={16} />
          <span>More</span>
        </summary>
        <div className="pc-mobile-more__sheet">
          {secondary.map((item) => (
            <MobileRailLink
              key={item.kind}
              item={item}
              route={route}
              onNavigate={() => setMoreOpen(false)}
            />
          ))}
        </div>
      </details>
    </nav>
  );
}

export type NavRailProps = Readonly<{
  product: DashboardProduct;
  route: ParsedDashboardRoute;
  operateAvailable: boolean;
  onOpenPalette: () => void;
}>;

/** Workspace switcher, the product's sections, and the palette entry point. */
export function NavRail({ product, route, operateAvailable, onOpenPalette }: NavRailProps) {
  const sections = product === 'operate' ? OPERATE_SECTIONS : PLANNING_SECTIONS;
  const operateUnavailable = !operateAvailable;
  return (
    <>
      <nav className="pc-rail" aria-label="Dashboard navigation">
        <div className="pc-rail__brand">
          <span className="pc-rail__tile" aria-hidden="true">
            P
          </span>
          <span className="pc-rail__wordmark">openplanr</span>
          <PcIcon name="chevrons-up-down" size={13} color="var(--pc-text-tertiary)" />
        </div>
        <div className="pc-rail__products">
          <a
            className="pc-rail__product"
            href="#/overview"
            aria-current={product === 'planning' ? 'page' : undefined}
          >
            <PcIcon name="list-tree" size={12} />
            planning
          </a>
          <a
            className="pc-rail__product"
            href="#/operate/today"
            aria-current={product === 'operate' ? 'page' : undefined}
            data-unavailable={operateUnavailable || undefined}
            title={
              operateUnavailable
                ? 'operate — local reviews available; actions require a command gateway'
                : 'operate'
            }
          >
            <PcIcon name={operateUnavailable ? 'unplug' : 'gauge'} size={12} />
            operate
          </a>
        </div>
        <button
          type="button"
          className="pc-rail__palette"
          onClick={onOpenPalette}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <PcIcon name="search" size={13} />
          <span>Command…</span>
          <span className="pc-rail__keys">
            <Kbd size="sm">⌘</Kbd>
            <Kbd size="sm">K</Kbd>
          </span>
        </button>
        <div className="pc-rail__sections">
          {sections.map((section) => (
            <div className="pc-rail__section" key={section.label}>
              <div className="pc-rail__label">{section.label}</div>
              <div className="pc-rail__items">
                {section.items.map((item) => (
                  <RailLink key={item.kind} item={item} route={route} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="pc-rail__footer">
          {REFERENCE_ITEMS.map((item) => (
            <RailLink key={item.kind} item={item} route={route} />
          ))}
        </div>
      </nav>
      <MobileNavigation
        key={route.kind}
        product={product}
        route={route}
        operateAvailable={operateAvailable}
      />
    </>
  );
}

// ---------------------------------------------------------------- connection

type ConnectionRecipe = Readonly<{
  label: string;
  icon: PcIconName;
  tone: 'ink' | 'lime' | 'amber' | 'verm';
  dot: 'lime' | 'amber' | 'off';
  dotLabel: string;
}>;

/*
 * Six real connection states. Each owns a top-bar chip and a status-bar dot, encoded three
 * ways — colour, glyph and wording — so none of them depends on colour alone.
 */
export const CONNECTION_STATES: Readonly<Record<ConnectionState, ConnectionRecipe>> = Object.freeze(
  {
    booting: {
      label: 'booting',
      icon: 'loader-circle',
      tone: 'amber',
      dot: 'amber',
      dotLabel: 'connecting to the watcher',
    },
    connected: {
      label: 'connected',
      icon: 'activity',
      tone: 'lime',
      dot: 'lime',
      dotLabel: 'watcher connected',
    },
    'read-only': {
      label: 'read-only',
      icon: 'lock',
      tone: 'ink',
      dot: 'lime',
      dotLabel: 'watcher connected',
    },
    stale: {
      label: 'stale',
      icon: 'clock',
      tone: 'amber',
      dot: 'amber',
      dotLabel: 'watcher stale',
    },
    offline: {
      label: 'offline',
      icon: 'unplug',
      tone: 'verm',
      dot: 'off',
      dotLabel: 'watcher offline',
    },
    incompatible: {
      label: 'incompatible',
      icon: 'octagon-alert',
      tone: 'verm',
      dot: 'off',
      dotLabel: 'watcher stopped',
    },
  },
);

export function ConnectionChip({ state }: Readonly<{ state: ConnectionState }>) {
  const recipe = CONNECTION_STATES[state];
  return (
    <span className="pc-conn" data-tone={recipe.tone} title={`connection: ${recipe.label}`}>
      <PcIcon name={recipe.icon} size={11} spin={state === 'booting'} />
      {recipe.label}
    </span>
  );
}

export function WatcherDot({ state }: Readonly<{ state: ConnectionState }>) {
  const recipe = CONNECTION_STATES[state];
  return (
    <span className="pc-watcher" role="status" aria-label={recipe.dotLabel}>
      <span className="pc-watcher__dot" data-dot={recipe.dot} aria-hidden="true" />
      <span className="pc-watcher__label">{recipe.dotLabel}</span>
    </span>
  );
}

// ---------------------------------------------------------------- theme

type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'op-theme';
const NEXT_THEME: Readonly<Record<ThemeChoice, ThemeChoice>> = Object.freeze({
  system: 'light',
  light: 'dark',
  dark: 'system',
});
const THEME_ICON: Readonly<Record<ThemeChoice, PcIconName>> = Object.freeze({
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
});

function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // localStorage can throw (private mode); fall through to the system default.
  }
  return 'system';
}

function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Cycles the theme system → light → dark and persists the choice. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    const stored = readStoredTheme();
    setChoice(stored);
    applyTheme(stored);
  }, []);
  return (
    <IconButton
      icon={THEME_ICON[choice]}
      label={`Theme: ${choice}. Switch to ${NEXT_THEME[choice]}.`}
      size="sm"
      onClick={() => {
        const next = NEXT_THEME[choice];
        setChoice(next);
        applyTheme(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // localStorage can throw (private mode); the in-memory choice still applies.
        }
      }}
    />
  );
}

// ---------------------------------------------------------------- top bar

export type TopBarProps = Readonly<{
  projectName?: string;
  showSubject?: boolean;
  route: ParsedDashboardRoute;
  connectionState: ConnectionState;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onOpenPalette: () => void;
}>;

/** Breadcrumb, palette field, connection chips, theme and inspector controls. */
export function TopBar({
  projectName,
  showSubject = false,
  route,
  connectionState,
  inspectorOpen,
  onToggleInspector,
  onOpenPalette,
}: TopBarProps) {
  const definition = dashboardRouteDefinition(route);
  const product = route.product ?? 'system';
  const subject = !showSubject || route.kind === 'not-found' ? null : route.subjectId;
  return (
    <header className="pc-topbar">
      {projectName ? (
        <span className="pc-topbar__crumb" title={projectName}>
          {projectName}
        </span>
      ) : null}
      <span className="pc-topbar__crumb">{product}</span>
      <PcIcon name="chevron-right" size={12} color="var(--pc-text-tertiary)" />
      <span className="pc-topbar__view">{definition?.label ?? 'Closed route'}</span>
      {subject ? (
        <>
          <PcIcon name="chevron-right" size={12} color="var(--pc-text-tertiary)" />
          <span className="pc-topbar__subject" title={subject}>
            {subject}
          </span>
        </>
      ) : null}
      <button
        type="button"
        className="pc-topbar__palette"
        onClick={onOpenPalette}
        aria-label="Open the command palette"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <PcIcon name="search" size={13} />
        <span className="pc-topbar__placeholder">Jump to a view or an artifact…</span>
        <span className="pc-rail__keys">
          <Kbd size="sm">⌘</Kbd>
          <Kbd size="sm">K</Kbd>
        </span>
      </button>
      <output className="pc-topbar__end" aria-live="polite">
        {connectionState !== 'read-only' ? <ConnectionChip state={connectionState} /> : null}
        <ConnectionChip state="read-only" />
      </output>
      <ThemeToggle />
      <IconButton
        icon={inspectorOpen ? 'panel-right-close' : 'panel-left-close'}
        label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        size="sm"
        active={inspectorOpen}
        onClick={onToggleInspector}
      />
    </header>
  );
}

// ---------------------------------------------------------------- status bar

export type StatusBarProps = Readonly<{
  branch: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  connectionState: ConnectionState;
  buildId: string;
}>;

export function StatusBar({
  branch,
  nodeCount,
  edgeCount,
  connectionState,
  buildId,
}: StatusBarProps) {
  return (
    <footer className="pc-statusbar">
      <span className="pc-statusbar__item">
        <PcIcon name="git-branch" size={11} />
        <span className="pc-statusbar__text">{branch ?? <Absent>no branch</Absent>}</span>
      </span>
      <span className="pc-statusbar__item">
        <span className="pc-statusbar__text">
          {nodeCount === null
            ? 'graph not read'
            : `${nodeCount} nodes · ${edgeCount === null ? '—' : edgeCount} edges`}
        </span>
      </span>
      <WatcherDot state={connectionState} />
      <span className="pc-statusbar__end" title="Served build">
        <span className="pc-statusbar__text">{buildId}</span>
      </span>
    </footer>
  );
}

// ---------------------------------------------------------------- inspector

const SKELETON_FIELDS = Object.freeze(['type', 'sprintId', 'updated', 'dependsOn', 'ref']);

export type InspectorProps = Readonly<{
  mode: 'skeleton' | 'stub' | 'selection';
  selection: InspectorSelection;
  floating: boolean;
}>;

function navigateTo(href: string): void {
  if (typeof window !== 'undefined') window.location.hash = href;
}

/**
 * The global inspector reads the same graph the plane does. While that read is in flight
 * it shows the shape of an artifact, never a resolved one.
 */
export function Inspector({ mode, selection, floating }: InspectorProps) {
  return (
    <aside
      className="pc-shell-inspector"
      data-floating={floating || undefined}
      aria-label="Inspector"
    >
      {mode === 'skeleton' ? (
        <>
          <div className="pc-shell-inspector__head">
            <Skeleton w={92} h={18} radius="var(--pc-radius-xs)" />
            <Skeleton w={64} h={14} />
          </div>
          <Skeleton h={16} />
          <Skeleton w="72%" h={16} />
          <div className="pc-shell-inspector__skeleton">
            {SKELETON_FIELDS.map((field, index) => (
              <div key={field} className="pc-shell-inspector__skeleton-row">
                <span>{field}</span>
                <Skeleton h={12} delay={index * 60} />
              </div>
            ))}
          </div>
        </>
      ) : mode === 'stub' ? (
        <div className="pc-shell-inspector__stub">
          <span className="pc-shell-inspector__id">inspector</span>
          <p>
            No artifact has been read. The schema on disk is a version this build does not parse.
          </p>
        </div>
      ) : selection === null ? (
        <EmptyState
          icon="square-dashed"
          title="Nothing selected"
          description="Pick a row in a table or a node in the graph to read it here."
        />
      ) : selection.kind === 'action' ? (
        <div className="pc-shell-inspector__content" aria-live="polite">
          <div className="pc-shell-inspector__head">
            <span className="pc-shell-inspector__id">{selection.actionId}</span>
            <StateBadge state={selection.state} size="sm" />
          </div>
          <h2 className="pc-shell-inspector__title">{selection.title}</h2>
          <div className="pc-shell-inspector__metadata">
            <Field label="Revision" mono>
              {selection.revision}
            </Field>
            <Field label="Route" mono>
              {selection.route ?? <Absent />}
            </Field>
            <Field label="Executions" mono>
              {selection.executions > 0 ? selection.executions : <Absent>none</Absent>}
            </Field>
            <Field label="Deep link" mono>
              {selection.deepLink ?? <Absent />}
            </Field>
          </div>
          {selection.href ? (
            <Button
              variant="secondary"
              size="sm"
              iconAfter="arrow-right"
              onClick={() => navigateTo(selection.href as string)}
            >
              Open action
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="pc-shell-inspector__content" aria-live="polite">
          <div className="pc-shell-inspector__head">
            <WorkItemChip type={selection.type} id={selection.id} />
            <ArtifactStatus status={selection.status} size="sm" />
          </div>
          <h2 className="pc-shell-inspector__title">{selection.title}</h2>
          <div className="pc-shell-inspector__metadata">
            <Field label="Type" mono>
              {selection.type}
            </Field>
            <Field label="Sprint" mono>
              {selection.sprintId ?? <Absent />}
            </Field>
            <Field label="Updated" mono>
              {selection.updated ?? <Absent />}
            </Field>
            <Field label="Dependencies" mono>
              {selection.dependsOn.length > 0 ? selection.dependsOn.join(', ') : <Absent />}
            </Field>
            <Field label="Reference" mono>
              {selection.ref ?? <Absent />}
            </Field>
          </div>
          {selection.href ? (
            <Button
              variant="secondary"
              size="sm"
              iconAfter="arrow-right"
              onClick={() => navigateTo(selection.href as string)}
            >
              Open artifact
            </Button>
          ) : null}
        </div>
      )}
    </aside>
  );
}
