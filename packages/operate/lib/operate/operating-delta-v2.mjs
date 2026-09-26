import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
  });
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

function exactScope(left, right, subject) {
  if (
    !left ||
    !right ||
    left.scopeId !== right.scopeId ||
    left.domainId !== right.domainId ||
    left.domainVersion !== right.domainVersion
  ) {
    fail('OPERATING_SCOPE_INVALID', `${subject} must use one exact scope and domain binding.`, {
      scopeId: left?.scopeId ?? null,
      domainId: left?.domainId ?? null,
      domainVersion: left?.domainVersion ?? null,
    });
  }
}

function assertTimestamp(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail('STATE_TRANSITION_INVALID', `${field} must be an explicit ISO timestamp.`);
  }
}

function sortedUniqueIds(ids, subject) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must be an array of durable identities.`);
  }
  const normalized = [...new Set(ids)].sort();
  if (normalized.length !== ids.length) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must not contain duplicate durable identities.`);
  }
  return normalized;
}

function sortedChange(change) {
  const normalized = {
    subjectId: change.subjectId,
    kind: change.kind,
    ...(change.evidenceRefIds === undefined
      ? {}
      : { evidenceRefIds: sortedUniqueIds(change.evidenceRefIds, 'Delta evidence references') }),
  };
  return normalized;
}

function canonicalChanges(changes) {
  return changes
    .map(sortedChange)
    .sort(
      (left, right) =>
        left.subjectId.localeCompare(right.subjectId) ||
        left.kind.localeCompare(right.kind) ||
        sha256Jcs(left).localeCompare(sha256Jcs(right)),
    );
}

function sameCanonical(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((entry, index) => sha256Jcs(entry) === sha256Jcs(expected[index]))
  );
}

function assertSnapshotState(snapshot, state, subject) {
  let verifiedState;
  let verifiedSnapshot;
  try {
    verifiedState = assertOperatingModelStateV2(state);
    verifiedSnapshot = assertOperatingSnapshotV2(snapshot, { state: verifiedState });
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      `${subject} requires a valid snapshot and exact operating-model state.`,
      {
        cause: cause?.code ?? null,
      },
    );
  }
  return { snapshot: verifiedSnapshot, state: verifiedState };
}

function revisionsByArtifact(snapshot) {
  const result = new Map();
  for (const revision of snapshot.sourceRevisions) {
    result.set(revision.sourceArtifactId, {
      revision: revision.revision,
      evidenceRefIds: revision.evidenceRefIds ?? [],
    });
  }
  for (const artifactId of snapshot.sourceArtifactIds) {
    if (!result.has(artifactId)) result.set(artifactId, { revision: null, evidenceRefIds: [] });
  }
  return result;
}

function diffRevisions(priorSnapshot, currentSnapshot) {
  const prior = priorSnapshot ? revisionsByArtifact(priorSnapshot) : new Map();
  const current = revisionsByArtifact(currentSnapshot);
  const ids = [...new Set([...prior.keys(), ...current.keys()])].sort();
  return canonicalChanges(
    ids.flatMap((artifactId) => {
      const previous = prior.get(artifactId);
      const next = current.get(artifactId);
      if (!previous)
        return [{ subjectId: artifactId, kind: 'added', evidenceRefIds: next.evidenceRefIds }];
      if (!next)
        return [
          { subjectId: artifactId, kind: 'removed', evidenceRefIds: previous.evidenceRefIds },
        ];
      if (previous.revision !== next.revision) {
        return [
          {
            subjectId: artifactId,
            kind: 'changed',
            evidenceRefIds: [
              ...new Set([...previous.evidenceRefIds, ...next.evidenceRefIds]),
            ].sort(),
          },
        ];
      }
      return [];
    }),
  );
}

