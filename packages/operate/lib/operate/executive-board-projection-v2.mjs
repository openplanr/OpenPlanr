import { OPERATE_CONTRACT_CATALOG_V2 } from '@openplanr/protocol/operate-contract-catalog-v2';
import { deriveOperatingIntelligenceAssignmentIdV2 } from './scheduler-v2.mjs';

const BUSINESS_BOARD_ROLE_ORDER = Object.freeze([
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'independent-challenge',
  'chair',
]);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function businessRoleCatalog(scope) {
  const domain = OPERATE_CONTRACT_CATALOG_V2.extensions.domains.find(
    ({ domainId, domainVersion }) =>
      domainId === scope.domainId && domainVersion === scope.domainVersion,
  );
  if (!domain) return new Map();
  return new Map(domain.roles.map((role) => [role.roleId, role]));
}

function seatAbsence({ assignmentAbsence, lensAbsence, omittedReason }) {
  if (assignmentAbsence) return Object.freeze({ kind: 'terminal', ...assignmentAbsence });
  if (lensAbsence) return Object.freeze({ kind: 'lens', ...lensAbsence });
  if (omittedReason) return Object.freeze({ kind: 'omitted', reason: omittedReason });
  return null;
}

function projectArtifact(indexes, artifactId, screen) {
  if (!artifactId) return null;
  const artifact = indexes.artifacts.get(artifactId);
  if (!artifact) return null;
  const access = screen.inspect([artifactId]);
  if (!access.visible) return null;
  return Object.freeze({
    artifactId: artifact.artifactId,
    rawHash: artifact.rawHash,
    canonicalHash: artifact.canonicalHash,
  });
}

function projectText(screen, value, sourceArtifactIds) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return screen.text(value, null, sourceArtifactIds);
}

function projectStructuredDissent(screen, entries, fallbackArtifactId) {
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const sourceArtifactId = entry.sourceArtifactId ?? fallbackArtifactId;
      if (typeof sourceArtifactId !== 'string') return null;
      const source = [sourceArtifactId];
      const statement = projectText(screen, entry.statement, source);
      const resolutionCondition = projectText(screen, entry.resolutionCondition, source);
      if (!statement || !resolutionCondition) return null;
      return Object.freeze({
        sourceArtifactId,
        localDissentId: entry.localDissentId,
        statement,
        resolutionCondition,
      });
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.sourceArtifactId.localeCompare(right.sourceArtifactId) ||
        left.localDissentId.localeCompare(right.localDissentId),
    );
}

function projectFinding(screen, finding) {
  const source = [finding.sourceArtifactId];
  const title = projectText(screen, finding.title, source);
  const statement = projectText(screen, finding.statement, source);
  const rationale = projectText(screen, finding.rationale, source);
  const correctionCondition = projectText(screen, finding.correctionCondition, source);
  if (!title || !statement || !rationale || !correctionCondition) return null;
  return Object.freeze({
    findingId: finding.findingId,
    sourceArtifactId: finding.sourceArtifactId,
    sourceAssignmentId: finding.sourceAssignmentId,
    sourceLocalFindingId: finding.sourceLocalFindingId,
    findingType: finding.findingType,
    severity: finding.severity,
    confidence: finding.confidence,
    targets: structuredClone(finding.targets),
    supportingEvidenceRefIds: [...finding.supportingEvidenceRefIds],
    contradictingEvidenceRefIds: [...finding.contradictingEvidenceRefIds],
    title,
    statement,
    rationale,
    correctionCondition,
    state: finding.state,
    ownerActorId: finding.ownerActorId,
    revisitAt: finding.revisitAt,
  });
}

function projectChallengerFindings(indexes, screen, challengerArtifactId, ledgerDissent) {
  if (!challengerArtifactId) return null;
  const findings = [...(indexes.findings?.values?.() ?? [])]
    .filter((finding) => finding.sourceArtifactId === challengerArtifactId)
    .map((finding) => projectFinding(screen, finding))
    .filter(Boolean)
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
  const dissent = projectStructuredDissent(
    screen,
    ledgerDissent.filter((entry) => entry?.sourceArtifactId === challengerArtifactId),
    challengerArtifactId,
  );
  const artifact = projectArtifact(indexes, challengerArtifactId, screen);
  if (!artifact && findings.length === 0 && dissent.length === 0) return null;
  return Object.freeze({
    artifact,
    findings,
    dissent,
  });
}

function projectAlternativeDisposition(screen, entry, source) {
  return Object.freeze({
    sourceArtifactId: entry.sourceArtifactId,
    localAlternativeId: entry.localAlternativeId,
    title: projectText(screen, entry.title, source),
    disposition: entry.disposition,
    rationale: projectText(screen, entry.rationale, source),
  });
}

