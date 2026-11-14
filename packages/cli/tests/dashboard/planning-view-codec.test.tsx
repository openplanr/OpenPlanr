// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardProviders, useDashboard } from '../../../../apps/dashboard/src/app/providers.js';
import {
  canonicalDashboardHref,
  parseDashboardLocation,
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import {
  planningDetailHref,
  planningNodeIdFromRouteSubject,
  planningRouteSubjectId,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  isCanonicalPlanningId,
  type PlanningView,
  parsePlanningSubject,
  parsePlanningViewToken,
  serializePlanningSubject,
  serializePlanningViewHref,
  serializePlanningViewToken,
  validatePlanningView,
} from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { DASHBOARD_ROUTE_FIXTURES } from '../e2e/fixtures/dashboard-route-catalog.js';

const FIXTURE_SPEC = 'SPEC-901';
const FIXTURE_TASK = 'T-902';
const FIXTURE_STORY = 'US-903';
const FIXTURE_SCOPED = `${FIXTURE_SPEC}/${FIXTURE_TASK}`;
const VIEW: PlanningView = {
  schemaVersion: '1.0.0',
  route: 'list',
  filters: {
    type: ['task'],
    status: ['outstanding'],
    priority: ['P1'],
    label: ['ready', '日本語'],
    query: 'review work',
    createdWithinDays: 1,
    updatedWithinDays: 365,
  },
  groupBy: 'label',
  sort: { field: 'updated', direction: 'desc' },
  density: 'compact',
  focusId: FIXTURE_SCOPED,
};

function token(value: unknown): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value)))
    binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function Snapshot() {
  const { route, presentationView, invalidView } = useDashboard();
  return (
    <output data-testid="snapshot">
      {JSON.stringify({ route, presentationView, invalidView })}
    </output>
  );
}

function snapshot() {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? '{}');
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('round-trips authored quick-task identities', () => {
  expect(parsePlanningSubject(serializePlanningSubject('QT-006'))).toBe('QT-006');
});

describe('Home aliases and preserved routes', () => {
  it.each(['', '#', '#/overview', '#/home'])('canonicalizes %j to Home', (hash) => {
    const route = parseDashboardRoute(hash);
    expect(route).toEqual({ kind: 'planning.overview', product: 'planning', subjectId: null });
    if (route.kind === 'not-found') throw new Error('Expected Home');
    expect(serializeDashboardRoute(route)).toBe('#/home');
  });

  it.each(DASHBOARD_ROUTE_FIXTURES)('preserves the $kind alias', ({ hash, kind }) => {
    const route = parseDashboardRoute(hash);
    expect(route.kind).toBe(kind);
    if (route.kind === 'not-found') throw new Error('Expected legacy route');
    expect(serializeDashboardRoute(route)).toBe(kind === 'planning.overview' ? '#/home' : hash);
  });

  it.each(['', '#', '#/overview'])(
    'replaces live alias %j without adding a history entry',
    (hash) => {
      window.history.replaceState({ marker: 'preserved' }, '', `/dashboard${hash}`);
      const length = window.history.length;
      render(
        <DashboardProviders buildId="fixture">
          <Snapshot />
        </DashboardProviders>,
      );
      expect(window.location.hash).toBe('#/home');
      expect(window.history.length).toBe(length);
      expect(window.history.state).toEqual({ marker: 'preserved' });
      expect(snapshot().route.kind).toBe('planning.overview');
    },
  );

  it('leaves the live location alone when rendering an explicit hash', () => {
    window.history.replaceState(null, '', '/dashboard#/graph');
    render(
      <DashboardProviders buildId="fixture" initialHash="#/overview">
        <Snapshot />
      </DashboardProviders>,
    );
    expect(window.location.hash).toBe('#/graph');
    expect(snapshot().route.kind).toBe('planning.overview');
  });
});

