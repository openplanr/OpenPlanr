import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
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
  Inspector as InspectorSheet,
  Kbd,
  PcIcon,
  type PcIconName,
  Skeleton,
  StateBadge,
  Tooltip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { InspectorSelection } from './inspector-selection.js';
import './console-shell.css';

type ConnectionState = DashboardConnection['state'];

const RAIL_PALETTE_LABEL = 'Search or jump';
const TOPBAR_PALETTE_LABEL = 'Jump to a view or an artifact…';

// ---------------------------------------------------------------- rail

type RailItem = Readonly<{ kind: DashboardRouteKind; icon: PcIconName }>;
type RailSection = Readonly<{ label: string; items: readonly RailItem[] }>;

const PLANNING_SECTIONS: readonly RailSection[] = Object.freeze([
  {
    label: 'Plan',
    items: [
      { kind: 'planning.overview', icon: 'house' },
      { kind: 'planning.list', icon: 'list' },
      { kind: 'planning.graph', icon: 'workflow' },
      { kind: 'planning.board', icon: 'columns-3' },
      { kind: 'planning.sprints', icon: 'calendar-range' },
      { kind: 'planning.activity', icon: 'activity' },
      { kind: 'planning.search', icon: 'search' },
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

export function defaultCompactRail(route: ParsedDashboardRoute): boolean {
  return ['planning.graph', 'planning.board', 'planning.sprints', 'planning.activity'].includes(
    route.kind,
  );
}

function RailLink({
  item,
  route,
  count,
  compact = false,
}: Readonly<{ item: RailItem; route: ParsedDashboardRoute; count?: number; compact?: boolean }>) {
  const definition = DEFINITION_BY_KIND.get(item.kind);
  if (!definition) return null;
  return (
    <a
      className="pc-rail__item"
      aria-label={compact ? definition.label : undefined}
      title={definition.label}
      href={definition.href}
      aria-current={navigationIsCurrent(definition, route) ? 'page' : undefined}
    >
      <PcIcon name={item.icon} size={16} />
      <span>{definition.label}</span>
      {count === undefined ? null : <span className="pc-rail__count">{count}</span>}
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
      aria-label={definition.label}
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
  const moreId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes the secondary sheet.
  useEffect(() => setMoreOpen(false), [route.kind]);
  const primary: readonly RailItem[] = [
    { kind: 'planning.overview', icon: 'house' },
    { kind: 'planning.list', icon: 'list' },
    { kind: 'planning.activity', icon: 'activity' },
  ];
  const secondary: readonly RailSection[] = [
    {
      label: 'Plan',
      items: (PLANNING_SECTIONS[0]?.items ?? []).filter(
        (item) => !primary.some((destination) => destination.kind === item.kind),
      ),
    },
    {
      label: 'Operate',
      items: (OPERATE_SECTIONS[0]?.items ?? []).filter((item) => item.kind !== 'operate.today'),
    },
    { label: 'Record', items: OPERATE_SECTIONS[1]?.items ?? [] },
    { label: 'Reference', items: REFERENCE_ITEMS },
  ];
  const productLabel = product === 'operate' ? 'Operate' : 'Planning';
  return (
    <nav className="pc-mobile-nav" aria-label={`Mobile ${productLabel} navigation`}>
      {primary.map((item) => (
        <MobileRailLink key={item.kind} item={item} route={route} />
      ))}
      <a
        className="pc-mobile-nav__item"
        href="#/operate/today"
        aria-current={product === 'operate' ? 'page' : undefined}
        data-unavailable={!operateAvailable || undefined}
        title={
          !operateAvailable
            ? 'Local reviews available; actions require a command gateway'
            : undefined
        }
      >
        <PcIcon name="gauge" size={16} />
        <span>Operate</span>
      </a>
      <details
        className="pc-mobile-more"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary
          className="pc-mobile-nav__item"
          aria-label={`More ${productLabel} destinations`}
          aria-controls={moreId}
        >
          <PcIcon name="layers" size={16} />
          <span>More</span>
        </summary>
        <div className="pc-mobile-more__sheet" id={moreId}>
          {secondary.map((section) => (
            <section
              className="pc-mobile-more__section"
              key={section.label}
              aria-label={section.label}
            >
              <div className="pc-rail__label">{section.label}</div>
              {section.items.map((item) => (
                <MobileRailLink
                  key={item.kind}
                  item={item}
                  route={route}
                  onNavigate={() => setMoreOpen(false)}
                />
              ))}
            </section>
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
  compact?: boolean;
  onToggleCompact?: () => void;
  preferenceError?: string | null;
  counts?: Partial<Record<DashboardRouteKind, number>>;
  branch?: string | null;
}>;

export function NavRail({
  product,
  route,
  operateAvailable,
  onOpenPalette,
  compact = defaultCompactRail(route),
  onToggleCompact,
  preferenceError,
  counts,
  branch = null,
}: NavRailProps) {
  const detailRoute = route.kind === 'planning.detail' || route.kind === 'planning.spec';
  const sections = compact
    ? product === 'operate'
      ? OPERATE_SECTIONS
      : PLANNING_SECTIONS.map((section) => ({
          ...section,
          items: section.items.filter((item) => item.kind !== 'planning.search'),
        }))
    : [
        ...PLANNING_SECTIONS,
        { label: 'Operate', items: OPERATE_SECTIONS[0]?.items ?? [] },
        ...OPERATE_SECTIONS.slice(1),
      ];
  return (
    <>
      {!detailRoute ? (
        <nav
          className="pc-rail"
          data-compact={compact || undefined}
          aria-label="Dashboard navigation"
        >
          <div className="pc-rail__brand">
            <svg
              className="pc-rail__tile"
              width="28"
              height="28"
              viewBox="0 0 160 160"
              aria-hidden="true"
            >
              <g transform="rotate(-45 80 80)">
                <path
                  d="M125 50A52 52 0 1 0 125 110"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <rect x="127" y="71" width="18" height="18" rx="3" fill="currentColor" />
              </g>
            </svg>
            <div className="pc-rail__identity">
              <span className="pc-rail__wordmark">OpenPlanr</span>
              <span className="pc-rail__branch">
                {branch === null ? null : `${branch} · .planr/`}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="pc-rail__palette"
            onClick={onOpenPalette}
            aria-keyshortcuts="Meta+K Control+K"
            aria-label={compact ? RAIL_PALETTE_LABEL : undefined}
          >
            <PcIcon name="search" size={15} />
            {!compact ? (
              <>
                <span>{RAIL_PALETTE_LABEL}</span>
                <span className="pc-rail__keys">
                  <Kbd>⌘K</Kbd>
                </span>
              </>
            ) : null}
          </button>
          <div className="pc-rail__sections">
            {sections.map((section) => (
              <section className="pc-rail__section" key={section.label} aria-label={section.label}>
                <div className="pc-rail__label">{section.label}</div>
                <div className="pc-rail__items">
                  {section.items.map((item) => (
                    <RailLink
                      key={item.kind}
                      item={item}
                      route={route}
                      count={counts?.[item.kind]}
                      compact={compact}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="pc-rail__footer">
            {onToggleCompact ? (
              <button
                type="button"
                className="pc-rail__toggle"
                aria-label={compact ? 'Expand navigation' : 'Collapse navigation'}
                aria-expanded={!compact}
                onClick={onToggleCompact}
                title={compact ? 'Expand navigation' : 'Collapse navigation'}
              >
                <PcIcon name={compact ? 'chevron-right' : 'chevron-left'} size={14} />
                <span>{compact ? 'Expand navigation' : 'Collapse navigation'}</span>
              </button>
            ) : null}
            {preferenceError ? (
              <p role="status" className="pc-rail__preference-error">
                {preferenceError}
              </p>
            ) : null}
            {!compact &&
              REFERENCE_ITEMS.map((item) => <RailLink key={item.kind} item={item} route={route} />)}
          </div>
        </nav>
      ) : null}
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
  const live = state === 'connected' || state === 'read-only';
  return (
    <span
      className="pc-conn pc-conn--watcher"
      data-tone={recipe.tone}
      title={`connection: ${recipe.label}`}
    >
      {live ? (
        <span className="pc-conn__dot" aria-hidden="true" />
      ) : (
        <PcIcon name={recipe.icon} size={13} spin={state === 'booting'} />
      )}
      {state === 'booting' ? null : live ? 'Live · watching .planr/' : recipe.label}
    </span>
  );
}

export function WatcherDot({
  state,
  compact = false,
}: Readonly<{ state: ConnectionState; compact?: boolean }>) {
  const recipe = CONNECTION_STATES[state];
  return (
    <span className="pc-watcher" role="status" aria-label={recipe.dotLabel}>
      <span className="pc-watcher__dot" data-dot={recipe.dot} aria-hidden="true" />
      <span className="pc-watcher__label" aria-hidden="true">
        {state === 'booting'
          ? null
          : !compact
            ? recipe.dotLabel
            : state === 'connected' || state === 'read-only'
              ? 'Live'
              : state === 'incompatible'
                ? 'Stopped'
                : recipe.label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- theme

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ThemePreferenceAdapter = Readonly<{
  initialChoice: ThemeChoice;
  initialStorageError?: boolean;
  save: (choice: ThemeChoice) => void;
}>;
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

function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute('data-theme', choice);
}

export function ThemeToggle({ preference }: Readonly<{ preference?: ThemePreferenceAdapter }>) {
  const [choice, setChoice] = useState<ThemeChoice>(preference?.initialChoice ?? 'system');
  const [storageError, setStorageError] = useState(preference?.initialStorageError ?? false);
  return (
    <>
      <IconButton
        icon={THEME_ICON[choice]}
        label={`Theme: ${choice}. Switch to ${NEXT_THEME[choice]}.`}
        size="sm"
        onClick={() => {
          const next = NEXT_THEME[choice];
          setChoice(next);
          applyTheme(next);
          try {
            preference?.save(next);
            setStorageError(false);
          } catch {
            setStorageError(true);
          }
        }}
      />
      {storageError && (
        <span role="status">Theme preference could not be saved in this browser.</span>
      )}
    </>
  );
}

// ---------------------------------------------------------------- top bar

export type TopBarProps = Readonly<{
  projectName?: string;
  themePreference?: ThemePreferenceAdapter;
  paletteIconOnly?: boolean;
  shortcutHelp?: ReactNode;
  showSubject?: boolean;
  route: ParsedDashboardRoute;
  connectionState: ConnectionState;
  inspectorOpen: boolean;
  inspectorAvailable?: boolean;
  onToggleInspector: () => void;
  onOpenPalette: () => void;
}>;

/** Breadcrumb, palette field, connection chips, theme and inspector controls. */
export function TopBar({
  projectName,
  themePreference,
  paletteIconOnly = false,
  shortcutHelp,
  showSubject = false,
  route,
  connectionState,
  inspectorOpen,
  inspectorAvailable = true,
  onToggleInspector,
  onOpenPalette,
}: TopBarProps) {
  const definition = dashboardRouteDefinition(route);
  const product = route.product ?? 'system';
  const subject = !showSubject || route.kind === 'not-found' ? null : route.subjectId;
  return (
    <header className="pc-topbar" data-product={product}>
      <div className="pc-topbar__breadcrumbs">
        <span className="pc-topbar__crumb" title={projectName}>
          {product === 'planning' ? 'Plan' : product === 'operate' ? 'Operate' : 'Reference'}
        </span>
        <span className="pc-topbar__separator" aria-hidden="true">
          /
        </span>
        <span className="pc-topbar__view">{definition?.label ?? 'Closed route'}</span>
        {subject ? (
          <>
            <span className="pc-topbar__separator" aria-hidden="true">
              /
            </span>
            <span className="pc-topbar__subject" title={subject}>
              {subject}
            </span>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="pc-topbar__palette"
        aria-label={paletteIconOnly ? TOPBAR_PALETTE_LABEL : undefined}
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <PcIcon name="search" size={15} />
        {!paletteIconOnly ? (
          <>
            <span className="pc-topbar__placeholder">{TOPBAR_PALETTE_LABEL}</span>
            <span className="pc-rail__keys">
              <Kbd>⌘K</Kbd>
            </span>
          </>
        ) : null}
      </button>
      <div className="pc-topbar__actions">
        <output className="pc-topbar__end" aria-live="polite">
          <ConnectionChip state={connectionState} />
          <Tooltip
            content={
              product === 'operate'
                ? 'Operate actions require confirmation and an authorized command gateway. Receipts record every governed change.'
                : 'Plan is read-only. Planning commands copy a continuation without changing project files.'
            }
          >
            <button type="button" className="pc-conn">
              <PcIcon name={product === 'operate' ? 'shield' : 'lock'} size={13} />
              <span className="pc-capability-label">
                {product === 'operate' ? 'Governed actions' : 'Read-only'}
              </span>
            </button>
          </Tooltip>
        </output>
        {shortcutHelp}
        <ThemeToggle preference={themePreference} />
        <span data-inspector-toggle style={{ display: 'contents' }}>
          <IconButton
            icon={inspectorOpen ? 'panel-right-close' : 'panel-left-close'}
            label={
              inspectorOpen
                ? 'Hide inspector'
                : inspectorAvailable
                  ? 'Show inspector'
                  : 'Show inspector: select an item first'
            }
            disabled={!inspectorAvailable}
            size="sm"
            active={inspectorOpen}
            onClick={onToggleInspector}
          />
        </span>
      </div>
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
  compact?: boolean;
}>;

export function StatusBar({
  branch,
  nodeCount,
  edgeCount,
  connectionState,
  buildId,
  compact,
}: StatusBarProps) {
  return (
    <footer className="pc-statusbar">
      <span className="pc-statusbar__item pc-statusbar__item--branch">
        <PcIcon name="git-branch" size={13} />
        <span className="pc-statusbar__text">{branch}</span>
      </span>
      <span className="pc-statusbar__item pc-statusbar__item--totals">
        <span className="pc-statusbar__text">
          {nodeCount === null || edgeCount === null
            ? null
            : `${nodeCount} nodes · ${edgeCount} edges`}
        </span>
      </span>
      <WatcherDot state={connectionState} compact={compact} />
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
  modal?: boolean;
  onClose?: () => void;
  onRestoreFocus?: () => void;
  onPromote?: (href: string) => void;
  planningContent?: ReactNode;
}>;

function navigateTo(href: string): void {
  if (typeof window !== 'undefined') window.location.hash = href;
}

/**
 * The global inspector reads the same graph the plane does. While that read is in flight
 * it shows the shape of an artifact, never a resolved one.
 */
export function Inspector({
  mode,
  selection,
  floating,
  modal = true,
  onClose,
  onRestoreFocus,
  onPromote,
  planningContent,
}: InspectorProps) {
  const opener = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  if (floating && selection === null) return null;

  const content = (
    <>
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
              onClick={() => (onPromote ?? navigateTo)(selection.href as string)}
            >
              Open action
            </Button>
          ) : null}
        </div>
      ) : planningContent ? (
        planningContent
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
              onClick={() => (onPromote ?? navigateTo)(selection.href as string)}
            >
              Open artifact
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
  if (floating) {
    return (
      <InspectorSheet
        open
        modal={modal}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
        onRestoreFocus={onRestoreFocus ?? (() => opener.current?.focus({ preventScroll: true }))}
        title="Inspector"
        description="Selected item details. Open the item to continue on its full page."
      >
        <div className="pc-shell-inspector__content">{content}</div>
      </InspectorSheet>
    );
  }
  return (
    <aside className="pc-shell-inspector" aria-label="Inspector">
      <div className="pc-shell-inspector__controls">
        {onClose ? (
          <IconButton icon="x" label="Close inspector" size="sm" onClick={onClose} />
        ) : null}
      </div>
      {content}
    </aside>
  );
}
