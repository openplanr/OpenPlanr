import { evaluateOperatingApprovalSetV2 } from 'planr-pipeline/operate/approvals-v2';
import {
  deriveOperateAuthorityAllowedActionsV2,
  OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2,
} from 'planr-pipeline/operate/authorization-v2';
import { buildOperatingTerminalVerificationInsufficientEvidenceV2 } from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { OperateClientError } from './client-error.js';
import {
  findBy,
  operateSuccess,
  PROTOCOL_VERSION,
  type RuntimeState,
  record,
  state,
  timestamp,
} from './client-support.js';
import type {
  ExperienceRequest,
  OperateActorV2,
  OperateApiEnvelopeV2,
  OperateAuditDisplayRequestV1,
  OperateExperiencePreviewRequestV1,
} from './client-types.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import {
  actionIdentity,
  exactAction,
  exactRollbackApprovalRecord,
  exactRollbackApprovalTemplate,
  exactRollbackPlanContext,
  sameActionIdentity,
} from './governed-action-service.js';
import { isOperatePublicId } from './identity-contract.js';
import { readOperateReview } from './review-lifecycle-service.js';
import type { OperateStoredRuntime } from './store.js';

const EXPERIENCE_READER_MODULE = 'planr-pipeline/dashboard/operate-experience-reader';
const REVIEW_SUBMIT_CAPABILITY = Object.freeze({
  id: 'operate-review-submit',
  version: PROTOCOL_VERSION,
});

export type OperateReadActor = Readonly<{
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}>;

type ReadRefusalCode =
  | 'CAPABILITY_DENIED'
  | 'CONTRACT_VERSION_UNSUPPORTED'
  | 'RESULT_CONTRACT_INVALID';

type Refuse = (code: ReadRefusalCode, message: string) => never;

type ReadEnvelope =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; [key: string]: unknown }>;

export type OperateExperienceReaderOwner = Readonly<{
  buildOperateExperienceTransportView(view: JsonRecord): JsonRecord;
  resolveOperateExperienceSearchDestination(
    view: JsonRecord,
    value: unknown,
  ): { route: string; surface: string; subjectId: string | null } | null;
  selectOperateExperienceSurface(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateExperienceAuditDisplaySurface(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateCycleDisplayWorkspace(
    view: JsonRecord,
    cycleRead: unknown,
    options: JsonRecord,
  ): unknown;
  selectOperateExecutiveBoardDisplay(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateActionDisplayWorkspace(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateRecoveryDisplay(
    view: JsonRecord,
    recoveryRead: unknown,
    options: JsonRecord,
  ): unknown;
}>;

let readerOwnerPromise: Promise<OperateExperienceReaderOwner> | null = null;

/** Load and verify the complete public reader once; no package-private projection is used. */
export async function loadOperateExperienceReaderOwner(
  refuse: Refuse,
): Promise<OperateExperienceReaderOwner> {
  readerOwnerPromise ??= import(EXPERIENCE_READER_MODULE).then((value) => {
    const candidate = value as Partial<OperateExperienceReaderOwner>;
    for (const name of [
      'buildOperateExperienceTransportView',
      'resolveOperateExperienceSearchDestination',
      'selectOperateExperienceSurface',
      'selectOperateExperienceAuditDisplaySurface',
      'selectOperateCycleDisplayWorkspace',
      'selectOperateExecutiveBoardDisplay',
      'selectOperateActionDisplayWorkspace',
      'selectOperateRecoveryDisplay',
    ] as const) {
      if (typeof candidate[name] !== 'function') {
        refuse(
          'CONTRACT_VERSION_UNSUPPORTED',
          'The installed operating experience reader is incompatible.',
        );
      }
    }
    return candidate as OperateExperienceReaderOwner;
  });
  return await readerOwnerPromise;
}

function readRecord(value: unknown, refuse: Refuse): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    refuse('RESULT_CONTRACT_INVALID', 'The accepted lifecycle result is not a JSON object.');
  }
  return value as JsonRecord;
}

function binding(view: JsonRecord): JsonRecord {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead as JsonRecord,
    viewHash: String(view.viewHash),
  };
}

function assertPublicId(value: string, label: string, refuse: Refuse): void {
  if (!isOperatePublicId(value)) {
    refuse('RESULT_CONTRACT_INVALID', `The ${label} identifier is invalid.`);
  }
}

function assertActor(actor: OperateReadActor, label: string, refuse: Refuse): void {
  if (!actor || typeof actor.actorId !== 'string' || actor.actorId.length === 0) {
    refuse('CAPABILITY_DENIED', `An exact ${label} actor is required.`);
  }
}

type ExperienceRead = (input: {
  cycleId: string;
  actor: OperateReadActor;
}) => Promise<ReadEnvelope>;

export async function readOperateCycleWorkspace(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  readCycle: (cycleId: string) => Promise<ReadEnvelope>;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Cycle', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const cycleRead = await input.readCycle(input.cycleId);
  if (!cycleRead.ok) return cycleRead;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateCycleDisplayWorkspace(view, cycleRead, {
    binding: { ...binding(view), cycleId: input.cycleId, subjectId: input.cycleId },
    subjectId: input.cycleId,
  });
}

export async function readOperateActionWorkspace(input: {
  actionId: string;
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.actionId, 'Action', input.refuse);
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Action', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateActionDisplayWorkspace(view, {
    binding: { ...binding(view), actionId: input.actionId, subjectId: input.actionId },
    subjectId: input.actionId,
  });
}

