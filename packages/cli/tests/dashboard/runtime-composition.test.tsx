// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import { useDashboardRuntimeComposition } from '../../../../apps/dashboard/src/app/runtime-composition.js';
import { resolvePlanningHandoffModel } from '../../../../apps/dashboard/src/features/operate/planning/planning-handoff-model.js';
import { planningNodesFromProductState } from '../../../../apps/dashboard/src/features/planning/planning-workspace.js';
import { parseDashboardBootstrap } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import { freezeDashboardWire } from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { DashboardValidationError } from '../../../../apps/dashboard/src/lib/api/validation.js';
import {
  createDashboardApiFixture,
  DASHBOARD_FIXTURE_ACTION_ID,
  DASHBOARD_FIXTURE_CYCLE_ID,
} from '../e2e/fixtures/dashboard-api-fixture.mjs';

const planning = vi.hoisted(() => ({
  fetch: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
}));

const operate = vi.hoisted(() => ({
  root: vi.fn(),
  action: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
}));

vi.mock('../../../../apps/dashboard/src/features/planning/planning-api.js', () => ({
  fetchPlanningGraph: planning.fetch,
  parsePlanningGraphEnvelope: (value: unknown) => value,
  createPlanningSseReconciler: () => Object.freeze({}),
  connectPlanningSse: planning.connect,
  encodePlanningCheckpoint: () => 'checkpoint',
}));

vi.mock('../../../../apps/dashboard/src/app/runtime-reads.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../apps/dashboard/src/app/runtime-reads.js')>();
  return { ...actual, fetchOperateRootDisplay: operate.root };
});

vi.mock(
  '../../../../apps/dashboard/src/features/operate/actions/operate-action-api.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../apps/dashboard/src/features/operate/actions/operate-action-api.js')
      >();
    return { ...actual, fetchOperateActionDisplay: operate.action };
  },
);

vi.mock('../../../../apps/dashboard/src/lib/api/sse.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../apps/dashboard/src/lib/api/sse.js')>();
  return {
    ...actual,
    connectDashboardSse: operate.connect,
    createDashboardSseReconciler: () => Object.freeze({}),
  };
});

const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const PROJECT_ID = HASH('a');
const VIEW_HASH = HASH('b');

function wireFixture<T>(value: T): T {
  return freezeDashboardWire(JSON.parse(JSON.stringify(value)) as T);
}

const bootstrap = parseDashboardBootstrap({
  kind: 'dashboard-bootstrap',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  ui: {
    buildId: 'runtime-composition-test',
    expectedBuildId: 'runtime-composition-test',
    assetManifestHash: HASH('c'),
  },
  server: { packageVersion: '2.0.0' },
  capabilities: {
    planningGraph: { schemaVersion: '1.0.0' },
    operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
    operateCommands: {
      protocolVersion: '2.0.0',
      transportVersion: '1.0.0',
      available: false,
    },
    diagnostics: { schemaVersion: '1.0.0', available: true },
  },
  project: {
    projectId: PROJECT_ID,
    name: 'Runtime composition',
    branch: 'feature/runtime-composition',
    products: ['planning', 'operate'],
  },
  queryRoots: {
    planning: {
      actorId: 'owner-runtime-composition',
      projectId: PROJECT_ID,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: 2,
    },
    operate: null,
  },
  origin: 'http://127.0.0.1:7473',
  compatibility: { status: 'compatible', reasonCodes: [] },
});

const graphEnvelope = Object.freeze({
  kind: 'planning-graph-snapshot' as const,
  schemaVersion: '1.0.0' as const,
  binding: Object.freeze({
    actorId: 'owner-runtime-composition',
    projectId: PROJECT_ID,
    scopeId: 'planning' as const,
    domainId: 'planning' as const,
    domainVersion: '1.0.0' as const,
    generation: 2,
  }),
  cursor: Object.freeze({
    eventHead: Object.freeze({ sequence: 0, hash: null }),
    viewHash: VIEW_HASH,
  }),
  mode: 'spec' as const,
  graph: Object.freeze({
    nodes: Object.freeze([
      Object.freeze({
        id: 'SPEC-020',
        type: 'spec' as const,
        title: 'Improve appointment reminder delivery',
        status: 'in-progress' as const,
        frontmatter: Object.freeze({ id: 'SPEC-020' }),
      }),
    ]),
    edges: Object.freeze([]),
  }),
});

