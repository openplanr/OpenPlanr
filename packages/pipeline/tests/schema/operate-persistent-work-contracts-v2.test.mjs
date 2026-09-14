import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));

test('persistent-work contracts keep v2 identities, local references, and Phase 3 vocabulary closed', () => {
  const valid = fixture('persistent-work-valid.json');
  const invalid = fixture('persistent-work-invalid.json');
  const contracts = {
    finding: 'operating-finding',
    decision: 'operating-decision',
    action: 'operating-action',
    changeSet: 'operating-work-change-set',
    ledger: 'operating-work-ledger',
  };

  for (const [key, contract] of Object.entries(contracts)) {
    assert.deepEqual(validateProtocolArtifact(contract, valid[key], { protocolVersion: '2.0.0' }), [], `${key} valid`);
    const candidate = structuredClone(valid[key]);
    Object.assign(candidate, invalid[key].patch);
    assert.ok(validateProtocolArtifact(contract, candidate, { protocolVersion: '2.0.0' }).length > 0, `${key} invalid`);
  }
});

test('persistent records discriminate generic work from operating-intelligence provenance', () => {
  const persistent = fixture('persistent-work-valid.json');
  const intelligence = fixture('all-contracts-valid.json');

  assert.equal(persistent.finding.origin, 'persistent-work');
  assert.equal(persistent.decision.origin, 'persistent-work');
  assert.equal(intelligence['operating-finding'].origin, 'operating-intelligence');
  assert.equal(intelligence['operating-decision'].origin, 'operating-intelligence');
  assert.equal(intelligence['operating-risk'].origin, 'operating-intelligence');

  for (const [contract, value] of [
    ['operating-finding', { ...persistent.finding, origin: 'operating-intelligence' }],
    ['operating-decision', { ...persistent.decision, origin: 'operating-intelligence' }],
    ['operating-finding', { ...intelligence['operating-finding'], origin: 'persistent-work' }],
    ['operating-decision', { ...intelligence['operating-decision'], origin: 'persistent-work' }],
  ]) {
    assert.ok(validateProtocolArtifact(contract, value, {
      protocolVersion: '2.0.0',
    }).length > 0, `${contract} rejects provenance fields from the other origin`);
  }

  const genericRisk = structuredClone(intelligence['operating-risk']);
  genericRisk.origin = 'generic';
  for (const field of [
    'sourceCycleId', 'sourceAssignmentId', 'sourceLocalRiskId', 'sourceClaimIds', 'sourceImpact',
    'exposureStatement', 'exposedSurfaces', 'mitigation', 'reversibility',
  ]) delete genericRisk[field];
  assert.deepEqual(validateProtocolArtifact('operating-risk', genericRisk, {
    protocolVersion: '2.0.0',
  }), [], 'generic durable Risk preserves the pre-intelligence contract');
  assert.ok(validateProtocolArtifact('operating-risk', {
    ...genericRisk,
    sourceAssignmentId: intelligence['operating-risk'].sourceAssignmentId,
  }, { protocolVersion: '2.0.0' }).length > 0, 'generic Risk rejects Advisor-only provenance');
  const incompleteIntelligenceRisk = structuredClone(intelligence['operating-risk']);
  delete incompleteIntelligenceRisk.sourceLocalRiskId;
  assert.ok(validateProtocolArtifact('operating-risk', incompleteIntelligenceRisk, {
    protocolVersion: '2.0.0',
  }).length > 0, 'operating-intelligence Risk requires exact Advisor provenance');
});