function latestObservations(observations, snapshot, evidenceRefs) {
  if (!Array.isArray(observations))
    fail('RESULT_CONTRACT_INVALID', 'Metric observations must be an array.');
  const byMetric = new Map();
  for (const candidate of observations) {
    // Observations are retained globally. A comparison consumes only records
    // explicitly bound to the selected immutable snapshot.
    if (candidate?.snapshotId !== snapshot.snapshotId) continue;
    try {
      assertProtocolArtifact('operating-metric-observation', candidate, {
        protocolVersion: PROTOCOL_VERSION,
      });
    } catch (cause) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Metric delta comparison accepts only typed metric observations.',
        { cause: cause?.code ?? null },
      );
    }
    if (
      candidate.scopeId !== snapshot.scopeId ||
      candidate.domainId !== snapshot.domainId ||
      candidate.domainVersion !== snapshot.domainVersion
    ) {
      fail(
        'OPERATING_SCOPE_INVALID',
        'Metric observation does not bind to its compared immutable snapshot.',
        {
          observationId: candidate.observationId,
          snapshotId: snapshot.snapshotId,
        },
      );
    }
    if (!snapshot.sourceArtifactIds.includes(candidate.sourceArtifactId)) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Metric observations must retain a source Artifact declared by their bound snapshot.',
        {
          observationId: candidate.observationId,
          sourceArtifactId: candidate.sourceArtifactId,
        },
      );
    }
    for (const evidenceRefId of candidate.evidenceRefIds) {
      const evidenceRef = evidenceRefs.get(evidenceRefId);
      if (!evidenceRef || evidenceRef.sourceArtifactId !== candidate.sourceArtifactId) {
        fail(
          'STATE_TRANSITION_INVALID',
          'Metric observations may cite only selected, same-source EvidenceRefs.',
          {
            observationId: candidate.observationId,
            evidenceRefId,
          },
        );
      }
    }
    const existing = byMetric.get(candidate.metricId);
    if (
      !existing ||
      candidate.observedAt > existing.observedAt ||
      (candidate.observedAt === existing.observedAt &&
        candidate.observationId > existing.observationId)
    ) {
      byMetric.set(candidate.metricId, candidate);
    }
  }
  return byMetric;
}

function diffMetrics(
  priorSnapshot,
  currentSnapshot,
  priorObservations,
  currentObservations,
  priorEvidenceRefs,
  currentEvidenceRefs,
) {
  const prior = priorSnapshot
    ? latestObservations(priorObservations, priorSnapshot, priorEvidenceRefs)
    : new Map();
  const current = latestObservations(currentObservations, currentSnapshot, currentEvidenceRefs);
  const ids = [...new Set([...prior.keys(), ...current.keys()])].sort();
  return canonicalChanges(
    ids.flatMap((metricId) => {
      const before = prior.get(metricId);
      const after = current.get(metricId);
      if (!before)
        return [{ subjectId: metricId, kind: 'added', evidenceRefIds: after.evidenceRefIds }];
      if (!after)
        return [{ subjectId: metricId, kind: 'removed', evidenceRefIds: before.evidenceRefIds }];
      if (before.value !== after.value || before.unit !== after.unit) {
        return [
          {
            subjectId: metricId,
            kind: 'changed',
            evidenceRefIds: [
              ...new Set([...before.evidenceRefIds, ...after.evidenceRefIds]),
            ].sort(),
          },
        ];
      }
      return [];
    }),
  );
}

function scopedRecords(records, snapshot, kind) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', `${kind} records must be an array.`);
  return records.filter(
    (record) =>
      record?.scopeId === snapshot.scopeId &&
      record?.domainId === snapshot.domainId &&
      record?.domainVersion === snapshot.domainVersion,
  );
}

function evidenceArtifactIndex(records, snapshot, evidenceRefs) {
  if (!Array.isArray(records))
    fail('RESULT_CONTRACT_INVALID', 'Delta comparison requires Evidence Artifact metadata.');
  const selectedArtifactIds = new Set(
    [...evidenceRefs.values()].map(({ evidenceArtifactId }) => evidenceArtifactId),
  );
  const result = new Map();
  for (const artifact of records) {
    if (!selectedArtifactIds.has(artifact?.artifactId)) continue;
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Delta comparison accepts only typed Evidence Artifacts.', {
        cause: cause?.code ?? null,
      });
    }
    if (
      artifact.scopeId !== snapshot.scopeId ||
      artifact.domainId !== snapshot.domainId ||
      artifact.domainVersion !== snapshot.domainVersion ||
      result.has(artifact.artifactId)
    ) {
      fail(
        'OPERATING_SCOPE_INVALID',
        'Delta Evidence Artifacts must be unique and match the selected immutable snapshot.',
        {
          artifactId: artifact?.artifactId ?? null,
        },
      );
    }
    result.set(artifact.artifactId, artifact);
  }
  return result;
}

