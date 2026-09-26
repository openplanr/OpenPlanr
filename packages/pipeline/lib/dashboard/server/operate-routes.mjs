/** Operate read routes: the projection, local reviews, bound display surfaces and the live stream. */

import {
  assertOperateReviewDisplayWorkspaceV1,
  decodeOperateExperienceCheckpoint,
  encodeOperateExperienceCheckpoint,
  readLocalOperateReview,
  readLocalOperateReviewIndex,
  selectOperateActionDisplayWorkspace,
  selectOperateCycleDisplayWorkspace,
  selectOperateExecutiveBoardDisplay,
  selectOperateExperienceAuditDisplaySurface,
  selectOperateExperienceDisplaySurface,
  selectOperateExperienceSurface,
  selectOperateInboxItemDisplaySurface,
  selectOperateRecoveryDisplay,
} from './operate.mjs';
import { supportsGovernedAction } from './operate-state.mjs';
import { createDashboardLiveEventEnvelope, liveGeneration } from './planning.mjs';
import { dashboardSafeErrorJson, experienceJson, json, sseFrame } from './responses.mjs';

export function experienceBinding(req, searchParams) {
  const actorHeader = req.headers['x-openplanr-actor'];
  const actorHeaders = req.headersDistinct?.['x-openplanr-actor'];
  const binding = {
    actorId:
      Array.isArray(actorHeader) || (Array.isArray(actorHeaders) && actorHeaders.length !== 1)
        ? null
        : actorHeader,
    ...Object.fromEntries(
      ['scopeId', 'domainId', 'domainVersion'].map((field) => [field, searchParams.get(field)]),
    ),
  };
  return Object.values(binding).every((value) => typeof value === 'string' && value.length > 0)
    ? binding
    : null;
}

export const OPERATE_BINDING_QUERY_KEYS = Object.freeze(['scopeId', 'domainId', 'domainVersion']);
const OPERATE_COLLECTION_ROUTES = new Map([
  ['cycles', 'cycles'],
  ['outcomes', 'outcomes'],
  ['actions', 'actions'],
]);
const OPERATE_DETAIL_ROUTES = new Map([
  ['cycle', 'cycle'],
  ['cycles', 'cycle'],
  ['action', 'action'],
  ['actions', 'action'],
  ['evidence', 'evidence'],
  ['outcome', 'outcome'],
  ['outcomes', 'outcome'],
]);
const OPERATE_SINGLETON_ROUTES = new Set([
  'today',
  'inbox',
  'evidence',
  'history',
  'search',
  'export',
  'events',
  'recovery',
]);
const OPERATE_AUDIT_DISPLAY_SURFACES = new Set([
  'evidence',
  'outcomes',
  'outcome',
  'history',
  'search',
  'export',
]);
export const OPERATE_SUBJECT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OPERATE_INBOX_ITEM_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function parseOperateApiRoute(pathname) {
  return parseOperateRoute(pathname);
}