describe('Planning-only scoped route subjects', () => {
  it.each([
    FIXTURE_SCOPED,
    `${FIXTURE_SPEC}/${FIXTURE_STORY}`,
    FIXTURE_SPEC,
    FIXTURE_TASK,
    FIXTURE_STORY,
  ])('round-trips canonical fixture %s once', (subjectId) => {
    const segment = encodeURIComponent(subjectId);
    expect(parsePlanningSubject(segment)).toBe(subjectId);
    expect(serializePlanningSubject(subjectId)).toBe(segment);
    for (const kind of ['planning.detail', 'planning.spec'] as const) {
      const route = { kind, product: 'planning' as const, subjectId };
      const href = serializeDashboardRoute(route);
      expect(parseDashboardRoute(href)).toEqual(route);
      expect(canonicalDashboardHref(href)).toBe(href);
    }
    expect(planningRouteSubjectId(subjectId)).toBe(subjectId);
    expect(planningNodeIdFromRouteSubject(subjectId)).toBe(subjectId);
    expect(planningDetailHref(subjectId)).toBe(`#/detail/${segment}`);
  });

  it.each([
    [FIXTURE_SCOPED, '#/detail/'],
    [FIXTURE_SCOPED, '#/plan/specs/'],
    [`${FIXTURE_SPEC}/${FIXTURE_STORY}`, '#/detail/'],
    [`${FIXTURE_SPEC}/${FIXTURE_STORY}`, '#/plan/specs/'],
  ])('normalizes the released alias for %s at %s', (subjectId, prefix) => {
    const legacy = subjectId.replace('/', ':2F');
    const segment = encodeURIComponent(legacy);
    const href = `${prefix}${segment}`;
    const canonical = `${prefix}${encodeURIComponent(subjectId)}`;
    const route = parseDashboardRoute(href);
    expect(parsePlanningSubject(segment)).toBe(subjectId);
    expect(route).toEqual(parseDashboardRoute(canonical));
    expect(route.subjectId).toBe(subjectId);
    if (route.kind === 'not-found') throw new Error('Expected Planning alias');
    expect(serializeDashboardRoute(route)).toBe(canonical);
    expect(parseDashboardRoute(serializeDashboardRoute(route))).toEqual(route);
    expect(canonicalDashboardHref(href)).toBeNull();
    expect(canonicalDashboardHref(canonical)).toBe(canonical);
    expect(planningNodeIdFromRouteSubject(legacy)).toBe(subjectId);
    window.history.replaceState({ marker: 'preserved' }, '', `/dashboard?mode=local${href}`);
    const length = window.history.length;
    render(
      <DashboardProviders buildId="fixture">
        <Snapshot />
      </DashboardProviders>,
    );
    expect(window.location.href).toContain(`/dashboard?mode=local${canonical}`);
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ marker: 'preserved' });
    expect(snapshot().route).toEqual(route);
  });

  it('resolves explicit legacy input without changing the live URL', () => {
    window.history.replaceState(null, '', '/dashboard#/graph');
    const legacy = `#/detail/${encodeURIComponent(FIXTURE_SCOPED.replace('/', ':2F'))}`;
    render(
      <DashboardProviders buildId="fixture" initialHash={legacy}>
        <Snapshot />
      </DashboardProviders>,
    );
    expect(snapshot().route.subjectId).toBe(FIXTURE_SCOPED);
    expect(window.location.hash).toBe('#/graph');
  });

  it.each([
    `${FIXTURE_SPEC}/${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%2f${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%252F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%253A2F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%25253A2F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}:2F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%3a2F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%3A2f${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%3A2F..`,
    `${FIXTURE_SPEC}%3A2FADR-904`,
    `${FIXTURE_SPEC}%3A2F${FIXTURE_TASK}%3A2Fextra`,
    `${FIXTURE_SPEC}%3A2F..%3A2F${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%2F..`,
    `${FIXTURE_SPEC}%2F${FIXTURE_TASK}%2Fextra`,
    `${FIXTURE_SPEC}%5C${FIXTURE_TASK}`,
    `${FIXTURE_SPEC}%2FADR-904`,
    `%2E%2E%2F${FIXTURE_TASK}`,
    '%E0%A4%A',
    '%00',
  ])('rejects malformed scoped segment %s', (segment) => {
    expect(parsePlanningSubject(segment)).toBeNull();
    for (const prefix of ['#/detail/', '#/plan/specs/']) {
      expect(parseDashboardRoute(`${prefix}${segment}`).kind).toBe('not-found');
    }
  });

  it.each(['cycles', 'inbox', 'actions', 'evidence', 'outcomes'])(
    'does not allow scoped Planning identities into Operate %s',
    (path) => {
      for (const subject of [
        encodeURIComponent(FIXTURE_SCOPED),
        encodeURIComponent(FIXTURE_SCOPED.replace('/', ':2F')),
        encodeURIComponent(encodeURIComponent(FIXTURE_SCOPED.replace('/', ':2F'))),
      ]) {
        expect(parseDashboardRoute(`#/operate/${path}/${subject}`).kind).toBe('not-found');
      }
    },
  );

  it.each([
    encodeURIComponent(FIXTURE_SCOPED.replace('/', ':2F')),
    encodeURIComponent(encodeURIComponent(FIXTURE_SCOPED.replace('/', ':2F'))),
  ])('rejects legacy separator in Operate Review and handoff %s', (subject) => {
    for (const href of [
      `#/operate/actions/${subject}/planning`,
      `#/operate/cycles/${subject}/reviews/review-fixture`,
      `#/operate/cycles/cycle-fixture/reviews/${subject}`,
    ])
      expect(parseDashboardRoute(href).kind).toBe('not-found');
    expect(() =>
      serializeDashboardRoute({
        kind: 'operate.action',
        product: 'operate',
        subjectId: FIXTURE_SCOPED.replace('/', ':2F'),
      }),
    ).toThrow();
  });

  it('also preserves strict Review and handoff subject validation', () => {
    const scoped = encodeURIComponent(FIXTURE_SCOPED);
    expect(parseDashboardRoute(`#/operate/actions/${scoped}/planning`).kind).toBe('not-found');
    expect(parseDashboardRoute(`#/operate/cycles/${scoped}/reviews/review-fixture`).kind).toBe(
      'not-found',
    );
    expect(parseDashboardRoute(`#/operate/cycles/cycle-fixture/reviews/${scoped}`).kind).toBe(
      'not-found',
    );
    expect(() =>
      serializeDashboardRoute({
        kind: 'operate.action',
        product: 'operate',
        subjectId: FIXTURE_SCOPED,
      }),
    ).toThrow();
    expect(() => serializePlanningSubject(`${FIXTURE_SPEC}/../${FIXTURE_TASK}`)).toThrow();
    expect(isCanonicalPlanningId(`${FIXTURE_SPEC}/../${FIXTURE_TASK}`)).toBe(false);
  });
});

