import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import {
  connectPlanningSse,
  createPlanningSseReconciler,
  fetchPlanningDetail,
  fetchPlanningGraph,
  type PlanningBinding,
  type PlanningCursor,
  type PlanningGraph,
  type PlanningGraphEnvelope,
  type PlanningPatch,
  parsePlanningDetailEnvelope,
  parsePlanningGraphEnvelope,
  parsePlanningGraphJson,
  parsePlanningLiveEvent,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  buildPlanningSearchIndex,
  filterPlanningNodes,
  groupPlanningNodes,
  planningDetailHref,
  planningNodeIdFromRouteSubject,
  planningRouteSubjectId,
  queryPlanningSearchIndex,
  selectAccessiblePlanningGraphRows,
  selectPlanningActivity,
  selectPlanningDetail,
  selectPlanningSprint,
  sortPlanningNodes,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { startOperateDashboard } from '../../src/cli/commands/operate.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createTestProject } from '../helpers/test-project.js';

const actorId = 'owner-planning-parity';
const projectId = `sha256:${'f'.repeat(64)}`;
const binding: PlanningBinding = Object.freeze({
  actorId,
  projectId,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 8,
});

const graph: PlanningGraph = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({
      id: 'SPEC-020',
      type: 'spec' as const,
      title: 'Unified dashboard',
      status: 'in-progress' as const,
      frontmatter: Object.freeze({ id: 'SPEC-020', created: '2026-08-01' }),
    }),
    Object.freeze({
      id: 'SPEC-020/US-011',
      type: 'story' as const,
      title: 'Planning parity',
      status: 'outstanding' as const,
      frontmatter: Object.freeze({ id: 'US-011', specId: 'SPEC-020', sprintId: 'S-1' }),
    }),
    Object.freeze({
      id: 'SPEC-020/T-022',
      type: 'task' as const,
      title: 'Bound Planning transport',
      status: 'blocked' as const,
      frontmatter: Object.freeze({
        id: 'T-022',
        specId: 'SPEC-020',
        storyId: 'US-011',
        sprintId: 'S-1',
        updated: '2026-08-03',
        agent: 'frontend',
      }),
    }),
    Object.freeze({
      id: 'S-1',
      type: 'sprint' as const,
      title: 'Sprint one',
      status: 'in-progress' as const,
      frontmatter: Object.freeze({ id: 'S-1', created: '2026-08-01', lengthDays: 10 }),
    }),
  ]),
  edges: Object.freeze([
    Object.freeze({ from: 'SPEC-020', to: 'SPEC-020/US-011', kind: 'contains' as const }),
    Object.freeze({
      from: 'SPEC-020/US-011',
      to: 'SPEC-020/T-022',
      kind: 'contains' as const,
    }),
  ]),
});

const cursor: PlanningCursor = Object.freeze({
  eventHead: Object.freeze({ sequence: 0, hash: null }),
  viewHash: sha256Jcs(graph as never),
});

function identity(overrides: Partial<DashboardQueryIdentity> = {}): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'planning',
    route: '#/graph',
    actorId,
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    cycleId: null,
    subjectId: null,
    eventHead: cursor.eventHead,
    viewHash: cursor.viewHash,
    generation: 8,
    ...overrides,
  });
}

function snapshot(value: PlanningGraph = graph): PlanningGraphEnvelope {
  const nextCursor = { eventHead: cursor.eventHead, viewHash: sha256Jcs(value as never) };
  return parsePlanningGraphEnvelope(
    {
      kind: 'planning-graph-snapshot',
      schemaVersion: '1.0.0',
      binding,
      cursor: nextCursor,
      mode: 'spec',
      graph: value,
    },
    identity({ eventHead: nextCursor.eventHead, viewHash: nextCursor.viewHash }),
  );
}

function patchEvent(from: PlanningCursor, patch: PlanningPatch, nextGraph: PlanningGraph) {
  const patchDigest = sha256Jcs(patch as never);
  const nextSequence = from.eventHead.sequence + 1;
  const viewHash = sha256Jcs(nextGraph as never);
  const eventHead = {
    sequence: nextSequence,
    hash: sha256Jcs({
      kind: 'planning-live-head',
      previous: from.eventHead,
      sequence: nextSequence,
      patchHash: patchDigest,
      viewHash,
    } as never),
  };
  const to = { eventHead, viewHash };
  const patchHash = sha256Jcs({ from, to, patch } as never);
  return {
    kind: 'planning-live-event',
    schemaVersion: '1.0.0',
    event: 'patch',
    binding,
    cursor: to,
    payload: {
      patchId: `ppatch_${nextSequence}_${patchHash.slice(7, 23)}`,
      patchHash,
      from,
      to,
      patch,
    },
  };
}

