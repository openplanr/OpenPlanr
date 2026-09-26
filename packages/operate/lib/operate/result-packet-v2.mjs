import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRoleLocalPositionIdV2,
} from './intelligence-output-identities-v2.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const RESULT_SCHEMA_FILES = Object.freeze({
  'operating-advisor-result': Object.freeze(['operating-advisor-result.schema.json']),
  'operating-challenger-review': Object.freeze(['operating-challenger-review.schema.json']),
  'operating-decision-ledger': Object.freeze([
    'operating-decision-ledger.schema.json',
    'operating-assignment.schema.json',
  ]),
});

const PROFILE_FIELDS = Object.freeze({
  'strategy-finance': Object.freeze({
    list: Object.freeze(['directionChanges', 'capitalAllocations', 'financialScenarios']),
    nullable: Object.freeze(['costOfDelay']),
  }),
  'technology-risk': Object.freeze({
    list: Object.freeze(['objectiveConstraints', 'riskPortfolio', 'implicitArchitectureDecisions']),
    nullable: Object.freeze(['riskiestChange']),
  }),
  'product-activation': Object.freeze({
    list: Object.freeze([
      'activationGaps',
      'unvalidatedBets',
      'orderedCuts',
      'acceptanceCriteriaFindings',
    ]),
    nullable: Object.freeze([]),
  }),
  'growth-market': Object.freeze({
    list: Object.freeze(['demandChanges', 'channelEconomics', 'positioningClaims', 'growthLoops']),
    nullable: Object.freeze([]),
  }),
  'operations-customer': Object.freeze({
    list: Object.freeze([
      'deliveryCapacity',
      'customerHealth',
      'singlePointsOfFailure',
      'renegotiations',
    ]),
    nullable: Object.freeze([]),
  }),
  'software-delivery': Object.freeze({
    list: Object.freeze([
      'changeSurface',
      'implementationRisks',
      'implementationAlternatives',
      'verificationGaps',
    ]),
    nullable: Object.freeze([]),
  }),
});

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertIntelligenceAssignment(assignment) {
  if (
    !assignment ||
    assignment.kind !== 'operating-assignment' ||
    !['advisor', 'challenger', 'chair'].includes(assignment.assignmentKind) ||
    !assignment.analysisProfile ||
    !assignment.intelligenceContext ||
    assignment.outputContract?.schemaVersion !== '2.0.0'
  ) {
    throw new TypeError('An exact Advisor, Challenger, or Chair Assignment is required.');
  }
  const expectedSchemaId = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  }[assignment.assignmentKind];
  if (assignment.outputContract.schemaId !== expectedSchemaId) {
    throw new TypeError(
      `Assignment ${assignment.assignmentId} does not bind ${expectedSchemaId}@2.0.0.`,
    );
  }
}

function normalizedInputArtifacts(inputArtifacts) {
  if (!Array.isArray(inputArtifacts)) throw new TypeError('inputArtifacts must be an array.');
  const seen = new Set();
  return inputArtifacts.map((descriptor) => {
    if (
      !descriptor ||
      typeof descriptor.artifactId !== 'string' ||
      typeof descriptor.schemaId !== 'string' ||
      descriptor.value === null ||
      typeof descriptor.value !== 'object'
    ) {
      throw new TypeError(
        'Each input Artifact descriptor requires artifactId, schemaId, and decoded value.',
      );
    }
    if (seen.has(descriptor.artifactId))
      throw new TypeError(`Duplicate input Artifact ${descriptor.artifactId}.`);
    seen.add(descriptor.artifactId);
    return descriptor;
  });
}

function commonIdentity(assignment) {
  const context = assignment.intelligenceContext;
  return {
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    roleVersion: assignment.roleVersion,
    analysisProfile: clone(assignment.analysisProfile),
    intelligencePlanId: context.intelligencePlanId,
    snapshotId: context.snapshotId,
    scopeId: context.scopeId,
    domainId: context.domainId,
    domainVersion: context.domainVersion,
  };
}

function absenceIds(assignment) {
  return assignment.inputAbsences.map(({ absenceId }) => absenceId);
}

