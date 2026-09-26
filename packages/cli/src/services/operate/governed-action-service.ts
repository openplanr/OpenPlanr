import { createHash } from 'node:crypto';
import {
  assertOperatingApprovalRequirementIntegrityV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
} from 'planr-pipeline/operate/approvals-v2';
import { createOperatingGovernedExecutionRuntimeV2 } from 'planr-pipeline/operate/governed-execution-v2';
import {
  buildOperatingRollbackPlanV2,
  createOperatingGovernedRecoveryRuntimeV2,
  recordOperatingRollbackPlanV2,
} from 'planr-pipeline/operate/governed-recovery-v2';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from 'planr-pipeline/operate/policy-v2';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from 'planr-pipeline/operate/reference-governed-executors-v2';
import { resolveOperatingLatestActionEvaluationV2 } from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { OperateClientError } from './client-error.js';
import {
  type Commit,
  type CreateEvent,
  findBy,
  operateSuccess,
  timestamp,
} from './client-support.js';
import type {
  OperateActorV2,
  OperateApiEnvelopeV2,
  OperateToolRequestMapV2,
} from './client-types.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import type { OperateStoredRuntime } from './store.js';

const ACTION_APPROVE_CAPABILITY = Object.freeze({ id: 'action-approve', version: '1.0.0' });
const GOVERNED_POLICY_VERSION = '1.0.0';
export const GOVERNED_APPROVAL_TEMPLATE_ID = 'aprq_openplanr_owner';

type RuntimeState = JsonRecord & {
  eventHead: { sequence: number; hash: string | null };
  eventReplayIndex: JsonRecord[];
  assignments: JsonRecord[];
  artifacts: JsonRecord[];
  actions: JsonRecord[];
  policyEvaluations: JsonRecord[];
  actionPolicies: JsonRecord[];
  approvalRequirements: JsonRecord[];
  approvalRecords: JsonRecord[];
  governedOperations: JsonRecord[];
  executionResults: JsonRecord[];
  rollbackPlans: JsonRecord[];
};

export type ExactRollbackApprovalTemplate = {
  evaluation: JsonRecord;
  policy: JsonRecord;
  requirement: JsonRecord;
  party: JsonRecord;
};

export type ExactRollbackPlanContext = {
  operation: JsonRecord;
  result: JsonRecord;
  plan: JsonRecord;
  binding: JsonRecord;
};

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The accepted lifecycle result is not a JSON object.',
      false,
    );
  }
  return value as JsonRecord;
}

function state(runtime: OperateStoredRuntime): RuntimeState {
  return runtime.state as RuntimeState;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function stableToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function later(instant: string, milliseconds: number): string {
  const value = Date.parse(instant);
  if (!Number.isFinite(value)) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The governed Action has no valid durable timestamp.',
      false,
    );
  }
  return new Date(value + milliseconds).toISOString();
}

export function actionIdentity(action: JsonRecord): {
  actionId: string;
  revision: number;
  actionHash: string;
} {
  return {
    actionId: String(action.actionId),
    revision: Number(action.revision),
    actionHash: String(action.actionHash),
  };
}

export function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return sha256Jcs(left as never) === sha256Jcs(right as never);
}

export function sameActionIdentity(left: unknown, right: JsonRecord): boolean {
  const candidate = record(left);
  return (
    candidate.actionId === right.actionId &&
    candidate.revision === right.revision &&
    candidate.actionHash === right.actionHash
  );
}

function withoutField(value: JsonRecord, field: string): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

export function exactRollbackApprovalTemplate(
  snapshot: RuntimeState,
  action: JsonRecord,
  actor: OperateActorV2,
): ExactRollbackApprovalTemplate {
  if (actor.kind !== 'human') {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval requires one exact human actor party.',
      false,
    );
  }
  let evaluation: JsonRecord | null = null;
  try {
    evaluation = resolveOperatingLatestActionEvaluationV2({
      evaluations: snapshot.policyEvaluations as never,
      action: action as never,
      configuredPolicies: snapshot.actionPolicies as never,
      at: String(snapshot.generatedAt),
    }) as unknown as JsonRecord | null;
  } catch {
    evaluation = null;
  }
  if (
    !evaluation ||
    !sameActionIdentity(evaluation.action, action) ||
    !sameCanonicalValue(evaluation.capability, action.requestedCapability) ||
    !sameCanonicalValue(evaluation.target, action.targetBinding) ||
    evaluation.effectClass !== action.effectClass ||
    !['named-single-party', 'named-multi-party', 'threshold'].includes(String(evaluation.outcome))
  ) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval requires one exact current Action policy evaluation.',
      false,
    );
  }
  const evaluationPolicy = record(evaluation.policy);
  const policies = snapshot.actionPolicies.filter((policy) => {
    const effectClasses = Array.isArray(policy.effectClasses) ? policy.effectClasses : [];
    const targetKinds = Array.isArray(policy.targetKinds) ? policy.targetKinds : [];
    return (
      policy.policyId === evaluationPolicy.policyId &&
      policy.policyVersion === evaluationPolicy.policyVersion &&
      policy.policyHash === evaluationPolicy.policyHash &&
      policy.domainId === action.domainId &&
      sameCanonicalValue(policy.actionKind, action.actionKind) &&
      sameCanonicalValue(policy.capability, action.requestedCapability) &&
      effectClasses.includes(action.effectClass) &&
      targetKinds.includes(record(action.targetBinding).kind) &&
      policy.decisionMode === evaluation.outcome &&
      policy.rollbackRequired === true
    );
  });
  if (policies.length !== 1) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval requires one exact current Action policy.',
      false,
    );
  }
  const requirementIds = Array.isArray(evaluation.approvalRequirementIds)
    ? evaluation.approvalRequirementIds
    : [];
  const eligible = requirementIds.flatMap((requirementId) => {
    const candidate = snapshot.approvalRequirements.find(
      (candidate) => candidate.requirementId === requirementId,
    );
    let requirement: JsonRecord | null = null;
    try {
      requirement = candidate
        ? (assertOperatingApprovalRequirementIntegrityV2(
            candidate as never,
          ) as unknown as JsonRecord)
        : null;
    } catch {
      requirement = null;
    }
    if (
      !requirement ||
      requirement.evaluationId !== evaluation?.evaluationId ||
      !sameActionIdentity(requirement.action, action) ||
      requirement.scopeId !== action.scopeId ||
      requirement.domainId !== action.domainId ||
      requirement.domainVersion !== action.domainVersion ||
      !sameCanonicalValue(requirement.policy, evaluationPolicy) ||
      !sameCanonicalValue(requirement.capability, action.requestedCapability) ||
      !sameCanonicalValue(requirement.target, action.targetBinding) ||
      requirement.effectClass !== action.effectClass ||
      requirement.mode !== evaluation?.outcome ||
      requirement.consumable !== true ||
      requirement.scopeHash !== sha256Jcs(withoutField(requirement, 'scopeHash') as never)
    ) {
      return [];
    }
    const parties = Array.isArray(requirement.parties) ? (requirement.parties as JsonRecord[]) : [];
    return parties
      .filter(
        (party) =>
          party.actorKind === 'human' &&
          party.actorId === actor.actorId &&
          sameCanonicalValue(party.requiredCapability, ACTION_APPROVE_CAPABILITY),
      )
      .map((party) => ({ evaluation, policy: policies[0], requirement, party }));
  });
  if (eligible.length !== 1) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval requires one exact human actor party and approval template.',
      false,
    );
  }
  return eligible[0];
}

