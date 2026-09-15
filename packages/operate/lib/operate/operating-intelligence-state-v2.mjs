import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

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

function sortedBy(records, id) {
  const normalized = records.map(clone).sort((left, right) => left[id].localeCompare(right[id]));
  if (new Set(normalized.map((record) => record[id])).size !== normalized.length) {
    fail('STATE_TRANSITION_INVALID', 'One intelligence transition cannot contain duplicate durable identities.', { id });
  }
  return normalized;
}

function sameScope(record, snapshot) {
  return record.scopeId === snapshot.scopeId
    && record.domainId === snapshot.domainId
    && record.domainVersion === snapshot.domainVersion;
}

function assertSnapshotState(snapshot, state) {
  let checkedState;
  let checkedSnapshot;
  try {
    checkedState = assertOperatingModelStateV2(state);
    checkedSnapshot = assertOperatingSnapshotV2(snapshot, { state: checkedState });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Operating intelligence facts require a valid immutable snapshot and matching model state.', {
      cause: cause?.code ?? null,
    });
  }
  return { snapshot: checkedSnapshot, state: checkedState };
}

function evidenceArtifactMap(records, snapshot, selectedEvidenceRefs) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization requires Evidence Artifact metadata.');
  const selectedArtifactIds = new Set(selectedEvidenceRefs.map(({ evidenceArtifactId }) => evidenceArtifactId));
  const result = new Map();
  for (const artifact of records) {
    // The runtime registry is global. Artifacts outside the immutable snapshot
    // selection are neither authority nor validation input for this transition.
    if (!selectedArtifactIds.has(artifact?.artifactId)) continue;
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization accepts only typed Evidence Artifacts.', { cause: cause?.code ?? null });
    }
    if (!sameScope(artifact, snapshot) || result.has(artifact.artifactId)) {
      fail('OPERATING_SCOPE_INVALID', 'Evidence Artifacts must be unique and match the immutable snapshot scope.', {
        artifactId: artifact?.artifactId ?? null,
      });
    }
    result.set(artifact.artifactId, artifact);
  }
  return result;
}

function evidenceMap(records, snapshot, evidenceArtifacts) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization requires an EvidenceRef collection.');
  const selectedIds = new Set(snapshot.evidenceRefIds);
  const selected = [];
  const seen = new Set();
  for (const evidence of records) {
    // Ambient registry entries are intentionally ignored. A record that cites
    // one will still fail through assertEvidence because it is not selected.
    if (!selectedIds.has(evidence?.evidenceRefId)) continue;
    try {
      assertProtocolArtifact('operating-evidence-ref', evidence, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization accepts only typed EvidenceRefs.', { cause: cause?.code ?? null });
    }
    if (!sameScope(evidence, snapshot) || seen.has(evidence.evidenceRefId)) {
      fail('OPERATING_SCOPE_INVALID', 'EvidenceRefs selected by an immutable snapshot must be unique and in scope.', {
        evidenceRefId: evidence?.evidenceRefId ?? null,
      });
    }
    seen.add(evidence.evidenceRefId);
    selected.push(evidence);
  }
  const artifacts = evidenceArtifactMap(evidenceArtifacts, snapshot, selected);
  const result = new Map();
  for (const evidence of selected) {
    const artifact = artifacts.get(evidence.evidenceArtifactId);
    if (!artifact
      || artifact.artifactType !== 'evidence-snapshot'
      || artifact.schemaId !== 'operating-evidence-snapshot'
      || !artifact.inputArtifactIds.includes(evidence.sourceArtifactId)
      || artifact.rawHash !== evidence.evidenceArtifactRawHash
      || artifact.canonicalHash !== evidence.evidenceArtifactCanonicalHash) {
      fail('OPERATING_SCOPE_INVALID', 'EvidenceRefs must bind their exact selected Evidence Artifact.', {
        evidenceRefId: evidence.evidenceRefId,
      });
    }
    result.set(evidence.evidenceRefId, evidence);
  }
  return result;
}