function evidenceIndex(records, evidenceArtifacts, snapshot) {
  const index = new Map();
  for (const evidence of records ?? []) {
    // Evidence registries are global; only this immutable snapshot selection
    // participates in its comparison. Ambient entries are harmless noise.
    if (!snapshot.evidenceRefIds.includes(evidence?.evidenceRefId)) continue;
    try {
      assertProtocolArtifact('operating-evidence-ref', evidence, {
        protocolVersion: PROTOCOL_VERSION,
      });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Delta comparison accepts only typed EvidenceRefs.', {
        cause: cause?.code ?? null,
      });
    }
    if (
      evidence.scopeId !== snapshot.scopeId ||
      evidence.domainId !== snapshot.domainId ||
      evidence.domainVersion !== snapshot.domainVersion ||
      index.has(evidence.evidenceRefId) ||
      !snapshot.sourceArtifactIds.includes(evidence.sourceArtifactId)
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Delta comparison requires snapshot-declared, unique EvidenceRef identities.',
        {
          evidenceRefId: evidence.evidenceRefId,
        },
      );
    }
    index.set(evidence.evidenceRefId, evidence);
  }
  const artifacts = evidenceArtifactIndex(evidenceArtifacts, snapshot, index);
  for (const evidence of index.values()) {
    const artifact = artifacts.get(evidence.evidenceArtifactId);
    if (
      !artifact ||
      artifact.artifactType !== 'evidence-snapshot' ||
      artifact.schemaId !== 'operating-evidence-snapshot' ||
      !artifact.inputArtifactIds.includes(evidence.sourceArtifactId) ||
      artifact.rawHash !== evidence.evidenceArtifactRawHash ||
      artifact.canonicalHash !== evidence.evidenceArtifactCanonicalHash
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Delta EvidenceRefs must resolve to their exact selected Evidence Artifact.',
        {
          evidenceRefId: evidence.evidenceRefId,
        },
      );
    }
  }
  return index;
}

function derivedEvidenceStatus({ evidenceRefs, claims, snapshot }) {
  const stale = [...evidenceRefs.values()]
    .filter(({ freshness }) => freshness === 'stale')
    .map(({ evidenceRefId }) => evidenceRefId)
    .sort();
  const conflicting = new Set();
  for (const claim of scopedRecords(claims, snapshot, 'Claim')) {
    if (!snapshot.sourceArtifactIds.includes(claim?.sourceArtifactId)) continue;
    try {
      assertProtocolArtifact('operating-claim', claim, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Delta claim analysis accepts only typed Claim records.', {
        cause: cause?.code ?? null,
      });
    }
    const support = new Set(claim.supportingEvidenceRefIds);
    const contradiction = new Set(claim.contradictingEvidenceRefIds);
    if (
      support.size !== claim.supportingEvidenceRefIds.length ||
      contradiction.size !== claim.contradictingEvidenceRefIds.length ||
      [...support].some((id) => contradiction.has(id))
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'A Delta Claim may not overlap or duplicate support and contradiction EvidenceRefs.',
        {
          claimId: claim.claimId,
        },
      );
    }
    for (const evidenceRefId of support) {
      if (
        !evidenceRefs.has(evidenceRefId) ||
        evidenceRefs.get(evidenceRefId).sourceArtifactId !== claim.sourceArtifactId
      ) {
        fail(
          'STATE_TRANSITION_INVALID',
          'A Claim references unavailable or cross-source typed evidence.',
          { claimId: claim.claimId, evidenceRefId },
        );
      }
    }
    for (const evidenceRefId of contradiction) {
      if (
        !evidenceRefs.has(evidenceRefId) ||
        evidenceRefs.get(evidenceRefId).sourceArtifactId !== claim.sourceArtifactId
      ) {
        fail(
          'STATE_TRANSITION_INVALID',
          'A Claim references unavailable or cross-source typed evidence.',
          { claimId: claim.claimId, evidenceRefId },
        );
      }
    }
    // A Claim can lawfully retain distinct support and contradiction evidence.
    // That is an explainable conflict, unlike an illegal same-ref overlap.
    if (support.size > 0 && contradiction.size > 0) {
      for (const evidenceRefId of support) conflicting.add(evidenceRefId);
      for (const evidenceRefId of contradiction) conflicting.add(evidenceRefId);
    }
  }
  return {
    stale,
    conflicting: [...conflicting].sort(),
  };
}

