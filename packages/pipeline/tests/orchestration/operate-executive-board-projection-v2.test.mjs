import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildExecutiveBoardForCycle } from '../../lib/operate/executive-board-projection-v2.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import { planOperatingIntelligenceBoardV2 } from '../../lib/operate/intelligence-router-v2.mjs';
import { deriveOperatingChairLedgerIdV2 } from '../../lib/operate/intelligence-output-identities-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function screen() {
  return {
    inspect: () => ({ visible: true }),
    text: (value) => value,
  };
}

const businessDomain = {
  kind: 'operate-domain-registration',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  ...structuredClone(
    OPERATE_CONTRACT_CATALOG_V2.extensions.domains.find(({ domainId }) => domainId === 'business'),
  ),
};

test('executive board projection binds stable role identity and typed absence for business plans', () => {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_exec_board_projection_001',
      eventId: 'evt_exec_board_projection_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_exec_board_projection_001',
    },
    { initialState: base.result.state },
  );
  const board = planOperatingIntelligenceBoardV2({
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: [base.evidenceRef],
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['all'],
    domainDescriptor: businessDomain,
    decisionOwnerActorId: 'owner-board-projection-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  });
  const cycle = base.result.state.cycles[0];
  const indexes = {
    assignments: new Map(
      board.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    ),
    artifacts: new Map(),
    claims: new Map(),
    findings: new Map(),
    decisionLedgers: new Map(),
    cycles: new Map([[cycle.cycleId, cycle]]),
  };
  const executiveBoard = buildExecutiveBoardForCycle({
    indexes,
    cycle,
    scope: { scopeId: cycle.scopeId, domainId: 'business', domainVersion: cycle.domainVersion },
    screen: screen(),
    intelligencePlan: board.plan,
    lensAbsences: [],
    assignmentAbsence: () => null,
  });
  assert.ok(executiveBoard);
  assert.equal(executiveBoard.cycleId, cycle.cycleId);
  assert.ok(executiveBoard.seats.length >= 5);
  for (const seat of executiveBoard.seats) {
    assert.notEqual(seat.roleId, seat.label);
    assert.ok(seat.label.length > 0);
  }
  assert.equal(
    buildExecutiveBoardForCycle({
      indexes,
      cycle,
      scope: { scopeId: cycle.scopeId, domainId: 'software', domainVersion: cycle.domainVersion },
      screen: screen(),
      intelligencePlan: board.plan,
      lensAbsences: [],
      assignmentAbsence: () => null,
    }),
    null,
  );
});

test('chair synthesis merges plan omissions with persisted terminal advisor absence gaps', () => {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_exec_board_gaps_001',
      eventId: 'evt_exec_board_gaps_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_exec_board_gaps_001',
    },
    { initialState: base.result.state },
  );
  const board = planOperatingIntelligenceBoardV2({
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: [base.evidenceRef],
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['technology-risk', 'challenge'],
    domainDescriptor: businessDomain,
    decisionOwnerActorId: 'owner-board-projection-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  });
  const cycle = base.result.state.cycles[0];
  const terminalAdvisor = board.assignments.find(({ roleId }) => roleId === 'technology-risk');
  const chairAssignment = board.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  const chairArtifactId = 'art_exec_board_gaps_chair';
  const ledger = {
    kind: 'operating-decision-ledger',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    ledgerId: deriveOperatingChairLedgerIdV2(chairAssignment.assignmentId),
    assignmentId: chairAssignment.assignmentId,
    roleId: chairAssignment.roleId,
    roleVersion: chairAssignment.roleVersion,
    analysisProfile: structuredClone(chairAssignment.analysisProfile),
    scopeId: cycle.scopeId,
    domainId: 'business',
    domainVersion: cycle.domainVersion,
    snapshotId: base.result.snapshot.snapshotId,
    intelligencePlanId: board.plan.planId,
    advisorArtifactIds: [],
    challengerArtifactId: null,
    summary: 'The bounded board retained the declared operating gaps.',
    advisorAbsenceGaps: [
      {
        absenceId: 'abs_role_exec_board_technology_001',
        kind: 'role',
        roleId: terminalAdvisor.roleId,
        roleKind: 'advisor',
        roleVersion: terminalAdvisor.roleVersion,
        absenceCode: 'assignment-abandoned',
        reason: 'Advisor seat abandoned before validation.',
        recoveryDisposition: 'continue-partial',
        sourceAssignmentId: terminalAdvisor.assignmentId,
        sourceEventId: 'evt-technology-risk-abandoned-001',
      },
    ],
    evidenceGaps: [],
    decisions: [],
    sourceDispositions: [],
    dissent: [],
    sourceArtifactId: board.plan.sourceArtifactId,
  };
  const chairArtifact = {
    ...fixture('all-contracts-valid.json')['operating-artifact'],
    artifactId: chairArtifactId,
    assignmentId: chairAssignment.assignmentId,
    cycleId: cycle.cycleId,
    scopeId: cycle.scopeId,
    domainId: 'business',
    domainVersion: cycle.domainVersion,
    artifactType: 'chair-result',
    schemaId: 'operating-decision-ledger',
    artifactSchemaVersion: '2.0.0',
    producer: { actorId: 'chair-agent', roleId: chairAssignment.roleId, runtime: 'codex' },
    inputArtifactIds: [...chairAssignment.inputArtifactIds],
  };
  const indexes = {
    assignments: new Map(
      board.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    ),
    artifacts: new Map([[chairArtifactId, chairArtifact]]),
    claims: new Map(),
    findings: new Map(),
    decisionLedgers: new Map([[ledger.ledgerId, ledger]]),
    cycles: new Map([[cycle.cycleId, cycle]]),
  };
  const lensAbsences = board.plan.omittedRoles
    .filter(({ roleKind }) => roleKind === 'advisor')
    .map((role) => ({
      roleId: role.roleId,
      roleKind: role.roleKind,
      roleVersion: role.roleVersion,
      absenceCode: 'not-selected',
      reason: role.reason,
      recoveryDisposition: 'not-applicable',
      sourceAssignmentId: null,
      sourceEventId: null,
    }));
  const executiveBoard = buildExecutiveBoardForCycle({
    indexes,
    cycle,
    scope: { scopeId: cycle.scopeId, domainId: 'business', domainVersion: cycle.domainVersion },
    screen: screen(),
    intelligencePlan: board.plan,
    lensAbsences,
    assignmentAbsence: () => null,
  });
  const gapRoleIds = executiveBoard.chairSynthesis.unresolvedGaps
    .map(({ roleId }) => roleId)
    .sort();
  assert.ok(gapRoleIds.includes('technology-risk'));
  assert.ok(gapRoleIds.some((roleId) => roleId !== 'technology-risk'));
});

