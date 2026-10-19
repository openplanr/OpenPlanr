import type { AccessSafeOperateSearchHitV1 } from '../../contracts/search-hit.js';
import {
  type ClosedDashboardDestination,
  canonicalClosedDashboardHref,
  closedDashboardDestinations,
} from '../../lib/routing/operate-routes.js';
import type { PlanningModelNode } from '../planning/planning-model.js';
import {
  buildPlanningSearchIndex,
  planningDetailHref,
  queryPlanningSearchIndex,
} from '../planning/planning-model.js';

export type DashboardSearchDestinationHit = Readonly<{
  id: string;
  title: string;
  href: string;
  source: 'route' | 'planning' | 'operate';
  kind: string;
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

export type DashboardSearchHit = DashboardSearchDestinationHit | DashboardSearchCommandHit;

const DEFAULT_COMMANDS: readonly DashboardSearchCommand[] = Object.freeze([
  Object.freeze({
    id: 'dashboard',
    title: 'Open the local dashboard',
    command: 'openplanr dashboard',
  }),
  Object.freeze({ id: 'sprint', title: 'Plan a sprint', command: '/planr:sprint' }),
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
  commands?: readonly DashboardSearchCommand[];
  operateResults?: readonly AccessSafeOperateSearchHitV1[];
}>;

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

/** Merge route destinations, Planning trigrams, and owner-issued Operate hits. */
export function buildDashboardSearchIndex(
  sources: DashboardSearchSources = Object.freeze({}),
): DashboardSearchIndex {
  const planningNodes = Object.freeze([...(sources.planningNodes ?? [])]);
  const operateHits = operateSearchHits(sources.operateResults);
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
  const nodes = query.term
    ? queryPlanningSearchIndex(
        buildPlanningSearchIndex(index.planningNodes),
        query.term,
        index.planningNodes.length,
      )
    : index.planningNodes;
  return query.type ? nodes.filter((node) => query.type === node.type) : nodes;
}

function matchingRouteHits(
  index: DashboardSearchIndex,
  query: TypedSearch,
): readonly DashboardSearchDestinationHit[] {
  if (query.type && query.type !== 'view') return [];
  return index.routes
    .filter((route) =>
      matches(`${route.title} ${route.kind} ${route.href}`, query.term.toLowerCase()),
    )
    .map((route) =>
      canonicalHit(`route:${route.kind}`, route.title, route.href, 'route', route.kind),
    )
    .filter((hit): hit is DashboardSearchDestinationHit => hit !== null);
}

/** Query only access-safe titles and canonical hrefs. Missing destinations are omitted, not invented. */
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
  const hits: DashboardSearchHit[] = [...matchingRouteHits(index, query)];
  for (const node of matchingPlanningNodes(index, query)) {
    const hit = canonicalHit(
      `planning:${node.id}`,
      node.title,
      planningDetailHref(node),
      'planning',
      node.type,
    );
    if (hit) hits.push(hit);
  }
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
  }
  const seen = new Set<string>();
  return Object.freeze(
    hits
      .filter((hit) => {
        const key = hit.source === 'command' ? hit.id : hit.href;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maximumResults),
  );
}

/** Planning rows that match but cannot emit a closed destination remain visible identities only. */
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
    if (planningDetailHref(node) !== null) continue;
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
