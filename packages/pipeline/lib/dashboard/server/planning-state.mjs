/** Planning graph cache with its committed live cursor, patch history and SSE clients. */

import { sha256Jcs } from './operate.mjs';
import {
  assertPlanningGraph,
  assertPlanningGraphEnvelope,
  assertPlanningLiveEventEnvelope,
  assertPlanningNode,
  assertPlanningPatch,
  assertPlanningPatchSignal,
  buildGraph,
  detectMode,
  engineGetNode,
  PLANNING_SCHEMA_VERSION,
  sameLiveCursor,
} from './planning.mjs';

const MAX_PLANNING_PATCH_HISTORY = 256;

/**
 * Apply a watcher patch (`{ updated, added, removed, edges }`) to an in-memory
 * graph, returning a new graph. Updated nodes replace by id, added nodes append,
 * removed ids drop out; edges add/remove by their `kind from to` identity. Pure
 * — does not mutate the input — so the cache swap is atomic.
 */
export function applyPatch(graph, patch) {
  const base = graph && Array.isArray(graph.nodes) ? graph : { nodes: [], edges: [] };
  if (!patch) return { nodes: [...(base.nodes || [])], edges: [...(base.edges || [])] };

  const removed = new Set(patch.removed || []);
  const replaced = new Map((patch.updated || []).filter((n) => n && n.id).map((n) => [n.id, n]));

  const nodes = (base.nodes || [])
    .filter((n) => !removed.has(n.id))
    .map((n) => (replaced.has(n.id) ? replaced.get(n.id) : n));
  const have = new Set(nodes.map((n) => n.id));
  for (const n of patch.added || []) {
    if (n && n.id && !have.has(n.id)) {
      nodes.push(n);
      have.add(n.id);
    }
  }

  const edgePatch = patch.edges || { added: [], removed: [] };
  const edgeKey = (e) => `${e.kind} ${e.from} ${e.to}`;
  const dropEdges = new Set((edgePatch.removed || []).map(edgeKey));
  const edges = (base.edges || []).filter((e) => !dropEdges.has(edgeKey(e)));
  const haveEdges = new Set(edges.map(edgeKey));
  for (const e of edgePatch.added || []) {
    if (e && !haveEdges.has(edgeKey(e))) {
      edges.push(e);
      haveEdges.add(edgeKey(e));
    }
  }

  return { nodes, edges };
}

/** Refuse no-op/foreign patch operations before they can become a committed revision. */
function applyPlanningPatch(graph, patch) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (
    patch.updated.some((node) => !nodeIds.has(node.id)) ||
    patch.added.some((node) => nodeIds.has(node.id)) ||
    patch.removed.some((id) => !nodeIds.has(id))
  ) {
    throw new TypeError('Planning watcher patch targets a foreign node revision.');
  }
  const edgeKey = (edge) => `${edge.kind}\0${edge.from}\0${edge.to}`;
  const edgeIds = new Set(graph.edges.map(edgeKey));
  if (
    patch.edges.added.some((edge) => edgeIds.has(edgeKey(edge))) ||
    patch.edges.removed.some((edge) => !edgeIds.has(edgeKey(edge)))
  ) {
    throw new TypeError('Planning watcher patch targets a foreign edge revision.');
  }
  const next = assertPlanningGraph(applyPatch(graph, patch));
  if (sha256Jcs(next) === sha256Jcs(graph)) {
    throw new TypeError('Planning watcher patch does not create a new graph revision.');
  }
  return next;
}

/**
 * Planning state for one dashboard server. `getGraph` / `getNode` stay injectable; the default
 * readers build from `planrDir`. The graph is read lazily and replaced only by a committed patch.
 */
