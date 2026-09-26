/** Closed envelope contracts for the dashboard live-event and Planning transports. */

import { assertOperateExperienceArtifactV2 } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { assertPlanningGraph, assertPlanningNode, detectMode } from './graph-engine.mjs';
import { assertOperateExperienceDisplaySurfaceV1 } from './operate-experience-display-contract.mjs';

export function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

const LIVE_EVENT_KINDS = new Set(['snapshot', 'ready', 'patch', 'stale']);
export const LIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
export const LIVE_HASH = /^sha256:[a-f0-9]{64}$/u;
const LIVE_REASON = /^[A-Z][A-Z0-9_]{0,127}$/u;
const LIVE_PATCH_ID = /^xpatch_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const LIVE_PATCH_PATHS = new Set([
  '/status',
  '/attention',
  '/domainMetrics',
  '/cycles',
  '/inbox',
  '/actions',
  '/evidence',
  '/claims',
  '/rationale',
  '/outcomes',
  '/learnings',
  '/history',
  '/replay',
  '/allowedActions',
  '/omissions',
  '/export',
]);

export function validLiveHead(value) {
  return (
    exactKeys(value, ['sequence', 'hash']) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    ((value.sequence === 0 && value.hash === null) ||
      (value.sequence > 0 && typeof value.hash === 'string' && LIVE_HASH.test(value.hash)))
  );
}

export function validLiveBinding(value) {
  return (
    exactKeys(value, [
      'actorId',
      'projectId',
      'scopeId',
      'domainId',
      'domainVersion',
      'generation',
    ]) &&
    [value.actorId, value.scopeId, value.domainId, value.domainVersion].every(
      (entry) => typeof entry === 'string' && LIVE_ID.test(entry),
    ) &&
    typeof value.projectId === 'string' &&
    LIVE_HASH.test(value.projectId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
  );
}

function validLiveCursor(value) {
  return (
    exactKeys(value, ['eventHead', 'viewHash']) &&
    validLiveHead(value.eventHead) &&
    typeof value.viewHash === 'string' &&
    LIVE_HASH.test(value.viewHash)
  );
}

/** Validate the closed, access-safe dashboard SSE envelope at its server-owner boundary. */
export function assertDashboardLiveEventEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload']) ||
    value.kind !== 'dashboard-live-event' ||
    value.schemaVersion !== '1.0.0' ||
    !LIVE_EVENT_KINDS.has(value.event) ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor)
  ) {
    throw new TypeError('Invalid dashboard live event envelope.');
  }
  const { binding, cursor, payload } = value;
  if (value.event === 'snapshot') {
    const surface = payload?.payload?.surface;
    if (!['today', 'inbox'].includes(surface)) {
      throw new TypeError('Dashboard live snapshot surface is unsupported.');
    }
    assertOperateExperienceDisplaySurfaceV1(payload, {
      actorId: binding.actorId,
      scopeId: binding.scopeId,
      domainId: binding.domainId,
      domainVersion: binding.domainVersion,
      generatedAt: payload?.payload?.generatedAt,
      eventHead: cursor.eventHead,
      viewHash: cursor.viewHash,
      surface,
      ...(surface === 'inbox'
        ? { projectId: binding.projectId, generation: binding.generation, subjectId: null }
        : {}),
    });
    if (payload.payload.ok !== true || payload.payload.surface !== surface) {
      throw new TypeError('Dashboard live snapshot binding is inconsistent.');
    }
  } else if (value.event === 'patch') {
    if (
      !exactKeys(payload, ['patchId', 'patchHash', 'from', 'to', 'changedPaths']) ||
      typeof payload.patchId !== 'string' ||
      !LIVE_PATCH_ID.test(payload.patchId) ||
      typeof payload.patchHash !== 'string' ||
      !LIVE_HASH.test(payload.patchHash) ||
      !validLiveCursor(payload.from) ||
      !validLiveCursor(payload.to) ||
      !Array.isArray(payload.changedPaths) ||
      payload.changedPaths.length !== new Set(payload.changedPaths).size ||
      !payload.changedPaths.every(
        (path) => typeof path === 'string' && LIVE_PATCH_PATHS.has(path),
      ) ||
      payload.to.eventHead.sequence !== cursor.eventHead.sequence ||
      payload.to.eventHead.hash !== cursor.eventHead.hash ||
      payload.to.viewHash !== cursor.viewHash
    ) {
      throw new TypeError('Invalid dashboard live patch signal.');
    }
  } else if (value.event === 'ready') {
    if (
      !exactKeys(payload, ['mutationEnabled', 'reasonCodes']) ||
      typeof payload.mutationEnabled !== 'boolean' ||
      !Array.isArray(payload.reasonCodes) ||
      !payload.reasonCodes.every(
        (reason) => typeof reason === 'string' && LIVE_REASON.test(reason),
      ) ||
      (payload.mutationEnabled && payload.reasonCodes.length !== 0) ||
      (!payload.mutationEnabled && payload.reasonCodes.length === 0)
    ) {
      throw new TypeError('Invalid dashboard live ready payload.');
    }
  } else if (
    !exactKeys(payload, ['mutationEnabled', 'reasonCodes', 'recovery']) ||
    payload.mutationEnabled !== false ||
    !Array.isArray(payload.reasonCodes) ||
    payload.reasonCodes.length < 1 ||
    !payload.reasonCodes.every(
      (reason) => typeof reason === 'string' && LIVE_REASON.test(reason),
    ) ||
    typeof payload.recovery !== 'string' ||
    payload.recovery.length < 1 ||
    payload.recovery.length > 240
  ) {
    throw new TypeError('Invalid dashboard live stale payload.');
  }
  return value;
}