describe('closed presentation-only URL token', () => {
  it.each(['list', 'graph', 'board', 'activity'] as const)(
    'round-trips %s presentation state without authority',
    (route) => {
      const view = { ...VIEW, route };
      const encoded = serializePlanningViewToken(view);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(parsePlanningViewToken(encoded)).toEqual(view);
      const hash = serializePlanningViewHref(view);
      expect(parseDashboardLocation(hash)).toEqual({
        route: { kind: `planning.${route}`, product: 'planning', subjectId: null },
        presentationView: view,
        invalidView: false,
      });
      expect(canonicalDashboardHref(hash)).toBeNull();
    },
  );

  it.each([
    'binding',
    'actor',
    'actorId',
    'cursor',
    'cursors',
    'sourceViewHash',
    'secret',
    'storageKey',
    'projectId',
    'authority',
    '__proto__',
  ])('rejects authority or extra field %s at every object boundary', (key) => {
    for (const view of [
      { ...VIEW, [key]: 'foreign' },
      { ...VIEW, filters: { ...VIEW.filters, [key]: 'foreign' } },
      { ...VIEW, sort: { ...VIEW.sort, [key]: 'foreign' } },
    ]) {
      expect(validatePlanningView(view)).toBeNull();
      expect(parsePlanningViewToken(token(view))).toBeNull();
      expect(() => serializePlanningViewToken(view as PlanningView)).toThrow();
    }
  });

  it.each([
    { ...VIEW, schemaVersion: '2.0.0' },
    { ...VIEW, route: 'operate' },
    { ...VIEW, groupBy: 'script' },
    { ...VIEW, density: 'tight' },
    { ...VIEW, focusId: '../outside' },
    { ...VIEW, sort: { field: 'actor', direction: 'asc' } },
    { ...VIEW, sort: { field: 'id', direction: 'sideways' } },
    ...[0, 366, 1.5, '7'].flatMap((days) => [
      { ...VIEW, filters: { ...VIEW.filters, createdWithinDays: days } },
      { ...VIEW, filters: { ...VIEW.filters, updatedWithinDays: days } },
    ]),
    { ...VIEW, filters: { ...VIEW.filters, query: 'x'.repeat(201) } },
    { ...VIEW, filters: { ...VIEW.filters, type: ['foreign'] } },
    { ...VIEW, filters: { ...VIEW.filters, status: ['quiet'] } },
    { ...VIEW, filters: { ...VIEW.filters, priority: ['urgent'] } },
    { ...VIEW, filters: { ...VIEW.filters, label: [''] } },
    { ...VIEW, filters: { ...VIEW.filters, label: ['x', 'x'] } },
    { ...VIEW, filters: { ...VIEW.filters, label: ['x'.repeat(81)] } },
  ])('rejects malformed presentation state %j', (view) => {
    expect(validatePlanningView(view)).toBeNull();
    expect(parsePlanningViewToken(token(view))).toBeNull();
  });

  it('accepts nullable optional choices and boundary-sized day values', () => {
    const view = {
      ...VIEW,
      focusId: null,
      filters: { ...VIEW.filters, createdWithinDays: null, updatedWithinDays: null },
    };
    expect(parsePlanningViewToken(serializePlanningViewToken(view))).toEqual(view);
  });

  it('enforces the decoded byte limit including multibyte labels', () => {
    const view = {
      ...VIEW,
      filters: {
        ...VIEW.filters,
        label: Array.from({ length: 50 }, (_, index) => `${index}${'語'.repeat(60)}`),
      },
    };
    expect(validatePlanningView(view)).not.toBeNull();
    expect(() => serializePlanningViewToken(view)).toThrow('4 KiB');
    expect(parsePlanningViewToken(token(view))).toBeNull();
  });

  it.each(['', '%', 'A', 'e30=', token({ schemaVersion: '9.0.0' }), btoa('{'), '_w'])(
    'recovers from invalid token %j to the base route',
    (encoded) => {
      const result = parseDashboardLocation(`#/list?v=${encoded}`);
      expect(result).toEqual({
        route: { kind: 'planning.list', product: 'planning', subjectId: null },
        presentationView: null,
        invalidView: true,
      });
    },
  );

  it.each([
    '#/operate/today?v=x',
    '#/home?v=x',
    '#/list?actor=foreign',
    '#/list?v=x&actor=foreign',
    '#/list?v=x&v=y',
    '#/list?%76=x',
    '#/list?v=x?actor=foreign',
    '#/list?v=x#foreign',
    '#/list/extra?v=x',
  ])('preserves rejection of unrelated query grammar %s', (hash) => {
    expect(parseDashboardRoute(hash).kind).toBe('not-found');
  });

  it('recovers from a view whose route disagrees with the destination', () => {
    expect(parseDashboardLocation(`#/graph?v=${serializePlanningViewToken(VIEW)}`)).toMatchObject({
      presentationView: null,
      invalidView: true,
    });
  });

  it('updates presentation state from hash navigation without altering history', () => {
    const first = serializePlanningViewHref(VIEW);
    const second = serializePlanningViewHref({ ...VIEW, density: 'comfortable' });
    window.history.replaceState(null, '', `/dashboard${first}`);
    render(
      <DashboardProviders buildId="fixture">
        <Snapshot />
      </DashboardProviders>,
    );
    expect(snapshot().presentationView).toEqual(VIEW);
    for (const hash of [second, first, '#/list?v=invalid']) {
      act(() => {
        window.history.replaceState(null, '', `/dashboard${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      expect(window.location.hash).toBe(hash);
      expect(snapshot()).toMatchObject(parseDashboardLocation(hash));
    }
  });
  it('preserves presentation tokens through normal browser Back and Forward', async () => {
    const first = serializePlanningViewHref(VIEW);
    const nextView = { ...VIEW, density: 'comfortable' as const };
    const second = serializePlanningViewHref(nextView);
    window.history.replaceState(null, '', `/dashboard${first}`);
    render(
      <DashboardProviders buildId="fixture">
        <Snapshot />
      </DashboardProviders>,
    );
    act(() => {
      window.history.pushState(null, '', `/dashboard${second}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(snapshot().presentationView).toEqual(nextView);
    act(() => window.history.back());
    await waitFor(() => expect(snapshot().presentationView).toEqual(VIEW));
    expect(window.location.hash).toBe(first);
    act(() => window.history.forward());
    await waitFor(() => expect(snapshot().presentationView).toEqual(nextView));
    expect(window.location.hash).toBe(second);
  });
});

describe('scoped Planning binding identity', () => {
  function binding(subjectId = FIXTURE_SCOPED) {
    return {
      productArea: 'planning',
      route: `#/detail/${encodeURIComponent(subjectId)}`,
      actorId: 'fixture-owner',
      projectId: `sha256:${'a'.repeat(64)}`,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      cycleId: null,
      subjectId,
      eventHead: { sequence: 0, hash: null },
      viewHash: `sha256:${'b'.repeat(64)}`,
      generation: 1,
    };
  }

  it('binds an exact canonical scoped Planning subject while preserving every authority dimension', () => {
    const current = createDashboardQueryIdentity(binding());
    expect(current.subjectId).toBe(FIXTURE_SCOPED);
    expect(Object.isFrozen(current)).toBe(true);
    for (const patch of [
      { actorId: 'foreign-owner' },
      { scopeId: 'foreign-scope' },
      { domainId: 'foreign-domain' },
      { generation: 2 },
      { viewHash: `sha256:${'c'.repeat(64)}` },
    ]) {
      expect(
        isCurrentDashboardQuery(createDashboardQueryIdentity({ ...binding(), ...patch }), current),
      ).toBe(false);
    }
  });

  it.each([
    { subjectId: `${FIXTURE_SPEC}/${FIXTURE_STORY}` },
    { actorId: FIXTURE_SCOPED },
    { scopeId: FIXTURE_SCOPED },
    { cycleId: FIXTURE_SCOPED },
    { subjectId: `${FIXTURE_SPEC}/../${FIXTURE_TASK}` },
    { productArea: 'operate' },
    { route: `#/operate/actions/${encodeURIComponent(FIXTURE_SCOPED)}`, productArea: 'operate' },
    { route: `#/detail/${encodeURIComponent(FIXTURE_SCOPED).replace('%2F', '%252F')}` },
    { route: '#/list?v=invalid', subjectId: null },
    { route: '#/overview', subjectId: null },
    { route: '#/list?actor=foreign', subjectId: null },
    { authority: 'foreign' },
  ])('fails closed for a scoped binding substitution %j', (patch) => {
    expect(() => createDashboardQueryIdentity({ ...binding(), ...patch })).toThrow();
  });

  it('rejects valid presentation tokens as authority routes', () => {
    expect(() =>
      createDashboardQueryIdentity({
        ...binding(),
        route: serializePlanningViewHref(VIEW),
        subjectId: null,
      }),
    ).toThrow('canonical closed dashboard route');
  });

  it('keeps the existing identity length bound for scoped subjects', () => {
    expect(() =>
      createDashboardQueryIdentity(binding(`SPEC-${'1'.repeat(150)}/${FIXTURE_TASK}`)),
    ).toThrow();
  });
});