test('Review read and receipt summaries preserve each durable record origin without invented fields', () => {
  const persistent = fixture('persistent-work-valid.json');
  const intelligence = fixture('all-contracts-valid.json');
  const persistentDecisionSummary = {
    origin: persistent.decision.origin,
    decisionId: persistent.decision.decisionId,
    title: persistent.decision.title,
    question: persistent.decision.question,
    outcome: persistent.decision.outcome,
    rationale: persistent.decision.rationale,
    confidence: persistent.decision.confidence,
    ownerActorId: persistent.decision.ownerActorId,
    expectedUpside: persistent.decision.expectedUpside,
    expectedDownside: persistent.decision.expectedDownside,
    revisitConditions: persistent.decision.revisitConditions,
    dissent: persistent.decision.dissent,
    evidenceRefIds: persistent.decision.evidenceRefIds,
  };
  const persistentFindingSummary = {
    origin: persistent.finding.origin,
    findingId: persistent.finding.findingId,
    title: persistent.finding.title,
    statement: persistent.finding.statement,
    state: persistent.finding.state,
    ownerActorId: persistent.finding.ownerActorId,
    revisitAt: persistent.finding.revisitAt,
  };
  const intelligenceDecision = intelligence['operating-decision'];
  const intelligenceDecisionSummary = {
    origin: intelligenceDecision.origin,
    decisionId: intelligenceDecision.decisionId,
    title: intelligenceDecision.title,
    question: intelligenceDecision.question,
    outcome: intelligenceDecision.outcome,
    rationale: intelligenceDecision.rationale,
    confidence: intelligenceDecision.confidence,
    ownerActorId: intelligenceDecision.ownerActorId,
    expectedUpside: intelligenceDecision.expectedUpside,
    expectedDownside: intelligenceDecision.expectedDownside,
    uncertainty: intelligenceDecision.uncertainty,
    reversibility: intelligenceDecision.reversibility,
    revisitConditions: intelligenceDecision.revisitConditions,
    dissentIds: intelligenceDecision.dissentIds,
    dissent: intelligenceDecision.dissent,
    evidenceRefIds: intelligenceDecision.evidenceRefIds,
  };
  const intelligenceFinding = intelligence['operating-finding'];
  const intelligenceFindingSummary = {
    origin: intelligenceFinding.origin,
    findingId: intelligenceFinding.findingId,
    title: intelligenceFinding.title,
    statement: intelligenceFinding.statement,
    findingType: intelligenceFinding.findingType,
    severity: intelligenceFinding.severity,
    confidence: intelligenceFinding.confidence,
    state: intelligenceFinding.state,
    ownerActorId: intelligenceFinding.ownerActorId,
    revisitAt: intelligenceFinding.revisitAt,
    supportingEvidenceRefIds: intelligenceFinding.supportingEvidenceRefIds,
    contradictingEvidenceRefIds: intelligenceFinding.contradictingEvidenceRefIds,
  };

  for (const [label, decisions, findings] of [
    ['persistent-work', [persistentDecisionSummary], [persistentFindingSummary]],
    ['operating-intelligence', [intelligenceDecisionSummary], [intelligenceFindingSummary]],
  ]) {
    const read = { ...structuredClone(intelligence['operating-review-read']), decisions, findings };
    assert.deepEqual(validateProtocolArtifact('operating-review-read', read, {
      protocolVersion: '2.0.0',
    }), [], `${label} Review read summary validates`);
    const receipt = { ...structuredClone(intelligence['operating-review-receipt']), decisions, findings };
    assert.deepEqual(validateProtocolArtifact('operating-review-receipt', receipt, {
      protocolVersion: '2.0.0',
    }), [], `${label} Review receipt summary validates`);
  }

  for (const [label, decisions, findings] of [
    ['lean summaries cannot claim intelligence provenance',
      [{ ...persistentDecisionSummary, origin: 'operating-intelligence' }],
      [{ ...persistentFindingSummary, origin: 'operating-intelligence' }]],
    ['rich summaries cannot claim persistent-work provenance',
      [{ ...intelligenceDecisionSummary, origin: 'persistent-work' }],
      [{ ...intelligenceFindingSummary, origin: 'persistent-work' }]],
  ]) {
    const read = { ...structuredClone(intelligence['operating-review-read']), decisions, findings };
    assert.ok(validateProtocolArtifact('operating-review-read', read, {
      protocolVersion: '2.0.0',
    }).length > 0, label);
  }
});
