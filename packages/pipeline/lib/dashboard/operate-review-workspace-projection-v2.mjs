import { PipelineError } from '../pipeline/errors.mjs';
import {
  assertOperateExperienceArtifactV2,
  assertProtocolArtifact,
} from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import {
  assertOperateReviewWorkspacePayloadSafeV1,
  classifyOperateReviewUnsafeTextV1,
} from './operate-review-payload-safety.mjs';

export { assertOperateReviewWorkspacePayloadSafeV1 } from './operate-review-payload-safety.mjs';

const PROTOCOL_VERSION = '2.0.0';
const STAGE_IDS = Object.freeze(['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn']);
const STAGE_STATES = Object.freeze([
  'complete', 'current', 'available', 'waiting', 'blocked', 'failed', 'skipped', 'uncertain', 'revisited',
]);
const TERMINAL_ASSIGNMENT_STATES = new Set(['validated', 'rejected', 'abandoned', 'failed']);
const ACTIVE_ASSIGNMENT_STATES = new Set(['available', 'claimed', 'running', 'submitted']);
const NARRATIVE_FIELDS = new Set([
  'consequence', 'expectedDownside', 'expectedResult', 'expectedUpside', 'label', 'message', 'outcome',
  'question', 'rationale', 'reason', 'recoveryDisposition', 'resolutionCondition', 'reversibility', 'statement',
  'conditions', 'dissent', 'revisitConditions', 'summary', 'text', 'title', 'uncertainty',
  'verificationMethod', 'verificationWindow', 'whyNow',
]);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function exactJson(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function exactEventHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function compareBy(field) {
  return (left, right) => String(left?.[field] ?? '').localeCompare(String(right?.[field] ?? ''));
}

function assertCanonicalView(view, { allowUnavailable = false } = {}) {
  assertOperateExperienceArtifactV2('operate-experience-view', view);
  if (view.viewHash !== sha256Jcs(without(view, 'viewHash'))) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Review workspace source viewHash does not equal its canonical content.');
  }
  if (!allowUnavailable && ['incompatible', 'corrupt'].includes(view.status)) {
    fail('E_OPERATE_REVIEW_WORKSPACE_UNAVAILABLE', 'An incompatible or corrupt experience view cannot project a Review workspace.', {
      status: view.status,
    });
  }
  return view;
}

function assertReviewSource(source) {
  if (source?.kind === 'operating-review-read') {
    assertProtocolArtifact('operating-review-read', source, { protocolVersion: PROTOCOL_VERSION });
    if (source.review.state !== 'pending' || source.review.disposition !== null) {
      fail('E_OPERATE_BINDING_MISMATCH', 'An operating-review-read workspace source must describe one pending Review.');
    }
    return source;
  }
  if (source?.kind === 'operating-review-receipt') {
    assertProtocolArtifact('operating-review-receipt', source, { protocolVersion: PROTOCOL_VERSION });
    assertTerminalReceiptIntegrity(source);
    return source;
  }
  fail('E_OPERATE_REVIEW_WORKSPACE_SOURCE_INVALID', 'Review workspace source must be an exact operating-review-read or operating-review-receipt.');
}

function sourceActor(source) {
  return source.kind === 'operating-review-read' ? source.reader : source.actor;
}

function sourceReadEventHead(source) {
  return source.kind === 'operating-review-read' ? source.eventHead : source.readEventHead;
}

