import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import { describe, expect, it } from 'vitest';
import {
  canonicalDashboardHref,
  parseDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { planningDetailHref } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  buildDashboardSearchIndex,
  queryDashboardSearchIndex,
} from '../../../../apps/dashboard/src/features/search/search-index.js';
import {
  canonicalClosedDashboardHref,
  closedDashboardDestinations,
  parseClosedDashboardRoute,
} from '../../../../apps/dashboard/src/lib/routing/operate-routes.js';
import { projectAccessSafeOperateSearchHits } from '../../src/services/operate/search-hit-contract.js';

const PRIVATE_MARKER = 'private-missing-link-must-not-cross-audit-selection';

const nodes: readonly PlanningModelNode[] = Object.freeze([
  Object.freeze({
    id: 'SPEC-020',
    type: 'spec',
    title: 'Unified dashboard',
    status: 'in-progress',
    frontmatter: Object.freeze({ id: 'SPEC-020' }),
  }),
  Object.freeze({
    id: 'SPEC-020/US-013',
    type: 'story',
    title: 'Callable search',
    status: 'outstanding',
    frontmatter: Object.freeze({ id: 'US-013', specId: 'SPEC-020' }),
  }),
]);

describe('T-026 closed destinations and access-safe search index', () => {
  it('parses only the closed grammar and canonicalizes emitted hrefs', () => {
    for (const destination of closedDashboardDestinations()) {
      expect(parseClosedDashboardRoute(destination.href).kind).toBe(destination.kind);
      expect(canonicalClosedDashboardHref(destination.href)).toBe(destination.href);
      expect(parseDashboardRoute(destination.href).kind).toBe(destination.kind);
    }
    expect(parseClosedDashboardRoute('#/operate/cycles/a%2Fb').kind).toBe('not-found');
    expect(canonicalClosedDashboardHref('#/operate/evidence/a%2Fb')).toBeNull();
    expect(canonicalDashboardHref('#/operate/today?actor=foreign')).toBeNull();
  });

  it('indexes Planning titles and only owner-certified Operate rows', () => {
    const index = buildDashboardSearchIndex({
      planningNodes: nodes,
      operateResults: [
        {
          kind: 'evidence',
          subjectId: 'evidence-available',
          title: 'Evidence evidence-available',
          summary: 'operate-artifact · supported',
          state: 'current',
          deepLink: '#/operate/evidence/evidence-available',
        },
        {
          kind: 'action',
          subjectId: 'act_search_00000001',
          title: 'Audit search destination links',
          summary: 'Every emitted search link resolves.',
          state: 'approved',
        },
      ],
    });

    const planningHits = queryDashboardSearchIndex(index, 'Callable');
    const planningHit = planningHits.find((hit) => hit.source === 'planning');
    expect(planningHit?.href).toBe(planningDetailHref(nodes[1]));

    const operateHits = queryDashboardSearchIndex(index, 'evidence-available').filter(
      (hit) => hit.source === 'operate',
    );
    expect(operateHits.map((hit) => hit.href)).toEqual(['#/operate/evidence/evidence-available']);

    const restricted = queryDashboardSearchIndex(index, 'restricted');
    expect(restricted).toEqual([]);
    expect(JSON.stringify(index)).not.toContain(PRIVATE_MARKER);

    const actionHits = queryDashboardSearchIndex(index, 'Audit search');
    expect(actionHits.filter((hit) => hit.kind === 'action')).toEqual([]);
  });

  it('drops owner rows whose deep links fail closed encoding or ownership', () => {
    const hits = projectAccessSafeOperateSearchHits([
      {
        kind: 'cycle',
        subjectId: 'cycle-1',
        title: 'Retention',
        deepLink: '#/operate/cycles/a%2Fb',
      },
      {
        kind: 'evidence',
        subjectId: 'private-unknown',
        title: 'visible',
        deepLink: '#/operate/evidence/private-unknown',
      },
    ]);
    const index = buildDashboardSearchIndex({ operateResults: hits });
    expect(queryDashboardSearchIndex(index, 'Retention')).toEqual([]);
    expect(
      queryDashboardSearchIndex(index, 'visible').every(
        (hit) => canonicalClosedDashboardHref(hit.href) !== null,
      ),
    ).toBe(true);
  });

  it('keeps a stable digest for the same access-safe inputs', () => {
    const left = buildDashboardSearchIndex({ planningNodes: nodes, operateResults: [] });
    const right = buildDashboardSearchIndex({ planningNodes: nodes, operateResults: [] });
    expect(sha256Jcs(left as never)).toBe(sha256Jcs(right as never));
  });
});