export async function readOperateRecoveryDisplay(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  inspectRecovery: () => Promise<ReadEnvelope>;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'recovery', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const recoveryRead = await input.inspectRecovery();
  if (!recoveryRead.ok) return recoveryRead;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateRecoveryDisplay(view, recoveryRead, { binding: binding(view) });
}

export async function readOperateExecutiveBoardDisplay(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Cycle', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateExecutiveBoardDisplay(view, {
    binding: { ...binding(view), cycleId: input.cycleId, subjectId: input.cycleId },
    subjectId: input.cycleId,
  });
}

function exactAuditDisplayRequest(value: unknown): value is OperateAuditDisplayRequestV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set(['cycleId', 'actor', 'surface', 'subjectId', 'query', 'format']);
    if (
      !(
        keys.every(
          (key) =>
            typeof key === 'string' &&
            allowed.has(key) &&
            descriptors[key]?.get === undefined &&
            descriptors[key]?.set === undefined,
        ) && ['cycleId', 'actor', 'surface'].every((key) => Object.hasOwn(descriptors, key))
      )
    ) {
      return false;
    }
    const cycleId = descriptors.cycleId?.value;
    const surface = descriptors.surface?.value;
    const hasSubject = Object.hasOwn(descriptors, 'subjectId');
    const subjectId = descriptors.subjectId?.value;
    const hasQuery = Object.hasOwn(descriptors, 'query');
    const query = descriptors.query?.value;
    const hasFormat = Object.hasOwn(descriptors, 'format');
    const format = descriptors.format?.value;
    if (
      !isOperatePublicId(cycleId) ||
      !['evidence', 'outcomes', 'outcome', 'history', 'search', 'export'].includes(surface) ||
      (hasSubject && !isOperatePublicId(subjectId)) ||
      (surface === 'outcome' && !hasSubject) ||
      (!['evidence', 'outcome'].includes(surface) && hasSubject) ||
      (hasQuery && (typeof query !== 'string' || query.length > 512)) ||
      (surface !== 'search' && hasQuery) ||
      (hasFormat && !['json', 'html'].includes(format)) ||
      (surface !== 'export' && hasFormat)
    ) {
      return false;
    }
    const actor = descriptors.actor?.value;
    if (actor === null || typeof actor !== 'object' || Array.isArray(actor)) return false;
    const actorPrototype = Object.getPrototypeOf(actor);
    if (actorPrototype !== Object.prototype && actorPrototype !== null) return false;
    const actorDescriptors = Object.getOwnPropertyDescriptors(actor);
    const actorKeys = Reflect.ownKeys(actorDescriptors);
    if (
      !actorKeys.every(
        (key) =>
          typeof key === 'string' &&
          ['actorId', 'kind', 'runtime'].includes(key) &&
          actorDescriptors[key]?.get === undefined &&
          actorDescriptors[key]?.set === undefined,
      ) &&
      ['actorId', 'kind'].every((key) => Object.hasOwn(actorDescriptors, key))
    ) {
      return false;
    }
    const actorId = actorDescriptors.actorId?.value;
    const kind = actorDescriptors.kind?.value;
    const hasRuntime = Object.hasOwn(actorDescriptors, 'runtime');
    const runtime = actorDescriptors.runtime?.value;
    return (
      isOperatePublicId(actorId) &&
      ['agent', 'human'].includes(kind) &&
      (!hasRuntime || (typeof runtime === 'string' && runtime.length > 0 && runtime.length <= 128))
    );
  } catch {
    return false;
  }
}