describe('T-022 Planning owner/client parity', () => {
  it('accepts the owner graph only when its single viewHash revision commitment matches', () => {
    const accepted = snapshot();
    expect(accepted.graph).toEqual(graph);
    expect(accepted.cursor.viewHash).toBe(sha256Jcs(graph as never));
    expect(Object.keys(accepted.cursor).sort()).toEqual(['eventHead', 'viewHash']);
    expect('revision' in accepted.cursor).toBe(false);

    const reordered = { ...graph, nodes: [...graph.nodes].reverse() };
    expect(() =>
      parsePlanningGraphEnvelope(
        {
          ...accepted,
          graph: reordered,
          // A body reorder is a new graph revision. Keeping the old viewHash is refused.
          cursor: accepted.cursor,
        },
        identity(),
      ),
    ).toThrow(/commitment disagree/u);
    expect(() =>
      parsePlanningGraphEnvelope(
        { ...accepted, binding: { ...binding, actorId: 'foreign' } },
        identity(),
      ),
    ).toThrow(/foreign/u);
    const duplicateMember = JSON.stringify(accepted).replace(
      '"kind":"planning-graph-snapshot"',
      '"kind":"planning-graph-snapshot","kind":"planning-graph-snapshot"',
    );
    expect(() => parsePlanningGraphJson(duplicateMember, identity())).toThrow(/duplicate/u);
    for (const id of ['\uD800', '\uDC00']) {
      const hostileGraph = { ...graph, nodes: [{ ...graph.nodes[0], id }] };
      expect(() =>
        parsePlanningGraphEnvelope(
          {
            ...accepted,
            graph: hostileGraph,
          },
          identity(),
        ),
      ).toThrow(/subject identity/u);
    }
  });

  it('binds detail identity/body to the exact graph cursor and refuses substitution', async () => {
    const acceptedGraph = snapshot();
    let graphCache: RequestCache | undefined;
    const fetchedGraph = await fetchPlanningGraph({
      origin: 'http://127.0.0.1:7473/',
      identity: identity(),
      fetcher: (async (_input, init) => {
        graphCache = init?.cache;
        return new Response(JSON.stringify(acceptedGraph), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }) as typeof fetch,
    });
    expect(fetchedGraph).toEqual(acceptedGraph);
    expect(graphCache).toBe('no-store');
    const detailIdentity = identity({
      route: '#/detail/SPEC-020%3A2FT-022',
      subjectId: 'SPEC-020:2FT-022',
    });
    const node = {
      ...graph.nodes[2],
      body: '## Acceptance Criteria\n\n- exact revision\n\n- [x] Validate binding',
    };
    const wire = {
      kind: 'planning-detail',
      schemaVersion: '1.0.0',
      binding,
      cursor,
      subjectId: node.id,
      node,
      nodeHash: sha256Jcs(node as never),
    };
    const accepted = parsePlanningDetailEnvelope(wire, detailIdentity, acceptedGraph);
    expect(selectPlanningDetail(accepted.node)).toMatchObject({
      header: { id: 'SPEC-020/T-022', status: 'blocked' },
      criteria: ['exact revision'],
      subtasks: [{ text: 'Validate binding', done: true }],
    });
    expect(planningDetailHref(accepted.node)).toBe('#/detail/SPEC-020%3A2FT-022');
    expect(() =>
      parsePlanningDetailEnvelope(
        { ...wire, cursor: { ...cursor, viewHash: `sha256:${'1'.repeat(64)}` } },
        detailIdentity,
        acceptedGraph,
      ),
    ).toThrow(/graph revision/u);
    expect(() =>
      parsePlanningDetailEnvelope(
        { ...wire, node: { ...node, title: 'Substituted' } },
        detailIdentity,
        acceptedGraph,
      ),
    ).toThrow(/commitment/u);

    const requested: { url: string | null; headers: Headers | null; cache?: RequestCache } = {
      url: null,
      headers: null,
    };
    const reloaded = await fetchPlanningDetail({
      origin: 'http://127.0.0.1:7473/',
      identity: detailIdentity,
      snapshot: acceptedGraph,
      fetcher: (async (input, init) => {
        requested.url = String(input);
        requested.headers = new Headers(init?.headers);
        requested.cache = init?.cache;
        return new Response(JSON.stringify(wire), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }) as typeof fetch,
    });
    expect(reloaded).toEqual(accepted);
    const requestedUrl = new URL(requested.url ?? 'http://invalid');
    expect(requestedUrl.pathname).toBe('/api/planning/detail/SPEC-020%2FT-022');
    expect([...requestedUrl.searchParams.keys()]).toEqual([
      'projectId',
      'scopeId',
      'domainId',
      'domainVersion',
      'generation',
    ]);
    expect(requested.headers?.get('x-openplanr-actor')).toBe(actorId);
    expect(requested.cache).toBe('no-store');
  });

  it('round-trips every route-only subject injectively without widening router grammar', () => {
    const ids = [
      'T-022',
      'SPEC-020/T-022',
      'literal:2F:3A',
      'colon:value',
      'percent%value',
      'unicode-مرحبا-計画',
    ];
    const encoded = ids.map((id) => {
      const value = planningRouteSubjectId(id);
      if (value === null) throw new Error(`valid route subject refused: ${id}`);
      return value;
    });
    expect(new Set(encoded).size).toBe(ids.length);
    expect(encoded.map(planningNodeIdFromRouteSubject)).toEqual(ids);
    for (const subjectId of encoded) {
      const route = parseDashboardRoute(`#/detail/${encodeURIComponent(subjectId)}`);
      expect(route).not.toMatchObject({ kind: 'not-found' });
      if (route.kind !== 'not-found') {
        expect(serializeDashboardRoute(route)).toBe(`#/detail/${encodeURIComponent(subjectId)}`);
      }
    }
    for (const malformed of [':', ':2', ':2f', ':GG', 'raw:slash/value', '%2F']) {
      expect(planningNodeIdFromRouteSubject(malformed)).toBeNull();
    }
    expect(planningRouteSubjectId('\uD800')).toBeNull();
    expect(planningRouteSubjectId('\uDC00')).toBeNull();
    const replacementSubject = planningRouteSubjectId('\uFFFD');
    expect(replacementSubject).not.toBeNull();
    expect(planningNodeIdFromRouteSubject(replacementSubject ?? '')).toBe('\uFFFD');
    // The adapter does not broaden the closed router: encoded slash/backslash
    // remain refused by the unchanged router grammar.
    expect(parseDashboardRoute('#/detail/SPEC-020%2FT-022')).toMatchObject({ kind: 'not-found' });
    expect(parseDashboardRoute('#/detail/SPEC-020%5CT-022')).toMatchObject({ kind: 'not-found' });
  });

  it('reconciles replay exactly, deduplicates, and refetches gaps/restarts before callbacks', () => {
    const updated = Object.freeze({ ...graph.nodes[2], status: 'in-progress' as const });
    const nextGraph = Object.freeze({
      nodes: Object.freeze(graph.nodes.map((node) => (node.id === updated.id ? updated : node))),
      edges: graph.edges,
    });
    const planningPatch: PlanningPatch = Object.freeze({
      updated: Object.freeze([updated]),
      added: Object.freeze([]),
      removed: Object.freeze([]),
      edges: Object.freeze({ added: Object.freeze([]), removed: Object.freeze([]) }),
    });
    const parsedPatch = parsePlanningLiveEvent(
      patchEvent(cursor, planningPatch, nextGraph),
      identity(),
    );
    const patches = vi.fn();
    const refetches = vi.fn();
    const reconciler = createPlanningSseReconciler({
      identity: identity(),
      initial: snapshot(),
      isCurrent: () => true,
      onSnapshot: vi.fn(),
      onPatch: patches,
      onRefetch: refetches,
    });
    expect(reconciler.ingest(parsedPatch)).toEqual({ kind: 'accepted', event: 'patch' });
    expect(reconciler.ingest(parsedPatch)).toEqual({ kind: 'duplicate' });
    expect(patches).toHaveBeenCalledOnce();
    expect(reconciler.getSnapshot()?.graph).toEqual(nextGraph);

    const foreign = {
      ...structuredClone(parsedPatch),
      binding: { ...parsedPatch.binding, actorId: 'foreign-owner' },
    };
    expect(reconciler.ingest(foreign as never)).toEqual({
      kind: 'rejected',
      reason: 'foreign-binding',
    });
    expect(patches).toHaveBeenCalledOnce();

    const skippedBase: PlanningCursor = {
      eventHead: { sequence: 2, hash: `sha256:${'9'.repeat(64)}` },
      viewHash: `sha256:${'8'.repeat(64)}`,
    };
    const skipped = parsePlanningLiveEvent(
      patchEvent(skippedBase, planningPatch, nextGraph),
      identity(),
    );
    expect(reconciler.ingest(skipped)).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(refetches).toHaveBeenCalledOnce();

    const restarted = parsePlanningLiveEvent(
      {
        kind: 'planning-live-event',
        schemaVersion: '1.0.0',
        event: 'snapshot',
        binding,
        cursor,
        payload: { mode: 'spec', graph },
      },
      identity(),
    );
    expect(reconciler.ingest(restarted)).toEqual({
      kind: 'refetch',
      reason: 'gap',
    });
    expect(refetches).toHaveBeenCalledOnce();
    expect(patches).toHaveBeenCalledOnce();

    const quarantinedPatches = vi.fn();
    const quarantinedRefetches = vi.fn();
    const quarantined = createPlanningSseReconciler({
      identity: identity(),
      initial: snapshot(),
      isCurrent: () => true,
      onSnapshot: vi.fn(),
      onPatch: quarantinedPatches,
      onRefetch: quarantinedRefetches,
    });
    expect(quarantined.ingest(skipped)).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(quarantined.ingest(parsedPatch)).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(quarantinedRefetches).toHaveBeenCalledOnce();
    expect(quarantinedPatches).not.toHaveBeenCalled();
    expect(quarantined.markReconciled(snapshot())).toBe(true);
    expect(quarantined.ingest(parsedPatch)).toEqual({ kind: 'accepted', event: 'patch' });
    expect(quarantinedPatches).toHaveBeenCalledOnce();

    const nextSnapshot = parsePlanningGraphEnvelope(
      {
        kind: 'planning-graph-snapshot',
        schemaVersion: '1.0.0',
        binding,
        cursor: parsedPatch.cursor,
        mode: 'spec',
        graph: nextGraph,
      },
      identity(),
    );
    const restartRefetches = vi.fn();
    const restartReconciler = createPlanningSseReconciler({
      identity: identity(),
      initial: nextSnapshot,
      isCurrent: () => true,
      onSnapshot: vi.fn(),
      onPatch: vi.fn(),
      onRefetch: restartRefetches,
    });
    expect(restartReconciler.ingest(restarted)).toEqual({
      kind: 'refetch',
      reason: 'restart-regression',
    });
    expect(restartRefetches).toHaveBeenCalledOnce();
  });

  it('routes malformed, foreign, and name-mismatched SSE frames through one quarantining refetch', async () => {
    const updated = Object.freeze({ ...graph.nodes[2], status: 'in-progress' as const });
    const nextGraph = Object.freeze({
      nodes: Object.freeze(graph.nodes.map((node) => (node.id === updated.id ? updated : node))),
      edges: graph.edges,
    });
    const planningPatch: PlanningPatch = Object.freeze({
      updated: Object.freeze([updated]),
      added: Object.freeze([]),
      removed: Object.freeze([]),
      edges: Object.freeze({ added: Object.freeze([]), removed: Object.freeze([]) }),
    });
    const validPatch = patchEvent(cursor, planningPatch, nextGraph);
    const validFrame = `event: patch\ndata: ${JSON.stringify(validPatch)}\n\n`;
    const hostileFrames = [
      'event: patch\ndata: {not-json}\n\n',
      `event: patch\ndata: ${JSON.stringify({
        ...validPatch,
        binding: { ...validPatch.binding, actorId: 'foreign-owner' },
      })}\n\n`,
      `event: snapshot\ndata: ${JSON.stringify(validPatch)}\n\n`,
    ];

    for (const hostileFrame of hostileFrames) {
      const patches = vi.fn();
      const refetches = vi.fn();
      const reconciler = createPlanningSseReconciler({
        identity: identity(),
        initial: snapshot(),
        isCurrent: () => true,
        onSnapshot: vi.fn(),
        onPatch: patches,
        onRefetch: refetches,
      });
      const connection = connectPlanningSse({
        origin: 'http://127.0.0.1:7473/',
        identity: identity(),
        reconciler,
        fetcher: (async () =>
          new Response(`${hostileFrame}${validFrame}`, {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          })) as typeof fetch,
      });
      await expect(connection.completion).resolves.toBeUndefined();
      expect(refetches).toHaveBeenCalledOnce();
      expect(refetches).toHaveBeenCalledWith('invalid-event');
      expect(patches).not.toHaveBeenCalled();
      expect(reconciler.getSnapshot()?.graph).toEqual(graph);
      connection.close();
      expect(reconciler.ingest(parsePlanningLiveEvent(validPatch, identity()))).toEqual({
        kind: 'rejected',
        reason: 'inactive',
      });
    }
  });

  it('keeps malformed frames inactive after disposal or query supersession, including awaited reads', async () => {
    const malformedJson = '{not-json}';
    const malformedFrame = `event: patch\ndata: ${malformedJson}\n\n`;
    const createTrackedReconciler = (isCurrent: () => boolean) => {
      const stateChanges = vi.fn();
      const refetches = vi.fn();
      const reconciler = createPlanningSseReconciler({
        identity: identity(),
        initial: snapshot(),
        isCurrent,
        onSnapshot: stateChanges,
        onPatch: stateChanges,
        onReady: stateChanges,
        onStale: stateChanges,
        onRefetch: refetches,
      });
      return { reconciler, refetches, stateChanges };
    };

    const disposed = createTrackedReconciler(() => true);
    disposed.reconciler.dispose();
    expect(disposed.reconciler.ingestJson(malformedJson)).toEqual({
      kind: 'rejected',
      reason: 'inactive',
    });
    expect(disposed.reconciler.ingestSseFrame(malformedJson, 'patch')).toEqual({
      kind: 'rejected',
      reason: 'inactive',
    });
    expect(disposed.refetches).not.toHaveBeenCalled();
    expect(disposed.stateChanges).not.toHaveBeenCalled();
    expect(disposed.reconciler.getSnapshot()?.graph).toEqual(graph);

    let current = false;
    const superseded = createTrackedReconciler(() => current);
    expect(superseded.reconciler.ingestJson(malformedJson)).toEqual({
      kind: 'rejected',
      reason: 'inactive',
    });
    expect(superseded.reconciler.ingestSseFrame(malformedJson, 'snapshot')).toEqual({
      kind: 'rejected',
      reason: 'inactive',
    });
    expect(superseded.refetches).not.toHaveBeenCalled();
    expect(superseded.stateChanges).not.toHaveBeenCalled();
    expect(superseded.reconciler.getSnapshot()?.graph).toEqual(graph);

    const exerciseAwaitedFrame = async (mode: 'close' | 'supersede') => {
      current = true;
      const tracked = createTrackedReconciler(() => current);
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      let markReadStarted!: () => void;
      let releaseRead = () => undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const heldRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const stream = new ReadableStream<Uint8Array>(
        {
          start: (controller) => {
            streamController = controller;
          },
          pull: () => {
            markReadStarted();
            return heldRead;
          },
        },
        { highWaterMark: 0 },
      );
      const connection = connectPlanningSse({
        origin: 'http://127.0.0.1:7473/',
        identity: identity(),
        reconciler: tracked.reconciler,
        fetcher: (async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          })) as typeof fetch,
      });
      await readStarted;
      if (mode === 'close') connection.close();
      else current = false;
      streamController.enqueue(new TextEncoder().encode(malformedFrame));
      streamController.close();
      releaseRead();
      await expect(connection.completion).resolves.toBeUndefined();
      expect(tracked.refetches).not.toHaveBeenCalled();
      expect(tracked.stateChanges).not.toHaveBeenCalled();
      expect(tracked.reconciler.getSnapshot()?.graph).toEqual(graph);
      connection.close();
    };

    await exerciseAwaitedFrame('close');
    await exerciseAwaitedFrame('supersede');
  });

  it('keeps legacy list, board, search, sprint, activity, and graph-alternative semantics', () => {
    expect(filterPlanningNodes(graph.nodes, { typeFilter: ['task'], search: 't-022' })).toEqual([
      graph.nodes[2],
    ]);
    expect(
      sortPlanningNodes([...graph.nodes].reverse(), 'id', 'asc').map((node) => node.id),
    ).toEqual(['S-1', 'SPEC-020', 'SPEC-020/T-022', 'SPEC-020/US-011']);
    expect(
      groupPlanningNodes(graph.nodes, 'status').map((group) => [group.key, group.nodes.length]),
    ).toEqual([
      ['outstanding', 1],
      ['in-progress', 2],
      ['blocked', 1],
      ['done', 0],
    ]);
    expect(
      queryPlanningSearchIndex(buildPlanningSearchIndex(graph.nodes), 'bound transport'),
    ).toEqual([graph.nodes[2]]);
    expect(selectPlanningSprint(graph)).toMatchObject({
      sprintId: 'S-1',
      committed: 2,
      completed: 0,
      carryover: 0,
      velocity: 0,
    });
    const activity = selectPlanningActivity([
      { updated: [graph.nodes[1]], added: [], removed: [] },
      { updated: [graph.nodes[2]], added: [], removed: [] },
    ]);
    expect(activity.map((entry) => entry.id)).toEqual(['SPEC-020/T-022', 'SPEC-020/US-011']);
    const rows = selectAccessiblePlanningGraphRows(graph);
    expect(rows.map((row) => row.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(rows[2]).toMatchObject({
      id: 'SPEC-020/T-022',
      hierarchyLevel: 3,
      containedBy: ['SPEC-020/US-011'],
      detailHref: '#/detail/SPEC-020%3A2FT-022',
    });
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it('accepts a graph above the generic dashboard 4k-object ceiling without weakening checks', () => {
    const largeGraph: PlanningGraph = {
      nodes: Object.freeze(
        Array.from({ length: 4_200 }, (_, index) =>
          Object.freeze({
            id: `T-${index + 1}`,
            type: 'task' as const,
            title: `Task ${index + 1}`,
            status: 'outstanding' as const,
            frontmatter: Object.freeze({ id: `T-${index + 1}` }),
          }),
        ),
      ),
      edges: Object.freeze([]),
    };
    const viewHash = sha256Jcs(largeGraph as never);
    const accepted = parsePlanningGraphJson(
      JSON.stringify({
        kind: 'planning-graph-snapshot',
        schemaVersion: '1.0.0',
        binding,
        cursor: { eventHead: { sequence: 0, hash: null }, viewHash },
        mode: 'empty',
        graph: largeGraph,
      }),
      identity({ viewHash }),
    );
    expect(accepted.graph.nodes).toHaveLength(4_200);
    expect(Object.isFrozen(accepted.graph.nodes)).toBe(true);
  });

  it('wires only the existing read-only OpenPlanr dashboard seam to the exact actor', async () => {
    const project = await createTestProject('t022-planning-adapter-seam');
    try {
      const client = createOperateClient(project.dir);
      const started = await client.dispatch({
        operation: 'operate.cycle.start',
        request: {
          scope: { scopeId: 'scope-t022', domainId: 'software', domainVersion: '1.0.0' },
          focus: ['Verify the read-only Planning adapter seam.'],
          trigger: { kind: 'manual' },
          mode: 'standard',
          ownerActorId: actorId,
          deliveryRoute: 'observe-only',
        },
      });
      if (!started.ok) throw new Error(JSON.stringify(started));
      const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
      let options: Record<string, unknown> | null = null;
      const dashboard = await startOperateDashboard({
        projectDir: project.dir,
        cycleId,
        actorId,
        watch: false,
        startDashboard: (value) => {
          options = value as unknown as Record<string, unknown>;
          return {
            listen: async () => 47_473,
            close: async () => undefined,
          };
        },
      });
      expect(options).toMatchObject({
        planrDir: `${project.dir}/.planr`,
        watch: false,
        planningActorId: actorId,
      });
      expect(options).not.toHaveProperty('planningMutationGateway');
      expect(options).not.toHaveProperty('planningSearch');
      expect(dashboard.url).toBe('http://127.0.0.1:47473/#/operate/today');
      await dashboard.close();
    } finally {
      project.cleanup();
    }
  });
});
