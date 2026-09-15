import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from 'planr-pipeline/operate/extensions-v2';
import {
  createOperatingResultTemplateV2,
  type OperatingResultInputArtifactV2,
} from 'planr-pipeline/operate/result-packet-v2';
import {
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRoleLocalClaimIdV2,
} from 'planr-pipeline/operate/runtime-v2';
import type { OperatingIntelligenceAssignmentV2 } from 'planr-pipeline/protocol';

type RecordValue = Record<string, unknown>;
type Assignment = { assignmentId: string; roleId: string };
type OperateClient = {
  dispatch: (request: {
    operation: string;
    request: RecordValue;
  }) => Promise<{ ok: boolean; data?: RecordValue; allowedActions?: RecordValue[] }>;
};

export type AssignmentClaimV2 = {
  submissionId: string;
  capabilities: string[];
  assignment: RecordValue & {
    assignmentId: string;
    roleId: string;
    inputArtifactIds: string[];
    inputAbsences: RecordValue[];
    intelligenceContext: RecordValue;
  };
  issuedArtifacts: IssuedAssignmentArtifactV2[];
};

export type IssuedAssignmentArtifactV2 = Readonly<{
  metadata: RecordValue;
  body: RecordValue;
}>;

export const EXECUTIVE_ADVISOR_ROLE_IDS = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
] as const;

export const CHALLENGER_ROLE_ID = 'independent-challenge';
export const CHAIR_ROLE_ID = 'chair';

export { deriveOperatingChairLedgerIdV2, deriveOperatingRoleLocalClaimIdV2 };

export async function readExactOwnerReviewForFixture(
  client: OperateClient,
  cycleId: string,
  actor: RecordValue,
): Promise<{
  ok: boolean;
  data?: RecordValue;
  allowedActions: RecordValue[];
  readRequest: RecordValue;
}> {
  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor, actionBinding: { cycleId, actorId: actor.actorId } },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  const readAction = (experience.allowedActions ?? []).find(
    (entry) => entry.tool === 'operate.review.get',
  );
  if (!readAction) throw new Error('Runtime did not issue the exact owner Review read action.');
  const review = await client.dispatch({
    operation: 'operate.review.get',
    request: readAction.arguments as RecordValue,
  });
  if (!review.ok) throw new Error(JSON.stringify(review));
  return {
    ...review,
    allowedActions: review.allowedActions ?? [],
    readRequest: readAction.arguments as RecordValue,
  };
}