function priorEquivalent(record, prior) {
  if (!prior) return null;
  return prior.get(record.predecessorRevisionId) ?? prior.get(record.revisionId) ?? null;
}

function recordsById(records, id, snapshot, kind, { snapshotSourcesOnly = false } = {}) {
  const result = new Map();
  for (const record of scopedRecords(records, snapshot, kind)) {
    if (snapshotSourcesOnly && !snapshot.sourceArtifactIds.includes(record?.sourceArtifactId))
      continue;
    try {
      assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', `Delta ${kind} analysis requires typed records.`, {
        cause: cause?.code ?? null,
      });
    }
    if (
      (kind === 'operating-risk' && record.revisionId !== record.riskId) ||
      (kind === 'operating-assumption' && record.revisionId !== record.assumptionId)
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Delta lifecycle records must retain their canonical immutable revision identity.',
        {
          entityId: record[id],
          revisionId: record.revisionId,
        },
      );
    }
    if (result.has(record[id]))
      fail(
        'STATE_TRANSITION_INVALID',
        `Delta analysis cannot resolve duplicate ${kind} identities.`,
        { entityId: record[id] },
      );
    result.set(record[id], record);
  }
  return result;
}

function verificationLearningRevisits(outcomes, learnings, snapshot, evidenceRefs) {
  if (!Array.isArray(outcomes) || !Array.isArray(learnings)) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Delta verification-revisit analysis requires Outcome and Learning collections.',
    );
  }
  const outcomesById = new Map();
  for (const outcome of outcomes) {
    if (!sameScopeForVerification(outcome, snapshot)) continue;
    try {
      assertProtocolArtifact('operating-outcome', outcome, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Delta verification-revisit analysis accepts only typed Outcomes.',
        { cause: cause?.code ?? null },
      );
    }
    if (
      !snapshot.sourceArtifactIds.includes(outcome.sourceArtifactId) ||
      outcome.evidenceRefIds.some(
        (id) => evidenceRefs.get(id)?.sourceArtifactId !== outcome.sourceArtifactId,
      ) ||
      outcomesById.has(outcome.outcomeId)
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Outcome revisit analysis requires one snapshot-declared accepted source and matching typed EvidenceRefs.',
        {
          outcomeId: outcome.outcomeId,
        },
      );
    }
    outcomesById.set(outcome.outcomeId, outcome);
  }
  const revisit = new Set();
  for (const learning of learnings) {
    if (!sameScopeForVerification(learning, snapshot)) continue;
    try {
      assertProtocolArtifact('operating-learning', learning, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Delta verification-revisit analysis accepts only typed Learnings.',
        { cause: cause?.code ?? null },
      );
    }
    const outcome = outcomesById.get(learning.outcomeId);
    if (
      !outcome ||
      learning.sourceArtifactId !== outcome.sourceArtifactId ||
      !snapshot.sourceArtifactIds.includes(learning.sourceArtifactId) ||
      learning.evidenceRefIds.some(
        (id) => evidenceRefs.get(id)?.sourceArtifactId !== learning.sourceArtifactId,
      )
    ) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Learning revisit analysis requires its retained Outcome and snapshot-declared typed evidence.',
        {
          learningId: learning.learningId,
        },
      );
    }
    for (const decisionId of learning.decisionIds) revisit.add(decisionId);
  }
  return [...revisit].sort();
}

function sameScopeForVerification(record, snapshot) {
  return (
    record?.scopeId === snapshot.scopeId &&
    record?.domainId === snapshot.domainId &&
    record?.domainVersion === snapshot.domainVersion
  );
}

function deltaMateriality(delta) {
  const fields = [
    'sourceRevisionChanges',
    'metricChanges',
    'staleEvidenceRefIds',
    'conflictingEvidenceRefIds',
    'invalidatedAssumptionIds',
    'exposedRiskIds',
    'decisionRevisitIds',
  ];
  return fields.some((field) => delta[field].length > 0);
}

/** Returns a stable material/no-material-change explanation without adding hidden state to the Delta contract. */
export function classifyOperatingDeltaMaterialityV2(delta) {
  try {
    assertProtocolArtifact('operating-delta', delta, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Delta materiality requires a valid operating Delta.', {
      cause: cause?.code ?? null,
    });
  }
  return freeze({
    material: deltaMateriality(delta),
    reason: deltaMateriality(delta) ? 'material-change' : 'no-material-change',
  });
}

