import type { AccessSafeOperateSearchHitV1 } from '../../contracts/search-hit.js';
import {
  type ClosedDashboardDestination,
  canonicalClosedDashboardHref,
  closedDashboardDestinations,
} from '../../lib/routing/operate-routes.js';
import {
  isCanonicalPlanningId,
  serializePlanningViewHref,
  validatePlanningView,
} from '../../lib/routing/planning-view-codec.js';
import type {
  PlanningModelGraph,
  PlanningModelNode,
  PlanningSearchIndex,
} from '../planning/planning-model.js';
import {
  buildPlanningSearchIndex,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
  planningRouteSubjectId,
  queryPlanningSearchIndex,
} from '../planning/planning-model.js';

export type DashboardSearchDestinationHit = Readonly<{
  id: string;
  title: string;
  href: string;
  source: 'route' | 'operate';
  kind: string;
}>;

export type DashboardSearchPlanningHit = Readonly<{
  id: string;
  title: string;
  href: string | null;
  source: 'planning';
  kind: string;
  status?: string;
}>;

export type DashboardSearchCommand = Readonly<{
  id: string;
  title: string;
  command: string;
}>;

export type DashboardSearchCommandHit = DashboardSearchCommand &
  Readonly<{
    href: null;
    source: 'command';
    kind: 'command';
  }>;

export type DashboardSearchHit =
  | DashboardSearchDestinationHit
  | DashboardSearchPlanningHit
  | DashboardSearchCommandHit;

const DEFAULT_COMMANDS: readonly DashboardSearchCommand[] = Object.freeze([
  Object.freeze({
    id: 'dashboard',
    title: 'Open the local dashboard',
    command: 'openplanr dashboard',
  }),
  Object.freeze({ id: 'sprint', title: 'Plan a sprint', command: '/planr:sprint' }),
  Object.freeze({ id: 'status', title: 'Delivery status', command: 'openplanr status --md' }),
]);

export type DashboardSearchIndex = Readonly<{
  routes: readonly ClosedDashboardDestination[];
  planningNodes: readonly PlanningModelNode[];
  operateHits: readonly DashboardSearchDestinationHit[];
  commands: readonly DashboardSearchCommandHit[];
}>;

export type DashboardUnsupportedIdentity = Readonly<{
  id: string;
  title: string;
  kind: string;
  reason: string;
}>;

export type DashboardSearchSources = Readonly<{
  planningNodes?: readonly PlanningModelNode[];
  planningGraph?: PlanningModelGraph;
  planningPresentation?: string;
  commands?: readonly DashboardSearchCommand[];
  operateResults?: readonly AccessSafeOperateSearchHitV1[];
}>;

export function searchHitDisplayId(
  hit: DashboardSearchHit,
  sources: DashboardSearchSources = {},
): string {
  if (hit.source !== 'planning') return '';
  const node = (sources.planningNodes ?? sources.planningGraph?.nodes ?? []).find(
    (candidate) => `planning:${candidate.id}` === hit.id,
  );
  const displayId = planningDisplayId(node ?? hit.id.slice('planning:'.length));
  const shortId = displayId.split('-').slice(0, 2).join('-');
  if (isCanonicalPlanningId(shortId)) return shortId;
  const canonicalId = planningDisplayId(hit.id.slice('planning:'.length));
  const canonicalShortId = canonicalId.split('-').slice(0, 2).join('-');
  return isCanonicalPlanningId(canonicalShortId) ? canonicalShortId : displayId;
}

export function verifiedSearchCommand(
  hit: DashboardSearchHit,
  sources: DashboardSearchSources,
): string | null {
  if (hit.source === 'command') return hit.command;
  if (hit.source !== 'planning') return null;
  const node = (sources.planningNodes ?? sources.planningGraph?.nodes ?? []).find(
    (candidate) => `planning:${candidate.id}` === hit.id,
  );
  return node ? planningContinuation(node) : null;
}

function canonicalHit(
  id: string,
  title: string,
  href: string | null,
  source: DashboardSearchDestinationHit['source'],
  kind: string,
): DashboardSearchDestinationHit | null {
  if (href == null) return null;
  const canonical = canonicalClosedDashboardHref(href);
  if (canonical === null) return null;
  return Object.freeze({ id, title, href: canonical, source, kind });
}