function sourceArtifactMap(records, snapshot) {
  if (!Array.isArray(records)) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization requires a producer Artifact collection.');
  }
  const result = new Map();
  for (const artifact of records) {
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Intelligence fact materialization accepts only typed producer Artifacts.', {
        cause: cause?.code ?? null,
      });
    }
    if (!sameScope(artifact, snapshot) || result.has(artifact.artifactId)) {
      fail('OPERATING_SCOPE_INVALID', 'Producer Artifacts must be unique and match the immutable snapshot scope.', {
        artifactId: artifact?.artifactId ?? null,
      });
    }
    result.set(artifact.artifactId, artifact);
  }
  return result;
}

function assertEvidence(ids, evidence, {
  subject,
  sourceArtifactId,
  producerArtifact = null,
  required = false,
} = {}) {
  if (!Array.isArray(ids) || (required && ids.length === 0)) {
    fail('RESULT_CONTRACT_INVALID', `${subject} requires ${required ? 'typed evidence' : 'an evidence-reference array'}.`);
  }
  if (new Set(ids).size !== ids.length) fail('RESULT_CONTRACT_INVALID', `${subject} evidence references must be unique.`);
  for (const evidenceRefId of ids) {
    const ref = evidence.get(evidenceRefId);
    const retainsCustody = producerArtifact === null
      ? ref?.sourceArtifactId === sourceArtifactId
      : producerArtifact.inputArtifactIds.includes(ref?.evidenceArtifactId);
    if (!ref || ref.freshness === 'stale' || !retainsCustody) {
      fail('STATE_TRANSITION_INVALID', `${subject} requires current or historical typed EvidenceRefs; stale or unavailable evidence fails closed.`, {
        evidenceRefId,
        sourceArtifactId,
      });
    }
  }
}

function assertSourceArtifact(record, snapshot, { subject, producerArtifacts = null } = {}) {
  if (snapshot.sourceArtifactIds.includes(record.sourceArtifactId)) return null;
  const producerArtifact = producerArtifacts?.get(record.sourceArtifactId) ?? null;
  if (!producerArtifact
    || !['operating-advisor-result', 'operating-challenger-review', 'operating-decision-ledger'].includes(producerArtifact.schemaId)) {
    fail('STATE_TRANSITION_INVALID', `${subject} source Artifact must be explicitly declared by the immutable snapshot.`, {
      sourceArtifactId: record.sourceArtifactId,
      snapshotId: snapshot.snapshotId,
    });
  }
  return producerArtifact;
}

function assertTyped(kind, record, snapshot, id) {
  try {
    assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', `Intelligence transition contains an invalid ${kind} record.`, { cause: cause?.code ?? null });
  }
  if (!sameScope(record, snapshot)) {
    fail('OPERATING_SCOPE_INVALID', `${kind} must match the immutable snapshot scope.`, { entityId: record?.[id] ?? null });
  }
}

function assertClaim(record, snapshot, evidence, assumptions, producerArtifacts) {
  assertTyped('operating-claim', record, snapshot, 'claimId');
  const producerArtifact = assertSourceArtifact(record, snapshot, { subject: 'Claim', producerArtifacts });
  assertEvidence(record.supportingEvidenceRefIds, evidence, {
    subject: 'Claim support', sourceArtifactId: record.sourceArtifactId, producerArtifact,
  });
  assertEvidence(record.contradictingEvidenceRefIds, evidence, {
    subject: 'Claim contradiction', sourceArtifactId: record.sourceArtifactId, producerArtifact,
  });
  if (new Set([...record.supportingEvidenceRefIds, ...record.contradictingEvidenceRefIds]).size
    !== record.supportingEvidenceRefIds.length + record.contradictingEvidenceRefIds.length) {
    fail('STATE_TRANSITION_INVALID', 'A Claim may not use one EvidenceRef as both support and contradiction.', { claimId: record.claimId });
  }
  for (const assumptionId of record.assumptionIds) {
    if (!assumptions.has(assumptionId)) {
      fail('STATE_TRANSITION_INVALID', 'Claim assumptions must resolve within the immutable operating state.', {
        claimId: record.claimId,
        assumptionId,
      });
    }
  }
}