/** Validate canonical ordering and immutable snapshot bindings for a Delta record. */
export function assertOperatingDeltaV2(delta, { currentSnapshot, priorSnapshot = null } = {}) {
  try {
    assertProtocolArtifact('operating-delta', delta, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Operating Delta is not a valid Protocol 2.0 record.', {
      cause: cause?.code ?? null,
    });
  }
  assertTimestamp(delta.derivedAt, 'Delta derivedAt');
  for (const field of ['sourceRevisionChanges', 'metricChanges']) {
    const canonical = canonicalChanges(delta[field]);
    if (!sameCanonical(delta[field], canonical)) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Operating Delta change records must use stable canonical ordering.',
        { deltaId: delta.deltaId, field },
      );
    }
  }
  for (const field of [
    'staleEvidenceRefIds',
    'conflictingEvidenceRefIds',
    'invalidatedAssumptionIds',
    'exposedRiskIds',
    'decisionRevisitIds',
  ]) {
    const canonical = sortedUniqueIds(delta[field], field);
    if (!sameCanonical(delta[field], canonical)) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Operating Delta identity collections must use stable canonical ordering.',
        { deltaId: delta.deltaId, field },
      );
    }
  }
  if (currentSnapshot !== undefined) {
    if (
      delta.currentSnapshotId !== currentSnapshot.snapshotId ||
      delta.scopeId !== currentSnapshot.scopeId ||
      delta.domainId !== currentSnapshot.domainId ||
      delta.domainVersion !== currentSnapshot.domainVersion
    ) {
      fail('OPERATING_SCOPE_INVALID', 'Delta must bind to its exact current snapshot and scope.', {
        deltaId: delta.deltaId,
      });
    }
  }
  if (
    priorSnapshot !== null &&
    priorSnapshot !== undefined &&
    delta.priorSnapshotId !== priorSnapshot.snapshotId
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Delta priorSnapshotId must match the supplied immutable predecessor.',
      { deltaId: delta.deltaId },
    );
  }
  return freeze(clone(delta));
}

/**
 * Derive one deterministic, evidence-backed Delta. This function reads only
 * immutable snapshots/state and typed persisted records; it has no provider,
 * byte-store, cache, model, or dispatch dependency.
 */