function operateSearchHits(
  results: readonly AccessSafeOperateSearchHitV1[] | undefined,
): readonly DashboardSearchDestinationHit[] {
  if (!results) return Object.freeze([]);
  const hits: DashboardSearchDestinationHit[] = [];
  for (const entry of results) {
    const hit = canonicalHit(
      `operate:${entry.kind}:${entry.subjectId}`,
      entry.title,
      entry.deepLink,
      'operate',
      entry.kind,
    );
    if (hit) hits.push(hit);
  }
  return Object.freeze(hits);
}

type PlanningSearch = Readonly<{
  planningIndex: PlanningSearchIndex;
  planningAliases: ReadonlyMap<string, readonly PlanningModelNode[]>;
}>;
const planningIndices = new WeakMap<readonly PlanningModelNode[], PlanningSearch>();
const indexSearches = new WeakMap<readonly PlanningModelNode[], PlanningSearch>();

function cachedPlanningIndex(nodes: readonly PlanningModelNode[]): PlanningSearch {
  let index = planningIndices.get(nodes);
  if (!index) {
    const aliases = new Map<string, PlanningModelNode[]>();
    for (const node of nodes) {
      const alias = planningDisplayId(node).toLowerCase();
      const matches = aliases.get(alias) ?? [];
      matches.push(node);
      aliases.set(alias, matches);
    }
    index = { planningIndex: buildPlanningSearchIndex(nodes), planningAliases: aliases };
    planningIndices.set(nodes, index);
  }
  return index;
}

