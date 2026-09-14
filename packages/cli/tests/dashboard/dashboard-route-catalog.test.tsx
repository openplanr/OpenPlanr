// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  DASHBOARD_ROUTE_DEFINITIONS,
  dashboardRouteDefinition,
  dashboardRouteScopeKey,
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import { RouteAnnouncer } from '../../../../apps/dashboard/src/features/accessibility/RouteAnnouncer.js';
import { NavRail } from '../../../../apps/dashboard/src/features/shell/shell-navigation.js';
import {
  DASHBOARD_FIXTURE_CYCLE_ID,
  DASHBOARD_FIXTURE_REVIEW_ID,
  DASHBOARD_ROUTE_FIXTURES,
} from '../e2e/fixtures/dashboard-route-catalog.js';

afterEach(cleanup);

describe('immutable public dashboard route fixture catalog', () => {
  it('equals the typed public route contract exactly', () => {
    expect(Object.isFrozen(DASHBOARD_ROUTE_FIXTURES)).toBe(true);
    expect(DASHBOARD_ROUTE_FIXTURES.every((fixture) => Object.isFrozen(fixture))).toBe(true);
    expect(DASHBOARD_ROUTE_FIXTURES.map(({ kind }) => kind)).toEqual(
      DASHBOARD_ROUTE_DEFINITIONS.map(({ kind }) => kind),
    );
    expect(new Set(DASHBOARD_ROUTE_FIXTURES.map(({ kind }) => kind)).size).toBe(
      DASHBOARD_ROUTE_FIXTURES.length,
    );
    expect(new Set(DASHBOARD_ROUTE_FIXTURES.map(({ hash }) => hash)).size).toBe(
      DASHBOARD_ROUTE_FIXTURES.length,
    );

    for (const fixture of DASHBOARD_ROUTE_FIXTURES) {
      const route = parseDashboardRoute(fixture.hash);
      expect(route.kind).toBe(fixture.kind);
      expect(route.kind).not.toBe('not-found');
      if (route.kind === 'not-found') throw new TypeError(`Unparsed fixture: ${fixture.hash}`);
      expect(serializeDashboardRoute(route)).toBe(fixture.hash);
      const definition = dashboardRouteDefinition(route);
      expect(definition?.kind).toBe(fixture.kind);
      expect(fixture.composition).toBe(definition?.product === null ? 'diagnostics' : 'shell');
    }
  });

  it.each(DASHBOARD_ROUTE_FIXTURES)('$kind announces its exact typed route contract', (fixture) => {
    const route = parseDashboardRoute(fixture.hash);
    if (route.kind === 'not-found') throw new TypeError(`Unparsed fixture: ${fixture.hash}`);
    const definition = dashboardRouteDefinition(route);
    if (!definition) throw new TypeError(`Undefined fixture route: ${fixture.kind}`);
    const subject =
      route.kind === 'operate.review'
        ? ` · ${route.cycleId} · ${route.subjectId}`
        : route.subjectId
          ? ` · ${route.subjectId}`
          : '';

    render(
      <DashboardProviders buildId="dashboard-route-catalog" initialHash={fixture.hash}>
        <RouteAnnouncer />
      </DashboardProviders>,
    );

    expect(screen.getByRole('status').textContent).toBe(
      `${definition.label}${subject}. ${definition.description}`,
    );
  });

  it('binds the hidden Review route to both opaque identities and keeps Cycles current', () => {
    const hash = `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`;
    const route = parseDashboardRoute(hash);
    expect(route).toEqual({
      kind: 'operate.review',
      product: 'operate',
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      subjectId: DASHBOARD_FIXTURE_REVIEW_ID,
    });
    if (route.kind !== 'operate.review') throw new TypeError('Expected the Review route');
    expect(serializeDashboardRoute(route)).toBe(hash);
    expect(dashboardRouteDefinition(route)).toMatchObject({
      href: '#/operate/cycles/:cycleId/reviews/:reviewId',
      navigation: 'hidden',
    });
    expect(dashboardRouteScopeKey(route)).toBe(
      `operate:operate.review:${DASHBOARD_FIXTURE_CYCLE_ID}:${DASHBOARD_FIXTURE_REVIEW_ID}`,
    );

    render(
      <NavRail product="operate" route={route} operateAvailable onOpenPalette={() => undefined} />,
    );
    expect(screen.getByRole('link', { name: /Cycles/u }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: /^Review$/u })).toBeNull();
  });

  it.each([
    '#/operate/cycles/cycle-1/reviews',
    '#/operate/cycles/cycle-1/reviews/review-1/extra',
    '#/operate/cycles/cycle%2Fforeign/reviews/review-1',
    '#/operate/cycles/cycle-1/reviews/review%5Cforeign',
    '#/operate/cycles/./reviews/review-1',
    '#/operate/cycles/cycle-1/reviews/..',
  ])('rejects hostile or incomplete Review route %s', (hash) => {
    expect(parseDashboardRoute(hash).kind).toBe('not-found');
  });
});