describe('production dashboard runtime composition', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps one Planning read and SSE lease while navigating between Operate routes', async () => {
    planning.fetch.mockResolvedValue(graphEnvelope);
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );

    const { result, rerender, unmount } = renderHook(
      ({ hash }: { hash: string }) =>
        useDashboardRuntimeComposition(bootstrap, parseDashboardRoute(hash)),
      { initialProps: { hash: '#/operate/today' } },
    );

    await waitFor(() => {
      expect(planning.fetch).toHaveBeenCalledTimes(1);
      expect(planning.connect).toHaveBeenCalledTimes(1);
      expect(planningNodesFromProductState(result.current.planningProjection)).toMatchObject([
        { id: 'SPEC-020', title: 'Improve appointment reminder delivery' },
      ]);
    });

    rerender({ hash: '#/operate/cycles' });
    await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
    expect(planning.fetch).toHaveBeenCalledTimes(1);
    expect(planning.close).not.toHaveBeenCalled();

    unmount();
    expect(planning.close).toHaveBeenCalledTimes(1);
  });

  it('rebinds one verified Planning graph immediately across Planning view routes', async () => {
    planning.fetch.mockResolvedValue(graphEnvelope);
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );

    const { result, rerender, unmount } = renderHook(
      ({ hash }: { hash: string }) =>
        useDashboardRuntimeComposition(bootstrap, parseDashboardRoute(hash)),
      { initialProps: { hash: '#/overview' } },
    );

    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    expect(result.current.binding?.route).toBe('#/overview');
    expect(planning.fetch).toHaveBeenCalledTimes(1);

    rerender({ hash: '#/graph' });

    // The graph is a root-level verified snapshot. Rebind it to the exact display route instead
    // of briefly replacing the workspace with an untrusted/loading route while re-reading bytes.
    expect(result.current.projection.kind).toBe('ready');
    expect(result.current.binding).toMatchObject({
      route: '#/graph',
      productArea: 'planning',
      subjectId: null,
      eventHead: graphEnvelope.cursor.eventHead,
      viewHash: graphEnvelope.cursor.viewHash,
    });
    expect(result.current.projection.binding).toMatchObject({
      route: '#/graph',
      eventHead: graphEnvelope.cursor.eventHead,
      viewHash: graphEnvelope.cursor.viewHash,
    });
    expect(planning.fetch).toHaveBeenCalledTimes(1);

    rerender({ hash: '#/detail/SPEC-020' });
    expect(result.current.projection.kind).toBe('ready');
    expect(result.current.binding).toMatchObject({
      route: '#/detail/SPEC-020',
      productArea: 'planning',
      subjectId: 'SPEC-020',
      eventHead: graphEnvelope.cursor.eventHead,
      viewHash: graphEnvelope.cursor.viewHash,
    });
    expect(result.current.projection.binding).toMatchObject({
      route: '#/detail/SPEC-020',
      eventHead: graphEnvelope.cursor.eventHead,
      viewHash: graphEnvelope.cursor.viewHash,
    });
    expect(planning.fetch).toHaveBeenCalledTimes(1);

    unmount();
    expect(planning.close).toHaveBeenCalledTimes(1);
  });

  it('does not carry a verified Planning graph across a changed root custody', async () => {
    const nextPlanningRoot = bootstrap.queryRoots.planning;
    if (!nextPlanningRoot) throw new Error('Test bootstrap requires a Planning root.');
    const nextBootstrap = parseDashboardBootstrap({
      ...bootstrap,
      queryRoots: {
        ...bootstrap.queryRoots,
        planning: { ...nextPlanningRoot, generation: nextPlanningRoot.generation + 1 },
      },
    });
    planning.fetch
      .mockResolvedValueOnce(graphEnvelope)
      .mockRejectedValueOnce(new Error('new Planning root is unavailable'));
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );

    const { result, rerender, unmount } = renderHook(
      ({ value, hash }: { value: typeof bootstrap; hash: string }) =>
        useDashboardRuntimeComposition(value, parseDashboardRoute(hash)),
      { initialProps: { value: bootstrap, hash: '#/overview' } },
    );

    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    rerender({ value: nextBootstrap, hash: '#/graph' });

    expect(result.current.projection.kind).toBe('loading');
    expect(result.current.projection.data).toBeNull();
    expect(result.current.binding).toMatchObject({
      route: '#/graph',
      generation: nextPlanningRoot.generation + 1,
    });
    await waitFor(() => expect(planning.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.projection.kind).toBe('unavailable'));
    expect(result.current.projection.data).toBeNull();
    expect(result.current.projection.error).toEqual({
      code: 'DASHBOARD_READ_FAILED',
      retryable: false,
      context: { operation: 'dashboard.projection.read' },
    });
    expect(result.current.binding).toMatchObject({
      route: '#/graph',
      generation: nextPlanningRoot.generation + 1,
    });

    unmount();
  });

  it('retains a failed exact refetch as a typed read-only projection without leaking internals', async () => {
    planning.fetch.mockResolvedValue(graphEnvelope);
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );
    const { result, unmount } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/overview')),
    );
    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));

    const privateFailure = new Error('private exact refetch details');
    privateFailure.stack = 'private stack and host paths';
    planning.fetch.mockRejectedValueOnce(privateFailure);
    let failed: Awaited<ReturnType<typeof result.current.refetchCurrent>> | null = null;
    await act(async () => {
      failed = await result.current.refetchCurrent();
    });
    expect(failed?.kind).toBe('stale');
    expect(failed?.mutationEnabled).toBe(false);
    expect(failed?.error).toEqual({
      code: 'DASHBOARD_READ_FAILED',
      retryable: false,
      context: { operation: 'dashboard.projection.read' },
    });
    expect(JSON.stringify(failed)).not.toContain('private exact refetch details');
    expect(JSON.stringify(failed)).not.toContain('private stack and host paths');
    await waitFor(() => expect(result.current.projection.kind).toBe('stale'));
    expect(result.current.projection.mutationEnabled).toBe(false);
    expect(planningNodesFromProductState(result.current.projection)).toMatchObject([
      { id: 'SPEC-020' },
    ]);

    planning.fetch.mockResolvedValueOnce(graphEnvelope);
    let reconciled: Awaited<ReturnType<typeof result.current.refetchCurrent>> | null = null;
    await act(async () => {
      reconciled = await result.current.refetchCurrent();
    });
    expect(reconciled?.kind).toBe('ready');
    unmount();
  });

  it('fails an invalid initial projection safely without rendering bytes or stack details', async () => {
    const privateFailure = new DashboardValidationError(
      '$.payload',
      'private invalid-response details',
    );
    privateFailure.stack = 'private invalid-response stack and host paths';
    planning.fetch.mockRejectedValue(privateFailure);

    const { result, unmount } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/overview')),
    );

    await waitFor(() => expect(result.current.projection.kind).toBe('corrupt'));
    expect(result.current.binding).toBeNull();
    expect(result.current.projection).toMatchObject({
      kind: 'corrupt',
      binding: null,
      data: null,
      mutationEnabled: false,
      error: {
        code: 'DASHBOARD_RESPONSE_INVALID',
        retryable: false,
        context: {},
      },
    });
    expect(JSON.stringify(result.current.projection)).not.toContain('private invalid-response');
    expect(planning.connect).not.toHaveBeenCalled();
    unmount();
  });

  it('rebinds one verified Action workspace immediately into its Planning handoff', async () => {
    const fixture = createDashboardApiFixture();
    const operateBootstrap = parseDashboardBootstrap(fixture.bootstrap);
    const actionRoute = `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`;
    const handoffRoute = `${actionRoute}/planning`;
    const today = wireFixture(fixture.today);
    const cycles = wireFixture(fixture.cycles);
    const action = wireFixture(fixture.action);
    planning.fetch.mockResolvedValue(wireFixture(fixture.planning));
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );
    operate.root.mockImplementation(({ surface }: { surface: string }) =>
      Promise.resolve(surface === 'today' ? today : cycles),
    );
    operate.action.mockResolvedValue(action);
    operate.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: operate.close }),
    );

    const { result, rerender, unmount } = renderHook(
      ({ hash }: { hash: string }) =>
        useDashboardRuntimeComposition(operateBootstrap, parseDashboardRoute(hash)),
      { initialProps: { hash: actionRoute } },
    );

    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    expect(result.current.binding).toMatchObject({
      route: actionRoute,
      productArea: 'operate',
      subjectId: DASHBOARD_FIXTURE_ACTION_ID,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      eventHead: action.payload.eventHead,
      viewHash: action.payload.viewHash,
    });
    expect(operate.action).toHaveBeenCalledTimes(1);
    expect(operate.action).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          route: actionRoute,
          subjectId: DASHBOARD_FIXTURE_ACTION_ID,
          cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
        }),
      }),
    );

    rerender({ hash: handoffRoute });

    expect(result.current.projection.kind).toBe('ready');
    expect(result.current.binding?.route).toBe(handoffRoute);
    expect(result.current.projection.binding?.route).toBe(handoffRoute);
    expect(result.current.binding).toMatchObject({
      route: handoffRoute,
      productArea: 'operate',
      subjectId: DASHBOARD_FIXTURE_ACTION_ID,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      eventHead: action.payload.eventHead,
      viewHash: action.payload.viewHash,
    });
    expect(result.current.projection.binding).toMatchObject({
      route: handoffRoute,
      subjectId: DASHBOARD_FIXTURE_ACTION_ID,
      eventHead: action.payload.eventHead,
      viewHash: action.payload.viewHash,
    });
    expect(result.current.projection.mutationEnabled).toBe(false);
    const handoffBinding = result.current.binding;
    if (!handoffBinding) throw new TypeError('Planning handoff binding is unavailable.');
    expect(resolvePlanningHandoffModel(result.current.projection, handoffBinding)).not.toBeNull();
    expect(operate.action).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not retain an Action workspace across a different Action custody', async () => {
    const fixture = createDashboardApiFixture();
    const operateBootstrap = parseDashboardBootstrap(fixture.bootstrap);
    const actionRoute = `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`;
    const foreignActionId = 'act_foreign_0001';
    const foreignActionRoute = `#/operate/actions/${foreignActionId}`;
    const today = wireFixture(fixture.today);
    const cycles = wireFixture(fixture.cycles);
    const action = wireFixture(fixture.action);
    planning.fetch.mockResolvedValue(wireFixture(fixture.planning));
    planning.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: planning.close }),
    );
    operate.root.mockImplementation(({ surface }: { surface: string }) =>
      Promise.resolve(surface === 'today' ? today : cycles),
    );
    operate.action
      .mockResolvedValueOnce(action)
      .mockRejectedValueOnce(new Error('foreign Action display is unavailable'));
    operate.connect.mockReturnValue(
      Object.freeze({ completion: Promise.resolve(), close: operate.close }),
    );

    const { result, rerender, unmount } = renderHook(
      ({ hash }: { hash: string }) =>
        useDashboardRuntimeComposition(operateBootstrap, parseDashboardRoute(hash)),
      { initialProps: { hash: actionRoute } },
    );

    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    rerender({ hash: foreignActionRoute });

    expect(result.current.projection.kind).toBe('loading');
    expect(result.current.projection.data).toBeNull();
    expect(result.current.binding).toMatchObject({
      route: foreignActionRoute,
      subjectId: foreignActionId,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
    });
    await waitFor(() => expect(operate.action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.projection.kind).toBe('unavailable'));
    expect(result.current.projection.data).toBeNull();

    unmount();
  });
});