export function createDashboardLiveEventEnvelope({ event, binding, cursor, payload }) {
  let transportPayload = payload;
  if (event === 'patch') {
    assertOperateExperienceArtifactV2('operate-experience-live-patch', payload);
    if (
      payload.actorId !== binding.actorId ||
      payload.scopeId !== binding.scopeId ||
      payload.domainId !== binding.domainId ||
      payload.domainVersion !== binding.domainVersion ||
      payload.toEventHead.sequence !== cursor.eventHead.sequence ||
      payload.toEventHead.hash !== cursor.eventHead.hash ||
      payload.toViewHash !== cursor.viewHash
    ) {
      throw new TypeError('Dashboard live patch binding is inconsistent.');
    }
    transportPayload = Object.freeze({
      patchId: payload.patchId,
      patchHash: payload.patchHash,
      from: Object.freeze({ eventHead: payload.fromEventHead, viewHash: payload.fromViewHash }),
      to: Object.freeze({ eventHead: payload.toEventHead, viewHash: payload.toViewHash }),
      changedPaths: Object.freeze(payload.operations.map((operation) => operation.path)),
    });
  }
  return assertDashboardLiveEventEnvelope({
    kind: 'dashboard-live-event',
    schemaVersion: '1.0.0',
    event,
    binding,
    cursor,
    payload: transportPayload,
  });
}