export function exactRollbackApprovalRecord(
  snapshot: RuntimeState,
  action: JsonRecord,
  actor: OperateActorV2,
  template: ExactRollbackApprovalTemplate,
  bindingHash: string,
  at: string,
): JsonRecord | null {
  const approvals = snapshot.approvalRecords.filter((approval) => {
    const approvalActor = record(approval.actor);
    const replay = snapshot.eventReplayIndex.find(
      (event) => event.type === 'approval.recorded' && event.entityId === approval.approvalId,
    );
    return (
      approval.requirementId === template.requirement.requirementId &&
      approval.evaluationId === template.evaluation.evaluationId &&
      approval.partyId === template.party.partyId &&
      approval.decision === 'approved' &&
      approval.consumedByOperationId === null &&
      sameActionIdentity(approval.action, action) &&
      sameCanonicalValue(approval.policy, template.evaluation.policy) &&
      sameCanonicalValue(approval.capability, action.requestedCapability) &&
      sameCanonicalValue(approval.target, action.targetBinding) &&
      approval.effectClass === action.effectClass &&
      approval.scopeHash === template.requirement.scopeHash &&
      approvalActor.kind === 'human' &&
      approvalActor.actorId === actor.actorId &&
      sameCanonicalValue(approvalActor.capability, template.party.requiredCapability) &&
      approval.recordHash === sha256Jcs(withoutField(approval, 'recordHash') as never) &&
      typeof approval.expiresAt === 'string' &&
      Date.parse(approval.expiresAt) > Date.parse(at) &&
      replay?.requestHash === bindingHash
    );
  });
  if (approvals.length > 1) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval has more than one exact current record.',
      false,
    );
  }
  return approvals[0] ?? null;
}

function rollbackApprovalBinding(
  original: JsonRecord,
  result: JsonRecord,
  plan: JsonRecord,
): JsonRecord {
  return {
    rollbackPlanId: plan.rollbackPlanId,
    planHash: plan.planHash,
    originalOperationId: original.operationId,
    executionResultId: result.resultId,
    expectedTargetHash: (plan.steps as JsonRecord[])[0]?.expectedTargetHash,
  };
}

export function exactRollbackPlanContext(
  snapshot: RuntimeState,
  action: JsonRecord,
  expected: {
    binding?: JsonRecord;
    originalOperationId?: unknown;
    rollbackPlanId?: unknown;
  } = {},
): ExactRollbackPlanContext {
  const plans = snapshot.rollbackPlans.filter(
    (candidate) =>
      sameActionIdentity(candidate.action, action) &&
      (expected.rollbackPlanId === undefined ||
        candidate.rollbackPlanId === expected.rollbackPlanId),
  );
  const eligible = plans.flatMap((plan) => {
    const operations = snapshot.governedOperations.filter(
      (candidate) => candidate.operationId === plan.operationId,
    );
    const results = snapshot.executionResults.filter(
      (candidate) => candidate.resultId === plan.executionResultId,
    );
    if (operations.length !== 1 || results.length !== 1) return [];
    const operation = operations[0];
    const result = results[0];
    const binding = rollbackApprovalBinding(operation, result, plan);
    if (
      (expected.originalOperationId !== undefined &&
        operation.operationId !== expected.originalOperationId) ||
      (expected.binding !== undefined && !sameCanonicalValue(binding, expected.binding)) ||
      operation.operationKind !== 'execute' ||
      result.operationKind !== 'execute' ||
      operation.state !== result.status ||
      !['succeeded', 'partial'].includes(String(result.status)) ||
      operation.rollbackClass !== 'reversible' ||
      operation.rollbackPlanId !== null ||
      operation.parentOperationId !== null ||
      result.rollbackPlanId !== null ||
      operation.resultId !== result.resultId ||
      result.operationId !== operation.operationId ||
      operation.requestFingerprint !== result.requestFingerprint ||
      operation.assignmentId !== result.assignmentId ||
      operation.evaluationId !== result.evaluationId ||
      operation.grantId !== result.grantId ||
      plan.operationId !== operation.operationId ||
      plan.executionResultId !== result.resultId ||
      plan.planHash !== sha256Jcs(withoutField(plan, 'planHash') as never) ||
      operation.operationHash !== sha256Jcs(withoutField(operation, 'operationHash') as never) ||
      result.resultHash !== sha256Jcs(withoutField(result, 'resultHash') as never) ||
      !sameActionIdentity(operation.action, action) ||
      !sameActionIdentity(result.action, action) ||
      !sameCanonicalValue(operation.approvalIds, result.approvalIds) ||
      !sameCanonicalValue(operation.capability, action.requestedCapability) ||
      !sameCanonicalValue(result.capability, action.requestedCapability) ||
      !sameCanonicalValue(plan.capability, action.requestedCapability) ||
      !sameCanonicalValue(operation.target, action.targetBinding) ||
      !sameCanonicalValue(result.target, action.targetBinding) ||
      !sameCanonicalValue(operation.executor, result.executor) ||
      !sameCanonicalValue(operation.connector, result.connector) ||
      !sameCanonicalValue(operation.inputArtifactIds, result.inputArtifactIds) ||
      operation.effectClass !== action.effectClass ||
      result.effectClass !== action.effectClass ||
      plan.effectClass !== action.effectClass ||
      operation.verificationPlanId !== action.verificationPlanId ||
      result.verificationPlanId !== action.verificationPlanId ||
      plan.verificationPlanId !== action.verificationPlanId ||
      result.baselineArtifactId !== plan.baselineArtifactId ||
      result.baselineHash !== plan.baselineHash ||
      result.targetAfterHash === null ||
      result.targetAfterHash !== record((plan.steps as JsonRecord[])[0]).expectedTargetHash ||
      binding.expectedTargetHash !== result.targetAfterHash ||
      !['eligible', 'required'].includes(String(plan.eligibility))
    ) {
      return [];
    }
    return [{ operation, result, plan, binding }];
  });
  if (eligible.length !== 1) {
    throw new OperateClientError(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback requires one exact current plan, operation, result, Action, target, and effect binding.',
      false,
    );
  }
  return eligible[0];
}

