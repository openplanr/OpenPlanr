export type DashboardProduct = 'planning' | 'operate';

export const DASHBOARD_COMMAND_PALETTE_SHORTCUT = 'Meta+K Control+K';

type CollectionRoute<Product extends DashboardProduct> = {
  product: Product;
  subjectId: null;
};

type DetailRoute<Product extends DashboardProduct> = {
  product: Product;
  subjectId: string;
};

type ReviewRoute = {
  product: 'operate';
  subjectId: string;
  cycleId: string;
  kind: 'operate.review';
};

type SystemRoute = {
  product: null;
  subjectId: null;
  kind: 'system.diagnostics';
};

export type DashboardRoute =
  | (CollectionRoute<'planning'> & { kind: 'planning.overview' })
  | (CollectionRoute<'planning'> & { kind: 'planning.graph' })
  | (CollectionRoute<'planning'> & { kind: 'planning.board' })
  | (CollectionRoute<'planning'> & { kind: 'planning.list' })
  | (CollectionRoute<'planning'> & { kind: 'planning.sprints' })
  | (CollectionRoute<'planning'> & { kind: 'planning.activity' })
  | (CollectionRoute<'planning'> & { kind: 'planning.search' })
  | (CollectionRoute<'planning'> & { kind: 'planning.console' })
  | (DetailRoute<'planning'> & { kind: 'planning.detail' })
  | (DetailRoute<'planning'> & { kind: 'planning.spec' })
  | (CollectionRoute<'operate'> & { kind: 'operate.today' })
  | (CollectionRoute<'operate'> & { kind: 'operate.cycles' })
  | (DetailRoute<'operate'> & { kind: 'operate.cycle' })
  | ReviewRoute
  | (CollectionRoute<'operate'> & { kind: 'operate.inbox' })
  | (DetailRoute<'operate'> & { kind: 'operate.inbox-item' })
  | (CollectionRoute<'operate'> & { kind: 'operate.actions' })
  | (DetailRoute<'operate'> & { kind: 'operate.action' })
  | (DetailRoute<'operate'> & { kind: 'operate.action-planning' })
  | (CollectionRoute<'operate'> & { kind: 'operate.evidence' })
  | (DetailRoute<'operate'> & { kind: 'operate.evidence-item' })
  | (CollectionRoute<'operate'> & { kind: 'operate.outcomes' })
  | (DetailRoute<'operate'> & { kind: 'operate.outcome' })
  | (CollectionRoute<'operate'> & { kind: 'operate.history' })
  | (CollectionRoute<'operate'> & { kind: 'operate.recovery' })
  | SystemRoute;

export type UnknownDashboardRoute = {
  kind: 'not-found';
  product: null;
  subjectId: null;
};

export type ParsedDashboardRoute = DashboardRoute | UnknownDashboardRoute;

export type DashboardRouteKind = DashboardRoute['kind'];

export type DashboardRouteDefinition = Readonly<{
  kind: DashboardRouteKind;
  product: DashboardProduct | null;
  label: string;
  description: string;
  href: string;
  navigation: 'primary' | 'contextual' | 'hidden';
}>;

