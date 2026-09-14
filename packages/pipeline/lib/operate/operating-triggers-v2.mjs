import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
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
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', `${id} records must be an array.`);
  const normalized = records.map(clone).sort((left, right) => left[id].localeCompare(right[id]));
  if (new Set(normalized.map((record) => record[id])).size !== normalized.length) {
    fail('STATE_TRANSITION_INVALID', 'Scenario/trigger transition contains duplicate durable identities.', { id });
  }
  return normalized;
}

function assertSnapshotState(snapshot, state) {
  let checkedState;
  let checkedSnapshot;
  try {
    checkedState = assertOperatingModelStateV2(state);
    checkedSnapshot = assertOperatingSnapshotV2(snapshot, { state: checkedState });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Scenario and trigger records require one valid immutable snapshot and state.', {
      cause: cause?.code ?? null,
    });
  }
  return { snapshot: checkedSnapshot, state: checkedState };
}

function evidenceArtifactMap(records, snapshot, selectedEvidenceRefs) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Scenario/trigger records require Evidence Artifact metadata.');
  const selectedArtifactIds = new Set(selectedEvidenceRefs.map(({ evidenceArtifactId }) => evidenceArtifactId));
  const result = new Map();
  for (const artifact of records) {
    if (!selectedArtifactIds.has(artifact?.artifactId)) continue;
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Scenario/trigger evidence requires typed Evidence Artifacts.', { cause: cause?.code ?? null });
    }
    if (artifact.scopeId !== snapshot.scopeId || artifact.domainId !== snapshot.domainId
      || artifact.domainVersion !== snapshot.domainVersion || result.has(artifact.artifactId)) {
      fail('OPERATING_SCOPE_INVALID', 'Scenario/trigger Evidence Artifacts must be unique and match the snapshot scope.', {
        artifactId: artifact?.artifactId ?? null,
      });
    }
    result.set(artifact.artifactId, artifact);
  }
  return result;
}

function evidenceMap(records, snapshot, evidenceArtifacts) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Scenario/trigger records require typed EvidenceRefs.');
  const selectedIds = new Set(snapshot.evidenceRefIds);
  const selected = [];
  const seen = new Set();
  for (const record of records) {
    if (!selectedIds.has(record?.evidenceRefId)) continue;
    try {
      assertProtocolArtifact('operating-evidence-ref', record, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Scenario/trigger evidence must use typed EvidenceRefs.', { cause: cause?.code ?? null });
    }
    if (record.scopeId !== snapshot.scopeId || record.domainId !== snapshot.domainId || record.domainVersion !== snapshot.domainVersion
      || seen.has(record.evidenceRefId)) {
      fail('OPERATING_SCOPE_INVALID', 'Scenario/trigger EvidenceRefs selected by a snapshot must be unique and in scope.', {
        evidenceRefId: record?.evidenceRefId ?? null,
      });
    }
    seen.add(record.evidenceRefId);
    selected.push(record);
  }
  const artifacts = evidenceArtifactMap(evidenceArtifacts, snapshot, selected);
  const result = new Map();
  for (const record of selected) {
    const artifact = artifacts.get(record.evidenceArtifactId);
    if (!artifact
      || artifact.artifactType !== 'evidence-snapshot'
      || artifact.schemaId !== 'operating-evidence-snapshot'
      || !artifact.inputArtifactIds.includes(record.sourceArtifactId)
      || artifact.rawHash !== record.evidenceArtifactRawHash
      || artifact.canonicalHash !== record.evidenceArtifactCanonicalHash) {
      fail('OPERATING_SCOPE_INVALID', 'Scenario/trigger EvidenceRefs must bind their exact selected Evidence Artifact.', {
        evidenceRefId: record.evidenceRefId,
      });
    }
    result.set(record.evidenceRefId, record);
  }
  return result;
}

function assertEvidence(ids, evidence, subject, { sourceArtifactId, required = false } = {}) {
  if (!Array.isArray(ids) || (required && ids.length === 0) || new Set(ids).size !== ids.length) {
    fail('RESULT_CONTRACT_INVALID', `${subject} requires a unique ${required ? 'nonempty ' : ''}typed EvidenceRef list.`);
  }
  for (const id of ids) {
    const ref = evidence.get(id);
    if (!ref || ref.freshness === 'stale' || ref.sourceArtifactId !== sourceArtifactId) {
      fail('STATE_TRANSITION_INVALID', `${subject} cannot use stale, foreign, or unresolved evidence.`, { evidenceRefId: id });
    }
  }
}

function assertSnapshotArtifact(record, snapshot, subject) {
  if (!snapshot.sourceArtifactIds.includes(record.sourceArtifactId)) {
    fail('STATE_TRANSITION_INVALID', `${subject} must name an accepted source Artifact declared by its snapshot.`, {
      sourceArtifactId: record.sourceArtifactId,
      snapshotId: snapshot.snapshotId,
    });
  }
}

