import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import {
  assertInvestigationApproval,
  assertInvestigationCommand,
  assertInvestigationExecutionEvidence,
  assertInvestigationPortable,
  assertInvestigationReceipt,
  assertInvestigationRequest,
  assertInvestigationScope,
  investigationArtifactId,
} from './investigation-contracts.mjs';
import { scopeContains } from './investigation-identity.mjs';

function fail(code, message) { throw new PipelineError(code, message); }
function clone(value) { return structuredClone(value); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) fail('E_INVESTIGATION_EVENT_INVALID', `${label} has missing or unknown fields.`);
}
function digest(value, label) { if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) fail('E_INVESTIGATION_EVENT_INVALID', `${label} must be an exact SHA-256 digest.`); }
function boundedText(value, label) { if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 4_000) fail('E_INVESTIGATION_EVENT_INVALID', `${label} must be bounded trimmed text.`); }

function appendEvent(state, event, runtime) {
  state.generation += 1;
  state.updatedAt = runtime.now;
  state.events.push({ eventId: event.eventId, type: event.type, generation: state.generation, inputDigest: runtime.inputDigest, at: runtime.now });
}

function evidenceForSource(state, source) {
  exact(source, ['id', 'kind'], 'observation.source');
  if (source.kind === 'reproduction') {
    if (source.id !== state.reproduction.commandId) fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation cites a foreign reproduction source.');
    return state.reproduction.evidenceDigest;
  }
  if (source.kind === 'experiment') {
    const experiment = state.experiments.find(({ id }) => id === source.id);
    if (!experiment) fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation cites an experiment that was not engine-run.');
    return experiment.evidence.evidenceDigest;
  }
  fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation source kind is unsupported.');
}

function normalizeObservation(state, value) {
  exact(value, ['evidenceDigest', 'fact', 'id', 'source'], 'observation');
  boundedText(value.fact, 'observation.fact');
  digest(value.evidenceDigest, 'observation.evidenceDigest');
  const expectedEvidence = evidenceForSource(state, value.source);
  if (value.evidenceDigest !== expectedEvidence) fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation evidence digest does not bind its engine-run source.');
  const identity = { source: value.source, fact: value.fact, evidenceDigest: value.evidenceDigest };
  const id = investigationArtifactId('obs', identity);
  if (value.id !== id) fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation ID does not bind its exact fact and provenance.');
  return { id, ...clone(identity) };
}

function normalizeHypotheses(state, values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > 32) fail('E_INVESTIGATION_HYPOTHESIS_INVALID', 'Diagnosis requires between 2 and 32 ranked hypotheses.');
  const result = values.map((value, index) => {
    exact(value, ['id', 'observationIds', 'rank', 'statement'], `hypotheses[${index}]`);
    boundedText(value.statement, `hypotheses[${index}].statement`);
    if (value.rank !== index + 1) fail('E_INVESTIGATION_HYPOTHESIS_INVALID', 'Hypothesis ranks must be unique, contiguous, and canonical.');
    if (!Array.isArray(value.observationIds) || !value.observationIds.length || new Set(value.observationIds).size !== value.observationIds.length || value.observationIds.some((id) => !state.observations.some((observation) => observation.id === id))) {
      fail('E_INVESTIGATION_HYPOTHESIS_INVALID', 'Each hypothesis must cite existing observations exactly once.');
    }
    const identity = { rank: value.rank, statement: value.statement, observationIds: clone(value.observationIds) };
    const id = investigationArtifactId('hyp', identity);
    if (value.id !== id) fail('E_INVESTIGATION_HYPOTHESIS_INVALID', 'Hypothesis ID does not bind its exact inference.');
    return { id, ...identity };
  });
  if (new Set(result.map(({ id }) => id)).size !== result.length) fail('E_INVESTIGATION_HYPOTHESIS_INVALID', 'Hypothesis identities must be unique.');
  return result;
}

