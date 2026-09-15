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

export type DashboardSearchHit = Readonly<{
  id: string;
  title: string;
  href: string;
  source: 'route' | 'planning' | 'operate';
  kind: string;
}>;

export type DashboardSearchIndex = Readonly<{
  routes: readonly ClosedDashboardDestination[];
  planningNodes: readonly PlanningModelNode[];
  operateHits: readonly DashboardSearchHit[];
}>;

export type DashboardUnsupportedIdentity = Readonly<{
  id: string;
  title: string;
  kind: string;
  reason: string;
}>;

export type DashboardSearchSources = Readonly<{
  planningNodes?: readonly PlanningModelNode[];
  operateResults?: readonly AccessSafeOperateSearchHitV1[];
}>;

function canonicalHit(
  id: string,
  title: string,
  href: string | null,
  source: DashboardSearchHit['source'],
  kind: string,
): DashboardSearchHit | null {
  if (href == null) return null;
  const canonical = canonicalClosedDashboardHref(href);
  if (canonical === null) return null;
  return Object.freeze({ id, title, href: canonical, source, kind });
}

function operateSearchHits(
  results: readonly AccessSafeOperateSearchHitV1[] | undefined,
): readonly DashboardSearchHit[] {
  if (!results) return Object.freeze([]);
  const hits: DashboardSearchHit[] = [];
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
  });
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/** Query only access-safe titles and canonical hrefs. Missing destinations are omitted, not invented. */
export function queryDashboardSearchIndex(
  index: DashboardSearchIndex,
  term: string,
  maximumResults = 20,
): readonly DashboardSearchHit[] {
  const needle = term.trim().toLowerCase();
  if (!needle || !Number.isSafeInteger(maximumResults) || maximumResults < 0) {
    return Object.freeze([]);
  }
  const hits: DashboardSearchHit[] = [];
  for (const route of index.routes) {
    if (matches(`${route.title} ${route.kind} ${route.href}`, needle)) {
      const hit = canonicalHit(`route:${route.kind}`, route.title, route.href, 'route', route.kind);
      if (hit) hits.push(hit);
    }
  }
  for (const node of queryPlanningSearchIndex(
    buildPlanningSearchIndex(index.planningNodes),
    term,
    maximumResults,
  )) {
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
    if (matches(`${operate.title} ${operate.kind} ${operate.id}`, needle)) hits.push(operate);
  }
  const seen = new Set<string>();
  return Object.freeze(
    hits
      .filter((hit) => {
        if (seen.has(hit.href)) return false;
        seen.add(hit.href);
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
  const needle = term.trim().toLowerCase();
  if (!needle || !Number.isSafeInteger(maximumResults) || maximumResults < 0) {
    return Object.freeze([]);
  }
  const unsupported: DashboardUnsupportedIdentity[] = [];
  for (const node of queryPlanningSearchIndex(
    buildPlanningSearchIndex(index.planningNodes),
    term,
    maximumResults,
  )) {
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