function assertTerminalReceiptIntegrity(receipt) {
  if (receipt.review.state === 'pending'
    || receipt.review.state !== receipt.decision
    || receipt.review.disposition !== receipt.decision
    || !exactJson(receipt.review.workDispositions, receipt.appliedWorkDispositions)) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Terminal Review receipt state, disposition, or work dispositions diverge.');
  }
  const applied = receipt.dispositionChoices.filter((choice) => (
    choice.choiceId === receipt.appliedChoiceId && choice.choiceHash === receipt.appliedChoiceHash
  ));
  if (applied.length !== 1) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Terminal Review receipt must retain exactly one applied advertised choice.');
  }
  const [choice] = applied;
  if (choice.choiceHash !== sha256Jcs(choice.submitArguments)
    || choice.submitArguments.disposition !== receipt.decision
    || !exactJson(choice.submitArguments.workDispositions, receipt.appliedWorkDispositions)
    || !exactJson(choice.submitArguments.actor, receipt.actor)
    || !exactJson(choice.submitArguments.scope, receipt.scope)
    || choice.submitArguments.reviewId !== receipt.review.reviewId
    || choice.submitArguments.cycleId !== receipt.cycleId) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Terminal Review receipt applied choice lost its exact owner, scope, Review, or disposition binding.');
  }
  const summary = receipt.summary;
  if (summary.decisionCount !== receipt.decisions.length
    || summary.actionCount !== receipt.actions.length
    || summary.findingCount !== receipt.findings.length
    || summary.dissentCount !== receipt.dissent.length
    || summary.gapCount !== receipt.gaps.length) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Terminal Review receipt summary counts contradict its retained records.');
  }
}

function assertSourceViewBinding(source, view) {
  const actor = sourceActor(source);
  const cycleMatches = view.cycles.filter(({ cycleId }) => cycleId === source.cycleId);
  if (!exactEventHead(source.eventHead, view.eventHead)
    || source.scope.scopeId !== view.scopeId
    || source.scope.domainId !== view.domainId
    || source.scope.domainVersion !== view.domainVersion
    || actor.actorId !== view.actorId
    || source.review.ownerActorId !== actor.actorId
    || source.review.cycleId !== source.cycleId
    || cycleMatches.length !== 1) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Review source and experience view do not bind the exact Event head, actor, scope, domain, Cycle, and Review.', {
      cycleId: source?.cycleId ?? null,
      reviewId: source?.review?.reviewId ?? null,
    });
  }
  if (source.kind === 'operating-review-read' && !exactEventHead(sourceReadEventHead(source), source.eventHead)) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Pending Review sourceReadEventHead must equal its source Event head.');
  }
}

function assertExperienceEvidenceGraph(view) {
  const evidence = new Map();
  const claims = new Map();
  for (const entry of view.evidence) {
    if (evidence.has(entry.evidenceRefId)) fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace evidence identities must be unique.');
    evidence.set(entry.evidenceRefId, entry);
  }
  for (const entry of view.claims) {
    if (claims.has(entry.claimId)) fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace claim identities must be unique.');
    claims.set(entry.claimId, entry);
  }
  for (const entry of view.evidence) {
    for (const claimId of entry.supportClaimIds) {
      if (!claims.get(claimId)?.supportEvidenceRefIds.includes(entry.evidenceRefId)) {
        fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace contains a broken reciprocal evidence support edge.', { evidenceRefId: entry.evidenceRefId, claimId });
      }
    }
    for (const claimId of entry.contradictClaimIds) {
      if (!claims.get(claimId)?.contradictEvidenceRefIds.includes(entry.evidenceRefId)) {
        fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace contains a broken reciprocal evidence contradiction edge.', { evidenceRefId: entry.evidenceRefId, claimId });
      }
    }
  }
  for (const entry of view.claims) {
    for (const evidenceRefId of entry.supportEvidenceRefIds) {
      if (!evidence.get(evidenceRefId)?.supportClaimIds.includes(entry.claimId)) {
        fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace contains a broken reciprocal claim support edge.', { evidenceRefId, claimId: entry.claimId });
      }
    }
    for (const evidenceRefId of entry.contradictEvidenceRefIds) {
      if (!evidence.get(evidenceRefId)?.contradictClaimIds.includes(entry.claimId)) {
        fail('E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID', 'Review workspace contains a broken reciprocal claim contradiction edge.', { evidenceRefId, claimId: entry.claimId });
      }
    }
  }
}

function countBy(records, predicate) {
  return records.reduce((total, record) => total + (predicate(record) ? 1 : 0), 0);
}

function outcomeHasAffirmativeProof(outcome) {
  return ['succeeded', 'failed'].includes(outcome.status)
    && outcome.evidenceRefIds.length > 0
    && outcome.observationIds.length > 0
    && outcome.verification !== null
    && outcome.verification.accessReason === null
    && outcome.metric !== null
    && outcome.metric.metricId === outcome.verification.metricId
    && outcome.metric.metricHash === outcome.verification.metricHash;
}