export function parseOperateRoute(pathname) {
  const prefix = '/api/operate/';
  if (!pathname.startsWith(prefix)) return null;
  const rawParts = pathname.slice(prefix.length).split('/');
  if (rawParts.some((part) => part.length === 0 || /%(?:2f|5c)/iu.test(part))) return null;
  let parts;
  try {
    parts = rawParts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (rawParts[0] !== parts[0]) return null;
  if (parts.length === 1 && OPERATE_SINGLETON_ROUTES.has(parts[0])) {
    return Object.freeze({ surface: parts[0], subjectId: null });
  }
  if (parts.length === 1 && OPERATE_COLLECTION_ROUTES.has(parts[0])) {
    return Object.freeze({ surface: OPERATE_COLLECTION_ROUTES.get(parts[0]), subjectId: null });
  }
  if (parts.length === 3 && parts[0] === 'cycles' && parts[2] === 'executive-board') {
    const subjectId = parts[1];
    if (!OPERATE_SUBJECT_SEGMENT.test(subjectId) || subjectId === '.' || subjectId === '..') {
      return null;
    }
    return Object.freeze({ surface: 'cycle-executive-board', subjectId });
  }
  if (parts.length === 4 && parts[0] === 'cycles' && parts[2] === 'reviews') {
    const cycleId = parts[1];
    const subjectId = parts[3];
    if (
      ![cycleId, subjectId].every(
        (id) => OPERATE_SUBJECT_SEGMENT.test(id) && id !== '.' && id !== '..',
      )
    )
      return null;
    return Object.freeze({ surface: 'review', cycleId, subjectId });
  }
  if (parts.length === 2 && parts[0] === 'inbox') {
    const subjectId = parts[1];
    if (!OPERATE_INBOX_ITEM_SEGMENT.test(subjectId)) return null;
    return Object.freeze({ surface: 'inbox', subjectId });
  }
  if (parts.length !== 2 || !OPERATE_DETAIL_ROUTES.has(parts[0])) return null;
  const subjectId = parts[1];
  if (!OPERATE_SUBJECT_SEGMENT.test(subjectId) || subjectId === '.' || subjectId === '..')
    return null;
  return Object.freeze({ surface: OPERATE_DETAIL_ROUTES.get(parts[0]), subjectId });
}

function hasInvalidOperateQuery(route, searchParams) {
  const allowed = new Set(OPERATE_BINDING_QUERY_KEYS);
  if (OPERATE_AUDIT_DISPLAY_SURFACES.has(route.surface)) allowed.add('cycleId');
  if (route.surface === 'inbox' || route.surface === 'actions') {
    allowed.add('projectId');
    allowed.add('generation');
  }
  if (route.surface === 'actions') allowed.add('cycleId');
  if (route.surface === 'events') {
    allowed.add('generation');
    allowed.add('projectId');
    allowed.add('surface');
  }
  if (route.surface === 'search') allowed.add('q');
  if (route.surface === 'export') allowed.add('format');
  const seen = new Set();
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function sameExperienceBinding(view, binding) {
  return (
    binding &&
    ['actorId', 'scopeId', 'domainId', 'domainVersion'].every(
      (field) => view?.[field] === binding[field],
    )
  );
}

export function exactEventHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

export function closedReviewWorkspace(value, binding, cycleId, reviewId, refreshedView) {
  let workspace;
  try {
    workspace = structuredClone(value);
    assertOperateReviewDisplayWorkspaceV1(workspace);
  } catch {
    return null;
  }
  const payload = workspace.payload;
  const exactCurrentSource =
    exactEventHead(payload.sourceEventHead, refreshedView.eventHead) &&
    payload.sourceViewHash === refreshedView.viewHash;
  const historicalTerminalSource =
    payload.sourceArtifactKind === 'operating-review-receipt' &&
    payload.status === 'terminal' &&
    payload.sourceEventHead.sequence < refreshedView.eventHead.sequence &&
    refreshedView.cycles.some((cycle) => cycle.cycleId === cycleId);
  if (
    payload.actorId !== binding.actorId ||
    payload.scopeId !== binding.scopeId ||
    payload.domainId !== binding.domainId ||
    payload.domainVersion !== binding.domainVersion ||
    payload.cycleId !== cycleId ||
    payload.reviewId !== reviewId ||
    (!exactCurrentSource && !historicalTerminalSource)
  )
    return null;
  return Object.freeze(workspace);
}

function liveCheckpointHeader(req) {
  const values = req.headersDistinct?.['last-event-id'];
  const fallback = req.headers['last-event-id'];
  if (values === undefined && fallback === undefined) {
    return Object.freeze({ valid: true, checkpoint: null });
  }
  const rawValues = Array.isArray(values) ? values : typeof fallback === 'string' ? [fallback] : [];
  if (rawValues.length !== 1 || typeof rawValues[0] !== 'string') {
    return Object.freeze({ valid: false, checkpoint: null });
  }
  const checkpoint = decodeOperateExperienceCheckpoint(rawValues[0]);
  if (!checkpoint || encodeOperateExperienceCheckpoint(checkpoint) !== rawValues[0]) {
    return Object.freeze({ valid: false, checkpoint: null });
  }
  return Object.freeze({ valid: true, checkpoint });
}

/** Answer an Operate read with the closed refusal envelope. */
function operateRefusal(res, { status, reasonCode, message }) {
  return experienceJson(res, status, {
    ok: false,
    error: {
      reasonCode,
      message,
      retryable: false,
    },
  });
}

const refusal = (status, reasonCode, message) =>
  Object.freeze({ refusal: Object.freeze({ status, reasonCode, message }) });

/** A display selection carries its own refusal status; any other response is a 200. */
const displayJson = (res, response) =>
  experienceJson(res, response.ok === false ? response.status : 200, response);

export function handleOperateProjection({ dashboard, res }) {
  const { getOperatingProjection } = dashboard;
  return json(res, 200, getOperatingProjection());
}

export function handleLocalReviewIndex({ dashboard, res, url }) {
  const pageValue = url.searchParams.get('page');
  const pageSizeValue = url.searchParams.get('pageSize');
  const page = pageValue === null ? 1 : Number(pageValue);
  const pageSize = pageSizeValue === null ? 20 : Number(pageSizeValue);
  if (
    [...url.searchParams.keys()].some((key) => key !== 'page' && key !== 'pageSize') ||
    [...url.searchParams.getAll('page')].length > 1 ||
    [...url.searchParams.getAll('pageSize')].length > 1 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    return dashboardSafeErrorJson(res, 400, {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: {},
    });
  }
  return experienceJson(
    res,
    200,
    readLocalOperateReviewIndex(dashboard.planrDir, { page, pageSize }),
  );
}

export function handleLocalReview({ dashboard, res, parts }) {
  let cycleId;
  try {
    cycleId = decodeURIComponent(parts[3]);
  } catch {
    cycleId = '';
  }
  const report = readLocalOperateReview(dashboard.planrDir, cycleId);
  return report
    ? experienceJson(res, 200, report)
    : dashboardSafeErrorJson(res, 404, {
        code: 'DASHBOARD_ERROR_UNAVAILABLE',
        retryable: false,
        context: {},
      });
}

/** Validate the surface-specific query before any projection read; returns a refusal or the selection. */
function readOperateSelection({ dashboard, req, url, pathname }, route) {
  const requestedAuditSurface = OPERATE_AUDIT_DISPLAY_SURFACES.has(route.surface);
  const requestedAuditCycleId = requestedAuditSurface ? url.searchParams.get('cycleId') : null;
  if (
    requestedAuditSurface &&
    (requestedAuditCycleId === null || !OPERATE_SUBJECT_SEGMENT.test(requestedAuditCycleId))
  ) {
    return refusal(
      400,
      'OPERATE_QUERY_INVALID',
      'The operating audit route requires one exact Cycle binding.',
    );
  }
  const requestedAuditQuery = route.surface === 'search' ? (url.searchParams.get('q') ?? '') : null;
  const requestedAuditFormat =
    route.surface === 'export' ? (url.searchParams.get('format') ?? 'json') : null;
  if (
    (route.surface === 'search' && requestedAuditQuery.length > 512) ||
    (route.surface === 'export' && !['json', 'html'].includes(requestedAuditFormat))
  ) {
    return refusal(400, 'OPERATE_QUERY_INVALID', 'The operating audit selection is invalid.');
  }
  const requestedLiveSurface =
    pathname === '/api/operate/events' ? (url.searchParams.get('surface') ?? 'today') : null;
  if (pathname === '/api/operate/events' && !['today', 'inbox'].includes(requestedLiveSurface)) {
    return refusal(
      400,
      'OPERATE_QUERY_INVALID',
      'The operating live route accepts only a documented display surface.',
    );
  }
  const requestedActionsCycleId =
    route.surface === 'actions' ? url.searchParams.get('cycleId') : null;
  if (
    route.surface === 'actions' &&
    (requestedActionsCycleId === null || !OPERATE_SUBJECT_SEGMENT.test(requestedActionsCycleId))
  ) {
    return refusal(
      400,
      'OPERATE_QUERY_INVALID',
      'The operating Actions route requires one exact Cycle binding.',
    );
  }
  const inboxSnapshot =
    route.surface === 'inbox' ||
    (pathname === '/api/operate/events' && requestedLiveSurface === 'inbox');
  const actionsSnapshot = pathname === '/api/operate/actions';
  const generation =
    pathname === '/api/operate/events' || inboxSnapshot || actionsSnapshot
      ? liveGeneration(url.searchParams)
      : undefined;
  if (
    (pathname === '/api/operate/events' || inboxSnapshot || actionsSnapshot) &&
    generation === null
  ) {
    return refusal(
      400,
      'OPERATE_GENERATION_INVALID',
      'The live request generation must be a non-negative safe integer.',
    );
  }
  if (
    (inboxSnapshot || actionsSnapshot) &&
    url.searchParams.get('projectId') !== dashboard.project.projectId
  ) {
    return refusal(
      403,
      'OPERATE_BINDING_MISMATCH',
      'The requested operating view is unavailable for this project.',
    );
  }
  const checkpointHeader =
    pathname === '/api/operate/events' ? liveCheckpointHeader(req) : undefined;
  if (checkpointHeader && !checkpointHeader.valid) {
    return refusal(
      400,
      'OPERATE_CHECKPOINT_INVALID',
      'The live checkpoint is invalid. Refresh the access-safe snapshot.',
    );
  }
  return Object.freeze({
    auditSurface: requestedAuditSurface,
    auditCycleId: requestedAuditCycleId,
    auditQuery: requestedAuditQuery,
    auditFormat: requestedAuditFormat,
    liveSurface: requestedLiveSurface,
    actionsCycleId: requestedActionsCycleId,
    generation,
    checkpoint: checkpointHeader?.checkpoint ?? null,
  });
}

/** Every `/api/operate/...` GET that no earlier route claimed; an undocumented shape answers 400. */
export async function handleOperateSurface(context) {
  const { dashboard, req, res, url, pathname } = context;
  const route = context.match.operateRoute;
  if (!route) {
    return operateRefusal(res, {
      status: 400,
      reasonCode: 'OPERATE_ROUTE_INVALID',
      message: 'The operating route does not match a documented surface shape.',
    });
  }
  if (hasInvalidOperateQuery(route, url.searchParams)) {
    return operateRefusal(res, {
      status: 400,
      reasonCode: 'OPERATE_QUERY_INVALID',
      message: 'The operating route accepts only its documented query fields.',
    });
  }
  const binding = experienceBinding(req, url.searchParams);
  if (!binding) {
    return operateRefusal(res, {
      status: 400,
      reasonCode: 'OPERATE_BINDING_REQUIRED',
      message: 'Actor, scope, domain, and domain version are required.',
    });
  }
  const selection = readOperateSelection(context, route);
  if (selection.refusal) return operateRefusal(res, selection.refusal);
  const read = dashboard.operate.ensureExperience();
  if (!read?.view) {
    return operateRefusal(res, {
      status: read?.status === 'absent' ? 404 : 409,
      reasonCode: read?.reasonCodes?.[0] ?? 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'The operating experience is unavailable until OpenPlanr refreshes it.',
    });
  }
  if (!sameExperienceBinding(read.view, binding)) {
    return operateRefusal(res, {
      status: 403,
      reasonCode: 'OPERATE_BINDING_MISMATCH',
      message: 'The requested operating view is unavailable for this actor and scope.',
    });
  }
  if (pathname === '/api/operate/events') {
    return openOperateLiveStream(context, read.view, binding, selection);
  }
  if (route.surface === 'cycle-executive-board') {
    return respondExecutiveBoard(res, read.view, binding, route);
  }
  if (route.surface === 'review') return respondReviewWorkspace(context, read.view, binding, route);
  if (route.surface === 'action') return respondActionWorkspace(context, read.view, binding, route);
  if (route.surface === 'cycle') return respondCycleWorkspace(context, read.view, binding, route);
  if (route.surface === 'recovery') return respondRecovery(context, read.view, binding);
  return respondOperateDisplay(context, read.view, binding, route, selection);
}

function liveDisplaySurface(current, binding, surface, projectId, generation) {
  return selectOperateExperienceDisplaySurface(current, {
    surface,
    binding: {
      ...binding,
      generatedAt: current.generatedAt,
      eventHead: current.eventHead,
      viewHash: current.viewHash,
      surface,
      ...(surface === 'inbox' ? { projectId, generation, subjectId: null } : {}),
    },
  });
}

/** The patches that lead from `checkpoint` to `current`, or null when the history has a gap. */
function replayOperatePatches(history, checkpoint, current) {
  const chain = [];
  let expectedViewHash = checkpoint.viewHash;
  let expectedHead = checkpoint.eventHead;
  for (const patch of history) {
    if (
      patch.fromViewHash !== expectedViewHash ||
      patch.fromEventHead.sequence !== expectedHead.sequence ||
      patch.fromEventHead.hash !== expectedHead.hash
    )
      continue;
    chain.push(patch);
    expectedViewHash = patch.toViewHash;
    expectedHead = patch.toEventHead;
    if (expectedViewHash === current.viewHash) break;
  }
  const complete =
    chain.length > 0 &&
    expectedViewHash === current.viewHash &&
    expectedHead.sequence === current.eventHead.sequence &&
    expectedHead.hash === current.eventHead.hash;
  return complete ? chain : null;
}

function openOperateLiveStream({ dashboard, req, res }, current, binding, selection) {
  const { operate, project } = dashboard;
  const { checkpoint, generation, liveSurface } = selection;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  const currentId = encodeOperateExperienceCheckpoint(current);
  const liveBinding = Object.freeze({
    ...binding,
    projectId: project.projectId,
    generation,
  });
  const currentCursor = Object.freeze({
    eventHead: current.eventHead,
    viewHash: current.viewHash,
  });
  if (!checkpoint) {
    const surface = liveDisplaySurface(
      current,
      binding,
      liveSurface,
      project.projectId,
      generation,
    );
    res.write(
      sseFrame(
        'snapshot',
        createDashboardLiveEventEnvelope({
          event: 'snapshot',
          binding: liveBinding,
          cursor: currentCursor,
          payload: surface,
        }),
        currentId,
      ),
    );
  } else if (
    checkpoint.viewHash === current.viewHash &&
    checkpoint.eventHead.sequence === current.eventHead.sequence &&
    checkpoint.eventHead.hash === current.eventHead.hash
  ) {
    const currentSurface = liveDisplaySurface(
      current,
      binding,
      liveSurface,
      project.projectId,
      generation,
    );
    res.write(
      sseFrame(
        'ready',
        createDashboardLiveEventEnvelope({
          event: 'ready',
          binding: liveBinding,
          cursor: currentCursor,
          payload: {
            mutationEnabled:
              currentSurface.kind === 'operate-experience-display-surface' &&
              currentSurface.payload.status === 'ready' &&
              currentSurface.payload.mutationEnabled === true,
            reasonCodes:
              currentSurface.kind === 'operate-experience-display-surface'
                ? currentSurface.payload.reasonCodes
                : ['OPERATE_PROJECTION_UNAVAILABLE'],
          },
        }),
        currentId,
      ),
    );
  } else {
    const chain = replayOperatePatches(operate.patchHistory, checkpoint, current);
    if (chain && liveSurface === 'inbox') {
      const surface = liveDisplaySurface(current, binding, 'inbox', project.projectId, generation);
      res.write(
        sseFrame(
          'snapshot',
          createDashboardLiveEventEnvelope({
            event: 'snapshot',
            binding: liveBinding,
            cursor: currentCursor,
            payload: surface,
          }),
          currentId,
        ),
      );
    } else if (chain) {
      for (const patch of chain) {
        const cursor = { eventHead: patch.toEventHead, viewHash: patch.toViewHash };
        res.write(
          sseFrame(
            'patch',
            createDashboardLiveEventEnvelope({
              event: 'patch',
              binding: liveBinding,
              cursor,
              payload: patch,
            }),
            encodeOperateExperienceCheckpoint(cursor),
          ),
        );
      }
    } else {
      res.write(
        sseFrame(
          'stale',
          createDashboardLiveEventEnvelope({
            event: 'stale',
            binding: liveBinding,
            cursor: currentCursor,
            payload: {
              mutationEnabled: false,
              reasonCodes: ['OPERATE_EVENT_GAP'],
              recovery: 'Refresh the validated snapshot before submitting any command.',
            },
          }),
          currentId,
        ),
      );
    }
  }
  const client = { res, binding: liveBinding, surface: liveSurface };
  operate.clients.add(client);
  req.on('close', () => operate.clients.delete(client));
  return undefined;
}

function respondExecutiveBoard(res, view, binding, route) {
  const response = selectOperateExecutiveBoardDisplay(view, {
    binding: {
      ...binding,
      cycleId: route.subjectId,
      subjectId: route.subjectId,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
    },
    subjectId: route.subjectId,
  });
  return displayJson(res, response);
}

async function respondReviewWorkspace({ dashboard, res }, view, binding, route) {
  const { getOperatingReviewRead } = dashboard;
  if (typeof getOperatingReviewRead !== 'function') {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'The Review workspace is unavailable until OpenPlanr connects its owner read.',
    });
  }
  let workspace;
  try {
    workspace = await getOperatingReviewRead(
      Object.freeze({
        cycleId: route.cycleId,
        reviewId: route.subjectId,
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
      }),
    );
  } catch {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'The Review workspace is unavailable until OpenPlanr refreshes its owner read.',
    });
  }
  const closed = closedReviewWorkspace(workspace, binding, route.cycleId, route.subjectId, view);
  if (!closed) {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_BINDING_MISMATCH',
      message: 'The Review workspace does not match the current actor-bound operating view.',
    });
  }
  return experienceJson(res, 200, closed);
}

