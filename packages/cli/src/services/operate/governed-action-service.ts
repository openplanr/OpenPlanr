import { createHash } from 'node:crypto';
import {
  assertOperatingApprovalRequirementIntegrityV2,
  createOperatingApprovalRequirementV2,
} from 'planr-pipeline/operate/approvals-v2';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from 'planr-pipeline/operate/policy-v2';
import { resolveOperatingLatestActionEvaluationV2 } from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActorV2 } from './client.js';
import { OperateClientError } from './client-error.js';
import type { JsonRecord } from './composition.js';
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