function assignmentActor(assignment: JsonRecord): OperateActorV2 | undefined {
  const claim = assignment.claim;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return undefined;
  const actorId = (claim as JsonRecord).actorId;
  const runtime = (claim as JsonRecord).runtime;
  if (typeof actorId !== 'string' || !actorId || typeof runtime !== 'string' || !runtime) {
    return undefined;
  }
  return { actorId, kind: 'agent', runtime };
}

function isDurableCycleActor(
  runtime: OperateStoredRuntime,
  snapshot: RuntimeState,
  cycleId: string,
  actor: OperateActorV2,
): boolean {
  if (
    actor.kind === 'human' &&
    runtime.preferences.reviewOwners[cycleId] === actor.actorId &&
    runtime.preferences.actorMemberships[actor.actorId]?.role === 'owner'
  ) {
    return true;
  }
  if (actor.kind !== 'agent' || !actor.runtime) return false;
  return snapshot.assignments.some((assignment) => {
    if (assignment.cycleId !== cycleId) return false;
    const claimed = assignmentActor(assignment);
    return claimed?.actorId === actor.actorId && claimed.runtime === actor.runtime;
  });
}

function bindActorActions(
  actions: JsonRecord[],
  actor: OperateActorV2,
  approvedWorkDispositions: JsonRecord[],
): JsonRecord[] {
  return actions.map((action) => {
    const tool = String(action.tool ?? '');
    if (!['operate.review.get', 'operate.review.submit'].includes(tool)) return action;
    const argumentsValue = record(action.arguments);
    return {
      ...action,
      arguments: {
        ...argumentsValue,
        actor,
        ...(tool === 'operate.review.submit' && argumentsValue.disposition === 'approved'
          ? { workDispositions: approvedWorkDispositions }
          : {}),
      },
    };
  });
}

function projectAllowedAction(action: JsonRecord): JsonRecord {
  if (
    ['operate.assignment.submit', 'operate.review.get', 'operate.review.submit'].includes(
      String(action.tool),
    )
  ) {
    return structuredClone(action);
  }
  const argumentsValue = record(action.arguments);
  const { actor: _actor, ...publicArguments } = argumentsValue;
  return {
    ...action,
    arguments: publicArguments,
  };
}