const ROUTE_DEFINITIONS = [
  {
    kind: 'planning.overview',
    product: 'planning',
    label: 'Overview',
    description: 'Project progress and the highest planning attention.',
    href: '#/overview',
    navigation: 'primary',
  },
  {
    kind: 'planning.graph',
    product: 'planning',
    label: 'Graph',
    description: 'Relationships, dependencies, and an accessible structural view.',
    href: '#/graph',
    navigation: 'primary',
  },
  {
    kind: 'planning.board',
    product: 'planning',
    label: 'Board',
    description: 'Planning work grouped for comparison without losing project context.',
    href: '#/board',
    navigation: 'primary',
  },
  {
    kind: 'planning.list',
    product: 'planning',
    label: 'List',
    description: 'A dense, filterable inventory of project work.',
    href: '#/list',
    navigation: 'primary',
  },
  {
    kind: 'planning.sprints',
    product: 'planning',
    label: 'Sprints',
    description: 'Delivery cadence and current sprint context.',
    href: '#/sprints',
    navigation: 'primary',
  },
  {
    kind: 'planning.activity',
    product: 'planning',
    label: 'Activity',
    description: 'Durable project changes in chronological order.',
    href: '#/activity',
    navigation: 'primary',
  },
  {
    kind: 'planning.search',
    product: 'planning',
    label: 'Search',
    description: 'Callable Planning and Operate destinations from access-safe projections.',
    href: '#/search',
    navigation: 'primary',
  },
  {
    kind: 'planning.console',
    product: 'planning',
    label: 'Console',
    description: 'Every planr-* capability, its dashboard home, and how to run it.',
    href: '#/console',
    navigation: 'primary',
  },
  {
    kind: 'planning.detail',
    product: 'planning',
    label: 'Artifact detail',
    description: 'Exact planning artifact identity and delivery trace.',
    href: '#/detail/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'planning.spec',
    product: 'planning',
    label: 'SPEC trace',
    description: 'The exact SPEC, operating origin, and delivery trace.',
    href: '#/plan/specs/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'system.diagnostics',
    product: null,
    label: 'Diagnostics',
    description: 'Compatibility, package, and API checks.',
    href: '#/diagnostics',
    navigation: 'hidden',
  },
  {
    kind: 'operate.today',
    product: 'operate',
    label: 'Today',
    description:
      'Material change, highest-priority attention, active Cycle, evidence, and the exact continuation.',
    href: '#/operate/today',
    navigation: 'primary',
  },
  {
    kind: 'operate.cycles',
    product: 'operate',
    label: 'Cycles',
    description: 'Operating cycles from Observe through Learn.',
    href: '#/operate/cycles',
    navigation: 'primary',
  },
  {
    kind: 'operate.cycle',
    product: 'operate',
    label: 'Cycle detail',
    description: 'Exact stages, assignments, gates, blockers, and proof.',
    href: '#/operate/cycles/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.review',
    product: 'operate',
    label: 'Review',
    description: 'Evidence-backed owner choices, consequences, and immutable disposition.',
    href: '#/operate/cycles/:cycleId/reviews/:reviewId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.inbox',
    product: 'operate',
    label: 'Inbox',
    description: 'Decisions, approvals, and verification that need attention.',
    href: '#/operate/inbox',
    navigation: 'primary',
  },
  {
    kind: 'operate.inbox-item',
    product: 'operate',
    label: 'Inbox item',
    description: 'An exact projected decision, approval, or verification item.',
    href: '#/operate/inbox/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.actions',
    product: 'operate',
    label: 'Actions',
    description: 'Proposed, approved, active, blocked, and verified action work.',
    href: '#/operate/actions',
    navigation: 'primary',
  },
  {
    kind: 'operate.action',
    product: 'operate',
    label: 'Action detail',
    description: 'Exact proposal, authority, execution, verification, and recovery context.',
    href: '#/operate/actions/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.action-planning',
    product: 'operate',
    label: 'Planning handoff',
    description: 'Review the exact governed bridge into Planning without starting PLAN or SHIP.',
    href: '#/operate/actions/:subjectId/planning',
    navigation: 'hidden',
  },
  {
    kind: 'operate.evidence',
    product: 'operate',
    label: 'Evidence',
    description: 'Claims, support, contradiction, access, freshness, and limitations.',
    href: '#/operate/evidence',
    navigation: 'primary',
  },
  {
    kind: 'operate.evidence-item',
    product: 'operate',
    label: 'Evidence detail',
    description: 'An exact access-safe evidence identity.',
    href: '#/operate/evidence/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.outcomes',
    product: 'operate',
    label: 'Outcomes',
    description: 'Observed effects, metrics, outcomes, and durable learning.',
    href: '#/operate/outcomes',
    navigation: 'primary',
  },
  {
    kind: 'operate.outcome',
    product: 'operate',
    label: 'Outcome detail',
    description: 'An exact outcome and its projected learning.',
    href: '#/operate/outcomes/:subjectId',
    navigation: 'hidden',
  },
  {
    kind: 'operate.history',
    product: 'operate',
    label: 'History',
    description: 'Causality, event history, checkpoint, tail, and replay proof.',
    href: '#/operate/history',
    navigation: 'primary',
  },
  {
    kind: 'operate.recovery',
    product: 'operate',
    label: 'Recovery',
    description: 'Proven state, unknown state, and only canonical next steps.',
    href: '#/operate/recovery',
    navigation: 'contextual',
  },
] as const satisfies readonly DashboardRouteDefinition[];