function cycleHasExactAffirmativeProof(cycle, outcomes) {
  const actionIds = cycle.persistentActionIds;
  const verify = cycle.stages.find(({ id }) => id === 'verify');
  const candidates = outcomes.filter(({ actionId }) => actionIds.includes(actionId));
  const affirmative = candidates.filter(outcomeHasAffirmativeProof);
  return actionIds.length > 0
    && verify?.state === 'complete'
    && verify.evidenceGapIds.length === 0
    && verify.uncertaintyIds.length === 0
    && verify.gates.length === affirmative.length
    && verify.gates.every((gate) => gate.kind === 'verification'
      && affirmative.filter(({ outcomeId, status }) => (
        outcomeId === gate.subjectId && status === gate.state
      )).length === 1)
    && affirmative.every(({ outcomeId, status }) => verify.gates.filter((gate) => (
      gate.kind === 'verification' && gate.subjectId === outcomeId && gate.state === status
    )).length === 1)
    && actionIds.every((actionId) => affirmative.some((outcome) => outcome.actionId === actionId));
}

function cycleProofIsIncomplete(cycle, outcomes) {
  const verify = cycle.stages.find(({ id }) => id === 'verify');
  const noProofRequired = cycle.persistentActionIds.length === 0
    && verify?.state === 'skipped'
    && verify.gates.length === 0
    && verify.evidenceGapIds.length === 0
    && verify.uncertaintyIds.length === 0;
  return !noProofRequired && !cycleHasExactAffirmativeProof(cycle, outcomes);
}

/**
 * One actor-bound, snapshot-wide truth summary. Consumers must carry this value
 * verbatim; they must not re-count a filtered surface independently.
 */