function evidenceGapTemplates(assignment) {
  return assignment.inputAbsences
    .filter(({ kind }) => kind === 'evidence')
    .map((absence, index) => ({
      localGapId: deriveOperatingRoleLocalPositionIdV2('gap', assignment.assignmentId, index + 1),
      inputAbsenceId: absence.absenceId,
      requirementId: absence.requirementId,
      impact: '',
      recoveryPath: '',
    }));
}

function challengerGapTemplates(assignment) {
  return assignment.inputAbsences.map((absence, index) => {
    const common = {
      localGapId: deriveOperatingRoleLocalPositionIdV2('gap', assignment.assignmentId, index + 1),
      inputAbsenceId: absence.absenceId,
      kind: absence.kind,
      impact: '',
      recoveryPath: '',
    };
    if (absence.kind === 'evidence') {
      return { ...common, requirementId: absence.requirementId };
    }
    return {
      ...common,
      roleId: absence.roleId,
      roleKind: absence.roleKind,
      roleVersion: absence.roleVersion,
      sourceAssignmentId: absence.sourceAssignmentId,
    };
  });
}

function challengerQuestionCoverageTemplate(assignment) {
  return assignment.analysisProfile.questionIds.map((questionId) => ({
    questionId,
    disposition: 'not-applicable',
    answer: '',
    findingIds: [],
    alternativeIds: [],
    dissentIds: [],
    gapIds: [],
    justification: '',
  }));
}

function chairQuestionCoverageTemplate(assignment) {
  return assignment.analysisProfile.questionIds.map((questionId) => ({
    questionId,
    disposition: 'not-applicable',
    answer: '',
    decisionIds: [],
    findingIds: [],
    dissentIds: [],
    absenceIds: [],
    justification: '',
  }));
}

function advisorProfileAnalysis(assignment) {
  const profileId = assignment.analysisProfile.id;
  const shape = PROFILE_FIELDS[profileId];
  if (!shape) throw new TypeError(`Unsupported Advisor analysis profile ${profileId}.`);
  const analysis = {
    profileId,
    executiveQuestionAnswers: assignment.analysisProfile.questionIds.map((questionId) => ({
      questionId,
      answer: '',
      claimIds: [],
      measurementIds: [],
      riskIds: [],
      evidenceRefIds: [],
      absenceIds: [],
    })),
  };
  for (const field of shape.list) analysis[field] = [];
  for (const field of shape.nullable) analysis[field] = null;
  return analysis;
}

function advisorTemplate(assignment) {
  return {
    kind: 'operating-advisor-result',
    ...commonIdentity(assignment),
    outcome: assignment.inputAbsences.length > 0 ? 'partial' : 'recommendation',
    summary: '',
    analysisMarkdown: '',
    inputAbsenceIds: absenceIds(assignment),
    analysis: advisorProfileAnalysis(assignment),
    claims: [],
    measurements: [],
    risks: [],
    alternatives: [],
    gaps: evidenceGapTemplates(assignment),
    recommendation: null,
  };
}

function advisorDescriptors(inputArtifacts) {
  return inputArtifacts.filter(
    ({ schemaId, value }) =>
      schemaId === 'operating-advisor-result' && value.kind === 'operating-advisor-result',
  );
}

function challengerDescriptor(inputArtifacts) {
  return (
    inputArtifacts.find(
      ({ schemaId, value }) =>
        schemaId === 'operating-challenger-review' && value.kind === 'operating-challenger-review',
    ) ?? null
  );
}

function challengerTemplate(assignment, inputArtifacts) {
  const advisors = advisorDescriptors(inputArtifacts);
  return {
    kind: 'operating-challenger-review',
    ...commonIdentity(assignment),
    summary: '',
    analysisMarkdown: '',
    inputAbsenceIds: absenceIds(assignment),
    advisorArtifactIds: advisors.map(({ artifactId }) => artifactId),
    reviewedClaims: advisors.flatMap(({ artifactId, value }) =>
      (value.claims ?? []).map(({ localClaimId }) => ({
        advisorArtifactId: artifactId,
        localClaimId,
      })),
    ),
    questionCoverage: challengerQuestionCoverageTemplate(assignment),
    findings: [],
    missingAlternatives: [],
    dissent: [],
    gaps: challengerGapTemplates(assignment),
  };
}

