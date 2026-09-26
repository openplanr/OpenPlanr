import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import {
  createOperatingResultTemplateV2,
  operatingResultSchemaDependenciesV2,
} from '../../lib/operate/result-packet-v2.mjs';
import { preflightOperatingIntelligenceResultV2 } from '../../lib/operate/runtime-foundation.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const PROFILE_FIELDS = Object.freeze({
  'strategy-finance': [
    'directionChanges',
    'capitalAllocations',
    'financialScenarios',
    'costOfDelay',
  ],
  'technology-risk': [
    'objectiveConstraints',
    'riskPortfolio',
    'implicitArchitectureDecisions',
    'riskiestChange',
  ],
  'product-activation': [
    'activationGaps',
    'unvalidatedBets',
    'orderedCuts',
    'acceptanceCriteriaFindings',
  ],
  'growth-market': ['demandChanges', 'channelEconomics', 'positioningClaims', 'growthLoops'],
  'operations-customer': [
    'deliveryCapacity',
    'customerHealth',
    'singlePointsOfFailure',
    'renegotiations',
  ],
  'software-delivery': [
    'changeSurface',
    'implementationRisks',
    'implementationAlternatives',
    'verificationGaps',
  ],
});

function role(roleId) {
  return OPERATE_CONTRACT_CATALOG_V2.extensions.domains
    .flatMap(({ roles }) => roles)
    .find((candidate) => candidate.roleId === roleId);
}

function assignmentFor(roleId, assignmentKind, outputSchemaId, suffix = roleId) {
  const registered = role(roleId);
  const assignmentId = `asg_packet_${suffix.replaceAll('-', '_')}_001`;
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId,
    cycleId: 'cyc_packet_template_001',
    assignmentKind,
    roleId,
    roleVersion: registered.roleVersion,
    objective: 'Produce the exact bounded operating-intelligence result.',
    state: 'running',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: ['art_packet_bundle_001'],
    inputAbsences: [],
    outputContract: {
      schemaId: outputSchemaId,
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: registered.output.maxBytes,
    },
    capabilityGrantId: 'grt_packet_template_001',
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 3, attempt: 1, timeoutMs: 300000 },
    claim: {
      actorId: 'agent-packet',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: 'clm_packet_001',
    },
    terminalOutcome: null,
    createdAt: '2026-08-20T08:00:00.000Z',
    availableAt: '2026-08-20T08:00:00.000Z',
    completedAt: null,
    analysisProfile: structuredClone(registered.analysisProfile),
    evidenceRequirements: structuredClone(registered.evidenceRequirements),
    resultRequirements: structuredClone(registered.resultRequirements),
    analysisRubric: structuredClone(registered.analysisRubric),
    mandate: structuredClone(registered.mandate),
    intelligenceContext: {
      intelligencePlanId: 'ipl_packet_template_001',
      snapshotId: 'snp_packet_template_001',
      scopeId: 'scope-packet',
      domainId: registered.analysisProfile.id === 'software-delivery' ? 'software' : 'business',
      domainVersion: '1.0.0',
      sourceArtifactId: 'art_packet_source_001',
      sourceArtifactIds: ['art_packet_source_001'],
      evidenceRefIds: [],
      inputBundle: {
        bundleId: `ibd_${suffix.replaceAll('-', '_')}_001`,
        bundleArtifactId: 'art_packet_bundle_001',
        bundleRawHash: `sha256:${'a'.repeat(64)}`,
        bundleCanonicalHash: `sha256:${'b'.repeat(64)}`,
        sourceArtifactIds: ['art_packet_source_001'],
        issuedEvidence: [],
      },
      decisionOwnerActorId: 'human-owner',
    },
  };
}