export function mergeRecordsBy(
  current: JsonRecord[] | undefined,
  additions: JsonRecord[],
  identity: (record: JsonRecord) => string,
): JsonRecord[] {
  return [
    ...new Map(
      [...(current ?? []), ...additions].map((entry) => [identity(entry), entry]),
    ).values(),
  ];
}

export function containedActionAuthorityInput(
  action: JsonRecord,
  baselineArtifactId: string,
  updatedAt: string,
): JsonRecord {
  return {
    actionKind: {
      id:
        action.domainId === 'business'
          ? 'business-operating-hypothesis'
          : 'software-operating-hypothesis',
      version: GOVERNED_POLICY_VERSION,
    },
    requestedCapability: {
      id: 'bounded-project-write',
      version: GOVERNED_POLICY_VERSION,
    },
    targetBinding: {
      kind: 'project-record',
      id: `record-${String(action.actionId).slice(4)}`,
      revision: 'source-v1',
    },
    effectClass: 'project-write',
    preconditionArtifactIds: [String(action.sourceArtifactId), baselineArtifactId].sort(),
    executionBinding: {
      policyId: 'bounded-project-write-policy',
      policyVersion: GOVERNED_POLICY_VERSION,
      rollbackRequired: true,
      verificationRequired: true,
    },
    updatedAt,
  };
}

export function deliveryActionAuthorityInput(
  action: JsonRecord,
  route: 'planning-work' | 'human-external' | 'observe-only',
  baselineArtifactId: string,
  updatedAt: string,
): JsonRecord {
  const contract = {
    'planning-work': {
      actionKind: 'planning-work-hypothesis',
      capability: 'planning-spec-materialization',
      targetKind: 'planning-spec',
      effectClass: 'project-write',
      policyId: 'planning-spec-confirmation-policy',
    },
    'human-external': {
      actionKind: 'human-external-hypothesis',
      capability: 'human-external-handoff',
      targetKind: 'human-handoff',
      effectClass: 'external-effect',
      policyId: 'human-external-handoff-policy',
    },
    'observe-only': {
      actionKind: 'observe-only-hypothesis',
      capability: 'operating-observation',
      targetKind: 'operating-observation',
      effectClass: 'read-only',
      policyId: 'observe-only-policy',
    },
  } as const;
  const selected = contract[route];
  return {
    actionKind: { id: selected.actionKind, version: GOVERNED_POLICY_VERSION },
    requestedCapability: { id: selected.capability, version: GOVERNED_POLICY_VERSION },
    targetBinding: {
      kind: selected.targetKind,
      id: `record-${String(action.actionId).slice(4)}`,
      revision: 'source-v1',
    },
    effectClass: selected.effectClass,
    preconditionArtifactIds: [String(action.sourceArtifactId), baselineArtifactId].sort(),
    executionBinding: {
      policyId: selected.policyId,
      policyVersion: GOVERNED_POLICY_VERSION,
      rollbackRequired: false,
      verificationRequired: true,
    },
    updatedAt,
  };
}

export function configureContainedActionAuthority(
  governed: JsonRecord[],
  ownerActorId: string,
  evaluatedAt: string,
) {
  const representative = governed[0];
  if (!representative) {
    return { actions: [], policies: [], evaluations: [], requirements: [] };
  }
  const policyTuple = {
    domainId: String(representative.domainId),
    actionKind: structuredClone(representative.actionKind),
    capability: structuredClone(representative.requestedCapability),
    effectClasses: [String(representative.effectClass)],
    targetKinds: [String(record(representative.targetBinding).kind)],
  };
  const corePolicy = createOperatingActionPolicyV2({
    policyId: 'core-governed-action-policy',
    policyVersion: GOVERNED_POLICY_VERSION,
    ...policyTuple,
    decisionMode: 'automatic',
    approvalRequirementIds: [],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'core',
    provenance: {
      providerId: 'core-policy-provider',
      providerVersion: GOVERNED_POLICY_VERSION,
      sourceHash: sha256Jcs({ contract: 'openplanr-contained-core-policy', version: 1 }),
    },
  } as never) as unknown as JsonRecord;
  const domainPolicy = createOperatingActionPolicyV2({
    policyId: 'bounded-project-write-policy',
    policyVersion: GOVERNED_POLICY_VERSION,
    ...policyTuple,
    decisionMode: 'named-single-party',
    approvalRequirementIds: [GOVERNED_APPROVAL_TEMPLATE_ID],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'domain',
    provenance: {
      providerId: 'open-reference-policy-provider',
      providerVersion: GOVERNED_POLICY_VERSION,
      sourceHash: sha256Jcs({
        contract: 'open-reference-bounded-project-write-policy',
        version: 1,
      }),
    },
  } as never) as unknown as JsonRecord;
  const policies = [corePolicy, domainPolicy];
  const evaluations = governed.map(
    (action) =>
      evaluateOperatingActionPolicyV2({
        action: action as never,
        configuredPolicies: policies as never,
        evaluatedAt,
      }) as unknown as JsonRecord,
  );
  const requirements = governed.map(
    (action, index) =>
      createOperatingApprovalRequirementV2({
        policyRequirementId: GOVERNED_APPROVAL_TEMPLATE_ID,
        evaluation: evaluations[index] as never,
        action: action as never,
        parties: [
          {
            partyId: `owner-party-${String(action.actionId).slice(4)}`,
            actorKind: 'human',
            actorId: ownerActorId,
            requiredCapability: ACTION_APPROVE_CAPABILITY,
          },
        ],
        expiresAt: later(evaluatedAt, 7 * 24 * 60 * 60_000),
        consumable: true,
      }) as unknown as JsonRecord,
  );
  return { actions: governed, policies, evaluations, requirements };
}