function normalizeExperiment(state, value) {
  exact(value, ['approval', 'command', 'evidence', 'hypothesisIds', 'id', 'kind', 'name', 'outcome', 'predictions', 'resultByHypothesis'], 'experiment');
  if (!['read-only', 'destructive', 'live', 'network'].includes(value.kind)) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment kind is unsupported.');
  boundedText(value.name, 'experiment.name');
  boundedText(value.outcome, 'experiment.outcome');
  assertInvestigationCommand(value.command, { label: 'experiment.command', allowedEffects: [value.kind] });
  if (!same(value.hypothesisIds, state.hypotheses.map(({ id }) => id))) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment must discriminate the complete live hypothesis set in canonical order.');
  if (!Array.isArray(value.predictions) || value.predictions.length !== value.hypothesisIds.length) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment predictions must cover every live hypothesis.');
  value.predictions.forEach((prediction, index) => {
    exact(prediction, ['expected', 'hypothesisId'], `experiment.predictions[${index}]`);
    if (prediction.hypothesisId !== value.hypothesisIds[index]) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment predictions must use canonical hypothesis order.');
    boundedText(prediction.expected, `experiment.predictions[${index}].expected`);
  });
  if (!Array.isArray(value.resultByHypothesis) || value.resultByHypothesis.length !== value.hypothesisIds.length) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment results must cover every live hypothesis.');
  value.resultByHypothesis.forEach((result, index) => {
    exact(result, ['disposition', 'hypothesisId'], `experiment.resultByHypothesis[${index}]`);
    if (result.hypothesisId !== value.hypothesisIds[index] || !['supported', 'rejected', 'inconclusive'].includes(result.disposition)) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment results are not canonical.');
  });
  const identity = { name: value.name, kind: value.kind, command: value.command, hypothesisIds: value.hypothesisIds, predictions: value.predictions };
  const id = investigationArtifactId('exp', identity);
  if (value.id !== id) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment ID does not bind its exact design.');
  if (value.kind === 'read-only') {
    if (value.approval !== null) fail('E_INVESTIGATION_APPROVAL_INVALID', 'Read-only experiments do not consume mutation authority.');
  } else if (value.approval === null) fail('E_INVESTIGATION_APPROVAL_REQUIRED', `${value.kind} experiment requires an independent approval artifact.`);
  else assertInvestigationApproval(value.approval, { experimentId: id, experimentKind: value.kind, baselineDigest: state.initialBaseline.digest });
  assertInvestigationExecutionEvidence(value.evidence);
  if (value.evidence.commandDigest !== sha256Jcs(value.command) || value.evidence.commandId !== value.command.id) fail('E_INVESTIGATION_EVIDENCE_INVALID', 'Experiment evidence is bound to a different command.');
  return clone({ id, name: value.name, kind: value.kind, command: value.command, hypothesisIds: value.hypothesisIds, predictions: value.predictions, outcome: value.outcome, resultByHypothesis: value.resultByHypothesis, approval: value.approval, evidence: value.evidence });
}

function normalizeDiagnosis(state, value) {
  exact(value, ['affectedScope', 'causeHypothesisId', 'confidence', 'experimentIds', 'proposedRegression', 'status', 'summary'], 'diagnosis');
  if (!['proven', 'unknown'].includes(value.status)) fail('E_INVESTIGATION_DIAGNOSIS_INVALID', 'Diagnosis status is unsupported.');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) fail('E_INVESTIGATION_DIAGNOSIS_INVALID', 'Diagnosis confidence must be between 0 and 1.');
  boundedText(value.summary, 'diagnosis.summary');
  const affectedScope = assertInvestigationScope(value.affectedScope, 'diagnosis.affectedScope');
  if (affectedScope.some((boundary) => !scopeContains(state.targetScope, boundary))) fail('E_INVESTIGATION_SCOPE_INVALID', 'Diagnosis affected scope exceeds the read-only target scope.');
  assertInvestigationCommand(value.proposedRegression, { label: 'diagnosis.proposedRegression', allowedEffects: ['read-only'] });
  if (!Array.isArray(value.experimentIds) || new Set(value.experimentIds).size !== value.experimentIds.length || value.experimentIds.some((id) => !state.experiments.some((experiment) => experiment.id === id))) fail('E_INVESTIGATION_DIAGNOSIS_INVALID', 'Diagnosis cites a foreign or duplicate experiment.');
  if (value.status === 'unknown') {
    if (value.causeHypothesisId !== null) fail('E_INVESTIGATION_DIAGNOSIS_INVALID', 'Unknown diagnosis cannot claim a cause.');
  } else {
    if (!state.reproduction.matchedExpectation) fail('E_INVESTIGATION_CAUSE_UNPROVEN', 'A non-reproduced symptom cannot establish root cause.');
    const cause = state.hypotheses.find(({ id }) => id === value.causeHypothesisId);
    if (!cause) fail('E_INVESTIGATION_CAUSE_UNPROVEN', 'Proven cause must identify one live hypothesis.');
    const discriminating = state.experiments.filter(({ id }) => value.experimentIds.includes(id)).some((experiment) => {
      const result = new Map(experiment.resultByHypothesis.map((entry) => [entry.hypothesisId, entry.disposition]));
      return result.get(cause.id) === 'supported' && state.hypotheses.every((hypothesis) => hypothesis.id === cause.id || result.get(hypothesis.id) === 'rejected');
    });
    if (!discriminating) fail('E_INVESTIGATION_CAUSE_UNPROVEN', 'Proven cause requires one named experiment that supports it and rejects every competing live hypothesis.');
  }
  return clone({ status: value.status, causeHypothesisId: value.causeHypothesisId, experimentIds: value.experimentIds, confidence: value.confidence, affectedScope, proposedRegression: value.proposedRegression, summary: value.summary, diagnosisDigest: sha256Jcs(value) });
}