export function liveGeneration(searchParams) {
  const raw = searchParams.get('generation');
  if (raw === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export const PLANNING_SCHEMA_VERSION = '1.0.0';
export const PLANNING_SCOPE_ID = 'planning';
export const PLANNING_DOMAIN_ID = 'planning';
export const PLANNING_DOMAIN_VERSION = '1.0.0';
export const PLANNING_BINDING_QUERY_KEYS = Object.freeze([
  'projectId',
  'scopeId',
  'domainId',
  'domainVersion',
  'generation',
]);
const PLANNING_MODES = new Set(['agile', 'spec', 'mixed', 'empty']);
const PLANNING_EVENT_KINDS = new Set(['snapshot', 'ready', 'patch', 'stale']);
const PLANNING_PATCH_ID = /^ppatch_[1-9][0-9]*_[a-f0-9]{16}$/u;
const PLANNING_REASON = /^PLANNING_[A-Z0-9_]{1,119}$/u;

function sameLiveHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

export function sameLiveCursor(left, right) {
  return sameLiveHead(left?.eventHead, right?.eventHead) && left?.viewHash === right?.viewHash;
}

export function validPlanningSubject(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    value === '.' ||
    value === '..' ||
    value.includes('\\')
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/** Closed structural assertion for the legacy watcher patch transported to React. */
export function assertPlanningPatch(value) {
  if (
    !exactKeys(value, ['updated', 'added', 'removed', 'edges']) ||
    !Array.isArray(value.updated) ||
    !Array.isArray(value.added) ||
    !Array.isArray(value.removed) ||
    !exactKeys(value.edges, ['added', 'removed']) ||
    !Array.isArray(value.edges.added) ||
    !Array.isArray(value.edges.removed)
  ) {
    throw new TypeError('Invalid Planning watcher patch.');
  }
  const nodes = (entries) =>
    entries.map((entry) => {
      const node = assertPlanningNode(entry);
      if (Object.hasOwn(node, 'body'))
        throw new TypeError('Planning watcher patches cannot include bodies.');
      return node;
    });
  const updated = nodes(value.updated);
  const added = nodes(value.added);
  const removed = value.removed.map((id) => {
    if (!validPlanningSubject(id)) throw new TypeError('Invalid Planning removed identity.');
    return id;
  });
  const allNodeIds = [...updated, ...added].map((node) => node.id);
  if (
    new Set(allNodeIds).size !== allNodeIds.length ||
    new Set(removed).size !== removed.length ||
    allNodeIds.some((id) => removed.includes(id))
  ) {
    throw new TypeError('Planning watcher patch has conflicting node operations.');
  }
  const edges = (entries) =>
    entries.map((edge) => {
      if (
        !exactKeys(edge, ['from', 'to', 'kind']) ||
        !validPlanningSubject(edge.from) ||
        !validPlanningSubject(edge.to) ||
        (edge.kind !== 'contains' && edge.kind !== 'depends_on')
      ) {
        throw new TypeError('Invalid Planning watcher edge.');
      }
      return Object.freeze({ from: edge.from, to: edge.to, kind: edge.kind });
    });
  const edgeAdded = edges(value.edges.added);
  const edgeRemoved = edges(value.edges.removed);
  const edgeKey = (edge) => `${edge.kind}\0${edge.from}\0${edge.to}`;
  const addedKeys = edgeAdded.map(edgeKey);
  const removedKeys = edgeRemoved.map(edgeKey);
  if (
    new Set(addedKeys).size !== addedKeys.length ||
    new Set(removedKeys).size !== removedKeys.length ||
    addedKeys.some((key) => removedKeys.includes(key))
  ) {
    throw new TypeError('Planning watcher patch has conflicting edge operations.');
  }
  return Object.freeze({
    updated: Object.freeze(updated),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    edges: Object.freeze({ added: Object.freeze(edgeAdded), removed: Object.freeze(edgeRemoved) }),
  });
}

export function assertPlanningGraphEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'binding', 'cursor', 'mode', 'graph']) ||
    value.kind !== 'planning-graph-snapshot' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor) ||
    !PLANNING_MODES.has(value.mode)
  ) {
    throw new TypeError('Invalid Planning graph envelope.');
  }
  const graph = assertPlanningGraph(value.graph);
  if (sha256Jcs(graph) !== value.cursor.viewHash || detectMode(graph) !== value.mode) {
    throw new TypeError('Planning graph envelope is not bound to its graph.');
  }
  return Object.freeze({ ...value, graph });
}

export function assertPlanningDetailEnvelope(value) {
  if (
    !exactKeys(value, [
      'kind',
      'schemaVersion',
      'binding',
      'cursor',
      'subjectId',
      'node',
      'nodeHash',
    ]) ||
    value.kind !== 'planning-detail' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor) ||
    !validPlanningSubject(value.subjectId) ||
    typeof value.nodeHash !== 'string' ||
    !LIVE_HASH.test(value.nodeHash)
  ) {
    throw new TypeError('Invalid Planning detail envelope.');
  }
  const node = assertPlanningNode(value.node, value.subjectId);
  if (sha256Jcs(node) !== value.nodeHash) {
    throw new TypeError('Planning detail envelope is not bound to its node.');
  }
  return Object.freeze({ ...value, node });
}