export function exactAction(
  snapshot: RuntimeState,
  identity: { actionId: string; revision: number; actionHash: string },
): JsonRecord {
  const selected = snapshot.actions.filter(
    (candidate) =>
      candidate.actionId === identity.actionId &&
      candidate.revision === identity.revision &&
      candidate.actionHash === identity.actionHash,
  );
  if (selected.length !== 1) {
    throw new OperateClientError(
      'ACTION_REVISION_MISMATCH',
      'The runtime-issued Action identity is no longer the exact current revision.',
      false,
    );
  }
  return selected[0];
}

export function artifactValue(runtime: OperateStoredRuntime, artifactId: string) {
  const artifact = state(runtime).artifacts.find(
    (candidate) => candidate.artifactId === artifactId,
  );
  const bytes = runtime.artifacts.get(artifactId);
  if (!artifact || !bytes) {
    throw new OperateClientError(
      'ARTIFACT_NOT_FOUND',
      'The governed Action input Artifact is unavailable.',
      false,
    );
  }
  let value: unknown = Buffer.from(bytes).toString('utf8');
  if (String(artifact.mediaType).includes('json')) {
    try {
      value = JSON.parse(String(value));
    } catch {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The governed JSON Artifact bytes are invalid.',
        false,
      );
    }
  }
  return { artifact, value };
}

export function governedArtifactStore(runtime: OperateStoredRuntime) {
  return {
    stageRaw({ artifact, rawBytes }: { artifact: JsonRecord; rawBytes: Uint8Array }) {
      const bytes = Buffer.from(rawBytes);
      const rawHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (rawHash !== artifact.rawHash) {
        throw Object.assign(new Error('Governed result Artifact bytes do not match.'), {
          code: 'ARTIFACT_HASH_MISMATCH',
        });
      }
      const artifactId = String(artifact.artifactId);
      const existing = runtime.artifacts.get(artifactId);
      if (existing && !Buffer.from(existing).equals(bytes)) {
        throw Object.assign(new Error('Governed result Artifact identity diverged.'), {
          code: 'OPERATION_CONFLICT',
        });
      }
      runtime.artifacts.set(artifactId, bytes);
      return true as const;
    },
    readRaw({ artifactId, rawHash }: { artifactId: string; rawHash: string }) {
      const bytes = runtime.artifacts.get(artifactId);
      if (!bytes || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== rawHash) {
        throw Object.assign(new Error('Governed result Artifact custody is unavailable.'), {
          code: 'ARTIFACT_NOT_FOUND',
        });
      }
      return Buffer.from(bytes);
    },
  };
}

export function governedDraft(
  action: JsonRecord,
  operation: 'execute' | 'rollback',
  preparedAt = String(action.updatedAt),
): JsonRecord {
  const token = stableToken(
    `${operation}:${String(action.actionId)}:${String(action.revision)}:${String(action.actionHash)}`,
  );
  const terminalPrefix = operation === 'execute' ? 'xres' : 'rbres';
  const eventFields = [
    'assignmentCreated',
    'assignmentClaimed',
    'assignmentStarted',
    'availabilityRecorded',
    'capabilityGranted',
    'intentRecorded',
    'submitted',
    'artifactCreated',
    'validated',
    'resultRecorded',
  ];
  return {
    assignmentId: `asg_${token}`,
    submissionId: `sub_${token}`,
    operationId: `op_${token}`,
    grantId: `cgr_${token}`,
    ...(operation === 'execute'
      ? { resultId: `${terminalPrefix}_${token}` }
      : { rollbackResultId: `${terminalPrefix}_${token}` }),
    resultArtifactId: `art_${token}_result`,
    claimId: `claim-${token}`,
    preparedAt,
    completedAt: later(preparedAt, 1_000),
    grantExpiresAt: later(preparedAt, 5 * 60_000),
    availabilityExpiresAt: later(preparedAt, 6 * 60_000),
    correlationId: `corr-${token}`,
    eventIds: Object.fromEntries(
      eventFields.map((field, index) => [field, `evt_${token}_${index + 1}`]),
    ),
    uncertainty: {
      ...(operation === 'execute'
        ? { resultId: `xres_uncertain${token}` }
        : { rollbackResultId: `rbres_uncertain${token}` }),
      resultArtifactId: `art_${token}_uncertain`,
      submissionId: `sub_uncertain${token}`,
      eventIds: Object.fromEntries(
        eventFields.slice(-4).map((field, index) => [field, `evt_${token}_uncertain_${index + 1}`]),
      ),
    },
  };
}

