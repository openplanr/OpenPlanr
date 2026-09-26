/**
 * Planning-bridge contracts with no Operate runtime dependency.
 *
 * These assertions are needed by the protocol loader and the pipeline's origin reader, neither of
 * which should reach into the Operate runtime to get them. The Operate side imports them back.
 */

import { sha256Jcs } from '../canonical-json.mjs';
import { assertOperateExperienceArtifactV2 } from '../contracts.mjs';
import { PipelineError } from '../errors.mjs';

const PROTOCOL_VERSION = '2.0.0';

const FORBIDDEN_KEY =
  /(?:hidden|chain[-_]?of[-_]?thought|reasoning|raw[-_]?prompt|credential|secret|token|private[-_]?path|rejected[-_]?advice)/iu;
const FORBIDDEN_TEXT =
  /(?:\/Users\/|\/home\/|[A-Za-z]:\\|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:api[-_]?key|access[-_]?token|password)\b\s*[:=])/iu;

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function sameScope(value, scope) {
  return (
    Boolean(scope) &&
    value?.scopeId === scope.scopeId &&
    value?.domainId === scope.domainId &&
    value?.domainVersion === scope.domainVersion
  );
}
function sameHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function assertNoSensitiveContext(value, path = '$') {
  if (typeof value === 'string' && FORBIDDEN_TEXT.test(value))
    fail(
      'EVIDENCE_ACCESS_DENIED',
      `Access-safe planning context contains prohibited private material at ${path}.`,
    );
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key))
      fail(
        'EVIDENCE_ACCESS_DENIED',
        `Access-safe planning context contains prohibited field ${path}.${key}.`,
      );
    assertNoSensitiveContext(nested, `${path}.${key}`);
  }
}

export function assertOperatingPlanningProposalV1(proposal) {
  assertOperateExperienceArtifactV2('operating-planning-proposal', proposal);
  assertNoSensitiveContext(proposal);
  if (proposal.proposalHash !== sha256Jcs(without(proposal, 'proposalHash')))
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal hash does not equal its canonical content.',
    );
  const route = proposal.deliveryRoute;
  if (
    !sameScope(route, proposal) ||
    !sameHead(route.eventHead, proposal.eventHead) ||
    route.action.actionId !== proposal.action.actionId ||
    route.action.revision !== proposal.action.revision ||
    route.action.actionHash !== proposal.action.actionHash ||
    route.routeHash !== sha256Jcs(without(route, 'routeHash'))
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal delivery route does not bind its exact scope, Action, and Event head.',
    );
  }
  const chair = proposal.acceptedPerspectiveSummaries.filter(
    ({ roleKind }) => roleKind === 'chair',
  );
  const challenger = proposal.acceptedPerspectiveSummaries.filter(
    ({ roleKind }) => roleKind === 'challenger',
  );
  const advisors = proposal.acceptedPerspectiveSummaries.filter(
    ({ roleKind }) => roleKind === 'advisor',
  );
  const normative = proposal.acceptedPerspectiveSummaries.filter(
    ({ normative: isNormative }) => isNormative,
  );
  if (
    chair.length !== 1 ||
    challenger.length !== 1 ||
    advisors.length < 1 ||
    normative.length !== 1 ||
    normative[0] !== chair[0] ||
    chair[0].stance !== 'synthesis' ||
    chair[0].artifactId !== proposal.decision.sourceArtifactId ||
    proposal.action.sourceArtifactId !== proposal.decision.sourceArtifactId ||
    chair[0].summary !== proposal.decision.rationale ||
    proposal.acceptedPerspectiveSummaries.some(
      (perspective) => perspective.roleVersion !== PROTOCOL_VERSION,
    )
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal requires exact advisor/Challenger context and exactly one normative Chair synthesis equal to the Decision rationale.',
    );
  }
  const decisionEvidenceIds = [...proposal.decision.evidenceRefIds].sort();
  const projectedEvidenceIds = proposal.evidence.map(({ evidenceRefId }) => evidenceRefId).sort();
  if (
    new Set(projectedEvidenceIds).size !== projectedEvidenceIds.length ||
    sha256Jcs(decisionEvidenceIds) !== sha256Jcs(projectedEvidenceIds) ||
    proposal.evidence.some((entry) =>
      entry.accessState === 'restricted'
        ? entry.summary !== null
        : typeof entry.summary !== 'string',
    )
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal evidence does not equal the exact access-safe Decision evidence set.',
    );
  }
  if (
    proposal.metric.metricId !== proposal.action.metricId ||
    proposal.verification.metricId !== proposal.metric.metricId ||
    proposal.verification.metricHash !== proposal.metric.metricHash ||
    proposal.verification.verificationPlanId !== proposal.action.verificationPlanId
  )
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal metric and verification identities are not exact.',
    );
  if (
    proposal.preview.digest !==
      sha256Jcs({
        proposalId: proposal.proposalId,
        correlationId: proposal.correlationId,
        eventHead: proposal.eventHead,
        framing: proposal.framing,
        actorId: proposal.actor.actorId,
      }) ||
    proposal.preview.issuedAt !== proposal.createdAt ||
    Date.parse(proposal.preview.expiresAt) <= Date.parse(proposal.preview.issuedAt)
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Planning proposal preview digest, actor, or expiry is not exact.',
    );
  }
  if (proposal.state === 'approved') {
    const reviewBase = {
      ...without(proposal, 'proposalHash'),
      revision: 1,
      predecessorProposalHash: null,
      state: 'review-required',
      confirmation: null,
    };
    const reviewHash = sha256Jcs(reviewBase);
    const confirmation = proposal.confirmation;
    if (
      proposal.revision !== 2 ||
      proposal.predecessorProposalHash !== reviewHash ||
      confirmation.reviewProposalHash !== reviewHash ||
      confirmation.reviewProposalRevision !== 1 ||
      !sameHead(confirmation.eventHead, proposal.eventHead) ||
      confirmation.previewDigest !== proposal.preview.digest ||
      confirmation.actorId !== proposal.actor.actorId ||
      confirmation.previewExpiresAt !== proposal.preview.expiresAt ||
      confirmation.confirmationHash !== sha256Jcs(without(confirmation, 'confirmationHash')) ||
      Date.parse(confirmation.confirmedAt) < Date.parse(proposal.preview.issuedAt) ||
      Date.parse(confirmation.confirmedAt) > Date.parse(confirmation.previewExpiresAt)
    )
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Approved proposal lacks exact, timely human confirmation proof.',
      );
  }
  return proposal;
}

