/** Planning routes: the bound graph snapshot, node detail and the live event stream. */

import { dirname } from 'node:path';
import { getPlanningReadModel } from '../graph-engine.mjs';
import {
  assertPlanningDiagnosticsEnvelope,
  PLANNING_DIAGNOSTICS_MAX_BYTES,
  PLANNING_DIAGNOSTICS_MAX_COUNT,
} from '../planning-diagnostics-contracts.mjs';
import {
  assertPlanningFileLinkEnvelope,
  PLANNING_FILE_LINK_ERROR_CODES,
  validPlanningFilePath,
} from '../planning-file-link-contracts.mjs';
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
  declaredPlanningFiles,
  readPlanningFileLinkArtifact,
  resolvePlanningFileLink,
} from './planning-file-links.mjs';
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

export function handlePlanningDiagnostics(context) {
  const { dashboard, req, res, url } = context;
  const params = new URLSearchParams(url.searchParams);
  if (params.getAll('sourceViewHash').length !== 1) return planningResponseError(res, 400);
  const sourceViewHash = params.get('sourceViewHash');
  params.delete('sourceViewHash');
  const binding = planningRequestBinding(
    req,
    params,
    dashboard.project.projectId,
    dashboard.planningActorId,
  );
  if (!binding) return planningBindingError(res);
  const { planning } = dashboard;
  const cursor = planning.cursor();
  if (sourceViewHash !== cursor.viewHash) return planningResponseError(res);
  const base = {
    kind: 'planning-diagnostics',
    schemaVersion: PLANNING_SCHEMA_VERSION,
    binding,
    cursor,
    sourceViewHash,
    state: 'unavailable',
    reason: null,
    errorCode: null,
    diagnostics: [],
    totalCount: null,
    truncated: false,
  };
  const respond = (value) =>
    planningJson(res, 200, assertPlanningDiagnosticsEnvelope(value, { binding, cursor }));
  let model;
  try {
    model = getPlanningReadModel(dashboard.planrDir);
  } catch (error) {
    const errorCode = PLANNING_FILE_LINK_ERROR_CODES.includes(error?.code) ? error.code : 'UNKNOWN';
    return respond({
      ...base,
      state: 'error',
      reason: 'Planning source diagnostics could not be read. Check source access and retry.',
      errorCode,
    });
  }
  // A native diagnostic belongs only to its complete source graph, including a delegated snapshot.
  if (sha256Jcs(model.graph) !== cursor.viewHash || !sameLiveCursor(cursor, planning.cursor())) {
    return respond({
      ...base,
      reason:
        'Planning source diagnostics do not match the current graph. Refresh the graph and retry.',
    });
  }
  const diagnostics = model.diagnostics
    .toSorted((left, right) => {
      const key = (entry) =>
        JSON.stringify([entry.sourcePath, entry.nodeId, entry.field, entry.reason]);
      return key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
    })
    .slice(0, PLANNING_DIAGNOSTICS_MAX_COUNT)
    .map((entry) => ({ ...entry, sourcePath: `.planr/${entry.sourcePath}` }));
  const result = {
    ...base,
    state: 'available',
    diagnostics,
    totalCount: model.diagnostics.length,
  };
  const disclose = () => {
    result.truncated = diagnostics.length < result.totalCount;
    result.reason = result.truncated
      ? 'The diagnostics response reached its record or byte limit. Additional source diagnostics are omitted.'
      : null;
  };
  disclose();
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > PLANNING_DIAGNOSTICS_MAX_BYTES) {
    diagnostics.pop();
    disclose();
  }
  return respond(result);
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

export function handlePlanningFileLink(context) {
  const { dashboard, req, res, url, pathname } = context;
  const params = new URLSearchParams(url.searchParams);
  const extraKeys = ['file', 'sourceViewHash'];
  if (extraKeys.some((key) => params.getAll(key).length !== 1))
    return planningResponseError(res, 400);
  const file = params.get('file');
  const sourceViewHash = params.get('sourceViewHash');
  for (const key of extraKeys) params.delete(key);
  const binding = planningRequestBinding(
    req,
    params,
    dashboard.project.projectId,
    dashboard.planningActorId,
  );
  if (!binding) return planningBindingError(res);
  const rawSubject = pathname.slice('/api/planning/file-link/'.length);
  let nodeId;
  try {
    nodeId = decodeURIComponent(rawSubject);
  } catch {
    return planningResponseError(res, 400);
  }
  if (
    !validPlanningSubject(nodeId) ||
    rawSubject.includes('/') ||
    encodeURIComponent(nodeId) !== rawSubject
  )
    return planningResponseError(res, 400);
  const { planning } = dashboard;
  const graph = planning.peekGraph();
  if (!graph) return planningResponseError(res);
  const cursor = planning.cursor();
  if (sourceViewHash !== cursor.viewHash) return planningResponseError(res);
  const summary = graph.nodes.find((node) => node.id === nodeId);
  if (!summary) return planningResponseError(res, 404);
  const respond = (result, path = null) =>
    planningJson(
      res,
      200,
      assertPlanningFileLinkEnvelope(
        {
          kind: 'planning-file-link',
          schemaVersion: '1.0.0',
          binding,
          cursor,
          sourceViewHash: cursor.viewHash,
          nodeId,
          path,
          ...result,
        },
        { binding, cursor, nodeId },
      ),
    );
  const refuse = (reason) =>
    respond({ state: 'unavailable', reason, errorCode: null, editorUrl: null });
  if (!validPlanningFilePath(file) || encodeURIComponent(file).length > 1024)
    return refuse(
      'The file path must be a repository-relative path without traversal, encoded segments or Windows separators, at most 1024 characters.',
    );
  const selected = readPlanningFileLinkArtifact(dashboard.planrDir, summary);
  if (!selected.detail) return respond(selected.result);
  const detail = selected.detail;
  const summaryFields = Object.fromEntries(
    Object.entries(detail.node).filter(([key]) => key !== 'body'),
  );
  if (sha256Jcs(summaryFields) !== sha256Jcs(summary) || !sameLiveCursor(cursor, planning.cursor()))
    return planningResponseError(res);
  const files = declaredPlanningFiles(detail.node);
  if (validPlanningFilePath(detail.sourcePath)) files.add(detail.sourcePath);
  if (!files.has(file)) return refuse('The selected artifact does not declare this file.');
  return respond(resolvePlanningFileLink(dirname(dashboard.planrDir), file), file);
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