export function createInvestigationRecord({ runId, request, baseline, reproduction = null, diagnosisReceipt = null, now }) {
  assertInvestigationRequest(request);
  if (!/^inv_[a-f0-9]{32}$/.test(runId ?? '')) fail('E_INVESTIGATION_RUN_ID_INVALID', 'Investigation runId must use inv_<32 lowercase hex>.');
  const mode = request.mode;
  const record = {
    kind: 'investigation-record', schemaVersion: '1.0.0', protocolVersion: '1.1.0', recordType: 'active', runId, mode,
    generation: 0, state: mode === 'diagnose' ? 'investigating' : 'authorized', feature: clone(request.feature), requestDigest: sha256Jcs(request),
    targetScope: clone(mode === 'diagnose' ? request.targetScope : request.authority.scope), initialBaseline: clone(baseline), currentBaselineDigest: baseline.digest,
    diagnosisReceiptHash: mode === 'fix' ? request.diagnosisReceiptHash : null, authority: mode === 'fix' ? clone(request.authority) : null,
    reproduction: mode === 'diagnose' ? clone(reproduction) : null, observations: [], hypotheses: [], experiments: [], diagnosis: mode === 'fix' ? clone(diagnosisReceipt.diagnosis) : null,
    verificationCommands: mode === 'fix' ? { regression: clone(request.regression), relevantSuite: clone(request.relevantSuite) } : null,
    change: null, verification: null, events: [], createdAt: now, updatedAt: now, terminal: null, receiptHash: null,
  };
  return assertInvestigationRecord(record);
}

export function assertInvestigationRecord(value) {
  if (!value || !['investigation-record', 'investigation-receipt'].includes(value.kind) || value.schemaVersion !== '1.0.0' || value.protocolVersion !== '1.1.0' || !['active', 'receipt'].includes(value.recordType)) fail('E_INVESTIGATION_RECORD_INVALID', 'Investigation record identity is unsupported.');
  if (!/^inv_[a-f0-9]{32}$/.test(value.runId ?? '') || !['diagnose', 'fix'].includes(value.mode) || !Number.isSafeInteger(value.generation) || value.generation !== value.events?.length) fail('E_INVESTIGATION_RECORD_INVALID', 'Investigation generation/run identity is invalid.');
  if (new Set(value.events.map(({ eventId }) => eventId)).size !== value.events.length || value.events.some((event, index) => event.generation !== index + 1)) fail('E_INVESTIGATION_RECORD_INVALID', 'Investigation event ledger is not unique and contiguous.');
  if (value.mode === 'diagnose' && value.reproduction === null) fail('E_INVESTIGATION_RECORD_INVALID', 'Diagnosis record requires engine-run reproduction evidence.');
  if (value.mode === 'fix' && (!value.authority || !value.diagnosisReceiptHash || value.diagnosis?.status !== 'proven' || !value.verificationCommands)) fail('E_INVESTIGATION_RECORD_INVALID', 'Fix record requires exact proven diagnosis, authority, and verification custody.');
  if (value.recordType === 'receipt') assertInvestigationReceipt(value);
  assertInvestigationPortable(value);
  return value;
}