export function createPlanningState({ planrDir, getGraph, getNode: suppliedGetNode }) {
  // In-memory graph cache: seeded lazily, patched in place by the watcher so
  // fresh page loads and SSE clients see the same up-to-date graph (one truth).
  let planningSequence = 0;
  let planningHeadHash = null;
  let planningViewHash = null;
  let currentGraph = null;
  const planningPatchHistory = [];
  const readFreshGraph = (options = {}) =>
    assertPlanningGraph(
      typeof getGraph === 'function'
        ? getGraph(Object.freeze({ planrDir, scope: options.scope ?? null }))
        : buildGraph(planrDir, options),
    );
  const ensureGraph = () => {
    if (!currentGraph) {
      currentGraph = readFreshGraph();
      planningViewHash = sha256Jcs(currentGraph);
    }
    return currentGraph;
  };
  const readNode = (id) => {
    const value =
      typeof suppliedGetNode === 'function' ? suppliedGetNode(id) : engineGetNode(planrDir, id);
    return value === null || value === undefined ? null : assertPlanningNode(value, id);
  };
  const planningCursor = () => {
    ensureGraph();
    return Object.freeze({
      eventHead: Object.freeze({ sequence: planningSequence, hash: planningHeadHash }),
      viewHash: planningViewHash,
    });
  };
  const planningGraphEnvelope = (binding) =>
    assertPlanningGraphEnvelope({
      kind: 'planning-graph-snapshot',
      schemaVersion: PLANNING_SCHEMA_VERSION,
      binding,
      cursor: planningCursor(),
      mode: detectMode(ensureGraph()),
      graph: ensureGraph(),
    });
  const planningLiveEnvelope = (event, binding, cursor, payload) =>
    assertPlanningLiveEventEnvelope({
      kind: 'planning-live-event',
      schemaVersion: PLANNING_SCHEMA_VERSION,
      event,
      binding,
      cursor,
      payload,
    });
  const planningSnapshotEvent = (binding) =>
    planningLiveEnvelope(
      'snapshot',
      binding,
      planningCursor(),
      Object.freeze({ mode: detectMode(ensureGraph()), graph: ensureGraph() }),
    );
  const planningReadyEvent = (binding) =>
    planningLiveEnvelope(
      'ready',
      binding,
      planningCursor(),
      Object.freeze({ readOnly: true, reasonCodes: Object.freeze([]) }),
    );
  const planningStaleEvent = (binding, reasonCode = 'PLANNING_EVENT_GAP') =>
    planningLiveEnvelope(
      'stale',
      binding,
      planningCursor(),
      Object.freeze({
        readOnly: true,
        reasonCodes: Object.freeze([reasonCode]),
        recovery: 'Refetch the validated Planning graph before applying more live events.',
      }),
    );
  const replayPlanningPatches = (checkpoint) => {
    const current = planningCursor();
    if (sameLiveCursor(checkpoint, current)) return Object.freeze([]);
    if (checkpoint.eventHead.sequence >= current.eventHead.sequence) return null;
    const chain = [];
    let cursor = checkpoint;
    for (let count = 0; count < planningPatchHistory.length; count += 1) {
      const signal = planningPatchHistory.find((entry) => sameLiveCursor(entry.from, cursor));
      if (!signal) return null;
      chain.push(signal);
      cursor = signal.to;
      if (sameLiveCursor(cursor, current)) return Object.freeze(chain);
    }
    return null;
  };

  /** Validate a watcher patch against the cached graph; throws when it is not a new revision. */
  const preparePatch = (patch) => {
    const accepted = assertPlanningPatch(patch);
    return { accepted, next: applyPlanningPatch(ensureGraph(), accepted) };
  };

  /** Commit a prepared patch as the next cursor and keep its signal for checkpoint replay. */
  const commitPatch = ({ accepted, next }) => {
    const from = planningCursor();
    const viewHash = sha256Jcs(next);
    const patchDigest = sha256Jcs(accepted);
    const nextSequence = from.eventHead.sequence + 1;
    const headHash = sha256Jcs({
      kind: 'planning-live-head',
      previous: from.eventHead,
      sequence: nextSequence,
      patchHash: patchDigest,
      viewHash,
    });
    const to = Object.freeze({
      eventHead: Object.freeze({ sequence: nextSequence, hash: headHash }),
      viewHash,
    });
    const patchHash = sha256Jcs({ from, to, patch: accepted });
    const signal = assertPlanningPatchSignal(
      {
        patchId: `ppatch_${nextSequence}_${patchHash.slice(7, 23)}`,
        patchHash,
        from,
        to,
        patch: accepted,
      },
      to,
    );

    currentGraph = next;
    planningSequence = nextSequence;
    planningHeadHash = headHash;
    planningViewHash = viewHash;
    planningPatchHistory.push(signal);
    if (planningPatchHistory.length > MAX_PLANNING_PATCH_HISTORY) planningPatchHistory.shift();
    return { signal, to };
  };

  return Object.freeze({
    clients: new Set(),
    readFreshGraph,
    ensureGraph,
    readNode,
    cursor: planningCursor,
    graphEnvelope: planningGraphEnvelope,
    liveEnvelope: planningLiveEnvelope,
    snapshotEvent: planningSnapshotEvent,
    readyEvent: planningReadyEvent,
    staleEvent: planningStaleEvent,
    replayPatches: replayPlanningPatches,
    preparePatch,
    commitPatch,
  });
}
