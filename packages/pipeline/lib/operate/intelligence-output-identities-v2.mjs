import { sha256Jcs } from '../protocol/canonical-json.mjs';

const ASSIGNMENT_ID = /^asg_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;

function checkedAssignmentId(assignmentId) {
  if (typeof assignmentId !== 'string' || !ASSIGNMENT_ID.test(assignmentId)) {
    throw new TypeError('A role-local output identity requires one valid Assignment identity.');
  }
  return assignmentId;
}

function checkedPosition(position) {
  if (!Number.isInteger(position) || position < 1) {
    throw new TypeError('A role-local output position must be a positive integer.');
  }
  return position;
}

const POSITIONED_LOCAL_PREFIXES = new Set([
  'action-hypothesis',
  'alternative',
  'analysis',
  'claim',
  'decision',
  'dissent',
  'finding',
  'gap',
  'measurement',
  'risk',
]);

/**
 * Canonical author-facing formulas. Generated role skills render these exact
 * records, while runtime validation derives the same values below.
 */
export const OPERATING_ROLE_LOCAL_IDENTITY_FORMULAS_V2 = Object.freeze({
  advisor: Object.freeze([
    Object.freeze({ field: 'analysis insights `localAnalysisId`', formula: 'analysis:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`claims[*].localClaimId`', formula: 'claim:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`measurements[*].localMeasurementId`', formula: 'measurement:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`risks[*].localRiskId`', formula: 'risk:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`alternatives[*].localAlternativeId`', formula: 'alternative:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`gaps[*].localGapId`', formula: 'gap:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`recommendation.localRecommendationId`', formula: 'recommendation:<assignmentId>:1' }),
  ]),
  challenger: Object.freeze([
    Object.freeze({ field: '`findings[*].localFindingId`', formula: 'finding:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`missingAlternatives[*].localAlternativeId`', formula: 'alternative:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`dissent[*].localDissentId`', formula: 'dissent:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: '`gaps[*].localGapId`', formula: 'gap:<assignmentId>:<1-based position>' }),
  ]),
  chair: Object.freeze([
    Object.freeze({ field: '`ledgerId`', formula: 'ldg_<assignmentId without the asg_ prefix>' }),
    Object.freeze({ field: '`decisions[*].localDecisionId`', formula: 'decision:<assignmentId>:<1-based position>' }),
    Object.freeze({ field: 'flattened `actionHypotheses[*].localActionHypothesisId`', formula: 'action-hypothesis:<assignmentId>:<1-based position>' }),
  ]),
});

function materializedIdentity(prefix, sourceArtifactId, localId) {
  if (typeof sourceArtifactId !== 'string' || !/^art_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(sourceArtifactId)) {
    throw new TypeError('A materialized intelligence identity requires one valid source Artifact identity.');
  }
  if (typeof localId !== 'string' || localId.length === 0 || localId.length > 256 || localId.trim() !== localId) {
    throw new TypeError('A materialized intelligence identity requires one canonical role-local identity.');
  }
  // Artifact identity is the immutable byte-proven namespace. Local role IDs
  // are meaningful only inside those exact accepted bytes.
  const digest = sha256Jcs({ sourceArtifactId, localId })
    .slice('sha256:'.length, 'sha256:'.length + 32);
  return `${prefix}_${digest}`;
}

/** Deterministic, role-local claim identity; it grants no runtime authority. */
export function deriveOperatingRoleLocalClaimIdV2(assignmentId, position = 1) {
  return deriveOperatingRoleLocalPositionIdV2('claim', assignmentId, position);
}

/** Deterministic positioned identity shared by every role-authored record list. */
export function deriveOperatingRoleLocalPositionIdV2(prefix, assignmentId, position = 1) {
  if (!POSITIONED_LOCAL_PREFIXES.has(prefix)) {
    throw new TypeError('A role-local output identity requires one declared record prefix.');
  }
  return `${prefix}:${checkedAssignmentId(assignmentId)}:${checkedPosition(position)}`;
}

/** Deterministic single Advisor recommendation identity. */
export function deriveOperatingRoleLocalRecommendationIdV2(assignmentId) {
  return `recommendation:${checkedAssignmentId(assignmentId)}:1`;
}

/** Deterministic, role-local ledger identity; the accepted Artifact ID remains runtime-owned. */
export function deriveOperatingChairLedgerIdV2(assignmentId) {
  return `ldg_${checkedAssignmentId(assignmentId).slice('asg_'.length)}`;
}

/** Require an ordered local-claim array to be derived solely from its Assignment. */
export function assertOperatingRoleLocalClaimIdsV2(assignmentId, claimIds) {
  if (!Array.isArray(claimIds)
    || claimIds.length === 0
    || claimIds.some((claimId, index) => (
      claimId !== deriveOperatingRoleLocalClaimIdV2(assignmentId, index + 1)
    ))) {
    throw new TypeError('Role-local claim identities must be the exact ordered Assignment-derived sequence.');
  }
  return Object.freeze([...claimIds]);
}

/** Durable Claim identity derived only after exact Advisor bytes are accepted. */
export function deriveOperatingMaterializedClaimIdV2(sourceArtifactId, localClaimId) {
  return materializedIdentity('clm', sourceArtifactId, localClaimId);
}

/** Durable Risk identity derived only after exact Advisor bytes are accepted. */
export function deriveOperatingMaterializedRiskIdV2(sourceArtifactId, localRiskId) {
  return materializedIdentity('rsk', sourceArtifactId, localRiskId);
}

/** Durable Finding identity derived only after exact Challenger bytes are accepted. */
export function deriveOperatingMaterializedFindingIdV2(sourceArtifactId, localFindingId) {
  return materializedIdentity('fnd', sourceArtifactId, localFindingId);
}

/** Durable Decision identity derived only after exact Chair bytes are accepted. */
export function deriveOperatingMaterializedDecisionIdV2(sourceArtifactId, localDecisionId) {
  return materializedIdentity('dec', sourceArtifactId, localDecisionId);
}
