import { createHash } from 'node:crypto';

import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { canonicalizeJson, sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertOperatingDeltaV2 } from './operating-delta-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const MAX_PROJECTED_RECORDS = 64;
const MAX_PROJECTED_EVIDENCE_REFS = 32;
const COLLECTIONS = Object.freeze([
  ['objectives', 'objective', 'objectiveId'],
  ['metrics', 'metric', 'metricId'],
  ['findings', 'finding', 'findingId'],
  ['decisions', 'decision', 'decisionId'],
  ['actions', 'action', 'actionId'],
  ['risks', 'risk', 'riskId'],
  ['assumptions', 'assumption', 'assumptionId'],
]);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context: structuredClone(context) });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function digestToken(prefix, value, length = 24) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + length)}`;
}

export function deriveOperatingIntelligenceBundleCustodyIdsV2(bundle) {
  const suffix = sha256Jcs({ bundleId: bundle?.bundleId, canonicalHash: sha256Jcs(bundle) })
    .slice('sha256:'.length, 'sha256:'.length + 24);
  return Object.freeze({
    assignmentId: `asg_bundle_${suffix}`,
    submissionId: `sub_bundle_${suffix}`,
    artifactId: `art_bundle_${suffix}`,
    creationEventId: `evt_bundle_created_${suffix}`,
    claimId: `claim-bundle-${suffix}`,
    claimedEventId: `evt_bundle_claimed_${suffix}`,
    startedEventId: `evt_bundle_started_${suffix}`,
    submittedEventId: `evt_bundle_submitted_${suffix}`,
    artifactEventId: `evt_bundle_artifact_${suffix}`,
    validatedEventId: `evt_bundle_validated_${suffix}`,
  });
}

export function deriveOperatingIntelligenceBundleIdV2({
  assignmentId,
  cycleId,
  snapshotId,
  deltaId,
  scopeId,
  domainId,
  domainVersion,
  sourceArtifactIds,
  roleRequirementsHash = null,
  evidenceBindingHash = null,
  authorizationHash = null,
} = {}) {
  return digestToken('ibd', {
    assignmentId,
    cycleId,
    snapshotId,
    deltaId,
    scopeId,
    domainId,
    domainVersion,
    sourceArtifactIds: [...(sourceArtifactIds ?? [])].sort(),
    roleRequirementsHash,
    evidenceBindingHash,
    authorizationHash,
  });
}

export function deriveOperatingEvidenceAbsenceIdV2({
  bundleId,
  roleId,
  roleVersion,
  requirementId,
  absenceCode,
  sourceEvidenceRefIds = [],
  sourceEventIds = [],
} = {}) {
  return digestToken('abs_evidence', {
    bundleId,
    roleId,
    roleVersion,
    requirementId,
    absenceCode,
    sourceEvidenceRefIds: [...sourceEvidenceRefIds].sort(),
    sourceEventIds: [...sourceEventIds].sort(),
  });
}

export function deriveOperatingRoleAbsenceIdV2({
  planId,
  consumerAssignmentId,
  roleId,
  roleVersion,
  terminalEventId,
} = {}) {
  return digestToken('abs_role', {
    planId,
    consumerAssignmentId,
    roleId,
    roleVersion,
    terminalEventId,
  });
}

function titleFor(record, kind) {
  const candidate = record.title
    ?? record.name
    ?? record.question
    ?? record.statement
    ?? `${kind} ${Object.values(record).find((value) => typeof value === 'string') ?? 'record'}`;
  return candidate.slice(0, 256).trim();
}

function stateFor(record) {
  return String(record.state ?? record.status ?? record.epistemicStatus ?? 'recorded').slice(0, 128);
}

function evidenceFor(record) {
  return [...new Set([
    ...(record.evidenceRefIds ?? []),
    ...(record.supportingEvidenceRefIds ?? []),
    ...(record.contradictingEvidenceRefIds ?? []),
  ])].sort().slice(0, MAX_PROJECTED_EVIDENCE_REFS);
}

function projectedCollection(records, kind, idField) {
  const ordered = [...records].sort((left, right) => {
    const leftCurrent = ['open', 'active', 'in_progress', 'proposed'].includes(stateFor(left)) ? 0 : 1;
    const rightCurrent = ['open', 'active', 'in_progress', 'proposed'].includes(stateFor(right)) ? 0 : 1;
    return leftCurrent - rightCurrent
      || String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? ''))
      || String(left[idField]).localeCompare(String(right[idField]));
  });
  const selected = ordered.slice(0, MAX_PROJECTED_RECORDS).map((record) => ({
    recordId: record[idField],
    recordKind: kind,
    title: titleFor(record, kind),
    state: stateFor(record),
    evidenceRefIds: evidenceFor(record),
  }));
  return {
    selected,
    coverage: {
      included: selected.length,
      total: records.length,
      omitted: records.length - selected.length,
    },
  };
}

export function projectOperatingIntelligenceStateV2(operatingState, { projectedAt } = {}) {
  const state = assertOperatingModelStateV2(operatingState);
  const projection = {
    kind: 'operating-state-projection',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    sourceStateId: state.stateId,
    sourceRuntimeHash: state.runtimeHash,
    scopeId: state.scopeId,
    domainId: state.domainId,
    domainVersion: state.domainVersion,
    snapshotId: state.snapshotId,
    selectionPolicy: 'deterministic-priority-v1',
    coverage: {},
    projectedAt,
  };
  for (const [collection, kind, idField] of COLLECTIONS) {
    const { selected, coverage } = projectedCollection(state[collection], kind, idField);
    projection[collection] = selected;
    projection.coverage[collection] = coverage;
  }
  return freeze(projection);
}

function evidenceIndexes(snapshot, evidenceRefs, evidenceArtifacts) {
  const refById = new Map();
  for (const ref of evidenceRefs) {
    if (!snapshot.evidenceRefIds.includes(ref?.evidenceRefId)) continue;
    try {
      assertProtocolArtifact('operating-evidence-ref', ref, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Snapshot EvidenceRef metadata is malformed and cannot be converted into an evidence absence.', {
        evidenceRefId: ref?.evidenceRefId ?? null,
        cause: cause?.code ?? null,
      });
    }
    if (ref.scopeId !== snapshot.scopeId
      || ref.domainId !== snapshot.domainId
      || ref.domainVersion !== snapshot.domainVersion) {
      fail('OPERATING_SCOPE_INVALID', 'Snapshot EvidenceRef crosses the immutable bundle scope or domain boundary.', {
        evidenceRefId: ref.evidenceRefId,
      });
    }
    if (refById.has(ref.evidenceRefId)) fail('STATE_TRANSITION_INVALID', 'Snapshot EvidenceRef identities must be unique.', {
      evidenceRefId: ref.evidenceRefId,
    });
    refById.set(ref.evidenceRefId, ref);
  }
  const missingEvidenceRefIds = snapshot.evidenceRefIds.filter((evidenceRefId) => !refById.has(evidenceRefId));
  if (missingEvidenceRefIds.length > 0) {
    fail('RESULT_CONTRACT_INVALID', 'Snapshot EvidenceRef custody is structurally incomplete and cannot be represented as no evidence.', {
      snapshotId: snapshot.snapshotId,
      evidenceRefIds: missingEvidenceRefIds,
    });
  }
  const artifactById = new Map();
  const referencedArtifactIds = new Set([...refById.values()].map(({ evidenceArtifactId }) => evidenceArtifactId));
  for (const artifact of evidenceArtifacts) {
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Evidence Artifact metadata is malformed and cannot enter intelligence-bundle custody.', {
        artifactId: artifact?.artifactId ?? null,
        cause: cause?.code ?? null,
      });
    }
    if (artifactById.has(artifact.artifactId)) {
      fail('STATE_TRANSITION_INVALID', 'Evidence Artifact identities must be unique before bundle materialization.', {
        artifactId: artifact.artifactId,
      });
    }
    if (referencedArtifactIds.has(artifact.artifactId)
      && (artifact.artifactType !== 'evidence-snapshot'
        || artifact.schemaId !== 'operating-evidence-snapshot'
        || artifact.artifactSchemaVersion !== '1.0.0')) {
      fail('RESULT_CONTRACT_INVALID', 'An EvidenceRef may bind only one materialized evidence-snapshot Artifact.', {
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        schemaId: artifact.schemaId,
      });
    }
    artifactById.set(artifact.artifactId, artifact);
  }
  return { refById, artifactById };
}

function absenceFor({ bundleId, role, draft }) {
  const sourceEvidenceRefIds = [...draft.sourceEvidenceRefIds];
  const sourceEventIds = [];
  return {
    absenceId: deriveOperatingEvidenceAbsenceIdV2({
      bundleId,
      roleId: role.roleId,
      roleVersion: role.roleVersion,
      requirementId: draft.requirementId,
      absenceCode: draft.absenceCode,
      sourceEvidenceRefIds,
      sourceEventIds,
    }),
    kind: 'evidence',
    requirementId: draft.requirementId,
    evidenceKinds: clone(draft.evidenceKinds),
    sourceContracts: clone(draft.sourceContracts),
    absenceCode: draft.absenceCode,
    reason: draft.reason,
    recoveryDisposition: 'refresh-or-issue-evidence',
    sourceEvidenceRefIds,
    sourceEventIds,
  };
}

function roleEvidenceSelection({ role, snapshot, refById, artifactById, authorizeEvidence }) {
  const issuedEvidence = [];
  const evidenceAbsenceDrafts = [];
  for (const requirement of role.evidenceRequirements) {
    const kindMatches = snapshot.evidenceRefIds
      .map((id) => refById.get(id))
      .filter(Boolean)
      .filter((ref) => requirement.acceptedEvidenceKinds.includes(ref.evidenceKind));
    const refs = kindMatches.filter((ref) => requirement.acceptedSourceContracts.some((contract) => (
      contract.id === ref.sourceContract.id && contract.version === ref.sourceContract.version
    )));
    const freshnessMatches = refs.filter((ref) => requirement.acceptedFreshness.includes(ref.freshness));
    const resolved = freshnessMatches.filter((ref) => {
      const artifact = artifactById.get(ref.evidenceArtifactId);
      return artifact
        && artifact.artifactType === 'evidence-snapshot'
        && artifact.schemaId === 'operating-evidence-snapshot'
        && artifact.artifactSchemaVersion === '1.0.0'
        && artifact.inputArtifactIds.includes(ref.sourceArtifactId)
        && artifact.rawHash === ref.evidenceArtifactRawHash
        && artifact.canonicalHash === ref.evidenceArtifactCanonicalHash
        && artifact.scopeId === snapshot.scopeId
        && artifact.domainId === snapshot.domainId
        && artifact.domainVersion === snapshot.domainVersion;
    });
    const authorized = resolved
      .filter((ref) => authorizeEvidence({ role, requirement, evidenceRef: ref, artifact: artifactById.get(ref.evidenceArtifactId) }) === true)
      .sort((left, right) => (
        requirement.acceptedFreshness.indexOf(left.freshness) - requirement.acceptedFreshness.indexOf(right.freshness)
        || left.evidenceRefId.localeCompare(right.evidenceRefId)
      ));
    const selected = authorized.slice(0, requirement.maximumEvidenceRefs);
    for (const ref of selected) {
      const artifact = artifactById.get(ref.evidenceArtifactId);
      issuedEvidence.push({
        requirementId: requirement.requirementId,
        evidenceRefId: ref.evidenceRefId,
        evidenceArtifactId: artifact.artifactId,
        rawHash: artifact.rawHash,
        canonicalHash: artifact.canonicalHash,
        classification: ref.classification,
        freshness: ref.freshness,
      });
    }
    if (selected.length >= requirement.minimumEvidenceRefs) continue;
    let absenceCode = 'not-available';
    let reason = selected.length === 0
      ? 'No materialized in-scope Evidence matched this role requirement.'
      : `Only ${selected.length} of minimum ${requirement.minimumEvidenceRefs} authorized EvidenceRefs were available.`;
    let absenceRefs = refs.length > 0 ? refs : kindMatches;
    if (refs.length > 0 && freshnessMatches.length === 0) {
      absenceCode = 'stale';
      reason = `Only 0 of minimum ${requirement.minimumEvidenceRefs} EvidenceRefs met the requirement freshness ceiling.`;
    } else if (freshnessMatches.length > 0 && resolved.length === 0) {
      absenceCode = 'resolution-failed';
      reason = `Only 0 of minimum ${requirement.minimumEvidenceRefs} matching EvidenceRefs resolved to exact immutable Artifact custody.`;
      absenceRefs = freshnessMatches;
    } else if (resolved.length > selected.length) {
      absenceCode = 'not-authorized';
      reason = `Only ${selected.length} of minimum ${requirement.minimumEvidenceRefs} matching EvidenceRefs were authorized for this role.`;
      absenceRefs = resolved;
    }
    evidenceAbsenceDrafts.push({
      requirementId: requirement.requirementId,
      evidenceKinds: [...requirement.acceptedEvidenceKinds].sort(),
      sourceContracts: [...requirement.acceptedSourceContracts]
        .sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`))
        .map((contract) => clone(contract)),
      absenceCode,
      reason,
      sourceEvidenceRefIds: absenceRefs.map(({ evidenceRefId }) => evidenceRefId).sort(),
    });
  }
  issuedEvidence.sort((left, right) => (
    left.requirementId.localeCompare(right.requirementId)
      || left.evidenceRefId.localeCompare(right.evidenceRefId)
  ));
  evidenceAbsenceDrafts.sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  return { issuedEvidence, evidenceAbsenceDrafts };
}