export function deriveOperateSharedTruthSummaryV1(inputView) {
  const view = assertCanonicalView(inputView, { allowUnavailable: true });
  assertExperienceEvidenceGraph(view);

  const byStage = STAGE_IDS.map((id) => {
    const stages = view.cycles.map((cycle) => cycle.stages.find((stage) => stage.id === id));
    if (stages.some((stage) => stage === undefined)) {
      fail('E_OPERATE_REVIEW_WORKSPACE_SUMMARY_INVALID', 'Every Cycle must contribute exactly one state for every canonical stage.', { stageId: id });
    }
    return Object.fromEntries([
      ['id', id],
      ...STAGE_STATES.map((state) => [state, countBy(stages, (stage) => stage.state === state)]),
    ]);
  });
  const stageTotals = Object.fromEntries(STAGE_STATES.map((state) => [
    state,
    byStage.reduce((total, stage) => total + stage[state], 0),
  ]));

  const assignments = view.cycles.flatMap((cycle) => cycle.assignments);
  const typedAbsences = assignments.filter((assignment) => assignment.absence !== null).length
    + view.cycles.reduce((total, cycle) => total + (cycle.lensAbsences?.length ?? 0), 0);
  const evidenceRestricted = countBy(view.evidence, (entry) => entry.accessState === 'restricted');
  const evidenceLinked = countBy(view.evidence, (entry) => entry.supportClaimIds.length + entry.contradictClaimIds.length > 0);
  const claimResolved = countBy(view.claims, (entry) => ['supported', 'contradicted'].includes(entry.status));
  const claimUnresolved = view.claims.length - claimResolved;
  const outcomeVerified = countBy(view.outcomes, outcomeHasAffirmativeProof);
  const outcomeInsufficient = countBy(view.outcomes, (entry) => entry.status === 'insufficient-evidence');
  const outcomeUnverified = view.outcomes.length - outcomeVerified - outcomeInsufficient;
  const cycleProofIncomplete = countBy(view.cycles, (cycle) => cycleProofIsIncomplete(cycle, view.outcomes));
  const omissionRestricted = view.omissions.reduce((total, entry) => (
    total + (entry.classification === 'restricted' ? entry.count : 0)
  ), 0);
  const omissionAbsent = view.omissions.reduce((total, entry) => (
    total + (entry.classification === 'restricted' ? 0 : entry.count)
  ), 0);

  const proofReasons = [];
  if (evidenceRestricted > 0 || omissionRestricted > 0) proofReasons.push('OPERATE_PROOF_RESTRICTED');
  if (typedAbsences > 0 || omissionAbsent > 0) proofReasons.push('OPERATE_PROOF_ABSENCE');
  if (claimUnresolved > 0) proofReasons.push('OPERATE_CLAIM_UNRESOLVED');
  if (outcomeUnverified + outcomeInsufficient + cycleProofIncomplete > 0) proofReasons.push('OPERATE_VERIFICATION_EVIDENCE_MISSING');
  if (view.evidence.length === 0 && view.claims.length > 0) proofReasons.push('OPERATE_EVIDENCE_ABSENT');
  const proofPositive = claimResolved + outcomeVerified + countBy(view.evidence, (entry) => entry.accessState === 'available');
  const proofIncomplete = evidenceRestricted + claimUnresolved + outcomeUnverified + outcomeInsufficient
    + cycleProofIncomplete
    + typedAbsences + omissionRestricted + omissionAbsent;
  const noProofExpected = view.evidence.length === 0
    && view.claims.length === 0
    && view.outcomes.length === 0
    && cycleProofIncomplete === 0
    && typedAbsences === 0
    && omissionRestricted === 0
    && omissionAbsent === 0;
  const proofStatus = noProofExpected
    ? 'not-required'
    : proofIncomplete === 0 && proofPositive > 0
      ? 'verified'
      : proofPositive > 0
        ? 'partial'
        : 'unverified';

  const allowedSubjects = new Set(view.allowedActions.map(({ subjectId }) => subjectId));
  const unavailableSubjects = new Set(view.inbox.filter(({ unavailableReason }) => unavailableReason !== null).map(({ subjectId }) => subjectId));
  const blockingSubjects = new Set(view.inbox.filter(({ blocking }) => blocking).map(({ subjectId }) => subjectId));
  const terminalSeats = countBy(assignments, (entry) => TERMINAL_ASSIGNMENT_STATES.has(entry.state));
  const activeSeats = countBy(assignments, (entry) => ACTIVE_ASSIGNMENT_STATES.has(entry.state));
  const pendingSeats = countBy(assignments, (entry) => entry.state === 'pending');
  if (assignments.length !== terminalSeats + activeSeats + pendingSeats) {
    fail('E_OPERATE_REVIEW_WORKSPACE_SUMMARY_INVALID', 'Shared seat truth encountered an undeclared Assignment state.');
  }
  const summary = {
    kind: 'operate-shared-truth-summary',
    schemaVersion: '1.0.0',
    sourceEventHead: clone(view.eventHead),
    sourceViewHash: view.viewHash,
    stages: {
      cycles: view.cycles.length,
      total: view.cycles.length * STAGE_IDS.length,
      ...stageTotals,
      byStage,
    },
    proof: {
      status: proofStatus,
      linkedEvidence: evidenceLinked,
      restrictedEvidence: evidenceRestricted,
      resolvedClaims: claimResolved,
      unresolvedClaims: claimUnresolved,
      verifiedOutcomes: outcomeVerified,
      unverifiedOutcomes: outcomeUnverified + outcomeInsufficient,
      reasonCodes: [...new Set(proofReasons)].sort(),
    },
    seats: {
      total: assignments.length,
      terminal: terminalSeats,
      validated: countBy(assignments, (entry) => entry.state === 'validated'),
      rejected: countBy(assignments, (entry) => entry.state === 'rejected'),
      failed: countBy(assignments, (entry) => entry.state === 'failed'),
      abandoned: countBy(assignments, (entry) => entry.state === 'abandoned'),
      active: activeSeats,
      pending: pendingSeats,
      typedAbsences,
    },
    evidence: {
      total: view.evidence.length,
      available: countBy(view.evidence, (entry) => entry.accessState === 'available'),
      restricted: evidenceRestricted,
      current: countBy(view.evidence, (entry) => entry.freshness === 'current'),
      historical: countBy(view.evidence, (entry) => entry.freshness === 'historical'),
      stale: countBy(view.evidence, (entry) => entry.freshness === 'stale'),
      linked: evidenceLinked,
      omitted: view.omissions.reduce((total, entry) => total + entry.count, 0),
    },
    claims: {
      total: view.claims.length,
      supported: countBy(view.claims, (entry) => entry.status === 'supported'),
      contradicted: countBy(view.claims, (entry) => entry.status === 'contradicted'),
      uncertain: countBy(view.claims, (entry) => entry.status === 'uncertain'),
      unknown: countBy(view.claims, (entry) => entry.status === 'unknown'),
      restricted: countBy(view.claims, (entry) => entry.status === 'restricted'),
    },
    verification: {
      total: view.outcomes.length,
      verified: outcomeVerified,
      unverified: outcomeUnverified,
      notRequired: 0,
      insufficientEvidence: outcomeInsufficient,
    },
    attention: {
      total: view.attention.length,
      blocking: countBy(view.attention, (entry) => blockingSubjects.has(entry.subjectId)
        || ['blocked', 'failed', 'uncertain'].includes(entry.state)),
      actionable: countBy(view.attention, (entry) => allowedSubjects.has(entry.subjectId)),
      unavailable: countBy(view.attention, (entry) => unavailableSubjects.has(entry.subjectId)
        || !allowedSubjects.has(entry.subjectId)),
    },
    omissions: {
      total: omissionRestricted + omissionAbsent,
      restricted: omissionRestricted,
      absent: omissionAbsent,
      reasonCodes: [...new Set(view.omissions.map((entry) => `OPERATE_OMISSION_${entry.reason.replaceAll('-', '_').toUpperCase()}`))].sort(),
    },
  };
  return deepFreeze(summary);
}

