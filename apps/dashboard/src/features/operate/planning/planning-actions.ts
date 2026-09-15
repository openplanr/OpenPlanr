import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createGovernedAdapterLifecycle,
  exactGovernedSession,
} from '../governed-command-lifecycle.js';
import type { PlanningPreviewCurrent } from './planning-handoff-model.js';
import {
  exactCreation,
  exactLocator,
  exactOrigin,
  exactPreview,
  exactTraceCreation,
  fail,
  get,
  isPlanningLaunchProof,
  type JsonRecord,
  type PlanningActionLocator,
  type PlanningActions,
  type PlanningActionsOptions,
  type PlanningHandoffCreation,
  type PlanningLaunchProof,
  planningLaunchProof,
  post,
  record,
  SHA256,
  validatePostedResponse,
} from './planning-transport-contract.js';

export type {
  PlanningActionLocator,
  PlanningActions,
  PlanningActionsOptions,
  PlanningFraming,
  PlanningHandoffCreation,
  PlanningHandoffPreview,
} from './planning-transport-contract.js';

/** Read-only operating origin and delivery trace for Planning detail surfaces. */
export async function fetchPlanningOperatingTrace(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    specId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<PlanningHandoffCreation> {
  const origin = exactOrigin(options.origin);
  const fetcher = options.fetcher ?? fetch;
  if (!/^SPEC-\d{3}$/u.test(options.specId)) fail();
  const signal = options.signal ?? new AbortController().signal;
  return exactTraceCreation(
    await get(
      fetcher,
      origin,
      `/api/operate/planning/trace/${encodeURIComponent(options.specId)}`,
      options.identity,
      signal,
    ),
    options.identity,
    options.specId,
  );
}

/** Create a bound Planning handoff transport for one authenticated Operate session. */
export function createPlanningActions(options: PlanningActionsOptions): PlanningActions {
  const origin = exactOrigin(options.origin);
  const fetcher = options.fetcher ?? fetch;

  const previewCurrent = (
    identity: DashboardQueryIdentity,
    boundLocator: PlanningActionLocator,
  ): PlanningPreviewCurrent => {
    if (identity.eventHead === null) {
      fail('OPERATE_BINDING_REQUIRED');
    }
    return Object.freeze({
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      action: Object.freeze({
        actionId: boundLocator.subjectId,
        revision: boundLocator.revision,
        actionHash: boundLocator.actionDigest,
      }),
      eventHead: identity.eventHead,
    });
  };

  const lifecycle = createGovernedAdapterLifecycle<
    PlanningActionLocator,
    { sessionId: string; capability: string }
  >({
    routeKinds: ['operate.action-planning'],
    routeErrorCode: 'OPERATE_PLANNING_ROUTE_REQUIRED',
    parseLocator: exactLocator,
    sameLocator: (left, right) =>
      left.subjectId === right.subjectId &&
      left.actionDigest === right.actionDigest &&
      left.revision === right.revision,
    async issueSession({ identity, locator: boundLocator, signal, assertCurrent, waitForCurrent }) {
      if (identity.cycleId === null || identity.eventHead === null || identity.viewHash === null) {
        fail('OPERATE_BINDING_REQUIRED');
      }
      const payload = await post(
        fetcher,
        origin,
        '/api/operate/session',
        identity,
        {
          cycleId: identity.cycleId,
          eventHead: identity.eventHead,
          sourceViewHash: identity.viewHash,
          actionLocator: boundLocator,
        },
        signal,
        undefined,
        { assertCurrent, waitForCurrent },
      );
      assertCurrent();
      return validatePostedResponse(() => {
        const session = exactGovernedSession(payload, identity, boundLocator, {
          parseLocator: exactLocator,
          sameLocator: (left, right) =>
            left.subjectId === right.subjectId &&
            left.actionDigest === right.actionDigest &&
            left.revision === right.revision,
          allowedActions: { kind: 'none' },
        });
        return Object.freeze({ sessionId: session.sessionId, capability: session.capability });
      });
    },
  });

  return Object.freeze({
    bind: lifecycle.bind,
    async preview(actionId, framing) {
      lifecycle.clearPreviewProof();
      return await lifecycle.run(
        async ({
          identity,
          locator: boundLocator,
          session: active,
          signal,
          assertCurrent,
          waitForCurrent,
        }) => {
          if (actionId !== boundLocator.subjectId) fail('OPERATE_BINDING_MISMATCH');
          const body: JsonRecord = { sessionId: active.sessionId, actionId };
          if (framing) body.framing = structuredClone(framing);
          const payload = await post(
            fetcher,
            origin,
            '/api/operate/planning/preview',
            identity,
            body,
            signal,
            active.capability,
            { assertCurrent, waitForCurrent },
          );
          assertCurrent();
          const result = validatePostedResponse(() =>
            exactPreview(payload, previewCurrent(identity, boundLocator)),
          );
          lifecycle.retainPreviewProof(
            planningLaunchProof(
              identity,
              boundLocator,
              String(result.proposal.proposalId),
              String(record(result.proposal.preview).digest),
            ),
          );
          return result;
        },
        { uncertainOnFailure: true },
      );
    },
    async createSpec(proposalId, confirmDigest) {
      if (!/^oprop_[a-f0-9]{32}$/u.test(proposalId) || !SHA256.test(confirmDigest)) fail();
      return await lifecycle.run(
        async ({
          identity,
          locator: boundLocator,
          session: active,
          signal,
          assertCurrent,
          waitForCurrent,
        }) => {
          const expectedProof = planningLaunchProof(
            identity,
            boundLocator,
            proposalId,
            confirmDigest,
          );
          lifecycle.requirePreviewProof((proof): proof is PlanningLaunchProof =>
            isPlanningLaunchProof(proof, expectedProof),
          );
          const payload = await post(
            fetcher,
            origin,
            '/api/operate/planning/create-spec',
            identity,
            {
              sessionId: active.sessionId,
              proposalId,
              confirmDigest,
            },
            signal,
            active.capability,
            { assertCurrent, waitForCurrent },
          );
          assertCurrent();
          const result = validatePostedResponse(() =>
            exactCreation(payload, {
              identity,
              locator: boundLocator,
              proposalId,
              confirmDigest,
            }),
          );
          lifecycle.clearPreviewProof();
          return result;
        },
        { uncertainOnFailure: true },
      );
    },
    async trace(specId) {
      if (!/^SPEC-\d{3}$/u.test(specId)) fail();
      return await lifecycle.run(async ({ identity, signal, assertCurrent, waitForCurrent }) => {
        const payload = await get(
          fetcher,
          origin,
          `/api/operate/planning/trace/${encodeURIComponent(specId)}`,
          identity,
          signal,
          { assertCurrent, waitForCurrent },
        );
        assertCurrent();
        return exactTraceCreation(payload, identity, specId);
      });
    },
    reconcile: lifecycle.reconcile,
    cancel: lifecycle.cancel,
    dispose: lifecycle.dispose,
  });
}