export function withVerificationArtifactReservations(
  runtime: OperateStoredRuntime,
  nextState: JsonRecord,
): OperateStoredRuntime {
  const assignments = Array.isArray(nextState.assignments)
    ? (nextState.assignments as JsonRecord[])
    : [];
  const assignmentArtifactIds = { ...runtime.preferences.assignmentArtifactIds };
  for (const assignment of assignments) {
    if (
      assignment.assignmentKind === 'verification' &&
      typeof assignment.assignmentId === 'string' &&
      assignmentArtifactIds[assignment.assignmentId] === undefined
    ) {
      assignmentArtifactIds[assignment.assignmentId] = stableId(
        'art',
        `verification:${assignment.assignmentId}`,
      );
    }
  }
  return {
    ...runtime,
    preferences: { ...runtime.preferences, assignmentArtifactIds },
  };
}

export type GovernedActionDependencies = Readonly<{
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  composition: () => Promise<OperateComposition>;
  createEvent: CreateEvent;
  commit: Commit;
}>;

export type ContainedActionTargets = Map<
  string,
  ReturnType<typeof createDisposableLocalProjectTargetV2>
>;

type GovernedActionRequest<Operation extends keyof OperateToolRequestMapV2> =
  GovernedActionDependencies & Readonly<{ request: OperateToolRequestMapV2[Operation] }>;