export async function approveExactOwnerReviewForFixture(
  client: OperateClient,
  cycleId: string,
  actor: RecordValue,
): Promise<{ ok: boolean; data?: RecordValue; allowedActions?: RecordValue[] }> {
  const review = await readExactOwnerReviewForFixture(client, cycleId, actor);
  const approval = review.allowedActions.find(
    (entry) =>
      entry.tool === 'operate.review.submit' &&
      (entry.arguments as RecordValue | undefined)?.disposition === 'approved',
  );
  if (!approval) throw new Error('Review did not issue its exact approval choice.');
  const submitted = await client.dispatch({
    operation: 'operate.review.submit',
    request: approval.arguments as RecordValue,
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  return submitted;
}

/** Adds one truthful allowlisted repository-architecture source before Cycle start. */
export async function writeScreenedEvidenceFixture(projectDir: string): Promise<void> {
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify({ name: 'operate-fixture', private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
}

export function isExecutiveAdvisorRole(roleId: string): boolean {
  return (EXECUTIVE_ADVISOR_ROLE_IDS as readonly string[]).includes(roleId);
}

export function collectAdvisorArtifactIds(
  dependencyArtifacts: IssuedAssignmentArtifactV2[],
): string[] {
  return dependencyArtifacts
    .filter((entry) => {
      const roleId = (entry.metadata.producer as RecordValue | undefined)?.roleId;
      return typeof roleId === 'string' && isExecutiveAdvisorRole(roleId);
    })
    .map((entry) => String(entry.metadata.artifactId))
    .sort((left, right) => left.localeCompare(right));
}

export function artifactIdForRole(
  dependencyArtifacts: IssuedAssignmentArtifactV2[],
  roleId: string,
): string | undefined {
  const match = dependencyArtifacts.find(
    (entry) => (entry.metadata.producer as RecordValue | undefined)?.roleId === roleId,
  );
  return match ? String(match.metadata.artifactId) : undefined;
}

export function issuedBodiesOfKind(
  dependencyArtifacts: IssuedAssignmentArtifactV2[],
  kind: string,
): IssuedAssignmentArtifactV2[] {
  return dependencyArtifacts.filter((entry) => entry.body.kind === kind);
}

function resultInputArtifacts(claim: AssignmentClaimV2): OperatingResultInputArtifactV2[] {
  const descriptors = claim.issuedArtifacts.map(({ metadata, body }) => ({
    artifactId: String(metadata.artifactId),
    schemaId: String(metadata.schemaId),
    value: body,
  }));
  const issuedChallenger = descriptors.find(
    ({ schemaId }) => schemaId === 'operating-challenger-review',
  );
  const advisorArtifactOrder = issuedChallenger
    ? ((issuedChallenger.value.advisorArtifactIds as string[] | undefined) ?? [])
    : [];
  const context = claim.assignment.intelligenceContext;
  const domain = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.domains.find(
    ({ domainId, domainVersion }) =>
      domainId === context.domainId && domainVersion === context.domainVersion,
  );
  const roleOrder = new Map<string, number>(
    (domain?.roles ?? [])
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }, index) => [roleId, index]),
  );
  const advisors = descriptors
    .filter(({ schemaId }) => schemaId === 'operating-advisor-result')
    .sort((left, right) => {
      if (advisorArtifactOrder.length > 0) {
        return (
          advisorArtifactOrder.indexOf(left.artifactId) -
          advisorArtifactOrder.indexOf(right.artifactId)
        );
      }
      return (
        (roleOrder.get(String(left.value.roleId)) ?? Number.MAX_SAFE_INTEGER) -
        (roleOrder.get(String(right.value.roleId)) ?? Number.MAX_SAFE_INTEGER)
      );
    });
  return [
    ...advisors,
    ...descriptors.filter(({ schemaId }) => schemaId !== 'operating-advisor-result'),
  ];
}

function exactAssignment(claim: AssignmentClaimV2): OperatingIntelligenceAssignmentV2 {
  return claim.assignment as unknown as OperatingIntelligenceAssignmentV2;
}

function issuedEvidenceRefIds(claim: AssignmentClaimV2): string[] {
  const inputBundle = claim.assignment.intelligenceContext.inputBundle as RecordValue;
  return ((inputBundle.issuedEvidence as RecordValue[] | undefined) ?? []).map((entry) =>
    String(entry.evidenceRefId),
  );
}

/** Authors the frozen result envelope while preserving every Assignment-owned binding. */
export function authoredAdvisorResultForFixture(
  claim: AssignmentClaimV2,
  recommendation: boolean,
): RecordValue {
  const value = structuredClone(
    createOperatingResultTemplateV2({ assignment: exactAssignment(claim) }),
  ) as unknown as RecordValue;
  const evidenceRefIds = issuedEvidenceRefIds(claim);
  const absenceIds = claim.assignment.inputAbsences.map((absence) => String(absence.absenceId));
  value.summary = recommendation
    ? 'A bounded measurement should precede any material allocation change.'
    : 'No additional primary recommendation is justified from this role evidence.';
  value.analysisMarkdown =
    'This result preserves exact evidence custody and states its uncertainty explicitly.';
  value.gaps = ((value.gaps as RecordValue[] | undefined) ?? []).map((gap) => ({
    ...gap,
    impact: 'The missing evidence limits confidence in this professional lens.',
    recoveryPath: 'Issue a current authorized Evidence Artifact for this requirement.',
  }));
  const analysis = value.analysis as RecordValue;
  for (const answer of analysis.executiveQuestionAnswers as RecordValue[]) {
    answer.answer = recommendation
      ? 'The evidence supports a reversible measurement-first direction.'
      : 'The evidence does not support a distinct material direction change.';
    answer.evidenceRefIds = [...evidenceRefIds];
    answer.absenceIds = [...absenceIds];
  }
  if (!recommendation) {
    value.outcome = absenceIds.length > 0 ? 'partial' : 'quiet';
    value.recommendation = null;
    return value;
  }
  if (evidenceRefIds.length === 0) {
    throw new Error('recommendation fixture requires one exact issued EvidenceRef');
  }
  const assignmentId = claim.assignment.assignmentId;
  const claimId = `claim:${assignmentId}:1`;
  const riskId = `risk:${assignmentId}:1`;
  const alternativeId = `alternative:${assignmentId}:1`;
  const recommendationId = `recommendation:${assignmentId}:1`;
  value.outcome = 'recommendation';
  value.claims = [
    {
      localClaimId: claimId,
      statement: 'A fresh measurement reduces the downside of changing allocation prematurely.',
      epistemicStatus: 'probable',
      confidence: 0.68,
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      assumptionIds: [],
      changeCondition: 'A current accepted measurement contradicts the observed direction.',
    },
  ];
  value.risks = [
    {
      localRiskId: riskId,
      title: 'Premature allocation change',
      statement: 'Changing allocation before measuring can amplify an unpriced downside.',
      likelihood: 0.5,
      impact: 'high',
      exposure: 'The operating scope may spend the next window on the wrong constraint.',
      exposedSurfaces: ['Allocation planning'],
      claimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      mitigation: 'Run one bounded measurement first.',
      reversibility: 'The measurement is reversible before an allocation change.',
    },
  ];
  value.alternatives = [
    {
      localAlternativeId: alternativeId,
      title: 'Hold current allocation',
      description: 'Keep allocation unchanged through the next measurement window.',
      supportingClaimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Preserves reversibility but defers another learning loop.'],
      costOfDelay: 'One observation window of delayed allocation learning.',
      reversibility: 'Fully reversible after the observation window.',
    },
  ];
  value.recommendation = {
    localRecommendationId: recommendationId,
    title: 'Measure before reallocating',
    proposal: 'Run one bounded measurement before changing allocation.',
    rationaleClaimIds: [claimId],
    alternativeIds: [alternativeId],
    riskIds: [riskId],
    confidence: 0.68,
    expectedUpside: 'Narrows the most consequential uncertainty before committing resources.',
    expectedDownside: 'Defers another learning loop by one observation window.',
    uncertainty: 'The current evidence remains limited.',
    reversibility: 'The measurement can stop without an allocation commitment.',
    successMeasurementIds: [],
    revisitConditions: ['A current accepted measurement materially changes the direction.'],
  };
  for (const answer of analysis.executiveQuestionAnswers as RecordValue[]) {
    answer.claimIds = [claimId];
    answer.riskIds = [riskId];
  }
  return value;
}

export async function submitAuthoredAdvisorAssignments(
  client: OperateClient,
  cycleId: string,
  claimAndSubmit: (
    assignment: Assignment,
    body: (claim: RecordValue) => RecordValue,
  ) => Promise<unknown>,
): Promise<void> {
  let recommendationAuthored = false;
  await submitAllAvailableAdvisorAssignments(client, cycleId, claimAndSubmit, (rawClaim) => {
    const claim = rawClaim as unknown as AssignmentClaimV2;
    const recommendation = !recommendationAuthored && issuedEvidenceRefIds(claim).length > 0;
    recommendationAuthored ||= recommendation;
    return authoredAdvisorResultForFixture(claim, recommendation);
  });
  if (!recommendationAuthored) {
    throw new Error('board fixture requires one Advisor with exact issued evidence');
  }
}

export function authoredChallengerResultForFixture(claim: AssignmentClaimV2): RecordValue {
  const inputs = resultInputArtifacts(claim);
  const advisor = inputs.find(
    ({ schemaId, value }) =>
      schemaId === 'operating-advisor-result' && value.recommendation !== null,
  );
  if (!advisor) throw new Error('Challenger fixture requires one issued Advisor recommendation');
  const advisorOutput = advisor.value as RecordValue;
  const advisorClaim = (advisorOutput.claims as RecordValue[])[0];
  const advisorRisk = (advisorOutput.risks as RecordValue[])[0];
  const recommendation = advisorOutput.recommendation as RecordValue;
  const value = structuredClone(
    createOperatingResultTemplateV2({ assignment: exactAssignment(claim), inputArtifacts: inputs }),
  ) as unknown as RecordValue;
  const findingId = `finding:${claim.assignment.assignmentId}:1`;
  const dissentId = `dissent:${claim.assignment.assignmentId}:1`;
  const evidenceRefIds = [...(advisorClaim.supportingEvidenceRefIds as string[])];
  const target = {
    advisorArtifactId: advisor.artifactId,
    analysisIds: [],
    claimIds: [String(advisorClaim.localClaimId)],
    measurementIds: [],
    riskIds: [String(advisorRisk.localRiskId)],
    recommendationIds: [String(recommendation.localRecommendationId)],
  };
  value.summary = 'The recommendation is reversible, but its downside must remain explicit.';
  value.analysisMarkdown =
    'The challenge targets the exact Advisor claim, risk, and recommendation.';
  value.findings = [
    {
      localFindingId: findingId,
      title: 'Unpriced delay downside',
      statement:
        'The recommendation does not fully price the opportunity cost of delaying another learning loop.',
      type: 'unpriced-downside',
      severity: 'medium',
      confidence: 0.62,
      targets: [target],
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      rationale: 'The source claim supports measurement but does not quantify delayed learning.',
      correctionCondition: 'Price the delayed learning cost in the Chair decision.',
    },
  ];
  value.missingAlternatives = [
    {
      localAlternativeId: `alternative:${claim.assignment.assignmentId}:1`,
      title: 'Parallel bounded measurement',
      description: 'Measure the constraint while preserving a small parallel learning lane.',
      targets: [target],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Costs more capacity but preserves both learning loops.'],
    },
  ];
  value.dissent = [
    {
      localDissentId: dissentId,
      findingIds: [findingId],
      statement:
        'Do not approve a measurement-only path unless the parallel-learning delay is bounded.',
      evidenceRefIds: [...evidenceRefIds],
      resolutionCondition: 'Bound and price the delayed learning in the accepted decision.',
    },
  ];
  value.questionCoverage = (value.questionCoverage as RecordValue[]).map((entry) => ({
    ...entry,
    disposition: 'answered',
    answer: `The exact Challenger Finding, alternative, and dissent address ${entry.questionId}.`,
    findingIds: [findingId],
    alternativeIds: [`alternative:${claim.assignment.assignmentId}:1`],
    dissentIds: [dissentId],
    gapIds: [],
    justification: null,
  }));
  value.gaps = ((value.gaps as RecordValue[] | undefined) ?? []).map((gap) => ({
    ...gap,
    impact: 'The missing input limits challenge coverage.',
    recoveryPath: 'Recover the exact missing role or Evidence Artifact and rerun challenge.',
  }));
  return value;
}

export type AuthoredChairOptions = Readonly<{
  title?: string;
  question?: string;
  outcome?: string;
  rationale?: string;
  actionHypothesis?: Readonly<{
    title: string;
    objectiveId: string;
    metricId: string;
    expectedResult?: string;
    verificationWindow?: string;
    verificationMethod?: string;
  }>;
}>;

export function authoredChairResultForFixture(
  claim: AssignmentClaimV2,
  options: AuthoredChairOptions = {},
): RecordValue {
  const inputs = resultInputArtifacts(claim);
  const advisor = inputs.find(
    ({ schemaId, value }) =>
      schemaId === 'operating-advisor-result' && value.recommendation !== null,
  );
  const challenger = inputs.find(({ schemaId }) => schemaId === 'operating-challenger-review');
  if (!advisor || !challenger) {
    throw new Error('Chair fixture requires issued Advisor recommendation and Challenger review');
  }
  const advisorOutput = advisor.value as RecordValue;
  const challengerOutput = challenger.value as RecordValue;
  const advisorClaim = (advisorOutput.claims as RecordValue[])[0];
  const recommendation = advisorOutput.recommendation as RecordValue;
  const finding = (challengerOutput.findings as RecordValue[])[0];
  const dissent = (challengerOutput.dissent as RecordValue[])[0];
  const alternative = (advisorOutput.alternatives as RecordValue[])[0];
  const evidenceRefIds = [...(advisorClaim.supportingEvidenceRefIds as string[])];
  if (evidenceRefIds.length === 0)
    throw new Error('Chair fixture requires exact relevant evidence');
  const value = structuredClone(
    createOperatingResultTemplateV2({ assignment: exactAssignment(claim), inputArtifacts: inputs }),
  ) as unknown as RecordValue;
  const decisionId = `decision:${claim.assignment.assignmentId}:1`;
  const actionHypotheses = options.actionHypothesis
    ? [
        {
          localActionHypothesisId: `action-hypothesis:${claim.assignment.assignmentId}:1`,
          title: options.actionHypothesis.title,
          objectiveId: options.actionHypothesis.objectiveId,
          ownerActorId: claim.assignment.intelligenceContext.decisionOwnerActorId,
          accountabilityDisposition: null,
          expectedResult:
            options.actionHypothesis.expectedResult ??
            'An accepted observation reaches the target.',
          metricId: options.actionHypothesis.metricId,
          baseline: 0.5,
          target: 1,
          verificationWindow: options.actionHypothesis.verificationWindow ?? 'next operating cycle',
          verificationMethod:
            options.actionHypothesis.verificationMethod ??
            'Compare the accepted observation with the target.',
          sourceClaimRefs: [
            {
              advisorArtifactId: advisor.artifactId,
              localClaimId: advisorClaim.localClaimId,
            },
          ],
          sourceFindingIds: [String(finding.localFindingId)],
          dependsOnActionHypothesisIds: [],
        },
      ]
    : [];
  value.summary = 'Approve one bounded measurement while explicitly limiting delayed learning.';
  value.decisions = [
    {
      localDecisionId: decisionId,
      title: options.title ?? 'Run a bounded measurement',
      question: options.question ?? 'How should the operating scope reduce uncertainty?',
      outcome:
        options.outcome ?? 'Run one bounded measurement and cap delayed learning to one window.',
      rationale:
        options.rationale ??
        'The Advisor claim supports a reversible measurement and the Challenger prices its downside.',
      sourceClaimRefs: [
        { advisorArtifactId: advisor.artifactId, localClaimId: advisorClaim.localClaimId },
      ],
      sourceRecommendationRefs: [
        {
          advisorArtifactId: advisor.artifactId,
          localRecommendationId: recommendation.localRecommendationId,
        },
      ],
      challengerFindingIds: [finding.localFindingId],
      evidenceRefIds,
      alternativeDispositions: [
        {
          sourceArtifactId: advisor.artifactId,
          localAlternativeId: alternative.localAlternativeId,
          title: alternative.title,
          disposition: 'deferred',
          rationale: 'The bounded measurement is more informative than holding all allocation.',
        },
      ],
      confidence: 0.66,
      assumptionIds: [],
      upside: 'Narrows uncertainty before a resource commitment.',
      downside: 'Defers another learning loop for one bounded window.',
      uncertainty: 'The response remains uncertain until the next accepted measurement.',
      reversibility: 'The measurement can stop without committing the allocation change.',
      ownerActorId: claim.assignment.intelligenceContext.decisionOwnerActorId,
      revisitConditions: ['The next accepted measurement materially changes the direction.'],
      dissentIds: [dissent.localDissentId],
      actionHypotheses,
    },
  ];
  value.sourceDispositions = (value.sourceDispositions as RecordValue[]).map((disposition) => {
    const relevant =
      disposition.sourceKind === 'advisor-recommendation' ||
      disposition.sourceKind === 'challenger-finding' ||
      disposition.sourceKind === 'challenger-dissent';
    return {
      ...disposition,
      disposition: relevant ? 'accepted' : 'noted',
      localDecisionId: relevant ? decisionId : null,
      rationale: relevant
        ? 'The Decision cites this exact source item.'
        : 'The quiet Advisor outcome is retained without inventing a recommendation.',
    };
  });
  value.questionCoverage = (value.questionCoverage as RecordValue[]).map((entry) => ({
    ...entry,
    disposition: 'answered',
    answer: `The accepted Decision and exact Challenger sources address ${entry.questionId}.`,
    decisionIds: [decisionId],
    findingIds: [finding.localFindingId],
    dissentIds: [dissent.localDissentId],
    absenceIds: [],
    justification: null,
  }));
  return value;
}

/**
 * Reads only the Artifact identities issued in the now-running Assignment.
 * This is the same closed claim -> issued-input-read boundary used by every
 * generated executive executor; it never recreates the removed private claim
 * context or accepts a caller-selected Artifact expansion.
 */
export async function readIssuedAssignmentClaim(
  client: OperateClient,
  claimedData: RecordValue,
  actor: RecordValue,
): Promise<AssignmentClaimV2> {
  const assignment = claimedData.assignment as AssignmentClaimV2['assignment'];
  const context = assignment.intelligenceContext;
  const scope = {
    scopeId: String(context.scopeId),
    domainId: String(context.domainId),
    domainVersion: String(context.domainVersion),
  };
  const issuedArtifacts: IssuedAssignmentArtifactV2[] = [];
  for (const artifactId of assignment.inputArtifactIds) {
    const result = await client.dispatch({
      operation: 'operate.artifact.get',
      request: {
        artifactId,
        representation: 'raw',
        actor,
        scope,
        assignmentId: assignment.assignmentId,
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const artifact = result.data as {
      metadata: RecordValue;
      representation: 'raw';
      contentBase64: string;
    };
    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(artifact.contentBase64, 'base64').toString('utf8'));
    } catch {
      throw new Error(`issued Artifact ${artifactId} is not a JSON DTO`);
    }
    if (body === null || Array.isArray(body) || typeof body !== 'object') {
      throw new Error(`issued Artifact ${artifactId} is not a closed object DTO`);
    }
    issuedArtifacts.push({ metadata: artifact.metadata, body: body as RecordValue });
  }
  return {
    submissionId: String(claimedData.submissionId),
    capabilities: [...(claimedData.capabilities as string[])],
    assignment,
    issuedArtifacts,
  };
}

/**
 * Test-fixture escape hatch for legacy Action/Planning integration coverage.
 * Production executors must never call this: the honest seven-seat flow stops
 * at Decisions-only when these identities were not issued in Assignment input.
 */
export async function readPersistedActionSeedForFixture(projectDir: string): Promise<{
  objectiveId: string;
  metricId: string;
}> {
  const [{ createOperateComposition }, { createOperateStore }] = await Promise.all([
    import('../../src/services/operate/composition.js'),
    import('../../src/services/operate/store.js'),
  ]);
  const composition = await createOperateComposition();
  const runtime = await createOperateStore(projectDir).load(({ baseState, events, artifacts }) =>
    composition.replay(baseState, events, artifacts),
  );
  if (!runtime) throw new Error('missing persisted Operate fixture runtime');
  const state = runtime.state as RecordValue;
  const operatingModel = (state.operatingModelStates as RecordValue[] | undefined)?.[0];
  const objective =
    (state.objectives as RecordValue[] | undefined)?.[0] ??
    (operatingModel?.objectives as RecordValue[] | undefined)?.[0];
  const metric =
    (state.metrics as RecordValue[] | undefined)?.[0] ??
    (operatingModel?.metrics as RecordValue[] | undefined)?.[0];
  if (!objective || !metric) throw new Error('missing persisted Action seed fixture');
  return {
    objectiveId: String(objective.objectiveId),
    metricId: String(metric.metricId),
  };
}

export async function submitAllAvailableAdvisorAssignments(
  client: OperateClient,
  cycleId: string,
  claimAndSubmit: (
    assignment: Assignment,
    body: (claim: RecordValue) => RecordValue,
  ) => Promise<unknown>,
  buildBody: (claim: RecordValue, roleId: string) => RecordValue,
): Promise<void> {
  while (true) {
    const current = await client.dispatch({
      operation: 'operate.cycle.get',
      request: { cycleId },
    });
    if (!current.ok) throw new Error(JSON.stringify(current));
    const assignments = (current.data as { availableAssignments: Assignment[] })
      .availableAssignments;
    const advisors = assignments.filter(({ roleId }) => isExecutiveAdvisorRole(roleId));
    if (advisors.length === 0) return;
    for (const assignment of advisors) {
      await claimAndSubmit(assignment, (claim) => buildBody(claim, assignment.roleId));
    }
  }
}

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