function redactNarrative(value, key = null, result = { count: 0 }) {
  if (Array.isArray(value)) return value.map((entry) => redactNarrative(entry, key, result));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, nested]) => [
      field,
      redactNarrative(nested, field, result),
    ]));
  }
  if (typeof value === 'string' && NARRATIVE_FIELDS.has(key)) {
    const reason = classifyOperateReviewUnsafeTextV1(value);
    if (reason !== null) {
      result.count += 1;
      return `[redacted:${reason}]`;
    }
  }
  return value;
}

function reviewEvidenceIds(source) {
  const ids = new Set();
  for (const decision of source.decisions) decision.evidenceRefIds.forEach((id) => ids.add(id));
  for (const finding of source.findings) {
    (finding.supportingEvidenceRefIds ?? []).forEach((id) => ids.add(id));
    (finding.contradictingEvidenceRefIds ?? []).forEach((id) => ids.add(id));
  }
  return ids;
}

function selectReviewEvidenceGraph(source, view) {
  const requestedEvidenceIds = reviewEvidenceIds(source);
  const evidenceById = new Map(view.evidence.map((entry) => [entry.evidenceRefId, entry]));
  const claimById = new Map(view.claims.map((entry) => [entry.claimId, entry]));
  const selectedEvidenceIds = new Set([...requestedEvidenceIds].filter((id) => evidenceById.has(id)));
  const selectedClaimIds = new Set();
  for (const evidenceRefId of selectedEvidenceIds) {
    const entry = evidenceById.get(evidenceRefId);
    entry.supportClaimIds.forEach((id) => selectedClaimIds.add(id));
    entry.contradictClaimIds.forEach((id) => selectedClaimIds.add(id));
  }
  for (const claim of view.claims) {
    if ([...claim.supportEvidenceRefIds, ...claim.contradictEvidenceRefIds].some((id) => selectedEvidenceIds.has(id))) {
      selectedClaimIds.add(claim.claimId);
    }
  }
  for (const claimId of selectedClaimIds) {
    const claim = claimById.get(claimId);
    if (!claim) continue;
    claim.supportEvidenceRefIds.forEach((id) => { if (evidenceById.has(id)) selectedEvidenceIds.add(id); });
    claim.contradictEvidenceRefIds.forEach((id) => { if (evidenceById.has(id)) selectedEvidenceIds.add(id); });
  }
  const missing = [...requestedEvidenceIds].filter((id) => !evidenceById.has(id)).sort();
  const evidence = [...selectedEvidenceIds].map((id) => clone(evidenceById.get(id))).sort(compareBy('evidenceRefId'));
  const claims = [...selectedClaimIds].map((id) => clone(claimById.get(id))).filter(Boolean).sort(compareBy('claimId'));
  return { evidence, claims, missing };
}