/** Record one human approval decision, or a rollback approval, for the exact current Action. */
export async function approveOperateAction(
  input: GovernedActionRequest<'operate.action.approve'>,
): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  const runtime = await input.requiredRuntime();
  const snapshot = state(runtime);
  const selected = exactAction(snapshot, request.action);
  const rollbackContext = request.rollback;
  let workingRuntime = runtime;
  let workingState = snapshot;
  const prefixEvents: JsonRecord[] = [];
  let rollbackSourceTemplate: ExactRollbackApprovalTemplate | null = null;
  if (rollbackContext) {
    if (request.decision !== 'approved' || selected.state !== 'completed') {
      throw new OperateClientError(
        'APPROVAL_INVALID',
        'Rollback approval is available only for one completed exact Action.',
        false,
      );
    }
    const { plan } = exactRollbackPlanContext(snapshot, selected, {
      binding: rollbackContext as unknown as JsonRecord,
    });
    if (Date.parse(String(plan.expiresAt)) <= Date.now()) {
      throw new OperateClientError(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback approval must bind the exact live plan, parent operation/result, and target precondition.',
        false,
      );
    }
    rollbackSourceTemplate = exactRollbackApprovalTemplate(snapshot, selected, request.actor);
    const rollbackEvaluationId = stableId('pevl', `rollback:${sha256Jcs(rollbackContext)}`);
    const rollbackEvaluationEvents = runtime.events.filter(
      (event) => event.type === 'policy.evaluated' && event.entityId === rollbackEvaluationId,
    );
    const stagedTemplateExists =
      rollbackSourceTemplate.evaluation.evaluationId === rollbackEvaluationId;
    if (stagedTemplateExists) {
      if (
        rollbackEvaluationEvents.length !== 1 ||
        Date.parse(String(rollbackSourceTemplate.requirement.expiresAt)) <= Date.now()
      ) {
        throw new OperateClientError(
          'APPROVAL_INVALID',
          'The exact staged rollback approval template is unavailable or expired.',
          false,
        );
      }
    } else {
      if (rollbackEvaluationEvents.length !== 0) {
        throw new OperateClientError(
          'APPROVAL_INVALID',
          'The rollback approval evaluation identity already exists with different custody.',
          false,
        );
      }
      const evaluatedAt = timestamp();
      const rollbackEvaluation = evaluateOperatingActionPolicyV2({
        action: selected as never,
        configuredPolicies: snapshot.actionPolicies as never,
        evaluatedAt,
        evaluationId: rollbackEvaluationId,
      }) as unknown as JsonRecord;
      const rollbackRequirement = createOperatingApprovalRequirementV2({
        policyRequirementId: GOVERNED_APPROVAL_TEMPLATE_ID,
        evaluation: rollbackEvaluation as never,
        action: selected as never,
        parties: structuredClone(rollbackSourceTemplate.requirement.parties) as never,
        threshold: Number(rollbackSourceTemplate.requirement.threshold),
        expiresAt: later(evaluatedAt, 10 * 60_000),
        consumable: true,
      }) as unknown as JsonRecord;
      const stagedBase = {
        ...runtime.baseState,
        approvalRequirements: mergeRecordsBy(
          runtime.baseState.approvalRequirements as JsonRecord[] | undefined,
          [rollbackRequirement],
          (record) => String(record.requirementId),
        ),
      };
      workingState = {
        ...snapshot,
        approvalRequirements: mergeRecordsBy(
          snapshot.approvalRequirements,
          [rollbackRequirement],
          (record) => String(record.requirementId),
        ),
      } as RuntimeState;
      workingRuntime = { ...runtime, baseState: stagedBase, state: workingState };
      const evaluated = await input.createEvent(workingRuntime, {
        type: 'policy.evaluated',
        entityId: String(rollbackEvaluation.evaluationId),
        cycleId: String(selected.sourceCycleId),
        correlationId: stableId('corr', `rollback-approval:${sha256Jcs(rollbackContext)}`),
        timestamp: evaluatedAt,
        requestHash: String(rollbackEvaluation.inputHash),
        actor: { kind: 'runtime', id: 'openplanr' },
        payload: rollbackEvaluation,
      });
      workingState = (await input.composition()).reduce(
        workingState,
        [evaluated],
        runtime.artifacts,
      ) as unknown as RuntimeState;
      prefixEvents.push(evaluated);
      workingRuntime = {
        ...workingRuntime,
        state: workingState,
        events: [...runtime.events, evaluated],
      };
    }
  }
  const rollbackTemplate = rollbackContext
    ? exactRollbackApprovalTemplate(workingState, selected, request.actor)
    : null;
  if (
    rollbackSourceTemplate &&
    rollbackTemplate &&
    (!sameCanonicalValue(
      rollbackTemplate.requirement.parties,
      rollbackSourceTemplate.requirement.parties,
    ) ||
      rollbackTemplate.requirement.threshold !== rollbackSourceTemplate.requirement.threshold)
  ) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback approval parties or threshold diverged from the exact source template.',
      false,
    );
  }
  const evaluations = workingState.policyEvaluations
    .filter(
      (candidate) =>
        (candidate.action as JsonRecord)?.actionId === selected.actionId &&
        (candidate.action as JsonRecord)?.revision === selected.revision &&
        (candidate.action as JsonRecord)?.actionHash === selected.actionHash,
    )
    .sort(
      (left, right) =>
        String(left.evaluatedAt).localeCompare(String(right.evaluatedAt)) ||
        String(left.evaluationId).localeCompare(String(right.evaluationId)),
    );
  const evaluation = rollbackTemplate?.evaluation ?? evaluations.at(-1);
  if (!evaluation) {
    throw new OperateClientError(
      'POLICY_EVALUATION_REJECTED',
      'The exact current Action has no durable policy evaluation.',
      false,
    );
  }
  const requirementIds = Array.isArray(evaluation.approvalRequirementIds)
    ? evaluation.approvalRequirementIds
    : [];
  const requirements = workingState.approvalRequirements.filter((candidate) =>
    requirementIds.includes(candidate.requirementId),
  );
  const requirement =
    rollbackTemplate?.requirement ??
    requirements.find(
      (candidate) =>
        Array.isArray(candidate.parties) &&
        candidate.parties.some(
          (party) =>
            party !== null &&
            typeof party === 'object' &&
            (party as JsonRecord).actorKind === 'human' &&
            (party as JsonRecord).actorId === request.actor.actorId,
        ),
    );
  const party =
    rollbackTemplate?.party ??
    (Array.isArray(requirement?.parties)
      ? requirement.parties.find(
          (candidate) =>
            candidate !== null &&
            typeof candidate === 'object' &&
            (candidate as JsonRecord).actorKind === 'human' &&
            (candidate as JsonRecord).actorId === request.actor.actorId,
        )
      : null);
  if (!requirement || !party || typeof party !== 'object' || Array.isArray(party)) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'The authenticated actor is not a named party for the current approval requirement.',
      false,
    );
  }
  const issuedAt = timestamp();
  const rollbackBindingHash = rollbackContext
    ? sha256Jcs({
        contract: 'openplanr-rollback-approval-v1',
        action: actionIdentity(selected),
        ...rollbackContext,
      })
    : null;
  if (
    rollbackTemplate &&
    rollbackBindingHash &&
    exactRollbackApprovalRecord(
      workingState,
      selected,
      request.actor,
      rollbackTemplate,
      rollbackBindingHash,
      issuedAt,
    )
  ) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'This exact rollback approval party has already recorded its decision.',
      false,
    );
  }
  const approval = createOperatingApprovalRecordV2({
    approvalId: stableId(
      'aprv',
      `${selected.actionHash}:${requirement.requirementId}:${party.partyId}:${request.decision}:${rollbackBindingHash ?? 'execute'}`,
    ),
    requirement: requirement as never,
    evaluation: evaluation as never,
    action: selected as never,
    partyId: String(party.partyId),
    actor: {
      kind: 'human',
      actorId: request.actor.actorId,
      capability: structuredClone(party.requiredCapability),
    } as never,
    decision: request.decision,
    issuedAt,
    expiresAt: (requirement.expiresAt as string | null) ?? null,
  });
  const approvalEvent = await input.createEvent(workingRuntime, {
    type: 'approval.recorded',
    entityId: approval.approvalId,
    cycleId: String(selected.sourceCycleId),
    correlationId: stableId('corr', `approval:${approval.approvalId}`),
    timestamp: approval.issuedAt,
    actor: { kind: 'human', id: request.actor.actorId },
    ...(rollbackBindingHash ? { requestHash: rollbackBindingHash } : {}),
    payload: approval,
  });
  let nextState = (await input.composition()).reduce(
    workingState,
    [approvalEvent],
    runtime.artifacts,
  );
  const approvals = [
    ...workingState.approvalRecords.filter(
      (candidate) => candidate.evaluationId === evaluation.evaluationId,
    ),
    approval,
  ];
  const disposition = evaluateOperatingApprovalSetV2({
    evaluation: evaluation as never,
    action: selected as never,
    requirements: requirements as never,
    approvals: approvals as never,
    now: issuedAt,
  });
  const events: JsonRecord[] = [...prefixEvents, approvalEvent];
  if (disposition.disposition !== null && !rollbackContext) {
    const transitionEvent = await input.createEvent(
      { ...runtime, state: nextState, events: [...runtime.events, approvalEvent] },
      {
        type: `action.${disposition.disposition}`,
        entityId: String(selected.actionId),
        cycleId: String(selected.sourceCycleId),
        correlationId: stableId('corr', `approval:${approval.approvalId}`),
        timestamp: issuedAt,
        actor: { kind: 'engine', id: 'openplanr' },
        payload: {
          action: structuredClone(request.action),
          from: selected.state,
          to: disposition.disposition,
          operationId: null,
          resultId: null,
          reasonCode: null,
        },
      },
    );
    nextState = (await input.composition()).reduce(nextState, [transitionEvent], runtime.artifacts);
    events.push(transitionEvent);
  }
  const committed = await input.commit(
    workingRuntime,
    nextState,
    events.slice(prefixEvents.length),
  );
  return operateSuccess('operate.action.approve', {
    generation: committed.generation,
    actionId: selected.actionId,
    disposition: request.decision,
    complete: disposition.complete,
  });
}