export function assertOperatingOriginV1(origin) {
  assertOperateExperienceArtifactV2('operating-origin', origin);
  assertNoSensitiveContext(origin);
  if (
    origin.originHash !== sha256Jcs(without(origin, 'originHash')) ||
    origin.verification.metricId !== origin.metric.metricId ||
    origin.verification.metricHash !== origin.metric.metricHash
  )
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operating origin hash or metric/verification binding is invalid.',
    );
  return origin;
}

export function assertOperatingDeliveryEvidenceV1(evidence) {
  assertOperateExperienceArtifactV2('operating-delivery-evidence', evidence);
  assertNoSensitiveContext(evidence);
  assertDeliveryClassification(evidence.classification, evidence.artifacts);
  if (
    evidence.deliveryEvidenceHash !== sha256Jcs(without(evidence, 'deliveryEvidenceHash')) ||
    evidence.outcomeStatus !== 'verification-required' ||
    evidence.verification.metricId !== evidence.metric.metricId ||
    evidence.verification.metricHash !== evidence.metric.metricHash ||
    (evidence.deliveryStatus === 'rolled-back') !== (evidence.rollback !== null) ||
    (evidence.rollback !== null &&
      (evidence.rollback.originalShipRunId !== evidence.shipRun.runId ||
        evidence.rollback.status !== 'succeeded'))
  )
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Delivery evidence is not exact or attempts to substitute verification, rollback custody, or claim Outcome closure.',
    );
  return evidence;
}

function assertDeliveryClassification(classification, artifacts) {
  const rank = { public: 0, internal: 1, confidential: 2, restricted: 3 };
  if (
    !(classification in rank) ||
    !Array.isArray(artifacts) ||
    artifacts.some(
      (artifact) =>
        !(artifact.classification in rank) || rank[artifact.classification] > rank[classification],
    )
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Delivery classification cannot narrow accepted Artifact classification.',
    );
  }
}

export {
  assertDeliveryClassification,
  assertNoSensitiveContext,
  FORBIDDEN_KEY,
  FORBIDDEN_TEXT,
  fail,
  PROTOCOL_VERSION,
  sameHead,
  sameScope,
  without,
};