export function reduceInvestigationRecord(current, event, runtime) {
  const state = clone(assertInvestigationRecord(current));
  const prior = state.events.find(({ eventId }) => event.eventId === eventId);
  if (prior) {
    if (prior.inputDigest !== runtime.inputDigest) fail('E_INVESTIGATION_EVENT_REPLAY_DIVERGED', `Event ${event.eventId} replayed with divergent bytes.`);
    return state;
  }
  if (state.recordType === 'receipt') fail('E_INVESTIGATION_TERMINAL', 'Terminal investigation receipts are immutable.');
  if (event.expectedGeneration !== state.generation) fail('E_INVESTIGATION_GENERATION_CONFLICT', `Expected generation ${event.expectedGeneration}, current generation is ${state.generation}.`);
  if (typeof runtime.now !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(runtime.inputDigest ?? '')) fail('E_INVESTIGATION_RUNTIME_INVALID', 'Reducer requires bounded runtime time and input digest.');
  if (event.type === 'observation.recorded') {
    if (state.mode !== 'diagnose' || state.state !== 'investigating') fail('E_INVESTIGATION_TRANSITION_INVALID', 'Observations are accepted only during active diagnosis.');
    const observation = normalizeObservation(state, event.observation);
    if (state.observations.some(({ id }) => id === observation.id)) fail('E_INVESTIGATION_OBSERVATION_FABRICATED', 'Observation already exists.');
    state.observations.push(observation);
  } else if (event.type === 'hypotheses.registered') {
    if (state.mode !== 'diagnose' || state.state !== 'investigating' || state.hypotheses.length) fail('E_INVESTIGATION_TRANSITION_INVALID', 'The ranked hypothesis set freezes exactly once.');
    state.hypotheses = normalizeHypotheses(state, event.hypotheses);
  } else if (event.type === 'experiment.ran') {
    if (state.mode !== 'diagnose' || state.state !== 'investigating' || !state.hypotheses.length) fail('E_INVESTIGATION_TRANSITION_INVALID', 'Experiments require the frozen live hypothesis set.');
    const experiment = normalizeExperiment(state, event.experiment);
    if (state.experiments.some(({ id }) => id === experiment.id)) fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment already ran.');
    state.experiments.push(experiment);
  } else if (event.type === 'diagnosis.concluded') {
    if (state.mode !== 'diagnose' || state.state !== 'investigating' || !state.hypotheses.length) fail('E_INVESTIGATION_TRANSITION_INVALID', 'Diagnosis conclusion requires ranked hypotheses.');
    state.diagnosis = normalizeDiagnosis(state, event.diagnosis);
    state.state = 'diagnosed';
  } else if (event.type === 'change.recorded') {
    if (state.mode !== 'fix' || state.state !== 'authorized' || state.change !== null) fail('E_INVESTIGATION_TRANSITION_INVALID', 'Fix change may be registered exactly once after authority.');
    exact(event.change, ['changedPaths', 'fromBaselineDigest', 'summary', 'toBaselineDigest'], 'change');
    boundedText(event.change.summary, 'change.summary');
    digest(event.change.fromBaselineDigest, 'change.fromBaselineDigest');
    digest(event.change.toBaselineDigest, 'change.toBaselineDigest');
    if (event.change.fromBaselineDigest !== state.initialBaseline.digest || event.change.toBaselineDigest === state.initialBaseline.digest || !Array.isArray(event.change.changedPaths) || !event.change.changedPaths.length) fail('E_INVESTIGATION_CHANGE_INVALID', 'Fix must bind one non-empty exact baseline successor.');
    if (event.change.changedPaths.some((entry) => !scopeContains(state.authority.scope, entry) || !scopeContains(state.diagnosis.affectedScope, entry))) fail('E_INVESTIGATION_SCOPE_VIOLATION', 'Fix changed bytes outside diagnosis-bound authority.');
    state.change = clone(event.change);
    state.currentBaselineDigest = event.change.toBaselineDigest;
    state.state = 'changed';
  } else if (event.type === 'verification.recorded') {
    if (state.mode !== 'fix' || state.state !== 'changed' || state.verification !== null) fail('E_INVESTIGATION_TRANSITION_INVALID', 'Fix verification runs exactly once after a registered change.');
    exact(event.verification, ['candidateDigest', 'regression', 'relevantSuite'], 'verification');
    if (event.verification.candidateDigest !== state.change.toBaselineDigest) fail('E_INVESTIGATION_BASELINE_CHANGED', 'Verification does not bind the registered fix candidate.');
    assertInvestigationExecutionEvidence(event.verification.regression);
    assertInvestigationExecutionEvidence(event.verification.relevantSuite);
    state.verification = clone(event.verification);
    state.state = 'verified';
  } else fail('E_INVESTIGATION_EVENT_INVALID', `Unsupported investigation event ${event.type}.`);
  appendEvent(state, event, runtime);
  return assertInvestigationRecord(state);
}

export function finalizeInvestigationRecord(current, { baseline, now } = {}) {
  const state = clone(assertInvestigationRecord(current));
  if (state.recordType === 'receipt') return state;
  if (baseline.digest !== state.currentBaselineDigest) fail(state.mode === 'diagnose' ? 'E_INVESTIGATION_DIAGNOSIS_DRIFT' : 'E_INVESTIGATION_BASELINE_CHANGED', 'Target baseline changed before investigation finalization.');
  if (state.mode === 'diagnose') {
    if (state.state !== 'diagnosed') fail('E_INVESTIGATION_TRANSITION_INVALID', 'Diagnosis must conclude before finalization.');
    state.state = state.diagnosis.status;
  } else {
    if (state.state !== 'verified') fail('E_INVESTIGATION_TRANSITION_INVALID', 'Fix must record one regression and relevant-suite pass before finalization.');
    state.state = state.verification.regression.matchedExpectation && state.verification.relevantSuite.matchedExpectation ? 'passed' : 'blocked';
  }
  state.kind = 'investigation-receipt';
  state.recordType = 'receipt';
  state.updatedAt = now;
  state.terminal = { status: state.state, finalizedAt: now, finalBaselineDigest: baseline.digest };
  state.receiptHash = sha256Jcs({ ...state, receiptHash: null });
  return assertInvestigationRecord(state);
}