function assertObservation(record, snapshot, evidence, metrics) {
  assertTyped('operating-metric-observation', record, snapshot, 'observationId');
  if (record.snapshotId !== snapshot.snapshotId) {
    fail('STATE_TRANSITION_INVALID', 'Metric observations must bind to the exact immutable snapshot used for the transition.', {
      observationId: record.observationId,
      snapshotId: record.snapshotId,
    });
  }
  const metric = metrics.get(record.metricId);
  if (!metric || metric.unit !== record.unit) {
    fail('STATE_TRANSITION_INVALID', 'Metric observations require one in-scope metric with a matching unit.', {
      observationId: record.observationId,
      metricId: record.metricId,
    });
  }
  assertSourceArtifact(record, snapshot, { subject: 'Metric observation' });
  assertEvidence(record.evidenceRefIds, evidence, { subject: 'Metric observation', sourceArtifactId: record.sourceArtifactId, required: true });
}

function revisionIndex(records, idField, subject) {
  const result = new Map();
  for (const record of records) {
    if (record?.revisionId === undefined) continue;
    if (record.revisionId !== record[idField]) {
      fail('STATE_TRANSITION_INVALID', `${subject} history has a duplicate or reset revision identity.`, {
        entityId: record?.[idField] ?? null,
        revisionId: record?.revisionId ?? null,
      });
    }
    const existing = result.get(record.revisionId);
    if (existing) {
      if (sha256Jcs(existing) === sha256Jcs(record)) continue;
      fail('STATE_TRANSITION_INVALID', `${subject} history has hash-divergent records for one revision identity.`, {
        entityId: record?.[idField] ?? null,
        revisionId: record?.revisionId ?? null,
      });
    }
    if ([...result.values()].some((entry) => entry[idField] === record[idField])) {
      fail('STATE_TRANSITION_INVALID', `${subject} history has a duplicate or reset revision identity.`, {
        entityId: record?.[idField] ?? null,
        revisionId: record?.revisionId ?? null,
      });
    }
    result.set(record.revisionId, record);
  }
  return result;
}

function assertRevision(record, revisions, {
  idField, immutableFields, initialState, transitions, stateField = 'state', subject,
} = {}) {
  if (!Number.isInteger(record.revision) || record.revision < 1
    || record.revisionId !== record[idField] || !Object.hasOwn(record, 'predecessorRevisionId')) {
    fail('STATE_TRANSITION_INVALID', `${subject} must carry explicit append-only revision metadata.`, {
      entityId: record?.[idField] ?? null,
    });
  }
  if (revisions.has(record.revisionId) || [...revisions.values()].some((entry) => entry[idField] === record[idField])) {
    fail('CONCURRENT_MODIFICATION', `${subject} may not reuse an immutable record or revision identity.`, {
      entityId: record[idField], revisionId: record.revisionId,
    });
  }
  if (record.revision === 1) {
    if (record.predecessorRevisionId !== null || record[stateField] !== initialState) {
      fail('STATE_TRANSITION_INVALID', `${subject} initial revision must begin in its initial lifecycle state without a predecessor.`, {
        entityId: record[idField],
      });
    }
    return;
  }
  const predecessor = revisions.get(record.predecessorRevisionId);
  if (!predecessor
    || record.revision !== (predecessor.revision ?? 1) + 1
    || [...revisions.values()].some((entry) => entry.predecessorRevisionId === predecessor.revisionId)) {
    fail('STATE_TRANSITION_INVALID', `${subject} revision must retain exactly one predecessor and its complete canonical history.`, {
      entityId: record[idField], predecessorRevisionId: record.predecessorRevisionId ?? null,
    });
  }
  for (const field of immutableFields) {
    if (record[field] !== predecessor[field]) {
      fail('STATE_TRANSITION_INVALID', `${subject} revisions may not alter immutable identity field ${field}.`, {
        entityId: record[idField], field,
      });
    }
  }
  if (!transitions[predecessor[stateField]]?.includes(record[stateField])) {
    fail('STATE_TRANSITION_INVALID', `${subject} revision uses an illegal lifecycle transition.`, {
      entityId: record[idField], from: predecessor[stateField], to: record[stateField],
    });
  }
}

