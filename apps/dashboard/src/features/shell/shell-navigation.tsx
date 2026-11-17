import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { DashboardConnection } from '../../app/providers.js';
import {
  DASHBOARD_ROUTE_DEFINITIONS,
  type DashboardProduct,
  type DashboardRouteDefinition,
  type DashboardRouteKind,
  dashboardRouteDefinition,
  type ParsedDashboardRoute,
  parseDashboardRoute,
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
import { useCopyFeedback } from '../../design-system/components/use-copy-feedback.js';
import type { InspectorSelection } from './inspector-selection.js';
import './console-shell.css';

type ConnectionState = DashboardConnection['state'];

const NAVIGATION_PALETTE_LABEL = 'Search or run';
const TOPBAR_PALETTE_LABEL = 'Jump to a view or an artifact…';
/** Shell slot a route may portal its own place tabs into; empty and hidden otherwise. */
export const TOPBAR_ROUTE_TABS_ID = 'topbar-route-tabs';
/** Shell slot beside the view name for a route's item count; empty and hidden otherwise. */
export const TOPBAR_ROUTE_COUNT_ID = 'topbar-route-count';

/** Changes whenever the shell swaps the element that owns its route slots. */
export const RouteSlotLayout = createContext('document');

/** Renders children into a shell route slot, following it between the phone and floating shells. */
export function TopBarPortal({ slotId, children }: { slotId: string; children: ReactNode }) {
  const layout = useContext(RouteSlotLayout);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a layout change replaces the slot element.
  useLayoutEffect(() => setSlot(document.getElementById(slotId)), [slotId, layout]);
  return slot ? createPortal(children, slot) : null;
}

function BrandMark({ className, size }: { className: string; size: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
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
  );
}

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

export function MobileNavigation({
  product,
  route,
  operateAvailable,
}: Readonly<{
  product: DashboardProduct;
  route: ParsedDashboardRoute;
  operateAvailable: boolean;
}>) {
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
      <MoreMenu
        productLabel={productLabel}
        route={route}
        sections={secondary}
        summaryClassName="pc-mobile-nav__item"
      />
    </nav>
  );
}