export function deriveOperatingDeltaV2({
  deltaId,
  currentSnapshot,
  currentState,
  priorSnapshot = null,
  priorState = null,
  evidenceRefs = [],
  evidenceArtifacts = [],
  claims = [],
  metricObservations = [],
  priorMetricObservations = [],
  risks = [],
  assumptions = [],
  decisions = [],
  outcomes = [],
  learnings = [],
  sourceArtifactId,
  derivedAt,
} = {}) {
  if (
    typeof deltaId !== 'string' ||
    deltaId.length === 0 ||
    typeof sourceArtifactId !== 'string' ||
    sourceArtifactId.length === 0
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Delta derivation requires runtime-issued Delta and source Artifact identities.',
    );
  }
  assertTimestamp(derivedAt, 'Delta derivedAt');
  const current = assertSnapshotState(currentSnapshot, currentState, 'Delta derivation');
  let prior = null;
  if ((priorSnapshot === null) !== (priorState === null)) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Delta derivation requires both predecessor snapshot and state, or neither.',
    );
  }
  if (priorSnapshot !== null) {
    prior = assertSnapshotState(priorSnapshot, priorState, 'Delta predecessor');
    exactScope(prior.snapshot, current.snapshot, 'Delta predecessor');
    if (current.snapshot.previousSnapshotId !== prior.snapshot.snapshotId) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Delta predecessor must be the current snapshot’s immutable prior link.',
        {
          currentSnapshotId: current.snapshot.snapshotId,
          priorSnapshotId: prior.snapshot.snapshotId,
        },
      );
    }
  } else if (current.snapshot.previousSnapshotId !== null) {
    fail(
      'STATE_TRANSITION_INVALID',
      'A snapshot with a prior link requires that exact predecessor for Delta derivation.',
      {
        currentSnapshotId: current.snapshot.snapshotId,
        priorSnapshotId: current.snapshot.previousSnapshotId,
      },
    );
  }
  if (!current.snapshot.sourceArtifactIds.includes(sourceArtifactId)) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Delta source Artifact must be named by the current immutable snapshot.',
      {
        sourceArtifactId,
        currentSnapshotId: current.snapshot.snapshotId,
      },
    );
  }
  const evidence = evidenceIndex(evidenceRefs, evidenceArtifacts, current.snapshot);
  const priorEvidence = prior
    ? evidenceIndex(evidenceRefs, evidenceArtifacts, prior.snapshot)
    : new Map();
  const status = derivedEvidenceStatus({
    evidenceRefs: evidence,
    claims,
    snapshot: current.snapshot,
  });
  const scopedAssumptions = recordsById(
    current.state.assumptions,
    'revisionId',
    current.snapshot,
    'operating-assumption',
  );
  const scopedRisks = recordsById(
    current.state.risks,
    'revisionId',
    current.snapshot,
    'operating-risk',
  );
  const priorAssumptions = prior
    ? recordsById(prior.state.assumptions, 'revisionId', prior.snapshot, 'operating-assumption')
    : new Map();
  const priorRisks = prior
    ? recordsById(prior.state.risks, 'revisionId', prior.snapshot, 'operating-risk')
    : new Map();
  const scopedDecisions = recordsById(
    decisions,
    'decisionId',
    current.snapshot,
    'operating-decision',
    { snapshotSourcesOnly: true },
  );
  const invalidatedAssumptionIds = [...scopedAssumptions.values()]
    .filter(
      (assumption) =>
        assumption.status === 'invalidated' &&
        priorEquivalent(assumption, priorAssumptions)?.status !== 'invalidated',
    )
    .map(({ assumptionId }) => assumptionId)
    .sort();
  const exposedRiskIds = [...scopedRisks.values()]
    .filter((risk) => {
      if (risk.state === 'closed' || risk.state === 'superseded' || risk.exposure <= 0)
        return false;
      const before = priorEquivalent(risk, priorRisks);
      return (
        !before ||
        before.state === 'closed' ||
        before.state === 'superseded' ||
        before.exposure !== risk.exposure
      );
    })
    .map(({ riskId }) => riskId)
    .sort();
  const sourceRevisionChanges = diffRevisions(prior?.snapshot ?? null, current.snapshot);
  const metricChanges = diffMetrics(
    prior?.snapshot ?? null,
    current.snapshot,
    prior ? priorMetricObservations : [],
    metricObservations,
    priorEvidence,
    evidence,
  );
  const changedEvidence = new Set([
    ...status.stale,
    ...status.conflicting,
    ...sourceRevisionChanges.flatMap((change) => change.evidenceRefIds ?? []),
    ...metricChanges.flatMap((change) => change.evidenceRefIds ?? []),
  ]);
  const changedMetrics = new Set(metricChanges.map(({ subjectId }) => subjectId));
  const changedSource = sourceRevisionChanges.length > 0;
  const learnedDecisionRevisitIds = verificationLearningRevisits(
    outcomes,
    learnings,
    current.snapshot,
    evidence,
  );
  const decisionRevisitIds = [...scopedDecisions.values()]
    .filter((decision) => decision.state !== 'superseded')
    .filter(
      (decision) =>
        decision.assumptionIds.some((id) => invalidatedAssumptionIds.includes(id)) ||
        decision.evidenceRefIds.some((id) => changedEvidence.has(id)) ||
        (changedMetrics.size > 0 && decision.revisitConditions.length > 0) ||
        (changedSource && decision.reopenConditions.length > 0) ||
        (decision.revisitAt !== null && decision.revisitAt <= derivedAt),
    )
    .map(({ decisionId }) => decisionId)
    .concat(learnedDecisionRevisitIds)
    .filter((decisionId, index, values) => values.indexOf(decisionId) === index)
    .sort();
  const delta = {
    kind: 'operating-delta',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    deltaId,
    scopeId: current.snapshot.scopeId,
    domainId: current.snapshot.domainId,
    domainVersion: current.snapshot.domainVersion,
    priorSnapshotId: prior?.snapshot.snapshotId ?? null,
    currentSnapshotId: current.snapshot.snapshotId,
    sourceRevisionChanges,
    metricChanges,
    staleEvidenceRefIds: status.stale,
    conflictingEvidenceRefIds: status.conflicting,
    invalidatedAssumptionIds,
    exposedRiskIds,
    decisionRevisitIds,
    sourceArtifactId,
    derivedAt,
  };
  return assertOperatingDeltaV2(delta, {
    currentSnapshot: current.snapshot,
    priorSnapshot: prior?.snapshot ?? null,
  });
}
