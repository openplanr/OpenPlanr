/** Governed command routes: session, preview, confirm, Planning handoff and trace. */

import {
  bearerCapability,
  closedCommandFailureResponse,
  closedCommandPreviewProof,
  closedCommandSessionResponse,
  closedCommandSuccessResponse,
  closedReviewCommandFailureResponse,
  closedReviewCommandSuccessResponse,
  commandOrigin,
  currentHeadIncludesCommitted,
  exactAdvancedHead,
  exactCommandBinding,
  exactRouteBody,
  loopbackCommandHost,
  OPERATE_COMMAND_ROUTES,
  readCommandBody,
  validCommandSessionBinding,
} from './command-contracts.mjs';
import { assertOperateExperiencePreviewV1 } from './operate.mjs';
import {
  closedReviewWorkspace,
  exactEventHead,
  OPERATE_SUBJECT_SEGMENT,
  sameExperienceBinding,
} from './operate-routes.mjs';
import { supportsGovernedAction, supportsOperateSession } from './operate-state.mjs';
import { commandError, experienceJson, safeDashboardErrorRecord } from './responses.mjs';

const refuse = (code, status) => Object.freeze({ refusal: Object.freeze({ code, status }) });

const humanActor = (actorId) => ({
  actorId,
  kind: 'human',
  runtime: 'openplanr',
});

const reviewReadRequest = (sessionBinding) =>
  Object.freeze({
    cycleId: sessionBinding.cycleId,
    reviewId: sessionBinding.actionLocator.subjectId,
    actorId: sessionBinding.actorId,
    scopeId: sessionBinding.scopeId,
    domainId: sessionBinding.domainId,
    domainVersion: sessionBinding.domainVersion,
  });

/** POST a governed command; every refusal is answered without effect and without echoing input. */
export async function handleOperateCommand(context) {
  const { dashboard, res } = context;
  const outcome = await runOperateCommand(context);
  if (outcome.refusal) return commandError(res, outcome.refusal);
  if (!outcome.experienceRefreshed) dashboard.refreshOperatingExperience();
  return experienceJson(res, 200, outcome.response);
}

async function runOperateCommand({ dashboard, req, url, pathname }) {
  const route = OPERATE_COMMAND_ROUTES.get(pathname);
  const origin = commandOrigin(req);
  if (!origin) return refuse('OPERATE_ORIGIN_INVALID', 403);
  const binding = exactCommandBinding(req, url.searchParams, url.search);
  if (!binding) return refuse('OPERATE_BINDING_REQUIRED', 400);
  const gateway = dashboard.operate.resolveCommandGateway();
  const gatewaySupportsRoute =
    route.kind === 'session'
      ? supportsOperateSession(gateway)
      : route.kind === 'preview'
        ? supportsOperateSession(gateway) && typeof gateway?.preview === 'function'
        : route.kind === 'confirm'
          ? supportsGovernedAction(gateway)
          : supportsOperateSession(gateway);
  if (!gatewaySupportsRoute) return refuse('OPERATE_READ_ONLY', 409);
  const body = await readCommandBody(req);
  if (!exactRouteBody(body, route)) return refuse('OPERATE_COMMAND_INVALID', 400);
  if (route.kind === 'session') return issueCommandSession(gateway, binding, body, origin);
  return runSessionCommand({ dashboard, req, route, gateway, binding, body, origin });
}

async function issueCommandSession(gateway, binding, body, origin) {
  const response = await gateway.issueSession({
    ...body,
    actor: humanActor(binding.actorId),
    origin,
  });
  const closedSession = closedCommandSessionResponse(response, binding, body);
  if (!closedSession) return refuse('OPERATE_BINDING_MISMATCH', 403);
  return { response: closedSession, experienceRefreshed: false };
}

async function runSessionCommand({ dashboard, req, route, gateway, binding, body, origin }) {
  const capability = bearerCapability(req);
  if (!capability) return refuse('OPERATE_SESSION_DENIED', 401);
  if (typeof gateway.assertSessionBinding !== 'function') return refuse('OPERATE_READ_ONLY', 409);
  const sessionBinding = await gateway.assertSessionBinding({
    sessionId: body.sessionId,
    capability,
    origin,
  });
  if (!validCommandSessionBinding(sessionBinding, binding)) {
    return refuse('OPERATE_BINDING_MISMATCH', 403);
  }
  if (route.kind.startsWith('planning-')) {
    return runPlanningCommand(dashboard, route, body, sessionBinding);
  }
  return runGovernedCommand({
    dashboard,
    route,
    gateway,
    body,
    capability,
    origin,
    sessionBinding,
  });
}

async function runPlanningCommand(dashboard, route, body, sessionBinding) {
  const planningGateway = dashboard.operate.resolvePlanningGateway();
  if (!planningGateway) return refuse('OPERATE_READ_ONLY', 409);
  const request = {
    ...body,
    actor: humanActor(sessionBinding.actorId),
    binding: structuredClone(sessionBinding),
  };
  delete request.sessionId;
  if (
    route.kind === 'planning-preview' &&
    typeof body.actionId === 'string' &&
    body.actionId !== sessionBinding.actionLocator?.subjectId
  ) {
    return refuse('OPERATE_BINDING_MISMATCH', 403);
  }
  const response =
    route.kind === 'planning-preview'
      ? await planningGateway.preview(request)
      : await planningGateway.createSpec(request);
  return { response, experienceRefreshed: false };
}