function assertRisk(record, snapshot, evidence, risks, producerArtifacts) {
  assertTyped('operating-risk', record, snapshot, 'riskId');
  const producerArtifact = assertSourceArtifact(record, snapshot, { subject: 'Risk', producerArtifacts });
  assertEvidence(record.evidenceRefIds, evidence, {
    subject: 'Risk', sourceArtifactId: record.sourceArtifactId, producerArtifact, required: true,
  });
  assertRevision(record, risks, {
    idField: 'riskId',
    immutableFields: ['scopeId', 'domainId', 'domainVersion', 'title', 'statement', 'createdAt'],
    initialState: 'open',
    transitions: {
      open: ['monitoring', 'mitigated', 'closed', 'superseded'],
      monitoring: ['mitigated', 'closed', 'superseded'],
      mitigated: ['monitoring', 'closed', 'superseded'],
    },
    subject: 'Risk',
  });
  if (record.state === 'closed' && record.closedAt !== record.updatedAt) {
    fail('STATE_TRANSITION_INVALID', 'A closed Risk must retain its Event timestamp as closedAt and updatedAt.', { riskId: record.riskId });
  }
}

function assertAssumption(record, snapshot, evidence, decisions, actions, assumptions) {
  assertTyped('operating-assumption', record, snapshot, 'assumptionId');
  assertSourceArtifact(record, snapshot, { subject: 'Assumption' });
  assertEvidence(record.evidenceRefIds, evidence, { subject: 'Assumption', sourceArtifactId: record.sourceArtifactId, required: true });
  assertRevision(record, assumptions, {
    idField: 'assumptionId',
    immutableFields: ['scopeId', 'domainId', 'domainVersion', 'statement', 'createdAt'],
    initialState: 'active',
    transitions: {
      active: ['validated', 'invalidated', 'closed', 'superseded'],
      validated: ['invalidated', 'closed', 'superseded'],
    },
    stateField: 'status',
    subject: 'Assumption',
  });
  if (['invalidated', 'closed'].includes(record.status) && record.closedAt !== record.updatedAt) {
    fail('STATE_TRANSITION_INVALID', 'An invalidated or closed Assumption must retain its Event timestamp as closedAt and updatedAt.', {
      assumptionId: record.assumptionId,
    });
  }
  for (const decisionId of record.affectedDecisionIds) {
    if (!decisions.has(decisionId)) fail('STATE_TRANSITION_INVALID', 'Assumption affected decision must resolve to durable history.', { assumptionId: record.assumptionId, decisionId });
  }
  for (const actionId of record.affectedActionIds) {
    if (!actions.has(actionId)) fail('STATE_TRANSITION_INVALID', 'Assumption affected action must resolve to durable history.', { assumptionId: record.assumptionId, actionId });
  }
}

function assertDecisionRevision(record, snapshot, evidence, assumptions, decisions) {
  assertTyped('operating-decision', record, snapshot, 'decisionId');
  assertSourceArtifact(record, snapshot, { subject: 'Decision revision' });
  assertEvidence(record.evidenceRefIds, evidence, { subject: 'Decision revision', sourceArtifactId: record.sourceArtifactId, required: true });
  if (record.predecessorDecisionId === null) {
    fail('STATE_TRANSITION_INVALID', 'A decision revision must name its immutable predecessor.', { decisionId: record.decisionId });
  }
  const predecessor = decisions.get(record.predecessorDecisionId);
  if (!predecessor || record.revision !== predecessor.revision + 1) {
    fail('STATE_TRANSITION_INVALID', 'A decision revision must increment exactly one existing predecessor revision.', {
      decisionId: record.decisionId,
      predecessorDecisionId: record.predecessorDecisionId,
    });
  }
  const expectedHistory = [...new Set([...predecessor.historyDecisionIds, predecessor.decisionId])].sort();
  if (sha256Jcs(record.historyDecisionIds) !== sha256Jcs(expectedHistory)) {
    fail('STATE_TRANSITION_INVALID', 'Decision revision history must retain every predecessor identity in canonical order.', {
      decisionId: record.decisionId,
    });
  }
  for (const assumptionId of record.assumptionIds) {
    if (!assumptions.has(assumptionId)) {
      fail('STATE_TRANSITION_INVALID', 'Decision revision assumptions must resolve to immutable operating history.', {
        decisionId: record.decisionId,
        assumptionId,
      });
    }
  }
}