export function assertPlanningPatchSignal(value, cursor) {
  if (
    !exactKeys(value, ['patchId', 'patchHash', 'from', 'to', 'patch']) ||
    typeof value.patchId !== 'string' ||
    !PLANNING_PATCH_ID.test(value.patchId) ||
    typeof value.patchHash !== 'string' ||
    !LIVE_HASH.test(value.patchHash) ||
    !validLiveCursor(value.from) ||
    !validLiveCursor(value.to) ||
    !sameLiveCursor(value.to, cursor) ||
    value.to.eventHead.sequence !== value.from.eventHead.sequence + 1 ||
    value.to.viewHash === value.from.viewHash
  ) {
    throw new TypeError('Invalid Planning live patch signal.');
  }
  const patch = assertPlanningPatch(value.patch);
  const patchDigest = sha256Jcs(patch);
  const expectedHeadHash = sha256Jcs({
    kind: 'planning-live-head',
    previous: value.from.eventHead,
    sequence: value.to.eventHead.sequence,
    patchHash: patchDigest,
    viewHash: value.to.viewHash,
  });
  if (
    value.to.eventHead.hash !== expectedHeadHash ||
    sha256Jcs({ from: value.from, to: value.to, patch }) !== value.patchHash ||
    value.patchId !== `ppatch_${value.to.eventHead.sequence}_${value.patchHash.slice(7, 23)}`
  ) {
    throw new TypeError('Planning live patch commitment is invalid.');
  }
  return Object.freeze({ ...value, patch });
}

export function assertPlanningLiveEventEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload']) ||
    value.kind !== 'planning-live-event' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !PLANNING_EVENT_KINDS.has(value.event) ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor)
  ) {
    throw new TypeError('Invalid Planning live event envelope.');
  }
  let payload;
  if (value.event === 'snapshot') {
    if (!exactKeys(value.payload, ['mode', 'graph']) || !PLANNING_MODES.has(value.payload.mode)) {
      throw new TypeError('Invalid Planning live snapshot.');
    }
    const graph = assertPlanningGraph(value.payload.graph);
    if (sha256Jcs(graph) !== value.cursor.viewHash || detectMode(graph) !== value.payload.mode) {
      throw new TypeError('Planning live snapshot is not bound to its graph.');
    }
    payload = Object.freeze({ mode: value.payload.mode, graph });
  } else if (value.event === 'patch') {
    payload = assertPlanningPatchSignal(value.payload, value.cursor);
  } else if (value.event === 'ready') {
    if (
      !exactKeys(value.payload, ['readOnly', 'reasonCodes']) ||
      value.payload.readOnly !== true ||
      !Array.isArray(value.payload.reasonCodes) ||
      value.payload.reasonCodes.length !== 0
    ) {
      throw new TypeError('Invalid Planning live ready state.');
    }
    payload = Object.freeze({ readOnly: true, reasonCodes: Object.freeze([]) });
  } else {
    if (
      !exactKeys(value.payload, ['readOnly', 'reasonCodes', 'recovery']) ||
      value.payload.readOnly !== true ||
      !Array.isArray(value.payload.reasonCodes) ||
      value.payload.reasonCodes.length < 1 ||
      value.payload.reasonCodes.length > 8 ||
      value.payload.reasonCodes.some(
        (reason) => typeof reason !== 'string' || !PLANNING_REASON.test(reason),
      ) ||
      typeof value.payload.recovery !== 'string' ||
      value.payload.recovery.length < 1 ||
      value.payload.recovery.length > 240
    ) {
      throw new TypeError('Invalid Planning live stale state.');
    }
    payload = Object.freeze({
      readOnly: true,
      reasonCodes: Object.freeze([...value.payload.reasonCodes]),
      recovery: value.payload.recovery,
    });
  }
  return Object.freeze({ ...value, payload });
}

export function encodePlanningCheckpoint(cursor) {
  if (!validLiveCursor(cursor)) throw new TypeError('Invalid Planning checkpoint.');
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePlanningCheckpoint(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!validLiveCursor(parsed) || encodePlanningCheckpoint(parsed) !== value) return null;
    return Object.freeze({
      eventHead: Object.freeze({ ...parsed.eventHead }),
      viewHash: parsed.viewHash,
    });
  } catch {
    return null;
  }
}