async function runGovernedCommand({
  dashboard,
  route,
  gateway,
  body,
  capability,
  origin,
  sessionBinding,
}) {
  let expectedOperation = null;
  if (route.kind === 'confirm') {
    if (typeof gateway.assertPreviewBinding !== 'function') return refuse('OPERATE_READ_ONLY', 409);
    const proof = closedCommandPreviewProof(
      await gateway.assertPreviewBinding({
        ...body,
        capability,
        origin,
      }),
      sessionBinding,
    );
    if (!proof) return refuse('OPERATE_BINDING_MISMATCH', 403);
    expectedOperation = proof.operation;
    if (Object.hasOwn(body, 'note') && expectedOperation !== 'operate.review.submit') {
      return refuse('OPERATE_COMMAND_INVALID', 400);
    }
  }
  const response =
    route.kind === 'preview'
      ? await gateway.preview({ ...body, capability, origin })
      : await gateway.confirm({ ...body, capability, origin });
  if (route.kind !== 'preview') {
    return closeConfirmation({ dashboard, response, expectedOperation, sessionBinding, body });
  }
  try {
    assertOperateExperiencePreviewV1(response, {
      actorId: sessionBinding.actorId,
      scopeId: sessionBinding.scopeId,
      domainId: sessionBinding.domainId,
      domainVersion: sessionBinding.domainVersion,
      eventHead: sessionBinding.eventHead,
      sourceViewHash: sessionBinding.sourceViewHash,
      subjectId: sessionBinding.actionLocator.subjectId,
      actionDigest: sessionBinding.actionLocator.actionDigest,
    });
  } catch {
    return refuse('OPERATE_PREVIEW_INVALID', 409);
  }
  return { response, experienceRefreshed: false };
}

/** Close a confirm result against the refreshed owner view; anything unprovable is uncertain. */
async function closeConfirmation({ dashboard, response, expectedOperation, sessionBinding, body }) {
  const { getOperatingReviewRead } = dashboard;
  const reviewSubmit = expectedOperation === 'operate.review.submit';
  const responseRecord = safeDashboardErrorRecord(response);
  if (!responseRecord || typeof expectedOperation !== 'string') {
    return refuse('OPERATE_COMMAND_REFUSED', 409);
  }
  if (responseRecord.ok === true) {
    const refreshed = dashboard.refreshOperatingExperience();
    const committedHeadIsVisible = reviewSubmit
      ? currentHeadIncludesCommitted(refreshed?.view?.eventHead, responseRecord.eventHead)
      : exactEventHead(refreshed?.view?.eventHead, responseRecord.eventHead);
    if (
      !exactAdvancedHead(responseRecord.eventHead, sessionBinding.eventHead) ||
      !refreshed?.view ||
      !sameExperienceBinding(refreshed.view, sessionBinding) ||
      !committedHeadIsVisible
    ) {
      return refuse('OPERATION_UNCERTAIN', 409);
    }
    let reviewWorkspace = null;
    if (reviewSubmit && typeof getOperatingReviewRead === 'function') {
      try {
        reviewWorkspace = await getOperatingReviewRead(reviewReadRequest(sessionBinding));
      } catch {
        reviewWorkspace = null;
      }
    }
    const closedSuccess = reviewSubmit
      ? closedReviewCommandSuccessResponse(
          response,
          refreshed.view,
          reviewWorkspace,
          sessionBinding,
          Object.hasOwn(body, 'note') ? body.note : null,
        )
      : closedCommandSuccessResponse(response, expectedOperation, refreshed.view);
    if (!closedSuccess) return refuse('OPERATION_UNCERTAIN', 409);
    return { response: closedSuccess, experienceRefreshed: true };
  }
  if (responseRecord.ok !== false) return refuse('OPERATE_COMMAND_REFUSED', 409);
  let reviewWorkspace = null;
  let experienceRefreshed = false;
  if (reviewSubmit && typeof getOperatingReviewRead === 'function') {
    const refreshed = dashboard.refreshOperatingExperience();
    experienceRefreshed = true;
    if (refreshed?.view) {
      try {
        const candidate = await getOperatingReviewRead(reviewReadRequest(sessionBinding));
        reviewWorkspace = closedReviewWorkspace(
          candidate,
          sessionBinding,
          sessionBinding.cycleId,
          sessionBinding.actionLocator.subjectId,
          refreshed.view,
        );
      } catch {
        reviewWorkspace = null;
      }
    }
  }
  const closedFailure = reviewSubmit
    ? closedReviewCommandFailureResponse(response, reviewWorkspace)
    : closedCommandFailureResponse(response, expectedOperation);
  if (!closedFailure) return refuse('OPERATE_COMMAND_REFUSED', 409);
  return { response: closedFailure, experienceRefreshed };
}

/** GET the Planning trace of one spec through the separate Planning gateway. */
export async function handlePlanningTrace({ dashboard, req, res, url, parts }) {
  if (!OPERATE_SUBJECT_SEGMENT.test(parts[4])) {
    return commandError(res, { code: 'OPERATE_COMMAND_INVALID', status: 400 });
  }
  const localHost = loopbackCommandHost(req);
  const binding = exactCommandBinding(req, url.searchParams, url.search);
  if (!localHost) {
    return commandError(res, { code: 'OPERATE_ORIGIN_INVALID', status: 403 });
  }
  if (!binding) {
    return commandError(res, { code: 'OPERATE_BINDING_REQUIRED', status: 400 });
  }
  const planningGateway = dashboard.operate.resolvePlanningGateway();
  if (!planningGateway) {
    return commandError(res, { code: 'OPERATE_READ_ONLY', status: 409 });
  }
  const response = await planningGateway.trace({
    specId: parts[4],
    actor: humanActor(binding.actorId),
    binding: structuredClone(binding),
  });
  return experienceJson(res, 200, response);
}