function governedExperienceActions(
  runtime: OperateStoredRuntime,
  snapshot: RuntimeState,
  cycle: JsonRecord,
  actor: OperateActorV2,
): Array<{ subjectId: string; action: JsonRecord }> {
  const projected: Array<{ subjectId: string; action: JsonRecord }> = [];
  for (const action of snapshot.actions.filter(
    (candidate) => candidate.sourceCycleId === cycle.cycleId,
  )) {
    if (!Object.hasOwn(action, 'actionHash')) continue;
    const evaluations = (snapshot.policyEvaluations ?? [])
      .filter(
        (candidate) =>
          record(candidate.action).actionId === action.actionId &&
          record(candidate.action).revision === action.revision &&
          record(candidate.action).actionHash === action.actionHash,
      )
      .sort(
        (left, right) =>
          String(left.evaluatedAt).localeCompare(String(right.evaluatedAt)) ||
          String(left.evaluationId).localeCompare(String(right.evaluationId)),
      );
    const evaluation = evaluations.at(-1);
    if (!evaluation) continue;
    const requirements = (snapshot.approvalRequirements ?? []).filter(
      (candidate) => candidate.evaluationId === evaluation.evaluationId,
    );
    const approvals = (snapshot.approvalRecords ?? []).filter(
      (candidate) => candidate.evaluationId === evaluation.evaluationId,
    );
    const effectivePolicy = (snapshot.actionPolicies ?? []).find(
      (candidate) =>
        candidate.policyId === record(evaluation.policy).policyId &&
        candidate.policyVersion === record(evaluation.policy).policyVersion &&
        candidate.policyHash === record(evaluation.policy).policyHash,
    );
    if (!effectivePolicy) continue;
    if (
      action.state === 'proposed' &&
      cycle.state === 'approved' &&
      !snapshot.reviews.some(
        (review) =>
          review.state === 'pending' && record(review.subject).actionId === action.actionId,
      )
    ) {
      const party = requirements
        .flatMap((requirement) =>
          Array.isArray(requirement.parties) ? (requirement.parties as JsonRecord[]) : [],
        )
        .find(
          (candidate) => candidate.actorKind === actor.kind && candidate.actorId === actor.actorId,
        );
      if (party) {
        try {
          const allowed = deriveOperateAuthorityAllowedActionsV2({
            actor: {
              ...actor,
              capabilities: [
                {
                  id: String(record(party.requiredCapability).id),
                  version: String(record(party.requiredCapability).version),
                },
              ],
            },
            capabilities: [
              structuredClone(OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2['operate.action.approve']),
            ],
            now: timestamp(),
            action: action as never,
            scope: {
              scopeId: String(action.scopeId),
              domainId: String(action.domainId),
              domainVersion: String(action.domainVersion),
            },
            target: action.targetBinding as never,
            actionPolicy: effectivePolicy as never,
            actionPolicies: snapshot.actionPolicies as never,
            policyEvaluation: evaluation as never,
            approvalRequirements: requirements as never,
            approvals: approvals as never,
          });
          projected.push(
            ...allowed
              .filter(
                (candidate) =>
                  candidate.tool === 'operate.action.approve' &&
                  record(candidate.arguments as unknown as JsonRecord).decision === 'approved',
              )
              .map((candidate) => ({
                subjectId: String(action.actionId),
                action: candidate as unknown as JsonRecord,
              })),
          );
        } catch {
          // The experience is fail-closed: malformed or expired authority emits
          // no browser command and the public state remains readable.
        }
      }
    }
    if (action.state === 'approved' && cycle.state === 'approved') {
      try {
        const disposition = evaluateOperatingApprovalSetV2({
          evaluation: evaluation as never,
          action: action as never,
          requirements: requirements as never,
          approvals: approvals as never,
          now: timestamp(),
        });
        const ownsOperation = snapshot.governedOperations.some(
          (operation) => record(operation.action).actionId === action.actionId,
        );
        if (disposition.complete && disposition.disposition === 'approved' && !ownsOperation) {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.execute',
              arguments: { action: actionIdentity(action) },
              label: 'Execute this exact approved Action',
              effect: action.effectClass,
            },
          });
        }
      } catch {
        // Closed omission; the execution runtime performs the full authority
        // chain again before any contained target is reachable.
      }
    }
    if (action.state === 'completed') {
      const operations = snapshot.governedOperations.filter(
        (operation) => record(operation.action).actionId === action.actionId,
      );
      if (
        !snapshot.outcomes.some(
          (outcome) => outcome.verificationPlanId === action.verificationPlanId,
        )
      ) {
        const terminal = [...operations]
          .filter((operation) => operation.state === 'succeeded')
          .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
          .at(-1);
        const assignment = terminal
          ? snapshot.assignments.find(
              (candidate) =>
                candidate.assignmentKind === 'verification' &&
                candidate.governedOperationId === terminal.operationId &&
                candidate.state === 'running' &&
                record(candidate.claim).actorId === actor.actorId,
            )
          : null;
        const submission = assignment
          ? snapshot.submissions.find(
              (candidate) =>
                candidate.assignmentId === assignment.assignmentId && candidate.state === 'issued',
            )
          : null;
        const verificationPlan = snapshot.verificationPlans.find(
          (candidate) => candidate.verificationPlanId === action.verificationPlanId,
        );
        const sourceArtifactId = assignment
          ? runtime.preferences.assignmentArtifactIds[String(assignment.assignmentId)]
          : null;
        if (assignment && submission && verificationPlan && typeof sourceArtifactId === 'string') {
          try {
            const claimant = record(assignment.claim);
            const records = buildOperatingTerminalVerificationInsufficientEvidenceV2({
              action: action as never,
              verificationPlan: verificationPlan as never,
              assignment: assignment as never,
              sourceArtifactId,
              timestamp: String(submission.issuedAt),
            });
            const allowedAction = {
              subjectId: String(assignment.assignmentId),
              action: {
                tool: 'operate.assignment.submit',
                arguments: {
                  assignmentId: assignment.assignmentId,
                  submissionId: submission.submissionId,
                  actor: {
                    actorId: claimant.actorId,
                    kind: claimant.actorKind,
                    runtime: claimant.runtime,
                  },
                  mediaType: 'application/json',
                  encoding: 'utf-8',
                  contentBase64: Buffer.from(JSON.stringify(records.outcome)).toString('base64'),
                },
                label: 'Record that verification lacks accepted metric evidence',
                effect: 'machine-local-write',
              },
            };
            projected.push(allowedAction);
          } catch {
            // Closed omission. The recording transaction independently proves
            // the accepted Assignment bytes and full terminal authority chain.
          }
        }
      }
      const rollbackPlans = snapshot.rollbackPlans.filter(
        (candidate) =>
          sameActionIdentity(candidate.action, action) &&
          ['eligible', 'required'].includes(String(candidate.eligibility)),
      );
      if (rollbackPlans.length > 0) {
        const { operation: original, plan, binding } = exactRollbackPlanContext(snapshot, action);
        const bindingHash = sha256Jcs({
          contract: 'openplanr-rollback-approval-v1',
          action: actionIdentity(action),
          ...binding,
        });
        const template = exactRollbackApprovalTemplate(snapshot, action, actor);
        const approvalReady =
          exactRollbackApprovalRecord(
            snapshot,
            action,
            actor,
            template,
            bindingHash,
            String(snapshot.generatedAt),
          ) !== null;
        if (approvalReady) {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.rollback',
              arguments: {
                action: actionIdentity(action),
                originalOperationId: original.operationId,
                rollbackPlanId: plan.rollbackPlanId,
              },
              label: 'Rollback this exact reversible Action',
              effect: action.effectClass,
            },
          });
        } else {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.approve',
              arguments: {
                action: actionIdentity(action),
                decision: 'approved',
                rollback: binding,
              },
              label: 'Approve this exact rollback plan',
              effect: action.effectClass,
            },
          });
        }
      }
    }
  }
  return projected;
}