test('all six Advisor profiles receive complete deterministic but unauthored templates', () => {
  for (const profileId of Object.keys(PROFILE_FIELDS)) {
    const roleId = profileId === 'software-delivery' ? 'advisor' : profileId;
    const assignment = assignmentFor(roleId, 'advisor', 'operating-advisor-result', profileId);
    const first = createOperatingResultTemplateV2({ assignment });
    const second = createOperatingResultTemplateV2({ assignment: structuredClone(assignment) });
    assert.deepEqual(second, first, profileId);
    assert.ok(Object.isFrozen(first), profileId);
    assert.equal(first.summary, '');
    assert.equal(first.analysisMarkdown, '');
    assert.equal(first.analysis.profileId, profileId);
    assert.deepEqual(
      first.analysis.executiveQuestionAnswers.map(({ questionId }) => questionId),
      assignment.analysisProfile.questionIds,
    );
    for (const field of PROFILE_FIELDS[profileId])
      assert.ok(field in first.analysis, `${profileId}:${field}`);
    assert.throws(
      () => assertProtocolArtifact('operating-advisor-result', first, { protocolVersion: '2.0.0' }),
      (error) => error.code === 'E_PROTOCOL_ARTIFACT_INVALID',
      `${profileId}: untouched authoring template must not submit`,
    );
  }
});

test('prepared-result preflight reports all bounded schema failures with JSON pointers before semantic validation', () => {
  const assignment = assignmentFor(
    'strategy-finance',
    'advisor',
    'operating-advisor-result',
    'multi_error',
  );
  const template = createOperatingResultTemplateV2({ assignment });
  const result = preflightOperatingIntelligenceResultV2({ value: template, assignment });
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.length > 1,
    'one validation reports multiple independently actionable schema issues',
  );
  assert.ok(result.issues.length <= 64, 'validation output remains deterministically bounded');
  assert.ok(
    result.issues.every(({ path }) => path.startsWith('/')),
    'every issue has a JSON pointer',
  );
  assert.ok(result.issues.some(({ path }) => path === '/summary'));
  assert.ok(result.issues.some(({ path }) => path === '/analysisMarkdown'));
  assert.ok(result.issues.every(({ code }) => code === 'RESULT_CONTRACT_INVALID'));
});

test('Challenger and Chair templates preserve exact predecessor-local references', () => {
  const advisorAssignment = assignmentFor(
    'strategy-finance',
    'advisor',
    'operating-advisor-result',
    'advisor',
  );
  const advisorValue = {
    ...createOperatingResultTemplateV2({ assignment: advisorAssignment }),
    assignmentId: advisorAssignment.assignmentId,
    outcome: 'quiet',
    claims: [{ localClaimId: `claim:${advisorAssignment.assignmentId}:1` }],
  };
  const advisorDescriptor = {
    artifactId: 'art_packet_advisor_001',
    schemaId: 'operating-advisor-result',
    value: advisorValue,
  };

  const challengerAssignment = assignmentFor(
    'independent-challenge',
    'challenger',
    'operating-challenger-review',
    'challenger',
  );
  const challenger = createOperatingResultTemplateV2({
    assignment: challengerAssignment,
    inputArtifacts: [advisorDescriptor],
  });
  assert.deepEqual(challenger.advisorArtifactIds, [advisorDescriptor.artifactId]);
  assert.deepEqual(challenger.reviewedClaims, [
    {
      advisorArtifactId: advisorDescriptor.artifactId,
      localClaimId: advisorValue.claims[0].localClaimId,
    },
  ]);
  assert.deepEqual(
    challenger.questionCoverage.map(({ questionId }) => questionId),
    challengerAssignment.analysisProfile.questionIds,
  );
  assert.ok(
    challenger.questionCoverage.every(({ disposition }) => disposition === 'not-applicable'),
  );

  const finding = {
    localFindingId: `finding:${challengerAssignment.assignmentId}:1`,
    title: 'Unpriced downside',
    statement: 'The proposed direction leaves one material downside unpriced.',
  };
  const dissent = {
    localDissentId: `dissent:${challengerAssignment.assignmentId}:1`,
    findingIds: [finding.localFindingId],
    statement: 'Defer the decision until the downside is measured.',
    evidenceRefIds: [],
    resolutionCondition: 'Price the downside with current evidence.',
  };
  const challengerDescriptor = {
    artifactId: 'art_packet_challenger_001',
    schemaId: 'operating-challenger-review',
    value: { ...challenger, findings: [finding], dissent: [dissent] },
  };
  const chairAssignment = assignmentFor('chair', 'chair', 'operating-decision-ledger', 'chair');
  const chair = createOperatingResultTemplateV2({
    assignment: chairAssignment,
    inputArtifacts: [advisorDescriptor, challengerDescriptor],
  });
  assert.equal(chair.sourceArtifactId, chairAssignment.intelligenceContext.sourceArtifactId);
  assert.equal(chair.ledgerId, `ldg_${chairAssignment.assignmentId.slice(4)}`);
  assert.deepEqual(chair.advisorArtifactIds, [advisorDescriptor.artifactId]);
  assert.equal(chair.challengerArtifactId, challengerDescriptor.artifactId);
  assert.deepEqual(
    chair.questionCoverage.map(({ questionId }) => questionId),
    chairAssignment.analysisProfile.questionIds,
  );
  assert.ok(chair.questionCoverage.every(({ disposition }) => disposition === 'not-applicable'));
  assert.deepEqual(chair.dissent, [
    { sourceArtifactId: challengerDescriptor.artifactId, ...dissent },
  ]);
  assert.deepEqual(
    chair.sourceDispositions.map(({ sourceKind, localSourceId }) => ({
      sourceKind,
      localSourceId,
    })),
    [
      {
        sourceKind: 'advisor-outcome',
        localSourceId: `outcome:${advisorAssignment.assignmentId}:1`,
      },
      { sourceKind: 'challenger-finding', localSourceId: finding.localFindingId },
      { sourceKind: 'challenger-dissent', localSourceId: dissent.localDissentId },
    ],
  );
});