/** Merge route destinations, Planning trigrams, and owner-issued Operate hits. */
export function buildDashboardSearchIndex(
  sources: DashboardSearchSources = Object.freeze({}),
): DashboardSearchIndex {
  const planningNodes = Object.freeze([...(sources.planningNodes ?? [])]);
  const operateHits = operateSearchHits(sources.operateResults);
  // Search caches stay outside the index so it remains plain, digestible JSON.
  indexSearches.set(planningNodes, cachedPlanningIndex(sources.planningNodes ?? planningNodes));
  return Object.freeze({
    routes: closedDashboardDestinations(),
    planningNodes,
    operateHits,
    commands: Object.freeze(
      (sources.commands ?? DEFAULT_COMMANDS)
        .filter((entry) => entry.id.trim() && entry.title.trim() && entry.command.trim())
        .map(
          (entry): DashboardSearchCommandHit =>
            Object.freeze({
              id: `command:${entry.id}`,
              title: entry.title,
              command: entry.command,
              href: null,
              source: 'command',
              kind: 'command',
            }),
        ),
    ),
  });
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

type SearchType = 'spec' | 'story' | 'task' | 'backlog' | 'adr' | 'sprint' | 'view' | 'command';
type TypedSearch = Readonly<{ type: SearchType | null; term: string }>;

function typedSearch(term: string): TypedSearch {
  const match = term.trim().match(/^@(spec|story|task|backlog|adr|sprint|view|command)(?:\s+|$)/iu);
  return {
    type: (match?.[1].toLowerCase() as SearchType | undefined) ?? null,
    term: match ? term.trim().slice(match[0].length).trim() : term.trim(),
  };
}

function matchingPlanningNodes(
  index: DashboardSearchIndex,
  query: TypedSearch,
): readonly PlanningModelNode[] {
  const search = indexSearches.get(index.planningNodes) ?? cachedPlanningIndex(index.planningNodes);
  const nodes = query.term
    ? queryPlanningSearchIndex(search.planningIndex, query.term, index.planningNodes.length)
    : [...index.planningNodes].sort((left, right) => left.id.localeCompare(right.id));
  const needle = query.term.toLowerCase();
  const exact = nodes.find((node) => node.id.toLowerCase() === needle);
  const aliases = [...(search.planningAliases.get(needle) ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const seen = new Set<string>();
  return [...(exact ? [exact] : []), ...aliases, ...nodes].filter((node) => {
    if ((query.type && query.type !== node.type) || seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function matchingRouteHits(
  index: DashboardSearchIndex,
  query: TypedSearch,
  hasPlanningMatches: boolean,
): readonly DashboardSearchDestinationHit[] {
  if (query.type && query.type !== 'view') return [];
  const destinations = index.routes
    .filter((route) =>
      matches(`${route.title} ${route.kind} ${route.href}`, query.term.toLowerCase()),
    )
    .map((route) =>
      canonicalHit(`route:${route.kind}`, route.title, route.href, 'route', route.kind),
    )
    .filter((hit): hit is DashboardSearchDestinationHit => hit !== null);
  if (query.term && (query.type === 'view' || (!query.type && hasPlanningMatches))) {
    const view = validatePlanningView({
      schemaVersion: '1.0.0',
      route: 'list',
      filters: {
        type: [],
        status: [],
        priority: [],
        label: [],
        query: query.term,
        createdWithinDays: null,
        updatedWithinDays: null,
      },
      groupBy: 'none',
      sort: { field: 'updated', direction: 'desc' },
      density: 'comfortable',
      focusId: null,
    });
    if (view)
      destinations.push({
        id: 'route:planning.list.filtered',
        title: `List filtered to “${query.term}”`,
        source: 'route',
        kind: 'planning.list',
        href: serializePlanningViewHref(view),
      });
  }
  return destinations;
}

/** Route availability must not hide graph identities that can be inspected locally. */
export function queryDashboardSearchIndex(
  index: DashboardSearchIndex,
  term: string,
  maximumResults = 20,
): readonly DashboardSearchHit[] {
  const query = typedSearch(term);
  const needle = query.term.toLowerCase();
  if ((!needle && !query.type) || !Number.isSafeInteger(maximumResults) || maximumResults < 0) {
    return Object.freeze([]);
  }
  const hits: DashboardSearchHit[] = [];
  const nodes = matchingPlanningNodes(index, query);
  for (const node of nodes) {
    // A graph identity can be inspected even when the public route grammar cannot represent it.
    if (planningRouteSubjectId(node) === null) continue;
    hits.push(
      Object.freeze({
        id: `planning:${node.id}`,
        title: node.title,
        href: planningDetailHref(node),
        source: 'planning',
        kind: node.type,
        status: node.status,
      }),
    );
  }
  hits.push(...matchingRouteHits(index, query, nodes.length > 0));
  for (const operate of index.operateHits) {
    if (!query.type && matches(`${operate.title} ${operate.kind} ${operate.id}`, needle))
      hits.push(operate);
  }
  if (!query.type || query.type === 'command') {
    hits.push(
      ...index.commands.filter((entry) =>
        matches(`${entry.id} ${entry.title} ${entry.command}`, needle),
      ),
    );
    if (!query.type) {
      const node = nodes.find((entry) => planningRouteSubjectId(entry) !== null);
      const command = node ? planningContinuation(node) : null;
      if (node && command) {
        hits.push({
          id: `command:planning:${node.id}`,
          title: `Continue ${planningDisplayId(node)}`,
          command,
          source: 'command',
          href: null,
          kind: 'command',
        });
      }
    }
  }
  const seen = new Set<string>();
  const distinct = hits.filter((hit) => {
    const key = hit.source === 'command' || hit.source === 'planning' ? hit.id : hit.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const firstBySource = new Map<DashboardSearchHit['source'], DashboardSearchHit>();
  for (const hit of distinct)
    if (!firstBySource.has(hit.source)) firstBySource.set(hit.source, hit);
  const selected = new Set([...firstBySource.values()].slice(0, maximumResults));
  for (const hit of distinct) if (selected.size < maximumResults) selected.add(hit);
  return Object.freeze(distinct.filter((hit) => selected.has(hit)));
}

/** Malformed graph identities remain visible without an interactive destination. */
export function queryUnsupportedPlanningIdentities(
  index: DashboardSearchIndex,
  term: string,
  maximumResults = 20,
): readonly DashboardUnsupportedIdentity[] {
  const query = typedSearch(term);
  const needle = query.term.toLowerCase();
  if ((!needle && !query.type) || !Number.isSafeInteger(maximumResults) || maximumResults < 0) {
    return Object.freeze([]);
  }
  const unsupported: DashboardUnsupportedIdentity[] = [];
  for (const node of matchingPlanningNodes(index, query)) {
    if (planningRouteSubjectId(node) !== null) continue;
    unsupported.push(
      Object.freeze({
        id: node.id,
        title: node.title,
        kind: node.type,
        reason: 'This artifact identity cannot be opened through the closed dashboard grammar.',
      }),
    );
  }
  return Object.freeze(unsupported.slice(0, maximumResults));
}