function defaultWorkDispositions(snapshot: RuntimeState, cycleId: string): JsonRecord[] {
  return [
    ...snapshot.findings
      .filter(
        (entry) =>
          entry.sourceCycleId === cycleId && ['open', 'deferred'].includes(String(entry.state)),
      )
      .map((entry) => ({
        entityType: 'operating-finding',
        entityId: entry.findingId,
        disposition: entry.state === 'deferred' ? 'deferred' : 'accepted',
      })),
    ...snapshot.decisions
      .filter((entry) => entry.sourceCycleId === cycleId && entry.state === 'proposed')
      .map((entry) => ({
        entityType: 'operating-decision',
        entityId: entry.decisionId,
        disposition: 'approved',
      })),
    ...snapshot.actions
      .filter((entry) => entry.sourceCycleId === cycleId && entry.state === 'proposed')
      .map((entry) => ({
        entityType: 'operating-action',
        entityId: entry.actionId,
        disposition: 'approved',
      })),
  ];
}

/** Project the access-screened experience view and the actor's allowed actions for one Cycle. */
export async function readOperateExperience(input: {
  request: ExperienceRequest;
  selectedRuntime?: OperateStoredRuntime;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  composition: () => Promise<OperateComposition>;
}): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  if (
    request.surface &&
    ![
      'today',
      'inbox',
      'cycles',
      'cycle',
      'evidence',
      'outcomes',
      'outcome',
      'history',
      'search',
      'export',
      'actions',
      'action',
    ].includes(request.surface)
  ) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The requested operating experience surface is unsupported.',
      false,
    );
  }
  if (request.surface === 'search' && (request.query?.length ?? 0) > 512) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The operating search query exceeds the local read limit.',
      false,
    );
  }
  if (['cycle', 'outcome', 'action'].includes(request.surface ?? '') && !request.subjectId) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'This operating experience surface requires a subject.',
      false,
    );
  }
  if (
    request.surface === 'export' &&
    request.format &&
    !['json', 'html'].includes(request.format)
  ) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The requested operating export format is unsupported.',
      false,
    );
  }
  const runtime = input.selectedRuntime ?? (await input.requiredRuntime());
  if (
    request.actionBinding &&
    (request.actionBinding.cycleId !== request.cycleId ||
      request.actionBinding.actorId !== request.actor.actorId)
  ) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'This emitted action is bound to a different durable operating context.',
      false,
      { cycleId: request.cycleId, bindingMismatch: true },
    );
  }
  const snapshot = state(runtime);
  const cycle = findBy(snapshot.cycles, 'cycleId', request.cycleId);
  if (!cycle) {
    throw new OperateClientError('CYCLE_NOT_FOUND', 'The requested cycle does not exist.', false, {
      cycleId: request.cycleId,
    });
  }
  if (
    request.actionBinding &&
    !isDurableCycleActor(runtime, snapshot, request.cycleId, request.actor)
  ) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'This emitted action is not bound to the durable operating context.',
      false,
      { cycleId: request.cycleId, bindingMismatch: true },
    );
  }
  const review = snapshot.reviews.find(
    (entry) => entry.cycleId === request.cycleId && entry.state === 'pending',
  );
  const reviewedAction =
    review && record(review.subject).type === 'action'
      ? exactAction(snapshot, {
          actionId: String(record(review.subject).actionId),
          revision: Number(record(review.subject).revision),
          actionHash: String(record(review.subject).actionHash),
        })
      : undefined;
  const composition = await input.composition();
  const allowedActionEntries = review
    ? (() => {
        const derived = bindActorActions(
          composition.allowedActions({
            actor: request.actor,
            capabilities: ['operate.review.get', REVIEW_SUBMIT_CAPABILITY],
            cycle,
            review,
            ...(reviewedAction === undefined ? {} : { action: reviewedAction }),
          }),
          request.actor,
          record(review.subject).type === 'action'
            ? []
            : defaultWorkDispositions(snapshot, request.cycleId),
        );
        if (request.actor.kind !== 'human' || review.ownerActorId !== request.actor.actorId) {
          return derived
            .filter((action) => action.tool !== 'operate.review.submit')
            .map((action) => ({ subjectId: String(review.reviewId), action }));
        }
        const exactRead = readOperateReview(runtime, {
          reviewId: String(review.reviewId),
          cycleId: request.cycleId,
          actor: request.actor as OperateActorV2 & { kind: 'human' },
          scope: {
            scopeId: String(cycle.scopeId),
            domainId: String(cycle.domainId),
            domainVersion: String(cycle.domainVersion),
          },
        }) as OperateApiEnvelopeV2<'operate.review.get'>;
        if (!exactRead.ok) return [];
        return [
          ...derived.filter((action) => action.tool !== 'operate.review.submit'),
          ...(exactRead.allowedActions as JsonRecord[]),
        ].map((action) => ({ subjectId: String(review.reviewId), action }));
      })()
    : governedExperienceActions(runtime, snapshot, cycle, request.actor);
  const allowedActions = allowedActionEntries.map((entry) => entry.action);
  const projected = composition.experience({
    state: snapshot,
    baseState: runtime.baseState,
    events: runtime.events,
    cycleId: request.cycleId,
    scope: {
      scopeId: String(cycle.scopeId),
      domainId: String(cycle.domainId),
      domainVersion: String(cycle.domainVersion),
    },
    actor: {
      actorId: request.actor.actorId,
      accessLevel: (() => {
        const membership = runtime.preferences.actorMemberships[request.actor.actorId];
        return membership?.role === 'owner' &&
          membership.scopeId === cycle.scopeId &&
          membership.domainId === cycle.domainId &&
          membership.domainVersion === cycle.domainVersion
          ? 'internal'
          : 'public';
      })(),
    },
    allowedActions: allowedActionEntries.map((entry) => ({
      subjectId: entry.subjectId,
      // Review and Assignment actions carry the exact runtime-issued actor
      // custody required by their frozen command contracts. Other projected
      // commands remain actor-neutral until an authenticated dispatch binds them.
      action: projectAllowedAction(entry.action),
    })),
    routes: runtime.preferences.cycleDeliveryRoutes,
    // Projection identity is durable-state derived. Re-reading or restarting
    // at the same Event head must not manufacture a new view hash.
    generatedAt: String(snapshot.generatedAt),
  });
  if (projected.kind !== 'operate-experience-view') {
    throw new OperateClientError(
      'CONTRACT_VERSION_UNSUPPORTED',
      'The durable operating state cannot be served through the current experience contract.',
      false,
      { cycleId: request.cycleId },
    );
  }
  const owner = await loadOperateExperienceReaderOwner((code, message) => {
    throw new OperateClientError(code, message, false);
  });
  const view = owner.buildOperateExperienceTransportView(projected);
  const selected = request.surface
    ? owner.selectOperateExperienceSurface(view, {
        surface: request.surface,
        binding: {
          actorId: String(view.actorId),
          scopeId: String(view.scopeId),
          domainId: String(view.domainId),
          domainVersion: String(view.domainVersion),
        },
        subjectId: request.subjectId ?? null,
        cycleId: request.cycleId,
        query: request.query ?? '',
        format: request.format ?? 'json',
        projectId: request.projectId ?? null,
        generation: request.generation ?? null,
      })
    : view;
  if (selected === null || (record(selected).ok === false && record(selected).status === 404)) {
    throw new OperateClientError(
      'OPERATE_SUBJECT_NOT_FOUND',
      'The requested operating subject does not exist in this scope.',
      false,
    );
  }
  if (record(selected).ok === false) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The requested operating experience surface could not be selected.',
      false,
    );
  }
  return operateSuccess('operate.experience.get', selected, allowedActions);
}