function projectActionHypothesis(screen, hypothesis, source) {
  return Object.freeze({
    localActionHypothesisId: hypothesis.localActionHypothesisId,
    title: projectText(screen, hypothesis.title, source),
    objectiveId: hypothesis.objectiveId,
    ownerActorId: hypothesis.ownerActorId,
    accountabilityDisposition: hypothesis.accountabilityDisposition,
    expectedResult: projectText(screen, hypothesis.expectedResult, source),
    metricId: hypothesis.metricId,
    baseline: hypothesis.baseline,
    target: hypothesis.target,
    verificationWindow: projectText(screen, hypothesis.verificationWindow, source),
    verificationMethod: projectText(screen, hypothesis.verificationMethod, source),
    sourceClaimRefs: structuredClone(hypothesis.sourceClaimRefs),
    sourceFindingIds: [...hypothesis.sourceFindingIds],
    dependsOnActionHypothesisIds: [...hypothesis.dependsOnActionHypothesisIds],
  });
}

function projectRoleGap(absence) {
  return Object.freeze({
    absenceId: absence.absenceId ?? null,
    kind: 'role',
    roleId: absence.roleId,
    roleKind: absence.roleKind,
    roleVersion: absence.roleVersion ?? null,
    absenceCode: absence.absenceCode,
    reason: absence.reason,
    recoveryDisposition: absence.recoveryDisposition ?? null,
    sourceAssignmentId: absence.sourceAssignmentId ?? null,
    sourceEventId: absence.sourceEventId ?? null,
  });
}

function projectEvidenceGap(absence) {
  return Object.freeze({
    absenceId: absence.absenceId,
    kind: 'evidence',
    requirementId: absence.requirementId,
    evidenceKinds: [...absence.evidenceKinds],
    sourceContracts: absence.sourceContracts.map((contract) => ({ ...contract })),
    absenceCode: absence.absenceCode,
    reason: absence.reason,
    recoveryDisposition: absence.recoveryDisposition,
    sourceEvidenceRefIds: [...absence.sourceEvidenceRefIds],
    sourceEventIds: [...absence.sourceEventIds],
  });
}

function projectChairSynthesis(ledger, chairArtifactId, screen, lensAbsences) {
  if (!ledger || !chairArtifactId) return null;
  const source = [chairArtifactId];
  const gapByIdentity = new Map(
    lensAbsences.map((absence) => [`role:${absence.roleId}`, projectRoleGap(absence)]),
  );
  for (const gap of ledger.advisorAbsenceGaps ?? []) {
    gapByIdentity.set(`role:${gap.roleId}`, projectRoleGap(gap));
  }
  for (const gap of ledger.evidenceGaps ?? []) {
    gapByIdentity.set(`evidence:${gap.absenceId}`, projectEvidenceGap(gap));
  }
  return Object.freeze({
    artifact: Object.freeze({
      artifactId: chairArtifactId,
      intelligencePlanId: ledger.intelligencePlanId,
      advisorArtifactIds: [...ledger.advisorArtifactIds].sort(),
      challengerArtifactId: ledger.challengerArtifactId,
    }),
    decisions: ledger.decisions.map((decision) =>
      Object.freeze({
        localDecisionId: decision.localDecisionId,
        title: projectText(screen, decision.title, source),
        question: projectText(screen, decision.question, source),
        outcome: projectText(screen, decision.outcome, source),
        rationale: projectText(screen, decision.rationale, source),
        sourceClaimRefs: structuredClone(decision.sourceClaimRefs),
        sourceRecommendationRefs: structuredClone(decision.sourceRecommendationRefs),
        challengerFindingIds: [...decision.challengerFindingIds],
        evidenceRefIds: [...decision.evidenceRefIds],
        confidence: decision.confidence,
        assumptionIds: [...decision.assumptionIds],
        expectedUpside: projectText(screen, decision.upside, source),
        expectedDownside: projectText(screen, decision.downside, source),
        uncertainty: projectText(screen, decision.uncertainty, source),
        reversibility: projectText(screen, decision.reversibility, source),
        ownerActorId: decision.ownerActorId,
        revisitConditions: decision.revisitConditions
          .map((entry) => projectText(screen, entry, source))
          .filter(Boolean),
        dissentIds: [...decision.dissentIds],
        alternativeDispositions: decision.alternativeDispositions.map((entry) =>
          projectAlternativeDisposition(screen, entry, source),
        ),
        actionHypotheses: decision.actionHypotheses.map((hypothesis) =>
          projectActionHypothesis(screen, hypothesis, source),
        ),
      }),
    ),
    dissent: projectStructuredDissent(screen, ledger.dissent, chairArtifactId),
    unresolvedGaps: [...gapByIdentity.values()].sort((left, right) =>
      `${left.kind}:${left.absenceId ?? left.roleId}`.localeCompare(
        `${right.kind}:${right.absenceId ?? right.roleId}`,
      ),
    ),
  });
}