function chairSourceDispositions(advisors, challenger) {
  const dispositions = [];
  for (const { artifactId, value } of advisors) {
    if (value.recommendation) {
      dispositions.push({
        sourceArtifactId: artifactId,
        sourceKind: 'advisor-recommendation',
        localSourceId: value.recommendation.localRecommendationId,
        sourceOutcome: null,
        disposition: 'deferred',
        localDecisionId: null,
        rationale: '',
      });
    } else if (value.outcome === 'partial' || value.outcome === 'quiet') {
      dispositions.push({
        sourceArtifactId: artifactId,
        sourceKind: 'advisor-outcome',
        localSourceId: `outcome:${value.assignmentId}:1`,
        sourceOutcome: value.outcome,
        disposition: 'noted',
        localDecisionId: null,
        rationale: '',
      });
    }
  }
  if (challenger) {
    for (const finding of challenger.value.findings ?? []) {
      dispositions.push({
        sourceArtifactId: challenger.artifactId,
        sourceKind: 'challenger-finding',
        localSourceId: finding.localFindingId,
        sourceOutcome: null,
        disposition: 'deferred',
        localDecisionId: null,
        rationale: '',
      });
    }
    for (const dissent of challenger.value.dissent ?? []) {
      dispositions.push({
        sourceArtifactId: challenger.artifactId,
        sourceKind: 'challenger-dissent',
        localSourceId: dissent.localDissentId,
        sourceOutcome: null,
        disposition: 'noted',
        localDecisionId: null,
        rationale: '',
      });
    }
  }
  return dispositions;
}

function chairTemplate(assignment, inputArtifacts) {
  const context = assignment.intelligenceContext;
  if (!context.inputBundle.sourceArtifactIds.includes(context.sourceArtifactId)) {
    throw new TypeError(
      'Chair sourceArtifactId is not present in the exact input-bundle provenance.',
    );
  }
  const advisors = advisorDescriptors(inputArtifacts);
  const challenger = challengerDescriptor(inputArtifacts);
  return {
    kind: 'operating-decision-ledger',
    ...commonIdentity(assignment),
    ledgerId: deriveOperatingChairLedgerIdV2(assignment.assignmentId),
    summary: '',
    advisorArtifactIds: advisors.map(({ artifactId }) => artifactId),
    challengerArtifactId: challenger?.artifactId ?? null,
    advisorAbsenceGaps: clone(assignment.inputAbsences.filter(({ kind }) => kind === 'role')),
    evidenceGaps: clone(assignment.inputAbsences.filter(({ kind }) => kind === 'evidence')),
    questionCoverage: chairQuestionCoverageTemplate(assignment),
    decisions: [],
    sourceDispositions: chairSourceDispositions(advisors, challenger),
    dissent: challenger
      ? (challenger.value.dissent ?? []).map((entry) => ({
          sourceArtifactId: challenger.artifactId,
          localDissentId: entry.localDissentId,
          findingIds: clone(entry.findingIds),
          statement: entry.statement,
          evidenceRefIds: clone(entry.evidenceRefIds),
          resolutionCondition: entry.resolutionCondition,
        }))
      : [],
    sourceArtifactId: context.sourceArtifactId,
  };
}

/**
 * Creates a deterministic, complete authoring skeleton. Empty required prose is
 * intentional: the untouched template must fail schema/semantic preflight.
 */
export function createOperatingResultTemplateV2({ assignment, inputArtifacts = [] }) {
  assertIntelligenceAssignment(assignment);
  const inputs = normalizedInputArtifacts(inputArtifacts);
  const value =
    assignment.assignmentKind === 'advisor'
      ? advisorTemplate(assignment)
      : assignment.assignmentKind === 'challenger'
        ? challengerTemplate(assignment, inputs)
        : chairTemplate(assignment, inputs);
  return deepFreeze(value);
}

/** Returns host-path-free root and transitive schemas for standalone preflight. */
export function operatingResultSchemaDependenciesV2(schemaId) {
  const files = RESULT_SCHEMA_FILES[schemaId];
  if (!files) throw new TypeError(`Unsupported operating result schema ${schemaId}.`);
  return deepFreeze(
    files.map((fileName) => {
      const schema = JSON.parse(
        readFileSync(resolve(packageRoot, 'schemas', 'v2.0.0', fileName), 'utf8'),
      );
      return { kind: basename(fileName, '.schema.json'), fileName, schema };
    }),
  );
}