/** Compose one exact command preview through the installed projection owner. */
export async function createOperateExperiencePreview(input: {
  request: OperateExperiencePreviewRequestV1;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  composition: () => Promise<OperateComposition>;
}): Promise<JsonRecord> {
  const { request } = input;
  const runtime = await input.requiredRuntime();
  const snapshot = state(runtime);
  const cycle = findBy(snapshot.cycles, 'cycleId', request.stateCycleId);
  if (!cycle) {
    throw new OperateClientError('CYCLE_NOT_FOUND', 'The requested cycle does not exist.', false);
  }
  if (String(request.view.actorId) !== request.actor.actorId) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'The preview actor does not match the exact current view.',
      false,
    );
  }
  return (await input.composition()).preview({
    state: snapshot,
    scope: {
      scopeId: String(cycle.scopeId),
      domainId: String(cycle.domainId),
      domainVersion: String(cycle.domainVersion),
    },
    view: request.view,
    actionDigest: request.actionDigest,
    authority: request.authority,
    reasonCodes: request.reasonCodes,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
  });
}

/** Build one owner-selected, browser-verifiable read-only audit display. */
export async function readOperateAuditDisplay(input: {
  request: OperateAuditDisplayRequestV1;
  readExperience: ExperienceRead;
}): Promise<unknown> {
  const { request } = input;
  const auditSurfaces = new Set(['evidence', 'outcomes', 'outcome', 'history', 'search', 'export']);
  if (
    !exactAuditDisplayRequest(request) ||
    !isOperatePublicId(request.cycleId) ||
    !request.actor ||
    typeof request.actor.actorId !== 'string' ||
    !auditSurfaces.has(request.surface)
  ) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The operating audit display request is invalid.',
      false,
    );
  }
  const subjectId = request.subjectId ?? null;
  const query = request.surface === 'search' ? (request.query ?? '') : null;
  const format = request.surface === 'export' ? (request.format ?? 'json') : null;
  if (
    (request.surface === 'outcome' && subjectId === null) ||
    (!['evidence', 'outcome'].includes(request.surface) && subjectId !== null) ||
    (request.surface !== 'search' && request.query !== undefined) ||
    (request.surface !== 'export' && request.format !== undefined) ||
    (typeof query === 'string' && query.length > 512)
  ) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The operating audit display selection is invalid.',
      false,
    );
  }
  const experience = await input.readExperience({
    cycleId: request.cycleId,
    actor: request.actor,
  });
  if (!experience.ok) return experience;
  const view = record(experience.data);
  const owner = await loadOperateExperienceReaderOwner((code, message) => {
    throw new OperateClientError(code, message, false);
  });
  return owner.selectOperateExperienceAuditDisplaySurface(view, {
    surface: request.surface,
    binding: {
      actorId: String(view.actorId),
      scopeId: String(view.scopeId),
      domainId: String(view.domainId),
      domainVersion: String(view.domainVersion),
      cycleId: request.cycleId,
      subjectId,
      surface: request.surface,
      query,
      format,
      generatedAt: String(view.generatedAt),
      eventHead: record(view.eventHead),
      viewHash: String(view.viewHash),
    },
    subjectId,
    cycleId: request.cycleId,
    query,
    format,
  });
}