function assertScenario(record, snapshot, assumptions, evidence) {
  try {
    assertProtocolArtifact('operating-scenario', record, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Scenario record is not contract-valid.', { cause: cause?.code ?? null });
  }
  if (record.scopeId !== snapshot.scopeId || record.domainId !== snapshot.domainId || record.domainVersion !== snapshot.domainVersion
    || record.snapshotId !== snapshot.snapshotId) {
    fail('OPERATING_SCOPE_INVALID', 'Scenario must bind to the exact immutable snapshot and domain scope.', { scenarioId: record.scenarioId });
  }
  assertSnapshotArtifact(record, snapshot, 'Scenario');
  assertEvidence(record.evidenceRefIds, evidence, 'Scenario', { sourceArtifactId: record.sourceArtifactId });
  for (const [name, entry] of [['base', record.base], ['upside', record.upside], ['downside', record.downside]]) {
    assertEvidence(entry.evidenceRefIds, evidence, `Scenario ${name} case evidence`, { sourceArtifactId: entry.sourceArtifactId });
  }
  const assumptionIds = [
    ...record.assumptionIds,
    ...record.base.assumptionIds,
    ...record.upside.assumptionIds,
    ...record.downside.assumptionIds,
  ];
  for (const assumptionId of assumptionIds) {
    if (!assumptions.has(assumptionId)) {
      fail('STATE_TRANSITION_INVALID', 'Scenario assumptions must resolve to immutable operating state.', {
        scenarioId: record.scenarioId,
        assumptionId,
      });
    }
  }
  // A scenario remains a transparent analysis record. Its text cannot encode
  // an authority-bearing command or a prediction accepted as a fact by state.
  if (/\b(?:approve|execute|grant|capability|connector|policy)\b/iu.test(record.breakEven)) {
    fail('RESULT_CONTRACT_INVALID', 'Scenario analysis cannot encode an approval, capability, policy, connector, or execution instruction.', {
      scenarioId: record.scenarioId,
    });
  }
}

function assertTrigger(record, snapshot, evidence) {
  try {
    assertProtocolArtifact('operating-event-trigger', record, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Event trigger record is not contract-valid.', { cause: cause?.code ?? null });
  }
  if (record.scopeId !== snapshot.scopeId || record.domainId !== snapshot.domainId || record.domainVersion !== snapshot.domainVersion
    || record.snapshotId !== snapshot.snapshotId) {
    fail('OPERATING_SCOPE_INVALID', 'Event trigger must bind to the exact immutable snapshot and domain scope.', { triggerId: record.triggerId });
  }
  assertSnapshotArtifact(record, snapshot, 'Event trigger');
  assertEvidence(record.evidenceRefIds, evidence, 'Event trigger', { sourceArtifactId: record.sourceArtifactId, required: true });
  if (/\b(?:approve|execute|grant|capability|connector|policy|assignment)\b/iu.test(record.condition)) {
    fail('RESULT_CONTRACT_INVALID', 'Event trigger conditions may request ordinary observation/cycle work only; authority or execution language is not a trigger condition.', {
      triggerId: record.triggerId,
    });
  }
}

/**
 * Validate immutable analytical Scenario and Trigger records before their
 * event transaction. It is deliberately not a scheduler, router, provider,
 * capability, or execution surface.
 */
export function buildOperatingTriggerScenarioTransitionV2({
  snapshot,
  operatingState,
  evidenceRefs = [],
  evidenceArtifacts = [],
  scenarios = [],
  triggers = [],
} = {}) {
  const checked = assertSnapshotState(snapshot, operatingState);
  const evidence = evidenceMap(evidenceRefs, checked.snapshot, evidenceArtifacts);
  const assumptions = new Map(checked.state.assumptions.map((record) => [record.assumptionId, record]));
  const normalized = {
    scenarios: sortedBy(scenarios, 'scenarioId'),
    triggers: sortedBy(triggers, 'triggerId'),
  };
  for (const scenario of normalized.scenarios) assertScenario(scenario, checked.snapshot, assumptions, evidence);
  for (const trigger of normalized.triggers) assertTrigger(trigger, checked.snapshot, evidence);
  return freeze({
    snapshotId: checked.snapshot.snapshotId,
    scopeId: checked.snapshot.scopeId,
    domainId: checked.snapshot.domainId,
    domainVersion: checked.snapshot.domainVersion,
    scenarios: normalized.scenarios,
    triggers: normalized.triggers,
    transitionHash: sha256Jcs({ snapshotId: checked.snapshot.snapshotId, ...normalized }),
  });
}