/** The More sheet: every destination the visible navigation leaves out, plus the shell utilities. */
function MoreMenu({
  productLabel,
  route,
  sections,
  summaryClassName,
}: Readonly<{
  productLabel: string;
  route: ParsedDashboardRoute;
  sections: readonly RailSection[];
  summaryClassName: string;
}>) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes the secondary sheet.
  useEffect(() => setMoreOpen(false), [route.kind]);
  return (
    <details
      className="pc-mobile-more"
      open={moreOpen}
      onToggle={(event) => setMoreOpen(event.currentTarget.open)}
    >
      <summary
        className={summaryClassName}
        aria-label={`More ${productLabel} destinations`}
        aria-controls={moreId}
      >
        <PcIcon name="layers" size={16} />
        <span>More</span>
      </summary>
      <div className="pc-mobile-more__sheet" id={moreId}>
        <div id="mobile-shell-controls" className="pc-mobile-more__controls" />
        {sections.map((section) => (
          <section
            className="pc-mobile-more__section"
            key={section.label}
            aria-label={section.label}
          >
            <div className="pc-chrome-label">{section.label}</div>
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
  );
}

export type NavigationDestination = Readonly<{
  kind: DashboardRouteKind;
  icon: PcIconName;
  label: string;
  href: string;
  current: boolean;
}>;
export type NavigationSection = Readonly<{
  label: string;
  items: readonly NavigationDestination[];
}>;

/** Every Plan, Operate and Reference destination, marking the one the route belongs to. */
export function navigationSections(route: ParsedDashboardRoute): readonly NavigationSection[] {
  return [
    ...PLANNING_SECTIONS,
    { label: 'Operate', items: OPERATE_SECTIONS[0]?.items ?? [] },
    ...OPERATE_SECTIONS.slice(1),
    { label: 'Reference', items: REFERENCE_ITEMS },
  ].map((section) => ({
    label: section.label,
    items: section.items.flatMap((item) => {
      const definition = DEFINITION_BY_KIND.get(item.kind);
      return definition
        ? [
            {
              kind: item.kind,
              icon: item.icon,
              label: definition.label,
              href: definition.href,
              current: navigationIsCurrent(definition, route),
            },
          ]
        : [];
    }),
  }));
}

/** The floating navigation panel's body: palette launcher, then each section with counts. */
export function NavigationSections({
  route,
  counts,
  onOpenPalette,
  paletteKeys,
}: Readonly<{
  route: ParsedDashboardRoute;
  counts?: Partial<Record<DashboardRouteKind, number>>;
  onOpenPalette: () => void;
  paletteKeys: string;
}>) {
  return (
    <div>
      <button
        type="button"
        className="canvas-chrome-menu-item"
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <PcIcon name="search" size={15} />
        <span>{NAVIGATION_PALETTE_LABEL}</span>
        <Kbd>{paletteKeys}</Kbd>
      </button>
      {navigationSections(route).map((section) => (
        <section key={section.label} aria-label={section.label}>
          <div className="pc-chrome-label">{section.label}</div>
          {section.items.map((item) => {
            const count = counts?.[item.kind];
            return (
              <a
                key={item.kind}
                className="pc-nav-item"
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
              >
                <PcIcon name={item.icon} size={16} />
                <span>{item.label}</span>
                {count === undefined ? null : <Kbd>{count}</Kbd>}
              </a>
            );
          })}
        </section>
      ))}
    </div>
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

export function ConnectionChip({
  state,
  compact = false,
  labelHidden = false,
}: Readonly<{ state: ConnectionState; compact?: boolean; labelHidden?: boolean }>) {
  const recipe = CONNECTION_STATES[state];
  const live = state === 'connected' || state === 'read-only';
  const label =
    state === 'booting'
      ? null
      : live
        ? compact
          ? 'Live'
          : 'Live · watching .planr/'
        : recipe.label;
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
      {labelHidden && label !== null ? <span className="pc-visually-hidden">{label}</span> : label}
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

/** The current theme choice, cycling system, light and dark through the injected adapter. */
export function useThemeChoice(preference?: ThemePreferenceAdapter) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const current =
      typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');
    return current === 'system' || current === 'light' || current === 'dark'
      ? current
      : (preference?.initialChoice ?? 'system');
  });
  const [storageError, setStorageError] = useState(preference?.initialStorageError ?? false);
  const cycle = () => {
    const next = NEXT_THEME[choice];
    setChoice(next);
    applyTheme(next);
    try {
      preference?.save(next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  return { choice, next: NEXT_THEME[choice], icon: THEME_ICON[choice], storageError, cycle };
}

export const THEME_STORAGE_ERROR = 'Theme preference could not be saved in this browser.';

export function ThemeToggle({ preference }: Readonly<{ preference?: ThemePreferenceAdapter }>) {
  const theme = useThemeChoice(preference);
  return (
    <>
      <IconButton
        icon={theme.icon}
        label={`Theme: ${theme.choice}. Switch to ${theme.next}.`}
        size="sm"
        onClick={theme.cycle}
      />
      {theme.storageError && <span role="status">{THEME_STORAGE_ERROR}</span>}
    </>
  );
}

// ---------------------------------------------------------------- top bar

export type TopBarProps = Readonly<{
  projectName?: string;
  themePreference?: ThemePreferenceAdapter;
  shortcutHelp?: ReactNode;
  detailTrail?: DetailTrail | null;
  onCopy?: (text: string) => Promise<void>;
  route: ParsedDashboardRoute;
  connectionState: ConnectionState;
  inspectorOpen: boolean;
  inspectorAvailable?: boolean;
  onToggleInspector: () => void;
  onOpenPalette: () => void;
}>;

/** Crumbs after the product on a detail route: where it was opened from, its spec, its ID. */
export type DetailTrail = Readonly<{
  origin: string;
  spec: Readonly<{ label: string; href: string }> | null;
  current: string;
  tag: string | null;
  link: string | null;
}>;

/** The narrow Detail header: back to where it was opened from, its ID, and Copy link. */
function DetailHeader({
  trail,
  onCopy,
  children,
}: {
  trail: DetailTrail;
  onCopy?: (text: string) => Promise<void>;
  children?: ReactNode;
}) {
  const feedback = useCopyFeedback(trail.link ?? '', !trail.link, onCopy);
  const origin = dashboardRouteDefinition(parseDashboardRoute(trail.origin))?.label ?? 'List';
  return (
    <div className="pc-topbar__detail">
      <a className="pc-topbar__back" href={trail.origin} aria-label={`Back to ${origin}`}>
        <PcIcon name="chevron-left" size={18} />
      </a>
      <span
        className="pc-topbar__detail-id"
        aria-current="page"
        style={trail.tag ? { color: `var(--pc-type-${trail.tag})` } : undefined}
      >
        {trail.current}
      </span>
      {children}
      {trail.link ? (
        <button
          type="button"
          className="pc-topbar__copy-link"
          aria-label="Copy link"
          title={feedback.error || undefined}
          data-state={feedback.state}
          onClick={() => void feedback.copy()}
        >
          <PcIcon name={feedback.state === 'copied' ? 'check' : 'link'} size={18} />
        </button>
      ) : null}
      <span className="pc-visually-hidden" aria-live="polite" aria-atomic="true">
        {feedback.message}
        {feedback.error ? `: ${feedback.error}` : ''}
      </span>
    </div>
  );
}

/** The phone top bar: view title, Live and search; the remaining utilities live in More. */
export function TopBar({
  projectName,
  themePreference,
  shortcutHelp,
  detailTrail = null,
  onCopy,
  route,
  connectionState,
  inspectorOpen,
  inspectorAvailable = true,
  onToggleInspector,
  onOpenPalette,
}: TopBarProps) {
  const definition = dashboardRouteDefinition(route);
  const product = route.product ?? 'system';
  const [mobileControls, setMobileControls] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setMobileControls(document.getElementById('mobile-shell-controls'));
  }, []);
  const utilities = (
    <div className="pc-topbar__utilities">
      <CapabilityChip product={product} />
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
  );
  const controls = mobileControls ? createPortal(utilities, mobileControls) : null;
  if (detailTrail)
    return (
      <header className="pc-topbar" data-product={product} data-detail-header>
        <DetailHeader trail={detailTrail} onCopy={onCopy} />
        {controls}
      </header>
    );
  return (
    <header className="pc-topbar" data-product={product}>
      <div className="pc-topbar__breadcrumbs">
        <BrandMark className="pc-topbar__logo" size={24} />
        <span className="pc-topbar__view" title={projectName}>
          {definition?.label ?? 'Closed route'}
        </span>
        <span id={TOPBAR_ROUTE_COUNT_ID} className="pc-topbar__count" aria-hidden="true" />
        <div id={TOPBAR_ROUTE_TABS_ID} className="pc-topbar__route-tabs" />
      </div>
      <button
        type="button"
        className="pc-topbar__palette"
        aria-label={TOPBAR_PALETTE_LABEL}
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <PcIcon name="search" size={15} />
      </button>
      <div className="pc-topbar__actions">
        <output className="pc-topbar__end" aria-live="polite">
          <ConnectionChip state={connectionState} compact />
        </output>
        {controls}
      </div>
    </header>
  );
}

/** Read-only in Plan, governed actions in Operate, with the rule behind each in a tooltip. */
export function CapabilityChip({
  product,
  iconOnly = false,
}: Readonly<{ product: DashboardProduct | 'system'; iconOnly?: boolean }>) {
  const label = product === 'operate' ? 'Governed actions' : 'Read-only';
  return (
    <Tooltip
      content={
        product === 'operate'
          ? 'Operate actions require confirmation and an authorized command gateway. Receipts record every governed change.'
          : 'Plan is read-only. Planning commands copy a continuation without changing project files.'
      }
    >
      <button type="button" className="pc-conn" aria-label={iconOnly ? label : undefined}>
        <PcIcon name={product === 'operate' ? 'shield' : 'lock'} size={13} />
        {iconOnly ? null : <span className="pc-capability-label">{label}</span>}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- inspector

const SKELETON_FIELDS = Object.freeze(['type', 'sprintId', 'updated', 'dependsOn', 'ref']);

export type InspectorProps = Readonly<{
  mode: 'skeleton' | 'stub' | 'selection';
  selection: InspectorSelection;
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
export function InspectorContent({
  mode,
  selection,
  onPromote,
  planningContent,
}: Pick<InspectorProps, 'mode' | 'selection' | 'onPromote' | 'planningContent'>) {
  return (
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
}

/** The phone inspector: a full-height sheet over the current route. */
export function Inspector({
  mode,
  selection,
  modal = true,
  onClose,
  onRestoreFocus,
  onPromote,
  planningContent,
}: InspectorProps) {
  const opener = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  if (selection === null) return null;
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
      <div className="pc-shell-inspector__content">
        <InspectorContent
          mode={mode}
          selection={selection}
          onPromote={onPromote}
          planningContent={planningContent}
        />
      </div>
    </InspectorSheet>
  );
}