export const DASHBOARD_ROUTE_DEFINITIONS: readonly DashboardRouteDefinition[] = ROUTE_DEFINITIONS;

const DEFINITION_BY_KIND = new Map<DashboardRouteKind, DashboardRouteDefinition>(
  ROUTE_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

function collection(kind: DashboardRouteKind, product: DashboardProduct): DashboardRoute {
  return { kind, product, subjectId: null } as DashboardRoute;
}

function detail(
  kind: DashboardRouteKind,
  product: DashboardProduct,
  subjectId: string,
): DashboardRoute {
  return { kind, product, subjectId } as DashboardRoute;
}

function review(cycleId: string, reviewId: string): ReviewRoute {
  return { kind: 'operate.review', product: 'operate', cycleId, subjectId: reviewId };
}

export const DASHBOARD_DIAGNOSTICS_ROUTE: DashboardRoute = Object.freeze({
  kind: 'system.diagnostics',
  product: null,
  subjectId: null,
});

function validSubject(subject: string): boolean {
  return !(
    subject === '.' ||
    subject === '..' ||
    subject.length === 0 ||
    subject.length > 256 ||
    [...subject].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 || character === '/' || character === '\\';
    })
  );
}

function parseSubject(segment: string): string | null {
  if (!segment || /%(?:2f|5c)/iu.test(segment)) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return validSubject(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

const UNKNOWN_ROUTE: UnknownDashboardRoute = Object.freeze({
  kind: 'not-found',
  product: null,
  subjectId: null,
});

/** Parse only the documented public dashboard grammar. Unknown paths never coerce to Today. */
export function parseDashboardRoute(hash: string): ParsedDashboardRoute {
  if (hash === '' || hash === '#') return collection('planning.overview', 'planning');
  if (!hash.startsWith('#/') || hash.includes('?') || hash.indexOf('#', 1) !== -1) {
    return UNKNOWN_ROUTE;
  }
  const rawPath = hash.slice(2);
  if (!rawPath || rawPath.endsWith('/') || rawPath.includes('//')) return UNKNOWN_ROUTE;
  const parts = rawPath.split('/');

  if (parts.length === 1) {
    if (parts[0] === 'diagnostics') return DASHBOARD_DIAGNOSTICS_ROUTE;
    const planning = new Map<string, DashboardRouteKind>([
      ['overview', 'planning.overview'],
      ['graph', 'planning.graph'],
      ['board', 'planning.board'],
      ['list', 'planning.list'],
      ['sprints', 'planning.sprints'],
      ['activity', 'planning.activity'],
      ['search', 'planning.search'],
      ['console', 'planning.console'],
    ]).get(parts[0]);
    if (planning) return collection(planning, 'planning');
  }

  if (parts.length === 2 && parts[0] === 'detail') {
    const subjectId = parseSubject(parts[1]);
    return subjectId ? detail('planning.detail', 'planning', subjectId) : UNKNOWN_ROUTE;
  }

  if (parts.length === 3 && parts[0] === 'plan' && parts[1] === 'specs') {
    const subjectId = parseSubject(parts[2]);
    return subjectId ? detail('planning.spec', 'planning', subjectId) : UNKNOWN_ROUTE;
  }

  if (parts[0] !== 'operate') return UNKNOWN_ROUTE;
  if (parts.length === 2) {
    const operate = new Map<string, DashboardRouteKind>([
      ['today', 'operate.today'],
      ['cycles', 'operate.cycles'],
      ['inbox', 'operate.inbox'],
      ['actions', 'operate.actions'],
      ['evidence', 'operate.evidence'],
      ['outcomes', 'operate.outcomes'],
      ['history', 'operate.history'],
      ['recovery', 'operate.recovery'],
    ]).get(parts[1]);
    return operate ? collection(operate, 'operate') : UNKNOWN_ROUTE;
  }

  if (parts.length === 3) {
    const subjectId = parseSubject(parts[2]);
    if (!subjectId) return UNKNOWN_ROUTE;
    const kind = new Map<string, DashboardRouteKind>([
      ['cycles', 'operate.cycle'],
      ['inbox', 'operate.inbox-item'],
      ['actions', 'operate.action'],
      ['evidence', 'operate.evidence-item'],
      ['outcomes', 'operate.outcome'],
    ]).get(parts[1]);
    return kind ? detail(kind, 'operate', subjectId) : UNKNOWN_ROUTE;
  }

  if (parts.length === 4 && parts[1] === 'actions' && parts[3] === 'planning') {
    const subjectId = parseSubject(parts[2]);
    return subjectId ? detail('operate.action-planning', 'operate', subjectId) : UNKNOWN_ROUTE;
  }

  if (parts.length === 5 && parts[1] === 'cycles' && parts[3] === 'reviews') {
    const cycleId = parseSubject(parts[2]);
    const reviewId = parseSubject(parts[4]);
    return cycleId && reviewId ? review(cycleId, reviewId) : UNKNOWN_ROUTE;
  }

  return UNKNOWN_ROUTE;
}

export function serializeDashboardRoute(route: DashboardRoute): string {
  const definition = DEFINITION_BY_KIND.get(route.kind);
  if (!definition) throw new Error(`Unknown dashboard route kind: ${String(route.kind)}`);
  if (route.kind === 'operate.review') {
    if (!validSubject(route.cycleId) || !validSubject(route.subjectId)) {
      throw new Error('Dashboard Review routes require valid opaque Cycle and Review identities.');
    }
    return definition.href
      .replace(':cycleId', encodeURIComponent(route.cycleId))
      .replace(':reviewId', encodeURIComponent(route.subjectId));
  }
  if (definition.href.includes(':subjectId')) {
    const subjectId = route.subjectId;
    if (typeof subjectId !== 'string' || !validSubject(subjectId)) {
      throw new Error('Dashboard detail routes require a valid opaque subject identity.');
    }
    return definition.href.replace(':subjectId', encodeURIComponent(subjectId));
  }
  return definition.href;
}

export function dashboardRouteDefinition(
  route: ParsedDashboardRoute,
): DashboardRouteDefinition | null {
  return route.kind === 'not-found' ? null : (DEFINITION_BY_KIND.get(route.kind) ?? null);
}

export function productHome(product: DashboardProduct): DashboardRoute {
  return product === 'planning'
    ? collection('planning.overview', 'planning')
    : collection('operate.today', 'operate');
}

export function routesForProduct(product: DashboardProduct): readonly DashboardRouteDefinition[] {
  return ROUTE_DEFINITIONS.filter(
    (definition) => definition.product === product && definition.navigation !== 'hidden',
  );
}

/** Returns a public destination only when it is already an exact canonical dashboard hash route. */
export function canonicalDashboardHref(value: string): string | null {
  const route = parseDashboardRoute(value);
  if (route.kind === 'not-found') return null;
  return serializeDashboardRoute(route) === value ? value : null;
}

/** Stable route identity used by live presentation boundaries; cursor progress is deliberately absent. */
export function dashboardRouteScopeKey(route: ParsedDashboardRoute): string {
  if (route.kind === 'not-found') return 'not-found';
  if (route.kind === 'operate.review') {
    return `${route.product}:${route.kind}:${route.cycleId}:${route.subjectId}`;
  }
  return `${route.product ?? 'system'}:${route.kind}:${route.subjectId ?? 'collection'}`;
}
