// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import { useDashboardRuntimeComposition } from '../../../../apps/dashboard/src/app/runtime-composition.js';
import type {
  PlanningGraphEnvelope,
  PlanningPatchSignal,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  EMPTY_SESSION_ACTIVITY,
  planningActivityScope,
} from '../../../../apps/dashboard/src/features/planning/planning-session-activity.js';
import { parseDashboardBootstrap } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import { freezeDashboardWire } from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { DashboardValidationError } from '../../../../apps/dashboard/src/lib/api/validation.js';

const planning = vi.hoisted(() => ({ fetch: vi.fn(), connect: vi.fn(), reconciler: vi.fn() }));
vi.mock('../../../../apps/dashboard/src/features/planning/planning-api.js', () => ({
  fetchPlanningGraph: planning.fetch,
  parsePlanningGraphEnvelope: (value: unknown) => value,
  createPlanningSseReconciler: planning.reconciler,
  connectPlanningSse: planning.connect,
  encodePlanningCheckpoint: (cursor: { eventHead: { sequence: number } }) =>
    `checkpoint-${cursor.eventHead.sequence}`,
}));

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const root: PlanningGraphEnvelope['binding'] = {
  actorId: 'owner-live',
  projectId: hash('a'),
  scopeId: 'planning' as const,
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 2,
};
const bootstrap = parseDashboardBootstrap({
  kind: 'dashboard-bootstrap',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  ui: { buildId: 'live-test', expectedBuildId: 'live-test', assetManifestHash: hash('c') },
  server: { packageVersion: '2.0.0' },
  capabilities: {
    planningGraph: { schemaVersion: '1.0.0' },
    operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
    operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: false },
    diagnostics: { schemaVersion: '1.0.0', available: true },
  },
  project: {
    projectId: root.projectId,
    name: 'Live fixture',
    branch: 'test',
    products: ['planning', 'operate'],
  },
  queryRoots: { planning: root, operate: null },
  origin: 'http://127.0.0.1:7473',
  compatibility: { status: 'compatible', reasonCodes: [] },
});
const graph = freezeDashboardWire<PlanningGraphEnvelope>({
  kind: 'planning-graph-snapshot',
  schemaVersion: '1.0.0',
  binding: root,
  cursor: { eventHead: { sequence: 0, hash: null }, viewHash: hash('b') },
  mode: 'spec',
  graph: {
    nodes: [
      {
        id: 'SPEC-020',
        type: 'spec',
        title: 'Stable item',
        status: 'in-progress',
        frontmatter: { id: 'SPEC-020' },
      },
    ],
    edges: [],
  },
});
function acceptedUpdate(before: PlanningGraphEnvelope, title: string) {
  const updated = { ...before.graph.nodes[0], title };
  const patch: PlanningPatchSignal['patch'] = {
    added: [],
    updated: [updated],
    removed: [],
    edges: { added: [], removed: [] },
  };
  const nextGraph = { ...before.graph, nodes: [updated] };
  const sequence = before.cursor.eventHead.sequence + 1;
  const viewHash = sha256Jcs(nextGraph as never);
  const to = {
    eventHead: {
      sequence,
      hash: sha256Jcs({
        kind: 'planning-live-head',
        previous: before.cursor.eventHead,
        sequence,
        patchHash: sha256Jcs(patch as never),
        viewHash,
      } as never),
    },
    viewHash,
  };
  const patchHash = sha256Jcs({ from: before.cursor, to, patch } as never);
  const signal: PlanningPatchSignal = {
    patchId: `ppatch_${sequence}_${patchHash.slice(7, 23)}`,
    patchHash,
    from: before.cursor,
    to,
    patch,
  };
  return { snapshot: freezeDashboardWire({ ...before, cursor: to, graph: nextGraph }), signal };
}

type Callbacks = {
  onReady: () => void;
  onPatch: (value: PlanningGraphEnvelope, signal: PlanningPatchSignal) => void;
  onRefetch: (reason: string) => void;
  isCurrent: () => boolean;
};
type Lease = {
  resolve: () => void;
  reject: (error: Error) => void;
  close: ReturnType<typeof vi.fn>;
};
let leases: Lease[];