test('executive board projection preserves durable Findings, structured decisions, typed evidence gaps, and 4096-character dissent', () => {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_exec_board_structured_001',
      eventId: 'evt_exec_board_structured_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_exec_board_structured_001',
    },
    { initialState: base.result.state },
  );
  const board = planOperatingIntelligenceBoardV2({
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: [base.evidenceRef],
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['all'],
    domainDescriptor: businessDomain,
    decisionOwnerActorId: 'owner-board-projection-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  });
  const cycle = base.result.state.cycles[0];
  const advisorAssignment = board.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'advisor',
  );
  const challengerAssignment = board.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const chairAssignment = board.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  const artifactFor = (assignment, artifactId, schemaId) => ({
    ...fixture('all-contracts-valid.json')['operating-artifact'],
    artifactId,
    assignmentId: assignment.assignmentId,
    cycleId: cycle.cycleId,
    scopeId: cycle.scopeId,
    domainId: 'business',
    domainVersion: cycle.domainVersion,
    artifactType: `${assignment.roleId}-result`,
    schemaId,
    artifactSchemaVersion: '2.0.0',
    producer: {
      actorId: `${assignment.roleId}-agent`,
      roleId: assignment.roleId,
      runtime: 'codex',
    },
    inputArtifactIds: [...assignment.inputArtifactIds],
  });
  const advisorArtifact = artifactFor(
    advisorAssignment,
    'art_exec_board_advisor_001',
    'operating-advisor-result',
  );
  const challengerArtifact = artifactFor(
    challengerAssignment,
    'art_exec_board_challenger_001',
    'operating-challenger-review',
  );
  const chairArtifact = artifactFor(
    chairAssignment,
    'art_exec_board_chair_001',
    'operating-decision-ledger',
  );
  const localClaimId = `claim:${advisorAssignment.assignmentId}:1`;
  const localFindingId = `finding:${challengerAssignment.assignmentId}:1`;
  const localDissentId = `dissent:${challengerAssignment.assignmentId}:1`;
  const dissentStatement = 'D'.repeat(4096);
  const finding = {
    kind: 'operating-finding',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    findingId: 'fnd_exec_board_structured_001',
    scopeId: cycle.scopeId,
    domainId: 'business',
    domainVersion: cycle.domainVersion,
    sourceCycleId: cycle.cycleId,
    sourceArtifactId: challengerArtifact.artifactId,
    sourceAssignmentId: challengerAssignment.assignmentId,
    sourceLocalFindingId: localFindingId,
    findingType: 'unsupported',
    severity: 'high',
    confidence: 0.8,
    targets: [
      {
        advisorArtifactId: advisorArtifact.artifactId,
        analysisIds: [],
        claimIds: [localClaimId],
        measurementIds: [],
        riskIds: [],
        recommendationIds: [],
      },
    ],
    supportingEvidenceRefIds: [],
    contradictingEvidenceRefIds: [base.evidenceRef.evidenceRefId],
    title: 'Evidence custody is incomplete',
    statement: 'The recommendation exceeds the available observation window.',
    rationale: 'The cited observation does not cover the full decision period.',
    correctionCondition: 'Collect one complete bounded observation window.',
    state: 'open',
    ownerActorId: null,
    revisitAt: null,
    createdAt: '2026-08-09T12:04:00.000Z',
    updatedAt: '2026-08-09T12:04:00.000Z',
  };
  const ledger = {
    kind: 'operating-decision-ledger',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId: chairAssignment.assignmentId,
    roleId: chairAssignment.roleId,
    roleVersion: chairAssignment.roleVersion,
    analysisProfile: structuredClone(chairAssignment.analysisProfile),
    ledgerId: deriveOperatingChairLedgerIdV2(chairAssignment.assignmentId),
    scopeId: cycle.scopeId,
    domainId: 'business',
    domainVersion: cycle.domainVersion,
    snapshotId: base.result.snapshot.snapshotId,
    intelligencePlanId: board.plan.planId,
    summary: 'Proceed only with the explicitly reversible bounded change.',
    advisorArtifactIds: [advisorArtifact.artifactId],
    challengerArtifactId: challengerArtifact.artifactId,
    advisorAbsenceGaps: [],
    evidenceGaps: [
      {
        absenceId: 'abs_evidence_exec_board_001',
        kind: 'evidence',
        requirementId: 'current-operating-evidence',
        evidenceKinds: ['operate-artifact'],
        absenceCode: 'stale',
        sourceContracts: [{ id: 'objective-metrics', version: '1.0.0' }],
        reason: 'The remaining evidence is older than the declared freshness ceiling.',
        recoveryDisposition: 'refresh-or-issue-evidence',
        sourceEvidenceRefIds: [base.evidenceRef.evidenceRefId],
        sourceEventIds: [],
      },
    ],
    decisions: [
      {
        localDecisionId: `decision:${chairAssignment.assignmentId}:1`,
        title: 'Run a bounded experiment',
        question: 'Which reversible move should be tested next?',
        outcome: 'Run the bounded experiment.',
        rationale: 'It preserves optionality while collecting decisive evidence.',
        sourceClaimRefs: [{ advisorArtifactId: advisorArtifact.artifactId, localClaimId }],
        sourceRecommendationRefs: [],
        challengerFindingIds: [localFindingId],
        evidenceRefIds: [base.evidenceRef.evidenceRefId],
        alternativeDispositions: [
          {
            sourceArtifactId: advisorArtifact.artifactId,
            localAlternativeId: `alternative:${advisorAssignment.assignmentId}:1`,
            title: 'Wait for passive evidence',
            disposition: 'deferred',
            rationale: 'Passive evidence would arrive too slowly for the bounded decision window.',
          },
        ],
        confidence: 0.72,
        assumptionIds: [base.assumption.assumptionId],
        upside: 'The experiment can validate the highest-value path quickly.',
        downside: 'The experiment consumes one delivery window.',
        uncertainty: 'Customer response remains uncertain.',
        reversibility: 'The experiment can be stopped without migration.',
        ownerActorId: 'owner-board-projection-001',
        revisitConditions: ['Revisit when the observation window closes.'],
        dissentIds: [localDissentId],
        actionHypotheses: [],
      },
    ],
    sourceDispositions: [],
    dissent: [
      {
        sourceArtifactId: challengerArtifact.artifactId,
        localDissentId,
        findingIds: [localFindingId],
        statement: dissentStatement,
        evidenceRefIds: [base.evidenceRef.evidenceRefId],
        resolutionCondition: 'Resolve only after the complete observation window is available.',
      },
    ],
    sourceArtifactId: board.plan.sourceArtifactId,
  };
  const indexes = {
    assignments: new Map(
      board.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    ),
    artifacts: new Map(
      [advisorArtifact, challengerArtifact, chairArtifact].map((artifact) => [
        artifact.artifactId,
        artifact,
      ]),
    ),
    claims: new Map(),
    findings: new Map([[finding.findingId, finding]]),
    decisionLedgers: new Map([[ledger.ledgerId, ledger]]),
    cycles: new Map([[cycle.cycleId, cycle]]),
  };
  const executiveBoard = buildExecutiveBoardForCycle({
    indexes,
    cycle,
    scope: { scopeId: cycle.scopeId, domainId: 'business', domainVersion: cycle.domainVersion },
    screen: screen(),
    intelligencePlan: board.plan,
    lensAbsences: [],
    assignmentAbsence: () => null,
  });
  assert.equal(executiveBoard.challengerFindings.findings[0].findingId, finding.findingId);
  assert.equal(executiveBoard.challengerFindings.dissent[0].statement, dissentStatement);
  assert.equal(executiveBoard.chairSynthesis.dissent[0].statement, dissentStatement);
  assert.equal(
    executiveBoard.chairSynthesis.decisions[0].expectedDownside,
    ledger.decisions[0].downside,
  );
  assert.equal(
    executiveBoard.chairSynthesis.decisions[0].alternativeDispositions[0].disposition,
    'deferred',
  );
  assert.equal(executiveBoard.chairSynthesis.unresolvedGaps[0].kind, 'evidence');
});