/**
 * Validates and canonically orders an append-only intelligence-fact transition.
 * It never loads a provider or performs a mutation; the runtime turns this
 * exact result into append-only Event records.
 */
export function buildOperatingIntelligenceStateTransitionV2({
  snapshot,
  operatingState,
  evidenceRefs = [],
  evidenceArtifacts = [],
  sourceArtifacts = [],
  existingDecisions = [],
  existingActions = [],
  existingRisks = [],
  existingAssumptions = [],
  claims = [],
  metricObservations = [],
  risks = [],
  assumptions = [],
  decisionRevisions = [],
} = {}) {
  const checked = assertSnapshotState(snapshot, operatingState);
  const allowed = new Set([
    'snapshot', 'operatingState', 'evidenceRefs', 'evidenceArtifacts', 'sourceArtifacts', 'existingDecisions', 'existingActions', 'existingRisks', 'existingAssumptions',
    'claims', 'metricObservations', 'risks', 'assumptions', 'decisionRevisions',
  ]);
  // Guard against an accidental transport of future effect-bearing fields.
  // The function is intentionally a closed, data-only construction boundary.
  for (const key of Object.keys(arguments[0] ?? {})) {
    if (!allowed.has(key)) fail('RESULT_CONTRACT_INVALID', 'Unsupported intelligence-state transition field.', { field: key });
  }
  const evidence = evidenceMap(evidenceRefs, checked.snapshot, evidenceArtifacts);
  const producers = sourceArtifactMap(sourceArtifacts, checked.snapshot);
  const metrics = new Map(checked.state.metrics.map((metric) => [metric.metricId, metric]));
  const assumptionsById = new Map(checked.state.assumptions.map((record) => [record.assumptionId, record]));
  const decisions = new Map([
    ...checked.state.decisions,
    ...existingDecisions,
  ].map((record) => [record.decisionId, record]));
  const actions = new Map([
    ...checked.state.actions,
    ...existingActions,
  ].map((record) => [record.actionId, record]));
  const risksByRevision = revisionIndex([
    ...checked.state.risks,
    ...existingRisks,
  ], 'riskId', 'Risk');
  const assumptionsByRevision = revisionIndex([
    ...checked.state.assumptions,
    ...existingAssumptions,
  ], 'assumptionId', 'Assumption');
  const normalized = {
    claims: sortedBy(claims, 'claimId'),
    metricObservations: sortedBy(metricObservations, 'observationId'),
    risks: sortedBy(risks, 'riskId'),
    assumptions: sortedBy(assumptions, 'assumptionId'),
    decisionRevisions: sortedBy(decisionRevisions, 'decisionId'),
  };
  for (const record of normalized.claims) assertClaim(record, checked.snapshot, evidence, assumptionsById, producers);
  for (const record of normalized.metricObservations) assertObservation(record, checked.snapshot, evidence, metrics);
  for (const record of normalized.risks) {
    assertRisk(record, checked.snapshot, evidence, risksByRevision, producers);
    risksByRevision.set(record.revisionId, record);
  }
  for (const record of normalized.assumptions) {
    assertAssumption(record, checked.snapshot, evidence, decisions, actions, assumptionsByRevision);
    assumptionsByRevision.set(record.revisionId, record);
  }
  for (const record of normalized.decisionRevisions) assertDecisionRevision(record, checked.snapshot, evidence, assumptionsById, decisions);
  return freeze({
    snapshotId: checked.snapshot.snapshotId,
    scopeId: checked.snapshot.scopeId,
    domainId: checked.snapshot.domainId,
    domainVersion: checked.snapshot.domainVersion,
    ...normalized,
  });
}