beforeEach(() => {
  vi.clearAllMocks();
  leases = [];
  planning.fetch.mockResolvedValue(graph);
  planning.reconciler.mockImplementation((options) => options);
  planning.connect.mockImplementation(() => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const close = vi.fn();
    leases.push({ resolve, reject, close });
    return { completion, close };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function callbacks(index = planning.reconciler.mock.calls.length - 1): Callbacks {
  return planning.reconciler.mock.calls[index][0] as Callbacks;
}

describe('Planning live connection custody', () => {
  it('pauses a pending stream immediately when the browser goes offline and validates before reconnecting', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result, unmount } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/activity')),
    );
    await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
    act(() => callbacks().onReady());
    vi.useFakeTimers();
    const accepted = acceptedUpdate(graph, 'Retained while offline');
    act(() => callbacks().onPatch(accepted.snapshot, accepted.signal));
    const entries = result.current.planningLive.activity?.entries;
    const snapshot = result.current.projection.data;
    const first = callbacks();
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.planningLive.state).toBe('paused');
    expect(result.current.planningLive.activity?.connection).toBe('paused');
    expect(result.current.planningLive.activity?.entries).toBe(entries);
    expect(result.current.projection.data).toEqual(snapshot);
    expect(leases[0].close).toHaveBeenCalledTimes(1);
    expect(first.isCurrent()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(planning.fetch).toHaveBeenCalledTimes(1);
    expect(planning.connect).toHaveBeenCalledTimes(1);

    let resolveRead!: (value: typeof graph) => void;
    planning.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(planning.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.planningLive.state).toBe('paused');
    await act(async () => resolveRead(accepted.snapshot));
    expect(planning.connect).toHaveBeenCalledTimes(2);
    expect(result.current.planningLive.activity?.entries).toBe(entries);
    expect(planning.connect.mock.calls[1][0].lastEventId).toBe('checkpoint-1');
    expect(result.current.planningLive.state).not.toBe('connected');
    act(() => callbacks().onReady());
    expect(result.current.planningLive.state).toBe('connected');
    unmount();
    act(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
    expect(planning.fetch).toHaveBeenCalledTimes(2);
  });

  it('starts paused when the browser is already offline without opening a stream', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/activity')),
    );
    await waitFor(() => expect(result.current.planningLive.state).toBe('paused'));
    expect(planning.connect).not.toHaveBeenCalled();
    expect(result.current.projection.data).toEqual(graph);
  });

  it('retains validated bytes with an explicit invalid-response diagnostic after a rejected read', async () => {
    const { result } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/list')),
    );
    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    const retained = result.current.projection.data;
    planning.fetch.mockRejectedValueOnce(
      new DashboardValidationError('$', 'private validator detail'),
    );
    await act(async () => {
      await result.current.refetchCurrent();
    });
    expect(result.current.projection.kind).toBe('stale');
    expect(result.current.projection.data).toEqual(retained);
    expect(result.current.projection.error?.code).toBe('DASHBOARD_RESPONSE_INVALID');
    expect(JSON.stringify(result.current.projection)).not.toContain('private validator detail');
    expect(result.current.projection.mutationEnabled).toBe(false);
  });

  it('never substitutes an explicit pending read from a prior generation into the new binding', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDashboardRuntimeComposition(value, parseDashboardRoute('#/list')),
      { initialProps: { value: bootstrap } },
    );
    await waitFor(() => expect(result.current.projection.kind).toBe('ready'));
    let resolveOld!: (value: typeof graph) => void;
    planning.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    let pending!: ReturnType<typeof result.current.refetchCurrent>;
    act(() => {
      pending = result.current.refetchCurrent();
    });
    const next = parseDashboardBootstrap({
      ...bootstrap,
      queryRoots: { ...bootstrap.queryRoots, planning: { ...root, generation: 3 } },
    });
    planning.fetch.mockRejectedValueOnce(new Error('New root unavailable'));
    rerender({ value: next });
    expect(result.current.projection.data).toBeNull();
    expect(result.current.binding?.generation).toBe(3);
    await waitFor(() => expect(result.current.projection.kind).toBe('unavailable'));
    await act(async () => {
      resolveOld(graph);
      await pending;
    });
    expect(result.current.projection.kind).toBe('unavailable');
    expect(result.current.projection.data).toBeNull();
    expect(result.current.binding?.generation).toBe(3);
  });

  it.each(['resolve', 'reject'] as const)(
    'surfaces a stream %s and reconnects from its accepted checkpoint',
    async (end) => {
      const { result } = renderHook(() =>
        useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/list')),
      );
      await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
      act(() => callbacks().onReady());
      const retained = result.current.projection.data;
      vi.useFakeTimers();
      await act(async () => {
        if (end === 'resolve') leases[0].resolve();
        else leases[0].reject(new Error('Private transport cause'));
      });
      expect(result.current.planningLive).toEqual({
        state: 'paused',
        attempt: 1,
        activity: { ...EMPTY_SESSION_ACTIVITY, connection: 'paused' },
      });
      expect(result.current.projection.data).toEqual(retained);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(planning.connect).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(planning.connect).toHaveBeenCalledTimes(2);
      expect(planning.connect.mock.calls[1][0].lastEventId).toBe('checkpoint-0');
      act(() => callbacks().onReady());
      expect(result.current.planningLive).toEqual({
        state: 'connected',
        attempt: 0,
        activity: { ...EMPTY_SESSION_ACTIVITY, connection: 'connected' },
      });
      expect(planning.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('requires one validated read for a gapped stream before opening another lease', async () => {
    const { result } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/list')),
    );
    await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
    act(() => callbacks().onReady());
    const retained = result.current.projection.data;
    let resolveRead!: (value: typeof graph) => void;
    planning.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const first = callbacks();
    act(() => {
      first.onRefetch('gap');
      first.onRefetch('invalid-event');
    });
    expect(planning.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.planningLive.state).toBe('paused');
    expect(result.current.projection.kind).toBe('refreshing');
    expect(result.current.projection.data).toEqual(retained);
    expect(planning.connect).toHaveBeenCalledTimes(1);
    expect(first.isCurrent()).toBe(false);
    await act(async () => resolveRead(freezeDashboardWire(JSON.parse(JSON.stringify(graph)))));
    expect(planning.connect).toHaveBeenCalledTimes(2);
    act(() => callbacks().onReady());
    expect(result.current.planningLive.state).toBe('connected');
    expect(result.current.projection.kind).toBe('ready');
  });

  it('cancels reconnection and stale callbacks when the binding disappears', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useDashboardRuntimeComposition(enabled ? bootstrap : null, parseDashboardRoute('#/list')),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    const first = callbacks();
    const accepted = acceptedUpdate(graph, 'Retained before custody ends');
    act(() => first.onPatch(accepted.snapshot, accepted.signal));
    expect(result.current.planningLive.activity?.entries).toHaveLength(1);
    await act(async () => leases[0].resolve());
    expect(result.current.planningLive.state).toBe('paused');
    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      first.onReady();
    });
    expect(planning.connect).toHaveBeenCalledTimes(1);
    expect(result.current.planningLive).toEqual({
      state: 'connecting',
      attempt: 0,
      activity: { ...EMPTY_SESSION_ACTIVITY, connection: 'connecting' },
    });
    expect(result.current.planningProjection.data).toBeNull();
    expect(first.isCurrent()).toBe(false);
  });

  it('coalesces accepted patches for 500 ms without pausing and resumes at their latest checkpoint', async () => {
    const { result } = renderHook(() =>
      useDashboardRuntimeComposition(bootstrap, parseDashboardRoute('#/list')),
    );
    await waitFor(() => expect(planning.connect).toHaveBeenCalledTimes(1));
    act(() => callbacks().onReady());
    vi.useFakeTimers();
    planning.fetch.mockImplementationOnce(() => new Promise(() => {}));
    const first = acceptedUpdate(graph, 'First accepted patch');
    const next = acceptedUpdate(first.snapshot, 'Second accepted patch');
    act(() => {
      callbacks().onPatch(first.snapshot, first.signal);
      callbacks().onPatch(next.snapshot, next.signal);
    });
    const retainedEntries = result.current.planningLive.activity?.entries;
    const expectedActivity = {
      scope: planningActivityScope(root),
      connection: 'connected',
      truncated: false,
      patchIds: [first.signal.patchId, next.signal.patchId],
      entries: [first, next].map(({ snapshot, signal }) => ({
        id: `${signal.patchId}:updated:SPEC-020`,
        patchId: signal.patchId,
        sequence: snapshot.cursor.eventHead.sequence,
        kind: 'updated',
        node: snapshot.graph.nodes[0],
      })),
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(planning.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.planningLive).toEqual({
      state: 'connected',
      attempt: 0,
      activity: expectedActivity,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(planning.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.projection.kind).toBe('refreshing');
    expect(result.current.planningLive.state).toBe('connected');
    expect(result.current.planningLive.activity?.entries).toBe(retainedEntries);
    await act(async () => leases[0].resolve());
    expect(result.current.planningLive.activity?.entries).toBe(retainedEntries);
    expect(result.current.planningLive.activity?.connection).toBe('paused');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(planning.connect.mock.calls[1][0].lastEventId).toBe('checkpoint-2');
    act(() => callbacks().onReady());
    expect(result.current.planningLive.activity?.entries).toBe(retainedEntries);
    expect(result.current.planningLive).toEqual({
      state: 'connected',
      attempt: 0,
      activity: expectedActivity,
    });
  });
});