async function prepareTerminalVerificationSubmission(
  input: Pick<GovernedActionDependencies, 'composition' | 'createEvent'>,
  runtime: OperateStoredRuntime,
  nextState: JsonRecord,
  events: JsonRecord[],
  assignmentId: string,
  actorId: string,
): Promise<{
  runtime: OperateStoredRuntime;
  state: JsonRecord;
  events: JsonRecord[];
}> {
  const composition = await input.composition();
  const withReservation = withVerificationArtifactReservations(runtime, nextState);
  const assignment = findBy((nextState as RuntimeState).assignments, 'assignmentId', assignmentId);
  if (assignment?.assignmentKind !== 'verification' || assignment.state !== 'available') {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The terminal operation did not produce one available canonical verification Assignment.',
      false,
      { assignmentId },
    );
  }
  const correlationId = stableId('corr', `verification-claim:${assignmentId}`);
  const submissionId = stableId('sub', `verification:${assignmentId}`);
  let working: OperateStoredRuntime = {
    ...withReservation,
    state: nextState,
    events: [...runtime.events, ...events],
  };
  const claimed = await input.createEvent(working, {
    type: 'assignment.claimed',
    entityId: assignmentId,
    cycleId: String(assignment.cycleId),
    correlationId,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload: {
      assignmentId,
      actorId,
      actorKind: 'agent',
      runtime: 'openplanr',
      claimId: stableId('clm', `verification:${assignmentId}`),
      submissionId,
    },
  });
  const claimedState = composition.reduce(nextState, [claimed], runtime.artifacts);
  working = {
    ...working,
    state: claimedState,
    events: [...working.events, claimed],
  };
  const started = await input.createEvent(working, {
    type: 'assignment.started',
    entityId: assignmentId,
    cycleId: String(assignment.cycleId),
    correlationId,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload: { assignmentId, attempt: 1 },
  });
  const runningState = composition.reduce(claimedState, [started], runtime.artifacts);
  return {
    runtime: withReservation,
    state: runningState,
    events: [...events, claimed, started],
  };
}

/** Execute one approved contained Action and issue its terminal verification Assignment. */
export async function executeOperateAction(
  input: GovernedActionRequest<'operate.action.execute'> &
    Readonly<{ containedTargets: ContainedActionTargets }>,
): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  const runtime = await input.requiredRuntime();
  const snapshot = state(runtime);
  const selected = exactAction(snapshot, request.action);
  if (request.actor.actorId !== selected.ownerActorId) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'Only the exact current Action owner may execute this contained Action.',
      false,
    );
  }
  const payload = artifactValue(runtime, String(selected.sourceArtifactId));
  const executionBinding = record(selected.executionBinding);
  const rollbackRequired = executionBinding.rollbackRequired === true;
  const baselineId = rollbackRequired
    ? (selected.preconditionArtifactIds as unknown[]).find(
        (artifactId) => artifactId !== selected.sourceArtifactId,
      )
    : null;
  if (rollbackRequired && typeof baselineId !== 'string') {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'A reversible Action has no exact rollback-baseline Artifact.',
      false,
    );
  }
  const baseline = typeof baselineId === 'string' ? artifactValue(runtime, baselineId) : null;
  const executeRequest = {
    actionId: selected.actionId,
    payload: {
      artifactId: payload.artifact.artifactId,
      contentHash: sha256Jcs(payload.value as never),
      value: payload.value,
    },
    rollbackBaseline: baseline
      ? {
          artifactId: baseline.artifact.artifactId,
          contentHash: sha256Jcs(baseline.value as never),
          value: baseline.value,
        }
      : null,
  };
  const draft = governedDraft(selected, 'execute');
  let checkpoint = structuredClone(snapshot);
  const checkpointStore = {
    readSnapshot: () => structuredClone(checkpoint),
    compareAndSwap: ({ expectedEventHead, nextState }: JsonRecord) => {
      const expected = record(expectedEventHead);
      const current = record(checkpoint.eventHead);
      const committed = expected.sequence === current.sequence && expected.hash === current.hash;
      if (committed) checkpoint = structuredClone(nextState) as RuntimeState;
      return { committed, state: structuredClone(checkpoint) };
    },
  };
  const actionId = String(selected.actionId);
  const targetAdapter =
    input.containedTargets.get(actionId) ??
    createDisposableLocalProjectTargetV2({
      target: selected.targetBinding as never,
      initialValue: baseline?.value ?? null,
    });
  input.containedTargets.set(actionId, targetAdapter);
  const governed = createOperatingGovernedExecutionRuntimeV2({
    initialState: snapshot as never,
    checkpointStore: checkpointStore as never,
    artifactStore: governedArtifactStore(runtime) as never,
    runtimeActorId: 'openplanr',
  });
  const completed = await governed.execute(executeRequest as never, draft as never, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  let nextState = completed.state as unknown as JsonRecord;
  const events = [...completed.events] as unknown as JsonRecord[];
  if (rollbackRequired && baseline) {
    const plan = buildOperatingRollbackPlanV2({
      operation: completed.operation,
      result: completed.result,
      baseline: executeRequest.rollbackBaseline as never,
      expiresAt: later(String(draft.completedAt), 7 * 24 * 60 * 60_000),
    });
    const planned = recordOperatingRollbackPlanV2({
      state: completed.state,
      plan,
      eventId: stableId('evt', `rollback-plan:${completed.operation.operationId}`),
      runtimeActorId: 'openplanr',
    });
    nextState = planned.state as unknown as JsonRecord;
    events.push(planned.event as unknown as JsonRecord);
  }
  const composition = await input.composition();
  const verificationCreatedIndex = events.findIndex(
    (event) =>
      event.type === 'assignment.created' &&
      record(event.payload).assignmentKind === 'verification',
  );
  if (verificationCreatedIndex < 0) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'Terminal contained execution produced no verification Assignment.',
      false,
    );
  }
  // The governed runtime returns the complete terminal state, including the
  // newly-created verification Assignment. Scheduling that creation Event
  // against the terminal state replays an earlier Event at a later head.
  // Rebuild the exact pre-creation state, then let the scheduler consume the
  // untouched terminal suffix and append its owner-issued release Event.
  const preCreationEvents = events.slice(0, verificationCreatedIndex);
  const schedulingBase = composition.reduce(
    snapshot as unknown as JsonRecord,
    preCreationEvents,
    runtime.artifacts,
  );
  const schedulingEvents = events.slice(verificationCreatedIndex);
  const scheduled = composition.schedule(schedulingBase, schedulingEvents);
  nextState = scheduled.state;
  events.splice(
    verificationCreatedIndex,
    events.length - verificationCreatedIndex,
    ...(scheduled.events as unknown as JsonRecord[]),
  );
  const prepared = await prepareTerminalVerificationSubmission(
    input,
    runtime,
    nextState,
    events,
    String(record(events[verificationCreatedIndex].payload).assignmentId),
    request.actor.actorId,
  );
  const committed = await input.commit(prepared.runtime, prepared.state, prepared.events);
  return operateSuccess('operate.action.execute', {
    generation: committed.generation,
    operationId: completed.operation.operationId,
    resultId: completed.result.resultId,
    replayed: completed.replayed,
    effectCount: completed.effectCount,
  });
}