export function buildExecutiveBoardForCycle({
  indexes,
  cycle,
  scope,
  screen,
  intelligencePlan,
  lensAbsences,
  assignmentAbsence,
  boardRecord = null,
  traceMatrix = null,
}) {
  if (scope.domainId !== 'business' || !intelligencePlan) return null;

  const catalog = businessRoleCatalog(scope);
  const selectedByRoleId = new Map(
    intelligencePlan.selectedRoles.map((role) => [role.roleId, role]),
  );
  const omittedByRoleId = new Map(intelligencePlan.omittedRoles.map((role) => [role.roleId, role]));
  const lensByRoleId = new Map(lensAbsences.map((absence) => [absence.roleId, absence]));
  const ledger =
    [...indexes.decisionLedgers.values()].find(
      ({ intelligencePlanId }) => intelligencePlanId === intelligencePlan.planId,
    ) ?? null;

  const seats = BUSINESS_BOARD_ROLE_ORDER.flatMap((roleId) => {
    const catalogRole = catalog.get(roleId);
    if (!catalogRole) return [];
    const selected = selectedByRoleId.get(roleId);
    const omitted = omittedByRoleId.get(roleId);
    if (!selected && !omitted) return [];

    if (omitted) {
      return [
        Object.freeze({
          roleId,
          label: catalogRole.label,
          roleKind: catalogRole.roleKind,
          roleVersion: omitted.roleVersion,
          assignmentId: null,
          assignmentState: null,
          artifact: null,
          absence: seatAbsence({
            lensAbsence: lensByRoleId.get(roleId),
            omittedReason: omitted.reason,
          }),
        }),
      ];
    }

    const assignmentId = deriveOperatingIntelligenceAssignmentIdV2(
      intelligencePlan.planId,
      roleId,
      selected.roleVersion,
    );
    const assignment = indexes.assignments.get(assignmentId);
    const artifactId =
      [...indexes.artifacts.values()]
        .filter((entry) => entry.assignmentId === assignmentId)
        .map(({ artifactId: id }) => id)
        .sort()[0] ?? null;

    return [
      Object.freeze({
        roleId,
        label: catalogRole.label,
        roleKind: catalogRole.roleKind,
        roleVersion: selected.roleVersion,
        assignmentId,
        assignmentState: assignment?.state ?? null,
        artifact: projectArtifact(indexes, artifactId, screen),
        absence: seatAbsence({
          assignmentAbsence: assignment ? assignmentAbsence(assignment) : null,
          lensAbsence: lensByRoleId.get(roleId),
        }),
      }),
    ];
  });

  const challengerArtifactId =
    seats.find(({ roleId }) => roleId === 'independent-challenge')?.artifact?.artifactId ??
    ledger?.challengerArtifactId ??
    null;
  const chairArtifactId =
    seats.find(({ roleId }) => roleId === 'chair')?.artifact?.artifactId ?? null;

  const projection = {
    cycleId: cycle.cycleId,
    planId: intelligencePlan.planId,
    seats,
    challengerFindings: projectChallengerFindings(
      indexes,
      screen,
      challengerArtifactId,
      ledger?.dissent ?? [],
    ),
    chairSynthesis: projectChairSynthesis(ledger, chairArtifactId, screen, lensAbsences),
  };
  if (boardRecord !== null) {
    const seatByRoleId = new Map(seats.map((seat) => [seat.roleId, seat]));
    if (
      boardRecord.cycleId !== cycle.cycleId ||
      boardRecord.planId !== intelligencePlan.planId ||
      boardRecord.ledgerId !== ledger?.ledgerId ||
      boardRecord.traceMatrix?.matrixHash === undefined ||
      traceMatrix?.cycleId !== cycle.cycleId ||
      boardRecord.seatBindings.length !== seats.length ||
      boardRecord.seatBindings.some((binding) => {
        const seat = seatByRoleId.get(binding.roleId);
        return (
          !seat ||
          seat.roleKind !== binding.roleKind ||
          seat.roleVersion !== binding.roleVersion ||
          seat.assignmentId !== binding.assignmentId
        );
      })
    ) {
      throw new Error(
        'Executive Board materialization does not match its current role, ledger, Cycle, or trace source.',
      );
    }
    Object.assign(projection, {
      boardId: boardRecord.boardId,
      reviewId: boardRecord.reviewId,
      projectionMode: boardRecord.projectionMode,
      authoritativeForMutation: boardRecord.authoritativeForMutation,
      materializedEventId: boardRecord.materializedEventId,
      sourceEventHead: structuredClone(boardRecord.sourceEventHead),
      sourceBoardHash: boardRecord.boardHash,
      semanticHash: boardRecord.semanticHash,
      traceMatrix: structuredClone(traceMatrix),
    });
  }
  return freeze(projection);
}