function buildUncertainty(source, claims) {
  const records = [];
  for (const decision of source.decisions) {
    if (decision.origin === 'operating-intelligence') {
      records.push({
        uncertaintyId: `unc_${sha256Jcs({ sourceKind: 'decision', sourceId: decision.decisionId, statement: decision.uncertainty }).slice(7, 39)}`,
        sourceKind: 'decision',
        sourceId: decision.decisionId,
        statement: decision.uncertainty,
      });
    }
  }
  for (const claim of claims) {
    if (['uncertain', 'unknown', 'restricted'].includes(claim.status)) {
      const statement = claim.statement ?? `Claim ${claim.claimId} is ${claim.status}.`;
      records.push({
        uncertaintyId: `unc_${sha256Jcs({ sourceKind: 'claim', sourceId: claim.claimId, statement }).slice(7, 39)}`,
        sourceKind: 'claim',
        sourceId: claim.claimId,
        statement,
      });
    }
  }
  for (const gap of source.gaps) {
    records.push({
      uncertaintyId: `unc_${sha256Jcs({ sourceKind: 'gap', sourceId: gap.absenceId, statement: gap.reason }).slice(7, 39)}`,
      sourceKind: 'gap',
      sourceId: gap.absenceId,
      statement: gap.reason,
    });
  }
  return records.sort(compareBy('uncertaintyId'));
}

function choiceConsequence(disposition) {
  const consequences = {
    approved: 'Records owner approval and applies only the listed work dispositions; it does not execute Actions or authorize external effects.',
    changes_requested: 'Records requested changes and applies only the listed work dispositions; a later Review requires separately governed work.',
    rejected: 'Records owner rejection and applies only the listed work dispositions; it does not delete evidence or execute Actions.',
    cancelled: 'Records owner cancellation and applies only the listed work dispositions; it does not authorize any follow-on effect.',
  };
  return consequences[disposition];
}

function assertChoiceBinding(choice, source) {
  const args = choice.submitArguments;
  const actor = sourceActor(source);
  if (choice.choiceHash !== sha256Jcs(args)
    || args.reviewId !== source.review.reviewId
    || args.cycleId !== source.cycleId
    || !exactJson(args.actor, actor)
    || !exactJson(args.scope, source.scope)) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Review choice lost its exact hash, actor, scope, Cycle, or Review binding.', { choiceId: choice.choiceId });
  }
}

function enrichedChoices(source) {
  if (source.kind === 'operating-review-receipt') return [];
  return [...source.dispositionChoices]
    .sort(compareBy('choiceId'))
    .map((choice) => {
      assertChoiceBinding(choice, source);
      return {
        choiceId: choice.choiceId,
        choiceHash: choice.choiceHash,
        label: choice.label,
        submitArguments: clone(choice.submitArguments),
        consequence: choiceConsequence(choice.submitArguments.disposition),
        reversibility: 'immutable-review-event',
        requiredDispositions: clone(choice.submitArguments.workDispositions),
      };
    });
}

function matchingSubmitActions(source, view, choices) {
  if (source.kind === 'operating-review-receipt') return [];
  const byArguments = new Map(choices.map((choice) => [sha256Jcs(choice.submitArguments), choice]));
  const matches = view.allowedActions.filter(({ subjectId, action }) => (
    subjectId === source.review.reviewId
    && action.tool === 'operate.review.submit'
    && action.effect === 'project-write'
    && byArguments.has(sha256Jcs(action.arguments))
  ));
  const exactChoiceIds = new Set(matches.map(({ action }) => byArguments.get(sha256Jcs(action.arguments)).choiceId));
  if (matches.length !== exactChoiceIds.size) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Review submit capability contains duplicate actions for one advertised choice.');
  }
  return matches.sort((left, right) => sha256Jcs(left.action.arguments).localeCompare(sha256Jcs(right.action.arguments)));
}

