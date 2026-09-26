/** Planning routes: the bound graph snapshot, node detail and the live event stream. */

import { sha256Jcs } from './operate.mjs';
import {
  assertPlanningDetailEnvelope,
  decodePlanningCheckpoint,
  encodePlanningCheckpoint,
  liveGeneration,
  PLANNING_BINDING_QUERY_KEYS,
  PLANNING_DOMAIN_ID,
  PLANNING_DOMAIN_VERSION,
  PLANNING_SCHEMA_VERSION,
  PLANNING_SCOPE_ID,
  sameLiveCursor,
  validLiveBinding,
  validPlanningSubject,
} from './planning.mjs';
import {
  planningBindingError,
  planningJson,
  planningResponseError,
  sseFrame,
} from './responses.mjs';

function planningRequestBinding(req, searchParams, projectId, expectedActorId) {
  const keys = [...searchParams.keys()];
  if (
    keys.length !== PLANNING_BINDING_QUERY_KEYS.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !PLANNING_BINDING_QUERY_KEYS.includes(key))
  )
    return null;
  for (const key of PLANNING_BINDING_QUERY_KEYS) {
    if (searchParams.getAll(key).length !== 1) return null;
  }
  const actorValues = req.headersDistinct?.['x-openplanr-actor'];
  const actorFallback = req.headers['x-openplanr-actor'];
  const actorId = Array.isArray(actorValues)
    ? actorValues.length === 1
      ? actorValues[0]
      : null
    : typeof actorFallback === 'string'
      ? actorFallback
      : null;
  const generation = liveGeneration(searchParams);
  const binding = {
    actorId,
    projectId: searchParams.get('projectId'),
    scopeId: searchParams.get('scopeId'),
    domainId: searchParams.get('domainId'),
    domainVersion: searchParams.get('domainVersion'),
    generation,
  };
  if (
    !validLiveBinding(binding) ||
    binding.projectId !== projectId ||
    binding.scopeId !== PLANNING_SCOPE_ID ||
    binding.domainId !== PLANNING_DOMAIN_ID ||
    binding.domainVersion !== PLANNING_DOMAIN_VERSION ||
    (expectedActorId !== null && binding.actorId !== expectedActorId)
  )
    return null;
  return Object.freeze(binding);
}

function planningCheckpointHeader(req) {
  const values = req.headersDistinct?.['last-event-id'];
  const fallback = req.headers['last-event-id'];
  if (values === undefined && fallback === undefined) {
    return Object.freeze({ valid: true, checkpoint: null });
  }
  const rawValues = Array.isArray(values) ? values : typeof fallback === 'string' ? [fallback] : [];
  if (rawValues.length !== 1) return Object.freeze({ valid: false, checkpoint: null });
  const checkpoint = decodePlanningCheckpoint(rawValues[0]);
  return Object.freeze({ valid: checkpoint !== null, checkpoint });
}

const bindPlanningRequest = ({ dashboard, req, url }) =>
  planningRequestBinding(
    req,
    url.searchParams,
    dashboard.project.projectId,
    dashboard.planningActorId,
  );

export function handlePlanningGraph(context) {
  const binding = bindPlanningRequest(context);
  if (!binding) return planningBindingError(context.res);
  return planningJson(context.res, 200, context.dashboard.planning.graphEnvelope(binding));
}

export function handlePlanningDetail(context) {
  const { dashboard, res, pathname } = context;
  const { planning } = dashboard;
  const binding = bindPlanningRequest(context);
  if (!binding) return planningBindingError(res);
  const rawSubject = pathname.slice('/api/planning/detail/'.length);
  let subjectId;
  try {
    subjectId = decodeURIComponent(rawSubject);
  } catch {
    return planningResponseError(res, 400);
  }
  if (
    !validPlanningSubject(subjectId) ||
    rawSubject.includes('/') ||
    encodeURIComponent(subjectId) !== rawSubject
  ) {
    return planningResponseError(res, 400);
  }
  const graph = planning.ensureGraph();
  const summary = graph.nodes.find((node) => node.id === subjectId);
  if (!summary) return planningResponseError(res, 404);
  const node = planning.readNode(subjectId);
  if (!node) return planningResponseError(res, 404);
  const summaryFields = Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'body'));
  if (sha256Jcs(summaryFields) !== sha256Jcs(summary)) {
    return planningResponseError(res);
  }
  const envelope = assertPlanningDetailEnvelope({
    kind: 'planning-detail',
    schemaVersion: PLANNING_SCHEMA_VERSION,
    binding,
    cursor: planning.cursor(),
    subjectId,
    node,
    nodeHash: sha256Jcs(node),
  });
  return planningJson(res, 200, envelope);
}

export function handlePlanningEvents(context) {
  const { dashboard, req, res } = context;
  const { planning } = dashboard;
  const binding = bindPlanningRequest(context);
  if (!binding) return planningBindingError(res);
  const header = planningCheckpointHeader(req);
  if (!header.valid) return planningResponseError(res, 400);
  const frames = [];
  if (header.checkpoint === null) {
    const event = planning.snapshotEvent(binding);
    frames.push(sseFrame('snapshot', event, encodePlanningCheckpoint(event.cursor)));
  } else if (sameLiveCursor(header.checkpoint, planning.cursor())) {
    const event = planning.readyEvent(binding);
    frames.push(sseFrame('ready', event, encodePlanningCheckpoint(event.cursor)));
  } else {
    const replay = planning.replayPatches(header.checkpoint);
    if (replay === null) {
      const event = planning.staleEvent(binding);
      frames.push(sseFrame('stale', event, encodePlanningCheckpoint(event.cursor)));
    } else {
      for (const signal of replay) {
        const event = planning.liveEnvelope('patch', binding, signal.to, signal);
        frames.push(sseFrame('patch', event, encodePlanningCheckpoint(event.cursor)));
      }
    }
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  for (const frame of frames) res.write(frame);
  const client = Object.freeze({ res, binding });
  planning.clients.add(client);
  req.on('close', () => planning.clients.delete(client));
  return undefined;
}