function respondActionWorkspace({ dashboard, res }, view, binding, route) {
  const commandGateway = dashboard.operate.resolveCommandGateway();
  const response = selectOperateActionDisplayWorkspace(view, {
    binding: {
      ...binding,
      actionId: route.subjectId,
      subjectId: route.subjectId,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
    },
    subjectId: route.subjectId,
    commandsAvailable: supportsGovernedAction(commandGateway),
  });
  return displayJson(res, response);
}

async function respondCycleWorkspace({ dashboard, res }, view, binding, route) {
  const { getOperatingCycleRead } = dashboard;
  if (typeof getOperatingCycleRead !== 'function') {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'The Cycle workspace is unavailable until OpenPlanr connects its owner read.',
    });
  }
  let cycleRead;
  try {
    cycleRead = await getOperatingCycleRead(
      Object.freeze({
        cycleId: route.subjectId,
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
      }),
    );
  } catch {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'The Cycle workspace is unavailable until OpenPlanr refreshes its owner read.',
    });
  }
  const response = selectOperateCycleDisplayWorkspace(view, cycleRead, {
    binding: {
      ...binding,
      cycleId: route.subjectId,
      subjectId: route.subjectId,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
    },
    subjectId: route.subjectId,
  });
  return displayJson(res, response);
}