function capabilityFor(source, view, choices) {
  if (source.kind === 'operating-review-receipt') {
    return { available: false, actions: [], reason: { code: 'REVIEW_TERMINAL', message: 'This Review is terminal.' } };
  }
  const matches = matchingSubmitActions(source, view, choices);
  if (view.status !== 'ready') {
    return { available: false, actions: [], reason: { code: `VIEW_${view.status.replaceAll('-', '_').toUpperCase()}`, message: `The verified view is ${view.status}.` } };
  }
  if (matches.length !== choices.length) {
    return { available: false, actions: [], reason: { code: 'REVIEW_SUBMIT_NOT_AVAILABLE', message: 'No exact owner submit capability is available.' } };
  }
  return { available: true, actions: clone(matches), reason: null };
}

function sourceOmissions(view, graph, redactionCount) {
  const omissions = [];
  const restrictedIds = graph.evidence.filter(({ accessState }) => accessState === 'restricted').map(({ evidenceRefId }) => evidenceRefId).sort();
  if (restrictedIds.length > 0) omissions.push({
    kind: 'restricted', subject: 'evidence', count: restrictedIds.length, subjectIds: restrictedIds, reasonCode: 'REVIEW_EVIDENCE_RESTRICTED',
  });
  if (graph.missing.length > 0) omissions.push({
    kind: 'absent', subject: 'evidence', count: graph.missing.length, subjectIds: graph.missing, reasonCode: 'REVIEW_EVIDENCE_NOT_VISIBLE',
  });
  for (const omission of view.omissions) {
    omissions.push({
      kind: omission.classification === 'restricted' ? 'restricted' : 'absent',
      subject: 'source',
      count: omission.count,
      subjectIds: [],
      reasonCode: `OPERATE_OMISSION_${omission.reason.replaceAll('-', '_').toUpperCase()}`,
    });
  }
  if (redactionCount > 0) omissions.push({
    kind: 'restricted', subject: 'source', count: redactionCount, subjectIds: [], reasonCode: 'DISPLAY_SOURCE_REDACTED',
  });
  return omissions.sort((left, right) => (
    left.reasonCode.localeCompare(right.reasonCode) || left.subject.localeCompare(right.subject)
  ));
}

function terminalDisposition(source) {
  if (source.kind !== 'operating-review-receipt') return null;
  return {
    receiptId: source.receiptId,
    decision: source.decision,
    appliedChoiceId: source.appliedChoiceId,
    appliedChoiceHash: source.appliedChoiceHash,
    appliedWorkDispositions: clone(source.appliedWorkDispositions),
    readEventHead: clone(source.readEventHead),
    eventHead: clone(source.eventHead),
    committedAt: source.committedAt,
  };
}

function statusAndReasons(source, view, capability) {
  if (source.kind === 'operating-review-receipt') return { status: 'terminal', reasonCodes: ['REVIEW_TERMINAL'] };
  const reasons = [];
  if (view.status !== 'ready') reasons.push(`VIEW_${view.status.replaceAll('-', '_').toUpperCase()}`);
  if (!capability.available) reasons.push(capability.reason.code);
  return {
    status: view.status === 'ready' && !capability.available ? 'read-only' : view.status,
    reasonCodes: [...new Set(reasons)].sort(),
  };
}

/**
 * Pure Review workspace payload projection. `source` is a closed union of the
 * pending read and terminal receipt contracts. No Store or clock is consulted.
 */
