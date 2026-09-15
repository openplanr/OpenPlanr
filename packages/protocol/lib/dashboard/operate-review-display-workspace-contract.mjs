import { validateJson } from '../../src/json-schema.mjs';
import { assertOperateReviewWorkspacePayloadSafeV1 } from './operate-review-payload-safety.mjs';
import {
  contentHash,
  deepFreeze,
  exactEventHead,
  exactJson,
  jcsHash,
  safeDataClone,
} from './closed-json-contract.mjs';
import {
  OPERATE_ALLOWED_ACTION_SCHEMA_REVIEW_SLICE as allowedActionSchema,
  OPERATE_EXPERIENCE_VIEW_SCHEMA_REVIEW_SLICE as experienceViewSchema,
  OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA_REVIEW_SLICE as reviewWorkspaceSchema,
  OPERATING_ASSIGNMENT_SCHEMA_REVIEW_SLICE as assignmentSchema,
  OPERATING_EVIDENCE_RESOLUTION_SCHEMA_REVIEW_SLICE as evidenceResolutionSchema,
  OPERATING_REVIEW_READ_SCHEMA_REVIEW_SLICE as reviewReadSchema,
  OPERATING_REVIEW_RECEIPT_SCHEMA_REVIEW_SLICE as reviewReceiptSchema,
  OPERATING_REVIEW_SCHEMA_REVIEW_SLICE as reviewSchema,
  OPERATING_TRACE_MATRIX_SCHEMA_REVIEW_SLICE as traceMatrixSchema,
} from './generated/operate-review-schema-data.mjs';

export const OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN =
  'openplanr:operate-review-display-workspace:1.0.0';

const schemas = new Map([
  ['operate-allowed-action.schema.json', allowedActionSchema],
  ['operate-experience-view.schema.json', experienceViewSchema],
  ['operate-review-display-workspace.schema.json', reviewWorkspaceSchema],
  ['operating-assignment.schema.json', assignmentSchema],
  ['operating-evidence-resolution.schema.json', evidenceResolutionSchema],
  ['operating-review-read.schema.json', reviewReadSchema],
  ['operating-review-receipt.schema.json', reviewReceiptSchema],
  ['operating-review.schema.json', reviewSchema],
  ['operating-trace-matrix.schema.json', traceMatrixSchema],
]);

function jsonPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function resolveSchemaRef(reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: jsonPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

function invalid() {
  return [{ path: '$', rule: 'closedContract', detail: 'does not satisfy the closed Review display workspace contract' }];
}

function unique(records, field) {
  return new Set(records.map((record) => record[field])).size === records.length;
}

function exactExpected(payload, expected) {
  if (!expected) return true;
  return payload.actorId === expected.actorId
    && payload.scopeId === expected.scopeId
    && payload.domainId === expected.domainId
    && payload.domainVersion === expected.domainVersion
    && payload.cycleId === expected.cycleId
    && payload.reviewId === expected.reviewId
    && payload.sourceArtifactKind === expected.sourceArtifactKind
    && payload.sourceArtifactHash === expected.sourceArtifactHash
    && payload.sourceViewHash === expected.sourceViewHash
    && exactEventHead(payload.sourceEventHead, expected.sourceEventHead)
    && exactEventHead(payload.sourceReadEventHead, expected.sourceReadEventHead);
}

function validSummary(summary) {
  const stageStates = ['complete', 'current', 'available', 'waiting', 'blocked', 'failed', 'skipped', 'uncertain', 'revisited'];
  if (summary.stages.total !== summary.stages.cycles * 7
    || summary.stages.byStage.length !== 7
    || new Set(summary.stages.byStage.map(({ id }) => id)).size !== 7
    || stageStates.some((state) => summary.stages[state] !== summary.stages.byStage.reduce((total, stage) => total + stage[state], 0))
    || summary.seats.terminal !== summary.seats.validated + summary.seats.rejected + summary.seats.failed + summary.seats.abandoned
    || summary.seats.total !== summary.seats.terminal + summary.seats.active + summary.seats.pending
    || summary.evidence.total !== summary.evidence.available + summary.evidence.restricted
    || summary.evidence.total !== summary.evidence.current + summary.evidence.historical + summary.evidence.stale
    || summary.evidence.linked > summary.evidence.total
    || summary.proof.linkedEvidence !== summary.evidence.linked
    || summary.proof.restrictedEvidence !== summary.evidence.restricted
    || summary.proof.resolvedClaims !== summary.claims.supported + summary.claims.contradicted
    || summary.proof.unresolvedClaims !== summary.claims.uncertain + summary.claims.unknown + summary.claims.restricted
    || summary.claims.total !== summary.proof.resolvedClaims + summary.proof.unresolvedClaims
    || summary.verification.total !== summary.verification.verified + summary.verification.unverified
      + summary.verification.notRequired + summary.verification.insufficientEvidence
    || summary.proof.verifiedOutcomes !== summary.verification.verified
    || summary.proof.unverifiedOutcomes !== summary.verification.unverified + summary.verification.insufficientEvidence
    || summary.omissions.total !== summary.omissions.restricted + summary.omissions.absent) {
    return false;
  }
  return true;
}

function validChoice(choice, payload) {
  return choice.choiceHash === jcsHash(choice.submitArguments)
    && choice.submitArguments.reviewId === payload.reviewId
    && choice.submitArguments.cycleId === payload.cycleId
    && choice.submitArguments.actor.actorId === payload.actorId
    && exactJson(choice.submitArguments.scope, {
      scopeId: payload.scopeId,
      domainId: payload.domainId,
      domainVersion: payload.domainVersion,
    })
    && exactJson(choice.requiredDispositions, choice.submitArguments.workDispositions)
    && choice.reversibility === 'immutable-review-event';
}

function validCapability(payload) {
  const { capability, choices } = payload.data;
  if (!capability.available) return capability.actions.length === 0 && payload.mutationEnabled === false;
  if (payload.sourceArtifactKind !== 'operating-review-read'
    || payload.status !== 'ready'
    || payload.mutationEnabled !== true
    || capability.actions.length !== choices.length) return false;
  const choiceByArguments = new Map(choices.map((choice) => [jcsHash(choice.submitArguments), choice]));
  if (choiceByArguments.size !== choices.length) return false;
  const matched = new Set();
  for (const action of capability.actions) {
    const digest = jcsHash(action.action.arguments);
    if (action.subjectId !== payload.reviewId
      || action.action.tool !== 'operate.review.submit'
      || action.action.effect !== 'project-write'
      || !choiceByArguments.has(digest)) return false;
    matched.add(digest);
  }
  return matched.size === choices.length;
}

function validTerminalDisposition(payload) {
  const disposition = payload.data.terminalDisposition;
  if (payload.sourceArtifactKind === 'operating-review-read') {
    return disposition === null
      && payload.data.review.state === 'pending'
      && payload.data.review.disposition === null
      && payload.data.choices.length > 0
      && exactEventHead(payload.sourceReadEventHead, payload.sourceEventHead);
  }
  return payload.status === 'terminal'
    && payload.reasonCodes.includes('REVIEW_TERMINAL')
    && payload.mutationEnabled === false
    && payload.data.choices.length === 0
    && payload.data.capability.available === false
    && payload.data.capability.actions.length === 0
    && payload.data.capability.reason.code === 'REVIEW_TERMINAL'
    && disposition !== null
    && disposition.decision === payload.data.review.state
    && payload.data.review.disposition === disposition.decision
    && exactJson(payload.data.review.workDispositions, disposition.appliedWorkDispositions)
    && exactEventHead(disposition.readEventHead, payload.sourceReadEventHead)
    && exactEventHead(disposition.eventHead, payload.sourceEventHead);
}

function validWorkspaceSemantics(value, expected) {
  const { payload, integrity } = value;
  const { data } = payload;
  if (integrity.domain !== OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN
    || integrity.sourceArtifactKind !== payload.sourceArtifactKind
    || integrity.sourceViewHash !== payload.sourceViewHash
    || integrity.sourceArtifactHash !== payload.sourceArtifactHash
    || data.review.reviewId !== payload.reviewId
    || data.review.cycleId !== payload.cycleId
    || data.policyBinding.ownerActorId !== data.review.ownerActorId
    || data.policyBinding.actorMatchesOwner !== (payload.actorId === data.review.ownerActorId)
    || data.policyBinding.actorMatchesOwner !== true
    || !exactEventHead(data.truthSummary.sourceEventHead, payload.sourceEventHead)
    || data.truthSummary.sourceViewHash !== payload.sourceViewHash
    || data.executiveSummary.decisionCount !== data.recommendation.items.length
    || data.executiveSummary.findingCount !== data.findings.length
    || data.executiveSummary.dissentCount !== data.dissent.length
    || data.executiveSummary.gapCount !== data.gaps.length
    || data.executiveSummary.uncertaintyCount !== data.uncertainty.length
    || !unique(data.choices, 'choiceId')
    || !unique(data.findings, 'findingId')
    || !unique(data.dissent, 'localDissentId')
    || !unique(data.uncertainty, 'uncertaintyId')
    || !unique(data.gaps, 'absenceId')
    || !unique(data.claims, 'claimId')
    || !unique(data.evidence, 'evidenceRefId')
    || data.choices.some((choice) => !validChoice(choice, payload))
    || !validCapability(payload)
    || !validTerminalDisposition(payload)
    || !validSummary(data.truthSummary)
    || !exactExpected(payload, expected)) return false;
  try {
    assertOperateReviewWorkspacePayloadSafeV1(payload);
  } catch {
    return false;
  }
  return true;
}

export function validateOperateReviewDisplayWorkspaceV1(value, expected) {
  try {
    const clone = safeDataClone(value);
    const errors = validateJson(clone, reviewWorkspaceSchema, {
      base: 'schemas/v2.0.0/operate-review-display-workspace.schema.json',
      resolveRef: resolveSchemaRef,
    });
    if (errors.length > 0 || !validWorkspaceSemantics(clone, expected)) {
      return errors.length > 0 ? errors : invalid();
    }
    return clone.integrity.contentHash === contentHash(
      clone.payload,
      OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN,
    ) ? [] : invalid();
  } catch {
    return invalid();
  }
}

export function assertOperateReviewDisplayWorkspaceV1(value, expected) {
  if (validateOperateReviewDisplayWorkspaceV1(value, expected).length > 0) {
    const error = new TypeError('The Review display workspace does not satisfy its closed integrity contract.');
    error.code = 'E_OPERATE_REVIEW_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

export function issueOperateReviewDisplayWorkspaceV1(payload) {
  assertOperateReviewWorkspacePayloadSafeV1(payload);
  const safePayload = safeDataClone(payload);
  const issued = {
    kind: 'operate-review-display-workspace',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    payload: safePayload,
    integrity: {
      algorithm: 'sha-256-jcs',
      domain: OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN,
      sourceArtifactKind: safePayload.sourceArtifactKind,
      sourceViewHash: safePayload.sourceViewHash,
      sourceArtifactHash: safePayload.sourceArtifactHash,
      contentHash: contentHash(safePayload, OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN),
    },
  };
  assertOperateReviewDisplayWorkspaceV1(issued);
  return deepFreeze(issued);
}

export const OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA_V1 = Object.freeze(
  structuredClone(reviewWorkspaceSchema),
);