export function prepareOperatingIntelligenceEvidenceSelectionV2({
  snapshot,
  role,
  evidenceRefs,
  evidenceArtifacts,
  authorizeEvidence = () => true,
} = {}) {
  const checkedSnapshot = assertOperatingSnapshotV2(snapshot);
  const { refById, artifactById } = evidenceIndexes(checkedSnapshot, evidenceRefs, evidenceArtifacts);
  return freeze(roleEvidenceSelection({
    role,
    snapshot: checkedSnapshot,
    refById,
    artifactById,
    authorizeEvidence,
  }));
}

/** Build exact canonical bytes for one least-authority Assignment bundle. */
export function buildOperatingIntelligenceInputBundleV2({
  assignmentId,
  cycle,
  snapshot,
  delta,
  operatingState,
  role,
  evidenceRefs,
  evidenceArtifacts,
  createdAt,
  authorizeEvidence = () => true,
  evidenceSelection = null,
} = {}) {
  const checkedSnapshot = assertOperatingSnapshotV2(snapshot, { state: operatingState });
  const checkedDelta = assertOperatingDeltaV2(delta, { currentSnapshot: checkedSnapshot });
  const checkedState = assertOperatingModelStateV2(operatingState);
  if (!cycle || cycle.cycleId === undefined
    || checkedDelta.currentSnapshotId !== checkedSnapshot.snapshotId
    || checkedState.snapshotId !== checkedSnapshot.snapshotId
    || checkedState.stateId !== checkedSnapshot.stateId
    || checkedDelta.scopeId !== cycle.scopeId
    || checkedSnapshot.scopeId !== cycle.scopeId
    || checkedSnapshot.domainId !== cycle.domainId
    || checkedSnapshot.domainVersion !== cycle.domainVersion
    || typeof createdAt !== 'string'
    || Number.isNaN(Date.parse(createdAt))
    || typeof assignmentId !== 'string'
    || !assignmentId.startsWith('asg_')
    || !role || typeof role !== 'object') {
    fail('OPERATING_SCOPE_INVALID', 'Intelligence input bundle requires one exact Assignment, Cycle, Snapshot, Delta, state, role, and timestamp binding.');
  }
  const sourceArtifactIds = [...checkedSnapshot.sourceArtifactIds].sort();
  const { refById, artifactById } = evidenceIndexes(checkedSnapshot, evidenceRefs, evidenceArtifacts);
  const roleRequirementsHash = sha256Jcs({
    roleId: role.roleId,
    roleKind: role.roleKind,
    roleVersion: role.roleVersion,
    analysisProfile: role.analysisProfile,
    evidenceRequirements: role.evidenceRequirements,
    resultRequirements: role.resultRequirements,
  });
  const evidenceBindingHash = sha256Jcs(checkedSnapshot.evidenceRefIds.map((evidenceRefId) => {
    const ref = refById.get(evidenceRefId);
    const artifact = ref ? artifactById.get(ref.evidenceArtifactId) : null;
    return {
      evidenceRefId,
      evidenceKind: ref?.evidenceKind ?? null,
      sourceContract: ref?.sourceContract ?? null,
      freshness: ref?.freshness ?? null,
      classification: ref?.classification ?? null,
      evidenceArtifactId: ref?.evidenceArtifactId ?? null,
      evidenceArtifactRawHash: ref?.evidenceArtifactRawHash ?? null,
      evidenceArtifactCanonicalHash: ref?.evidenceArtifactCanonicalHash ?? null,
      availableArtifactRawHash: artifact?.rawHash ?? null,
      availableArtifactCanonicalHash: artifact?.canonicalHash ?? null,
    };
  }));
  const computedSelection = roleEvidenceSelection({
    role,
    snapshot: checkedSnapshot,
    refById,
    artifactById,
    authorizeEvidence,
  });
  if (evidenceSelection !== null && sha256Jcs(evidenceSelection) !== sha256Jcs(computedSelection)) {
    fail('STATE_TRANSITION_INVALID', 'Prepared Evidence selection differs from the exact recomputed authorization result.', {
      assignmentId,
      roleId: role.roleId,
    });
  }
  const selectedEvidence = computedSelection;
  const authorizationHash = sha256Jcs(selectedEvidence);
  const bundleId = deriveOperatingIntelligenceBundleIdV2({
    assignmentId,
    cycleId: cycle.cycleId,
    snapshotId: checkedSnapshot.snapshotId,
    deltaId: checkedDelta.deltaId,
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
    sourceArtifactIds,
    roleRequirementsHash,
    evidenceBindingHash,
    authorizationHash,
  });
  const evidenceAbsences = selectedEvidence.evidenceAbsenceDrafts.map((draft) => absenceFor({
    bundleId,
    role,
    draft,
  }));
  const assignmentBinding = {
    assignmentId,
    roleId: role.roleId,
    roleKind: role.roleKind,
    roleVersion: role.roleVersion,
    analysisProfile: clone(role.analysisProfile),
    evidenceRequirements: clone(role.evidenceRequirements),
    resultRequirements: clone(role.resultRequirements),
    issuedEvidence: selectedEvidence.issuedEvidence,
    evidenceAbsences,
  };
  const bundle = {
    kind: 'operating-intelligence-input-bundle',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    bundleId,
    cycleId: cycle.cycleId,
    snapshotId: checkedSnapshot.snapshotId,
    deltaId: checkedDelta.deltaId,
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
    snapshot: clone(checkedSnapshot),
    delta: clone(checkedDelta),
    operatingState: clone(projectOperatingIntelligenceStateV2(checkedState, { projectedAt: createdAt })),
    sourceArtifactIds,
    assignmentBinding,
    createdAt,
  };
  try {
    assertProtocolArtifact('operating-intelligence-input-bundle', bundle, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'The runtime-built intelligence input bundle is not contract-valid.', {
      bundleId,
      cause: cause?.code ?? null,
    });
  }
  const rawBytes = Buffer.from(canonicalizeJson(bundle), 'utf8');
  const rawHash = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;
  return Object.freeze({
    bundle: freeze(bundle),
    rawBytes: Buffer.from(rawBytes),
    rawHash,
    canonicalHash: sha256Jcs(bundle),
    evidenceArtifactIds: Object.freeze([...new Set(assignmentBinding.issuedEvidence.map(({ evidenceArtifactId }) => (
      evidenceArtifactId
    )))].sort()),
  });
}