test('Chair template refuses provenance outside the exact Assignment bundle', () => {
  const assignment = assignmentFor('chair', 'chair', 'operating-decision-ledger', 'foreign');
  assignment.intelligenceContext.inputBundle.sourceArtifactIds = ['art_other_source_001'];
  assert.throws(
    () => createOperatingResultTemplateV2({ assignment }),
    /not present in the exact input-bundle provenance/u,
  );
});

test('Challenger template preserves a missing Advisor as the exact typed role gap', () => {
  const assignment = assignmentFor(
    'independent-challenge',
    'challenger',
    'operating-challenger-review',
    'missing_advisor',
  );
  assignment.inputAbsences = [
    {
      absenceId: 'abs_packet_missing_advisor_001',
      kind: 'role',
      roleId: 'growth-market',
      roleKind: 'advisor',
      roleVersion: '2.0.0',
      absenceCode: 'dependency-failed',
      reason: 'The selected Advisor reached a terminal failed state without a validated Artifact.',
      recoveryDisposition: 'retry-or-record-role-gap',
      sourceAssignmentId: 'asg_packet_missing_source_001',
      sourceEventId: 'evt_packet_missing_source_001',
    },
  ];
  const [gap] = createOperatingResultTemplateV2({ assignment }).gaps;
  assert.deepEqual(gap, {
    localGapId: `gap:${assignment.assignmentId}:1`,
    inputAbsenceId: assignment.inputAbsences[0].absenceId,
    kind: 'role',
    roleId: assignment.inputAbsences[0].roleId,
    roleKind: assignment.inputAbsences[0].roleKind,
    roleVersion: assignment.inputAbsences[0].roleVersion,
    sourceAssignmentId: assignment.inputAbsences[0].sourceAssignmentId,
    impact: '',
    recoveryPath: '',
  });
  assert.equal(
    Object.hasOwn(gap, 'requirementId'),
    false,
    'a role gap never fabricates an Evidence requirement',
  );
});

test('standalone result schema inventories are host-path-free and transitively complete', () => {
  assert.deepEqual(
    operatingResultSchemaDependenciesV2('operating-advisor-result').map(({ kind, fileName }) => ({
      kind,
      fileName,
    })),
    [{ kind: 'operating-advisor-result', fileName: 'operating-advisor-result.schema.json' }],
  );
  const chair = operatingResultSchemaDependenciesV2('operating-decision-ledger');
  assert.deepEqual(
    chair.map(({ fileName }) => fileName),
    ['operating-decision-ledger.schema.json', 'operating-assignment.schema.json'],
  );
  for (const dependency of chair) {
    assert.ok(Object.isFrozen(dependency));
    assert.ok(Object.isFrozen(dependency.schema));
    assert.ok(!dependency.fileName.includes('/'));
    assert.equal(dependency.schema['x-openplanr-contract'].id, dependency.kind);
  }
  assert.throws(() => operatingResultSchemaDependenciesV2('foreign-result'), /Unsupported/u);
});