/** Roll back one completed contained Action against its approved plan and process-local target. */
export async function rollbackOperateAction(
  input: GovernedActionRequest<'operate.action.rollback'> &
    Readonly<{ containedTargets: ContainedActionTargets }>,
): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  const runtime = await input.requiredRuntime();
  const snapshot = state(runtime);
  const selected = exactAction(snapshot, request.action);
  if (request.actor.actorId !== selected.ownerActorId) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'Only the exact current Action owner may roll back this contained Action.',
      false,
    );
  }
  const {
    operation: original,
    plan,
    binding,
  } = exactRollbackPlanContext(snapshot, selected, {
    originalOperationId: request.originalOperationId,
    rollbackPlanId: request.rollbackPlanId,
  });
  const payload = artifactValue(runtime, String(selected.sourceArtifactId));
  const baseline = artifactValue(runtime, String(plan.baselineArtifactId));
  const rollbackRequest = {
    actionId: selected.actionId,
    originalOperationId: original.operationId,
    rollbackPlanId: plan.rollbackPlanId,
    payload: {
      artifactId: payload.artifact.artifactId,
      contentHash: sha256Jcs(payload.value as never),
      value: payload.value,
    },
    rollbackBaseline: {
      artifactId: baseline.artifact.artifactId,
      contentHash: sha256Jcs(baseline.value as never),
      value: baseline.value,
    },
  };
  const preparedAt = timestamp();
  const draft = governedDraft(selected, 'rollback', preparedAt);
  const replaying = snapshot.governedOperations.some(
    (candidate) =>
      candidate.operationId === draft.operationId &&
      candidate.operationKind === 'rollback' &&
      candidate.parentOperationId === original.operationId &&
      candidate.rollbackPlanId === plan.rollbackPlanId,
  );
  const bindingHash = sha256Jcs({
    contract: 'openplanr-rollback-approval-v1',
    action: actionIdentity(selected),
    ...binding,
  });
  const template = exactRollbackApprovalTemplate(snapshot, selected, request.actor);
  const approval = exactRollbackApprovalRecord(
    snapshot,
    selected,
    request.actor,
    template,
    bindingHash,
    preparedAt,
  );
  if (
    !replaying &&
    (!approval || Date.parse(String(approval.expiresAt)) <= Date.parse(preparedAt))
  ) {
    throw new OperateClientError(
      'APPROVAL_INVALID',
      'Rollback requires one distinct fresh human approval bound to the exact current plan, parent result, and target precondition.',
      false,
    );
  }
  let checkpoint: JsonRecord = structuredClone(snapshot) as unknown as JsonRecord;
  const checkpointStore = {
    readSnapshot: () => structuredClone(checkpoint),
    compareAndSwap: ({ expectedEventHead, nextState }: JsonRecord) => {
      const expected = record(expectedEventHead);
      const current = record(checkpoint.eventHead);
      const committed = expected.sequence === current.sequence && expected.hash === current.hash;
      if (committed) checkpoint = structuredClone(record(nextState));
      return { committed, state: structuredClone(checkpoint) };
    },
  };
  const targetAdapter = replaying
    ? undefined
    : input.containedTargets.get(String(selected.actionId));
  if (!replaying && !targetAdapter) {
    throw new OperateClientError(
      'OPERATION_UNCERTAIN',
      'The exact process-local contained target receipt is unavailable after restart; blind rollback is forbidden and recovery inspection is required.',
      false,
      { actionId: String(selected.actionId), originalOperationId: String(original.operationId) },
    );
  }
  const governed = createOperatingGovernedRecoveryRuntimeV2({
    initialState: snapshot as never,
    checkpointStore: checkpointStore as never,
    artifactStore: governedArtifactStore(runtime) as never,
    runtimeActorId: 'openplanr',
  });
  const completed = await governed.rollback(rollbackRequest as never, draft as never, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: targetAdapter as never,
  });
  if (completed.replayed) {
    return operateSuccess('operate.action.rollback', {
      generation: runtime.generation,
      operationId: completed.operation.operationId,
      resultId: completed.result.rollbackResultId,
      replayed: true,
      effectCount: 0,
    });
  }
  const rollbackEvents = [...completed.events] as unknown as JsonRecord[];
  const composition = await input.composition();
  const verificationCreatedIndex = rollbackEvents.findIndex(
    (event) =>
      event.type === 'assignment.created' &&
      record(event.payload).assignmentKind === 'verification',
  );
  if (verificationCreatedIndex < 0) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'Terminal contained rollback produced no verification Assignment.',
      false,
    );
  }
  const scheduled = composition.schedule(completed.state as unknown as JsonRecord, [
    rollbackEvents[verificationCreatedIndex],
  ]);
  rollbackEvents.push(...(scheduled.releaseEvents as unknown as JsonRecord[]));
  const rollbackState = scheduled.state as unknown as JsonRecord;
  const prepared = await prepareTerminalVerificationSubmission(
    input,
    runtime,
    rollbackState,
    rollbackEvents,
    String(record(rollbackEvents[verificationCreatedIndex].payload).assignmentId),
    request.actor.actorId,
  );
  const committed = await input.commit(prepared.runtime, prepared.state, prepared.events);
  return operateSuccess('operate.action.rollback', {
    generation: committed.generation,
    operationId: completed.operation.operationId,
    rollbackResultId: completed.result.rollbackResultId,
    replayed: completed.replayed,
    effectCount: completed.effectCount,
  });
}
