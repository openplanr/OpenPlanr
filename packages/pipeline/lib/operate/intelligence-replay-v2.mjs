import { sha256Jcs } from '../protocol/canonical-json.mjs';
import {
  resolveOperatingAssignmentInputArtifactIdsV2,
  resolveOperatingAssignmentInputAbsencesV2,
} from './scheduler-v2.mjs';

const clone = (value) => structuredClone(value);
const sortedAssignmentIds = (values) => [...values].sort();

/**
 * Private intelligence replay service. It compares immutable Assignment intent
 * and recomputes released custody exclusively from durable dependency state.
 */
export function createOperatingIntelligenceReplayServiceV2({ runtimeError }) {
  if (typeof runtimeError !== 'function') {
    throw new TypeError('runtimeError must be a function.');
  }

  function intelligenceAssignmentCreationEventId(planId, assignmentId) {
    return `evt_intelligence_${sha256Jcs({ planId, assignmentId }).slice('sha256:'.length, 31)}`;
  }

  function immutableAssignmentIntent(assignment) {
    return {
      kind: assignment.kind,
      schemaVersion: assignment.schemaVersion,
      protocolVersion: assignment.protocolVersion,
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      assignmentKind: assignment.assignmentKind,
      roleId: assignment.roleId,
      roleVersion: assignment.roleVersion ?? null,
      analysisRubric: assignment.analysisRubric ?? null,
      mandate: assignment.mandate ?? null,
      analysisProfile: assignment.analysisProfile ?? null,
      evidenceRequirements: assignment.evidenceRequirements ?? null,
      resultRequirements: assignment.resultRequirements ?? null,
      objective: assignment.objective,
      dependsOn: sortedAssignmentIds(assignment.dependsOn),
      dependencyPolicy: assignment.dependencyPolicy,
      inputArtifactIds: assignment.inputArtifactIds,
      inputAbsences: assignment.inputAbsences,
      intelligenceContext: assignment.intelligenceContext ?? null,
      outputContract: assignment.outputContract,
      capabilityGrantId: assignment.capabilityGrantId,
      attemptPolicy: {
        maxAttempts: assignment.attemptPolicy.maxAttempts,
        timeoutMs: assignment.attemptPolicy.timeoutMs,
      },
      createdAt: assignment.createdAt,
    };
  }

  function expectedIntelligenceAssignmentCustody(index, plan, intent, persisted) {
    if (persisted.availableAt === null) {
      return { inputArtifactIds: intent.inputArtifactIds, inputAbsences: intent.inputAbsences };
    }
    const proofs = [...intent.dependsOn].sort().map((dependencyId) => {
      const dependency = index.assignments.get(dependencyId);
      if (!dependency) {
        throw runtimeError('STATE_TRANSITION_INVALID', 'Intelligence replay has a foreign or missing dependency.', {
          assignmentId: intent.assignmentId,
          dependencyId,
        });
      }
      if (dependency.state === 'validated') {
        const submission = [...index.submissions.values()].find((candidate) => (
          candidate.assignmentId === dependency.assignmentId && candidate.state === 'accepted'
        ));
        const artifact = index.artifacts.get(submission?.artifactId);
        if (!submission || !artifact) {
          throw runtimeError('STATE_TRANSITION_INVALID', 'Validated intelligence replay dependency lacks accepted Artifact custody.', {
            dependencyId,
          });
        }
        return {
          assignmentId: dependency.assignmentId,
          outcome: 'validated',
          eventId: submission.acceptanceEventIds.at(-1),
          artifactId: artifact.artifactId,
        };
      }
      if (['abandoned', 'failed'].includes(dependency.state) && dependency.terminalOutcome) {
        return {
          assignmentId: dependency.assignmentId,
          outcome: dependency.state,
          eventId: dependency.terminalOutcome.eventId,
          absence: {
            code: dependency.terminalOutcome.code,
            reason: dependency.terminalOutcome.reason,
            recoveryDisposition: dependency.terminalOutcome.recoveryDisposition,
          },
        };
      }
      throw runtimeError('STATE_TRANSITION_INVALID', 'Released intelligence replay dependency is not terminal.', {
        assignmentId: intent.assignmentId,
        dependencyId,
      });
    });
    return {
      inputArtifactIds: resolveOperatingAssignmentInputArtifactIdsV2(intent, proofs),
      inputAbsences: resolveOperatingAssignmentInputAbsencesV2(intent, {
        dependencyProofs: proofs,
        assignments: [...index.assignments.values()],
        intelligencePlans: [plan],
      }),
    };
  }

  function exactIntelligenceBoardReplay(index, planEventId, creationEventIds, board, requestHash) {
    const identities = [planEventId, ...creationEventIds];
    const present = identities.filter((eventId) => index.eventReplay.has(eventId));
    const plan = index.intelligencePlans.get(board.plan.planId);
    const assignments = board.assignments.map((intent) => index.assignments.get(intent.assignmentId));
    const hasRecord = plan !== undefined || assignments.some(Boolean);
    if (present.length === 0 && !hasRecord) return false;
    if (present.length !== identities.length || !plan || assignments.some((assignment) => !assignment)) {
      throw runtimeError('CONCURRENT_MODIFICATION', 'Intelligence board replay identity is incomplete or conflicts with a partial prior transaction.', {
        planId: board.plan.planId,
        eventIds: present.sort(),
      });
    }
    const replay = index.eventReplay.get(planEventId);
    if (replay.requestHash !== requestHash || sha256Jcs(plan) !== sha256Jcs(board.plan)
      || assignments.some((assignment, position) => {
        const intent = board.assignments[position];
        const custody = expectedIntelligenceAssignmentCustody(index, plan, intent, assignment);
        const expected = { ...clone(intent), ...clone(custody) };
        return sha256Jcs(immutableAssignmentIntent(assignment)) !== sha256Jcs(immutableAssignmentIntent(expected));
      })) {
      throw runtimeError('STATE_TRANSITION_INVALID', 'A runtime-issued intelligence board identity was reused with a different exact request, plan, or Assignment graph.', {
        planId: board.plan.planId,
        eventId: planEventId,
      });
    }
    return true;
  }

  return Object.freeze({ exactIntelligenceBoardReplay, intelligenceAssignmentCreationEventId });
}
