import { selectOperateReviewDisplayWorkspace } from 'planr-pipeline/dashboard/operate-experience-reader';
import {
  assertOperateReviewDisplayWorkspaceV1,
  type OperateReviewDisplayWorkspaceV1,
} from 'planr-pipeline/dashboard/operate-review-display-workspace-contract';
import type {
  OperateExperienceViewV1,
  OperatingReviewReadV2,
  OperatingReviewReceiptV2,
} from 'planr-pipeline/protocol';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActorV2, OperateApiEnvelopeV2, OperateClient } from './client.js';
import type { JsonRecord } from './composition.js';

export type OperatingReviewDisplayReadRequestV1 = Readonly<{
  cycleId: string;
  reviewId: string;
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
}>;

type ReviewSource = OperatingReviewReadV2 | OperatingReviewReceiptV2;

type ReviewReadClient = Pick<
  OperateClient,
  'dispatch' | 'readCommittedReviewReceipt' | 'readExperienceAtEventHead'
>;

function gatewayError(code: string, message: string, status = 409): Error {
  return Object.assign(new Error(message), { code, status });
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw gatewayError(
      'OPERATE_PROJECTION_INVALID',
      `${label} is unavailable from the verified operating projection.`,
    );
  }
  return value as JsonRecord;
}

function sourceFromEnvelope(
  envelope: OperateApiEnvelopeV2<'operate.review.get' | 'operate.review.submit'>,
): ReviewSource {
  if (!envelope.ok) {
    throw gatewayError(envelope.error.code, envelope.error.message);
  }
  const source = record(envelope.data, 'The Review source');
  if (source.kind !== 'operating-review-read' && source.kind !== 'operating-review-receipt') {
    throw gatewayError(
      'OPERATE_PROJECTION_INVALID',
      'The Review source does not satisfy the closed pending-or-terminal contract.',
    );
  }
  return source as unknown as ReviewSource;
}

function viewFromEnvelope(
  envelope: OperateApiEnvelopeV2<'operate.experience.get'>,
): OperateExperienceViewV1 {
  if (!envelope.ok) {
    throw gatewayError(envelope.error.code, envelope.error.message);
  }
  return record(envelope.data, 'The operating experience') as unknown as OperateExperienceViewV1;
}

function expectedBinding(workspace: OperateReviewDisplayWorkspaceV1) {
  const payload = workspace.payload;
  return {
    actorId: payload.actorId,
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId: payload.cycleId,
    reviewId: payload.reviewId,
    sourceArtifactKind: payload.sourceArtifactKind,
    sourceArtifactHash: payload.sourceArtifactHash,
    sourceEventHead: payload.sourceEventHead,
    sourceReadEventHead: payload.sourceReadEventHead,
    sourceViewHash: payload.sourceViewHash,
  };
}

/**
 * OpenPlanr-owned access gateway for one exact Review display. The dashboard
 * receives only the pipeline-validated display workspace; Store/runtime state
 * and legacy projections never cross this boundary.
 */
export function createOperatingReviewReadGatewayV1(input: {
  client: ReviewReadClient;
}): (request: OperatingReviewDisplayReadRequestV1) => Promise<OperateReviewDisplayWorkspaceV1> {
  return async (request) => {
    const actor: OperateActorV2 & { kind: 'human' } = {
      actorId: request.actorId,
      kind: 'human',
      runtime: 'openplanr',
    };
    const scope = {
      scopeId: request.scopeId,
      domainId: request.domainId,
      domainVersion: request.domainVersion,
    };
    const reviewRequest = {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
      actor,
      scope,
    };

    const pending = await input.client.dispatch({
      operation: 'operate.review.get',
      request: reviewRequest,
    });
    const source = pending.ok
      ? sourceFromEnvelope(pending)
      : pending.error.code === 'REVIEW_NOT_PENDING'
        ? sourceFromEnvelope(await input.client.readCommittedReviewReceipt(reviewRequest))
        : (() => {
            throw gatewayError(pending.error.code, pending.error.message);
          })();

    const experienceRequest = {
      cycleId: request.cycleId,
      actor,
      actionBinding: { cycleId: request.cycleId, actorId: request.actorId },
    };
    const view = viewFromEnvelope(
      source.kind === 'operating-review-receipt'
        ? await input.client.readExperienceAtEventHead(experienceRequest, source.eventHead)
        : await input.client.dispatch({
            operation: 'operate.experience.get',
            request: experienceRequest,
          }),
    );
    const sourceReadEventHead =
      source.kind === 'operating-review-read' ? source.eventHead : source.readEventHead;
    const generatedAt =
      source.kind === 'operating-review-read' ? source.readAt : source.committedAt;
    const selected = selectOperateReviewDisplayWorkspace(view, source, {
      subjectId: request.reviewId,
      binding: {
        actorId: request.actorId,
        scopeId: request.scopeId,
        domainId: request.domainId,
        domainVersion: request.domainVersion,
        cycleId: request.cycleId,
        reviewId: request.reviewId,
        generatedAt,
        sourceArtifactKind: source.kind,
        sourceArtifactHash: sha256Jcs(source as never),
        sourceEventHead: structuredClone(source.eventHead),
        sourceReadEventHead: structuredClone(sourceReadEventHead),
        sourceViewHash: view.viewHash,
      },
    });
    const candidate = record(selected, 'The Review display workspace');
    if (candidate.ok === false) {
      const failure = record(candidate.error, 'The Review display refusal');
      throw gatewayError(
        String(failure.reasonCode ?? 'OPERATE_PROJECTION_INVALID'),
        'The Review display is unavailable for this exact actor and scope.',
        Number(failure.status ?? 409),
      );
    }
    const workspace = candidate as unknown as OperateReviewDisplayWorkspaceV1;
    assertOperateReviewDisplayWorkspaceV1(workspace, expectedBinding(workspace));
    return structuredClone(workspace);
  };
}