export function buildOperateReviewWorkspacePayloadV1(inputSource, inputView) {
  const source = assertReviewSource(inputSource);
  const view = assertCanonicalView(inputView);
  assertSourceViewBinding(source, view);
  assertExperienceEvidenceGraph(view);

  for (const choice of source.dispositionChoices) assertChoiceBinding(choice, source);
  const graph = selectReviewEvidenceGraph(source, view);
  const choices = enrichedChoices(source);
  const capability = capabilityFor(source, view, choices);
  const uncertainty = buildUncertainty(source, graph.claims);
  const redaction = { count: 0 };
  const redacted = redactNarrative({
    recommendationItems: [...source.decisions].sort(compareBy('decisionId')),
    findings: [...source.findings].sort(compareBy('findingId')),
    dissent: [...source.dissent].sort(compareBy('localDissentId')),
    gaps: [...source.gaps].sort(compareBy('absenceId')),
    uncertainty,
    claims: graph.claims,
    evidence: graph.evidence,
    message: source.kind === 'operating-review-receipt' ? source.summary.message : null,
  }, null, redaction);
  const omissions = sourceOmissions(view, graph, redaction.count);
  const recommendation = redacted.recommendationItems.length > 0
    ? { status: 'available', items: redacted.recommendationItems, absence: null }
    : { status: 'absent', items: [], absence: { code: 'REVIEW_RECOMMENDATION_ABSENT', message: 'No Chair recommendation is available.' } };
  const summaryCounts = source.kind === 'operating-review-receipt' ? source.summary : {
    decisionCount: source.decisions.length,
    actionCount: source.actions.length,
    findingCount: source.findings.length,
    dissentCount: source.dissent.length,
    gapCount: source.gaps.length,
  };
  const status = statusAndReasons(source, view, capability);
  const sourceCycles = view.cycles.filter(({ cycleId }) => cycleId === source.cycleId);
  if (sourceCycles.length !== 1) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Review workspace requires one exact source Cycle trace owner.', {
      cycleId: source.cycleId,
    });
  }
  const traceMatrix = sourceCycles[0].executiveBoard?.traceMatrix ?? null;
  const payload = {
    ok: true,
    kind: 'operate-review-workspace',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    readOnly: true,
    mutationEnabled: capability.available,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: source.cycleId,
    reviewId: source.review.reviewId,
    actorId: view.actorId,
    accessLevel: view.accessLevel,
    generatedAt: source.kind === 'operating-review-read' ? source.readAt : source.committedAt,
    sourceArtifactKind: source.kind,
    sourceArtifactHash: sha256Jcs(source),
    sourceEventHead: clone(source.eventHead),
    sourceReadEventHead: clone(sourceReadEventHead(source)),
    sourceViewHash: view.viewHash,
    status: status.status,
    reasonCodes: status.reasonCodes,
    data: {
      review: clone(source.review),
      policyBinding: {
        sourceContract: { id: 'operating-review', version: '2.0.0' },
        ownerActorId: source.review.ownerActorId,
        actorMatchesOwner: source.review.ownerActorId === view.actorId,
        authorityBoundary: 'review-only',
        externalEffectsAuthorized: false,
      },
      executiveSummary: {
        text: source.kind === 'operating-review-receipt'
          ? redacted.message
          : `Pending Review with ${summaryCounts.decisionCount} decision(s), ${summaryCounts.actionCount} action(s), ${summaryCounts.findingCount} Finding(s), ${summaryCounts.dissentCount} dissent item(s), and ${summaryCounts.gapCount} typed gap(s).`,
        decisionCount: summaryCounts.decisionCount,
        actionCount: summaryCounts.actionCount,
        findingCount: summaryCounts.findingCount,
        dissentCount: summaryCounts.dissentCount,
        gapCount: summaryCounts.gapCount,
        uncertaintyCount: redacted.uncertainty.length,
      },
      recommendation,
      choices,
      findings: redacted.findings,
      dissent: redacted.dissent,
      uncertainty: redacted.uncertainty,
      gaps: redacted.gaps,
      claims: redacted.claims,
      evidence: redacted.evidence,
      omissions,
      traceMatrix: traceMatrix === null ? null : clone(traceMatrix),
      truthSummary: clone(deriveOperateSharedTruthSummaryV1(view)),
      terminalDisposition: terminalDisposition(source),
      capability,
    },
  };
  assertOperateReviewWorkspacePayloadSafeV1(payload);
  return deepFreeze(payload);
}