async function respondRecovery({ dashboard, res }, view, binding) {
  const gateway = dashboard.operate.resolveCommandGateway();
  if (!gateway || typeof gateway.inspectRecovery !== 'function') {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_READ_ONLY',
      message: 'Recovery inspection is unavailable until OpenPlanr is connected.',
    });
  }
  let recoveryRead;
  try {
    recoveryRead = await gateway.inspectRecovery();
  } catch {
    return operateRefusal(res, {
      status: 409,
      reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
      message: 'Recovery inspection is unavailable until OpenPlanr refreshes it.',
    });
  }
  const response = selectOperateRecoveryDisplay(view, recoveryRead, {
    binding: {
      ...binding,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
    },
  });
  return displayJson(res, response);
}

function respondOperateDisplay({ dashboard, res, url }, view, binding, route, selection) {
  const { projectId } = dashboard.project;
  const { actionsCycleId, auditCycleId, auditFormat, auditQuery, auditSurface, generation } =
    selection;
  if (route.surface === 'inbox' && route.subjectId !== null) {
    return displayJson(
      res,
      selectOperateInboxItemDisplaySurface(view, {
        binding: {
          ...binding,
          generatedAt: view.generatedAt,
          eventHead: view.eventHead,
          viewHash: view.viewHash,
          surface: 'inbox',
          projectId,
          generation,
          subjectId: route.subjectId,
        },
        subjectId: route.subjectId,
      }),
    );
  }
  if (['today', 'inbox', 'cycles', 'actions'].includes(route.surface)) {
    return displayJson(
      res,
      selectOperateExperienceDisplaySurface(view, {
        surface: route.surface,
        binding: {
          ...binding,
          generatedAt: view.generatedAt,
          eventHead: view.eventHead,
          viewHash: view.viewHash,
          surface: route.surface,
          ...(route.surface === 'inbox' || route.surface === 'actions'
            ? { projectId, generation }
            : {}),
          subjectId: route.subjectId,
          cycleId:
            route.surface === 'cycle'
              ? route.subjectId
              : route.surface === 'actions'
                ? actionsCycleId
                : route.subjectId,
        },
        subjectId: route.subjectId,
        cycleId:
          route.surface === 'actions'
            ? actionsCycleId
            : route.surface === 'cycle'
              ? route.subjectId
              : null,
      }),
    );
  }
  if (auditSurface) {
    return displayJson(
      res,
      selectOperateExperienceAuditDisplaySurface(view, {
        surface: route.surface,
        binding: {
          ...binding,
          cycleId: auditCycleId,
          subjectId: route.subjectId,
          surface: route.surface,
          query: auditQuery,
          format: auditFormat,
          generatedAt: view.generatedAt,
          eventHead: view.eventHead,
          viewHash: view.viewHash,
        },
        subjectId: route.subjectId,
        cycleId: auditCycleId,
        query: auditQuery,
        format: auditFormat,
      }),
    );
  }
  return displayJson(
    res,
    selectOperateExperienceSurface(view, {
      surface: route.surface,
      binding,
      subjectId: route.subjectId,
      cycleId: route.surface === 'actions' ? actionsCycleId : null,
      query: url.searchParams.get('q') ?? '',
      format: url.searchParams.get('format') ?? 'json',
      projectId: route.surface === 'actions' ? projectId : null,
      generation: route.surface === 'actions' ? generation : null,
    }),
  );
}
