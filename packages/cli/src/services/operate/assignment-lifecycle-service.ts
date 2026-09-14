import { sha256Jcs } from 'planr-pipeline/protocol';
import type { JsonRecord, OperateComposition } from './composition.js';
import {
  retryReplaySafeGenerationConflict,
  withOperateMutationLane,
} from './replay-safe-retry-service.js';
import type { OperateStoredRuntime } from './store.js';

type AssignmentActor = Readonly<{
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}>;

export type AssignmentClaimRequest = Readonly<{
  assignmentId: string;
  actor: AssignmentActor;
}>;

export type AssignmentSubmitRequest = Readonly<{
  assignmentId: string;
  submissionId: string;
  actor: AssignmentActor;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  contentBase64: string;
}>;

type LifecycleIssue = Readonly<{
  id(prefix: string): string;
  stableId(prefix: string, seed: string): string;
  timestamp(): string;
}>;

type AssignmentCommit = (
  runtime: OperateStoredRuntime,
  nextState: JsonRecord,
  events: JsonRecord[],
) => Promise<OperateStoredRuntime>;

type LifecycleRefusalCode =
  | 'ASSIGNMENT_NOT_AVAILABLE'
  | 'CAPABILITY_DENIED'
  | 'OPERATE_STORE_CORRUPT';

type Refuse = (
  code: LifecycleRefusalCode,
  message: string,
  context?: Record<string, string>,
) => never;

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? (value as JsonRecord[]) : [];
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Own the complete public claim preparation and replay selection. The client facade supplies
 * only persistence and ID/time capabilities; claimant and retained-custody rules stay here.
 */
export function claimRuntimeAssignment(input: {
  composition: OperateComposition;
  request: AssignmentClaimRequest;
  runtimeState: JsonRecord;
  issue: LifecycleIssue;
  refuse: Refuse;
}) {
  const { composition, request, runtimeState, issue, refuse } = input;
  if (!request.actor.actorId || !request.actor.runtime || request.actor.kind !== 'agent') {
    return refuse(
      'CAPABILITY_DENIED',
      'An agent identity and runtime are required to claim an Assignment.',
    );
  }

  const assignment = records(runtimeState.assignments).find(
    (candidate) => candidate.assignmentId === request.assignmentId,
  );
  let claimId = issue.id('clm');
  let submissionId = issue.id('sub');
  if (assignment?.state === 'running') {
    const retainedClaim = record(assignment.claim);
    const issuedSubmissions = records(runtimeState.submissions).filter(
      (submission) =>
        submission.assignmentId === assignment.assignmentId && submission.state === 'issued',
    );
    if (
      typeof retainedClaim.claimId !== 'string' ||
      retainedClaim.claimId.length === 0 ||
      issuedSubmissions.length !== 1
    ) {
      return refuse(
        'OPERATE_STORE_CORRUPT',
        'The running Assignment lost its exact retained claim or issued Submission.',
        { assignmentId: request.assignmentId },
      );
    }
    claimId = retainedClaim.claimId;
    submissionId = String(issuedSubmissions[0].submissionId);
  }

  const claimed = composition.claimAssignment(
    request,
    {
      claimId,
      submissionId,
      eventIds: { claimed: issue.id('evt'), started: issue.id('evt') },
      timestamp: issue.timestamp(),
      correlationId: issue.id('corr'),
    },
    runtimeState,
  );
  return Object.freeze({
    ...claimed,
    cycleId: String(record(claimed.response.assignment).cycleId),
  });
}

/**
 * Own the complete replay-safe claim transaction. The client facade supplies durable runtime
 * access and commit custody, while this service owns retry identity, mutation serialization,
 * claimant validation, exact claim replay, and the response's only permitted next action.
 */
export async function claimOperateAssignment(input: {
  root: string;
  request: AssignmentClaimRequest;
  issueFactory: () => () => LifecycleIssue;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  composition: () => Promise<OperateComposition>;
  commit: AssignmentCommit;
  refuse: Refuse;
}): Promise<unknown> {
  const nextIssue = input.issueFactory();
  return await retryReplaySafeGenerationConflict(`claim:${sha256Jcs(input.request as never)}`, () =>
    withOperateMutationLane(input.root, async () => {
      const runtime = await input.requiredRuntime();
      const composition = await input.composition();
      const claimed = claimRuntimeAssignment({
        composition,
        request: input.request,
        runtimeState: runtime.state,
        issue: nextIssue(),
        refuse: input.refuse,
      });
      if (!claimed.replayed) {
        await input.commit(runtime, claimed.state, claimed.events as JsonRecord[]);
      }
      return {
        ok: true,
        operation: 'operate.assignment.claim',
        data: claimed.response,
        allowedActions: [
          {
            tool: 'operate.cycle.get',
            arguments: { cycleId: claimed.cycleId },
            label: 'Inspect the current cycle',
            effect: 'read-only',
          },
        ],
      };
    }),
  );
}

/**
 * Resolve the runtime-owned reservation and construct the replay-stable Submission draft before
 * any bytes are staged. Post-acceptance Chair/verification workflows remain separate consumers.
 */
export function stageRuntimeAssignmentSubmission(input: {
  composition: OperateComposition;
  request: AssignmentSubmitRequest;
  runtimeState: JsonRecord;
  artifactBytes: Map<string, Uint8Array>;
  assignmentArtifactIds: Record<string, string>;
  issue: LifecycleIssue;
  refuse: Refuse;
}) {
  const {
    composition,
    request,
    runtimeState,
    artifactBytes,
    assignmentArtifactIds,
    issue,
    refuse,
  } = input;
  const assignment = records(runtimeState.assignments).find(
    (candidate) => candidate.assignmentId === request.assignmentId,
  );
  if (!assignment) {
    return refuse('ASSIGNMENT_NOT_AVAILABLE', 'The requested assignment does not exist.', {
      assignmentId: request.assignmentId,
    });
  }
  const artifactId = assignmentArtifactIds[request.assignmentId];
  if (!artifactId) {
    return refuse(
      'OPERATE_STORE_CORRUPT',
      'The Assignment is missing its runtime-owned Artifact reservation.',
      { assignmentId: request.assignmentId },
    );
  }
  const acceptedAt =
    typeof assignment.completedAt === 'string' ? assignment.completedAt : issue.timestamp();
  const accepted = composition.acceptSubmission(
    request,
    {
      artifactId,
      artifactType: `${String(assignment.roleId)}-result`,
      inputArtifactIds: assignment.inputArtifactIds,
      timestamp: acceptedAt,
      validatorVersion: 'openplanr-operate',
      correlationId: issue.stableId('corr', request.submissionId),
      eventIds: {
        submitted: issue.stableId('evt', `${request.submissionId}:submitted`),
        artifactCreated: issue.stableId('evt', `${request.submissionId}:artifact-created`),
        validated: issue.stableId('evt', `${request.submissionId}:validated`),
      },
    },
    runtimeState,
    artifactBytes,
  );
  return Object.freeze({ assignment, accepted });
}
