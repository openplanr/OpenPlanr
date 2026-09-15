import { randomBytes } from 'node:crypto';
import {
  assertOperatingReviewBoundSubmissionV1,
  buildOperatingReviewBoundSubmissionV1,
  type OperateReviewBoundSubmissionV1,
} from 'planr-pipeline/operate/runtime-v2';
import type { OperatingReviewReceiptV2 } from 'planr-pipeline/protocol';
import { assertOperateExperienceArtifactV2, sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActorV2, OperateApiEnvelopeV2, OperateClient } from './client.js';
import type { JsonRecord } from './composition.js';
import { isOperatePublicId } from './identity-contract.js';
import {
  createOperatingReviewReadGatewayV1,
  type OperatingReviewDisplayReadRequestV1,
} from './review-read-gateway.js';
import {
  createOperateSessionCapabilityIssuerV2,
  type OperateSessionBindingV2,
  type OperateSessionCapabilityIssuerV2,
} from './session-capability.js';

const PREVIEW_TTL_MS = 2 * 60 * 1000;
const MAX_REFERENCES_PER_SESSION = 128;
const MAX_REFERENCES_GLOBAL = 4_096;
const MAX_PREVIEWS_PER_SESSION = 32;
const MAX_PREVIEWS_GLOBAL = 1_024;
const MAX_PREVIEW_TOMBSTONES = 1_024;
const PREVIEW_TOMBSTONE_TTL_MS = 10 * 60 * 1000;
const MAX_GLOBAL_CONFIRMATIONS = 1_024;
const COMMAND_TOOLS = new Set([
  'operate.review.submit',
  'operate.assignment.submit',
  'operate.action.approve',
  'operate.action.execute',
  'operate.action.rollback',
]);
const DETERMINATE_REVIEW_CONFLICT_CODES = new Set([
  'OPERATE_PREVIEW_STALE',
  'OPERATE_ACTION_REFERENCE_STALE',
  'CONCURRENT_MODIFICATION',
  'REVIEW_NOT_FOUND',
  'REVIEW_NOT_PENDING',
  'REVIEW_NOT_AUTHORIZED',
  'STATE_TRANSITION_INVALID',
  'RESULT_CONTRACT_INVALID',
  'OPERATING_SCOPE_INVALID',
]);

type EventHead = { sequence: number; hash: string | null };
type FailureEnvelope = Extract<OperateApiEnvelopeV2, { ok: false }>;
type ReviewWorkspace = Awaited<ReturnType<ReturnType<typeof createOperatingReviewReadGatewayV1>>>;
export type OperatingReviewReadGatewayV1 = (
  request: OperatingReviewDisplayReadRequestV1,
) => Promise<ReviewWorkspace>;
type AllowedAction = {
  tool: string;
  arguments: JsonRecord;
  label: string;
  effect: string;
};

export type OperateCommandSessionRequestV2 = {
  cycleId: string;
  eventHead: EventHead;
  sourceViewHash: string;
  actionLocator: { subjectId: string; actionDigest: string };
  actor: OperateActorV2;
  origin: string;
};

export type OperateCommandPreviewRequestV2 = {
  sessionId: string;
  capability: string;
  origin: string;
  actionReference: string;
};

export type OperateCommandConfirmRequestV2 = {
  sessionId: string;
  capability: string;
  origin: string;
  previewId: string;
  previewHash: string;
  note?: string | null;
};

export type OperateCommandSessionAssertionV2 = {
  sessionId: string;
  capability: string;
  origin: string;
};

export type OperateCommandRuntimeV2 = {
  perform(input: {
    action: AllowedAction;
    actor: OperateActorV2;
    binding: OperateSessionBindingV2;
    previewId: string;
    previewHash: string;
    note: string | null;
  }): Promise<OperateApiEnvelopeV2>;
};

type ActionReference = {
  reference: string;
  sessionId: string;
  binding: OperateSessionBindingV2;
  action: AllowedAction;
  actionDigest: string;
  expiresAtMs: number;
};

type PreviewRecord = {
  preview: JsonRecord;
  sessionId: string;
  actionReference: string;
  action: AllowedAction;
  actionDigest: string;
  binding: OperateSessionBindingV2;
  expiresAtMs: number;
  sessionExpiresAtMs: number;
  terminal: CommandResult | null;
  terminalConfirmationHash: string | null;
  confirmation: {
    confirmationHash: string;
    promise: Promise<CommandResult>;
  } | null;
};

type PreviewTombstone = {
  sessionId: string;
  retainedUntilMs: number;
};

export type OperateReviewCommandConfirmationV1 = Readonly<{
  ok: true;
  operation: 'operate.review.submit';
  data: Readonly<{
    receipt: OperatingReviewReceiptV2;
    workspace: ReviewWorkspace;
  }>;
  allowedActions: readonly [];
  eventHead: EventHead;
}>;

type CommandResult =
  | (OperateApiEnvelopeV2 & { eventHead?: EventHead })
  | OperateReviewCommandConfirmationV1;

type GlobalConfirmation = {
  confirmationHash: string;
  promise: Promise<CommandResult>;
  terminal: CommandResult | null;
};

const confirmationsByClient = new WeakMap<OperateClient, Map<string, GlobalConfirmation>>();

function processConfirmations(client: OperateClient): Map<string, GlobalConfirmation> {
  const existing = confirmationsByClient.get(client);
  if (existing) return existing;
  const created = new Map<string, GlobalConfirmation>();
  confirmationsByClient.set(client, created);
  return created;
}

export class OperateCommandGatewayErrorV2 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = code;
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function hashJson(value: unknown): string {
  return sha256Jcs(value as never);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_COMMAND_INVALID',
      `${label} is unavailable from the current runtime projection.`,
      400,
    );
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, fields: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_COMMAND_INVALID',
      `${label} contains an unsupported field.`,
      400,
    );
  }
}

function eventHead(value: unknown): EventHead {
  const head = record(value, 'The Event head');
  if (
    !Number.isSafeInteger(head.sequence) ||
    Number(head.sequence) < 0 ||
    (head.sequence === 0 ? head.hash !== null : !/^sha256:[a-f0-9]{64}$/u.test(String(head.hash)))
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_COMMAND_INVALID',
      'The current runtime projection has an invalid Event head.',
    );
  }
  return { sequence: Number(head.sequence), hash: head.hash as string | null };
}

function sameHead(left: EventHead, right: EventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function exactLocator(value: unknown): { subjectId: string; actionDigest: string } {
  const locator = record(value, 'The action locator');
  exactKeys(locator, ['subjectId', 'actionDigest'], 'The action locator');
  if (
    !isOperatePublicId(locator.subjectId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(locator.actionDigest))
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_COMMAND_INVALID',
      'The action locator is invalid.',
      400,
    );
  }
  return {
    subjectId: String(locator.subjectId),
    actionDigest: String(locator.actionDigest),
  };
}

function sameLocator(
  left: { subjectId: string; actionDigest: string },
  right: { subjectId: string; actionDigest: string },
): boolean {
  return left.subjectId === right.subjectId && left.actionDigest === right.actionDigest;
}

function previewKey(sessionId: string, previewId: string): string {
  return `${sessionId}\u0000${previewId}`;
}

function confirmationIdentity(binding: OperateSessionBindingV2): string {
  return hashJson({
    actorId: binding.actorId,
    scopeId: binding.scopeId,
    domainId: binding.domainId,
    domainVersion: binding.domainVersion,
    cycleId: binding.cycleId,
    eventHead: binding.eventHead,
    actionDigest: binding.actionLocator.actionDigest,
  });
}

function confirmationHash(binding: OperateSessionBindingV2, note: string | null): string {
  return hashJson({
    confirmationIdentity: confirmationIdentity(binding),
    note,
  });
}

function exactConfirmationFields(request: OperateCommandConfirmRequestV2, label: string): void {
  exactKeys(
    request as unknown as JsonRecord,
    Object.hasOwn(request, 'note')
      ? ['sessionId', 'capability', 'origin', 'previewId', 'previewHash', 'note']
      : ['sessionId', 'capability', 'origin', 'previewId', 'previewHash'],
    label,
  );
}

function confirmationNote(request: OperateCommandConfirmRequestV2): string | null {
  if (!Object.hasOwn(request, 'note') || request.note === null) return null;
  if (
    typeof request.note !== 'string' ||
    request.note.length > 2_048 ||
    !/^\S(?:[\s\S]*\S)?$/u.test(request.note)
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_COMMAND_INVALID',
      'The optional Review note is invalid.',
      400,
    );
  }
  return request.note;
}

function assertExactViewBinding(view: JsonRecord, binding: OperateSessionBindingV2): void {
  const cycles = Array.isArray(view.cycles) ? view.cycles : [];
  if (
    view.actorId !== binding.actorId ||
    view.scopeId !== binding.scopeId ||
    view.domainId !== binding.domainId ||
    view.domainVersion !== binding.domainVersion ||
    !cycles.some(
      (candidate) =>
        candidate !== null &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        (candidate as JsonRecord).cycleId === binding.cycleId,
    )
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_BINDING_MISMATCH',
      'The durable projection does not match the authenticated command binding.',
      403,
    );
  }
}

function action(value: unknown): AllowedAction {
  const candidate = record(value, 'The allowed action');
  exactKeys(candidate, ['tool', 'arguments', 'label', 'effect'], 'The allowed action');
  if (!COMMAND_TOOLS.has(String(candidate.tool))) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_ACTION_NOT_COMMANDABLE',
      'The selected runtime action is read-only or unsupported by the local command gateway.',
      400,
    );
  }
  return {
    tool: String(candidate.tool),
    arguments: structuredClone(record(candidate.arguments, 'The allowed action arguments')),
    label: String(candidate.label),
    effect: String(candidate.effect),
  };
}

function commandActions(value: unknown): Array<{ subjectId: string; action: AllowedAction }> {
  if (!Array.isArray(value)) return [];
  const selected: Array<{ subjectId: string; action: AllowedAction }> = [];
  for (const entry of value) {
    const bound = record(entry, 'The bound allowed action');
    const candidate = record(bound.action, 'The allowed action');
    if (!COMMAND_TOOLS.has(String(candidate.tool))) continue;
    selected.push({
      subjectId: String(bound.subjectId),
      action: action(candidate),
    });
  }
  return selected;
}

function safeFailure(
  operation: string,
  cause: unknown,
  allowedActions: unknown[] = [],
): FailureEnvelope {
  const code =
    typeof (cause as { code?: unknown })?.code === 'string'
      ? String((cause as { code: string }).code)
      : 'STATE_TRANSITION_INVALID';
  const message =
    code === 'OPERATION_UNCERTAIN'
      ? 'The durable result is uncertain. Inspect recovery state; do not retry blindly.'
      : 'The governed command was refused without effect.';
  return {
    ok: false,
    operation: operation as never,
    error: { code: code as never, message, retryable: false, context: {} },
    allowedActions: structuredClone(allowedActions),
  };
}

function reviewDisplayRequest(
  selected: AllowedAction,
  actor: OperateActorV2,
  binding: OperateSessionBindingV2,
): OperatingReviewDisplayReadRequestV1 {
  const argumentsValue = record(selected.arguments, 'The Review choice arguments');
  const selectedActor = record(argumentsValue.actor, 'The Review choice actor');
  const scope = record(argumentsValue.scope, 'The Review choice scope');
  if (
    selected.tool !== 'operate.review.submit' ||
    selected.effect !== 'project-write' ||
    !isOperatePublicId(argumentsValue.reviewId) ||
    argumentsValue.cycleId !== binding.cycleId ||
    selectedActor.actorId !== actor.actorId ||
    selectedActor.kind !== 'human' ||
    selectedActor.runtime !== actor.runtime ||
    scope.scopeId !== binding.scopeId ||
    scope.domainId !== binding.domainId ||
    scope.domainVersion !== binding.domainVersion
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_BINDING_MISMATCH',
      'The Review choice does not match the authenticated command binding.',
      403,
    );
  }
  return {
    cycleId: binding.cycleId,
    reviewId: String(argumentsValue.reviewId),
    actorId: actor.actorId,
    scopeId: binding.scopeId,
    domainId: binding.domainId,
    domainVersion: binding.domainVersion,
  };
}

function currentReviewActions(workspace: ReviewWorkspace): unknown[] {
  const capability = workspace.payload.data.capability;
  return capability.available
    ? capability.actions.map(({ action: selected }) => structuredClone(selected))
    : [];
}

function boundReviewSubmission(
  selected: AllowedAction,
  workspace: ReviewWorkspace,
  binding: OperateSessionBindingV2,
  note: string | null,
): OperateReviewBoundSubmissionV1 {
  if (
    workspace.payload.status !== 'ready' ||
    !workspace.payload.mutationEnabled ||
    !sameHead(workspace.payload.sourceReadEventHead, binding.eventHead)
  ) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_PREVIEW_STALE',
      'The Review read changed after the governed preview.',
      409,
    );
  }
  const exact = workspace.payload.data.choices.filter(
    (choice) => hashJson(choice.submitArguments) === hashJson(selected.arguments),
  );
  if (exact.length !== 1) {
    throw new OperateCommandGatewayErrorV2(
      'OPERATE_ACTION_REFERENCE_STALE',
      'The Review choice is no longer advertised by the exact owner read.',
      409,
    );
  }
  const submission = buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: workspace.payload.sourceReadEventHead,
    choice: exact[0],
    note,
  });
  assertOperatingReviewBoundSubmissionV1(submission);
  return submission;
}

function assertReviewConfirmation(
  receiptValue: unknown,
  workspace: ReviewWorkspace,
  selected: AllowedAction,
  expectedNote: string | null,
): OperatingReviewReceiptV2 {
  const receipt = record(
    receiptValue,
    'The immutable Review receipt',
  ) as unknown as OperatingReviewReceiptV2;
  const terminal = workspace.payload.data.terminalDisposition;
  const appliedChoice = receipt.dispositionChoices.find(
    (choice) =>
      choice.choiceId === receipt.appliedChoiceId &&
      choice.choiceHash === receipt.appliedChoiceHash,
  );
  const boundSubmission = receipt.boundSubmission;
  if (boundSubmission === undefined) {
    throw Object.assign(new Error('The Review receipt has no owner-bound submission.'), {
      code: 'OPERATION_UNCERTAIN',
    });
  }
  try {
    assertOperatingReviewBoundSubmissionV1(boundSubmission);
  } catch {
    throw Object.assign(new Error('The Review receipt has no valid owner-bound submission.'), {
      code: 'OPERATION_UNCERTAIN',
    });
  }
  if (
    receipt.kind !== 'operating-review-receipt' ||
    workspace.payload.sourceArtifactKind !== 'operating-review-receipt' ||
    workspace.payload.sourceArtifactHash !== hashJson(receipt) ||
    workspace.payload.cycleId !== receipt.cycleId ||
    workspace.payload.reviewId !== receipt.review.reviewId ||
    !sameHead(workspace.payload.sourceReadEventHead, receipt.readEventHead) ||
    !sameHead(workspace.payload.sourceEventHead, receipt.eventHead) ||
    terminal === null ||
    terminal.receiptId !== receipt.receiptId ||
    terminal.appliedChoiceId !== receipt.appliedChoiceId ||
    terminal.appliedChoiceHash !== receipt.appliedChoiceHash ||
    hashJson(receipt.appliedWorkDispositions) !== hashJson(receipt.review.workDispositions) ||
    appliedChoice === undefined ||
    hashJson(appliedChoice.submitArguments) !== hashJson(selected.arguments) ||
    !sameHead(boundSubmission.expectedReadEventHead, receipt.readEventHead) ||
    boundSubmission.choiceId !== receipt.appliedChoiceId ||
    boundSubmission.choiceHash !== receipt.appliedChoiceHash ||
    hashJson(boundSubmission.submitArguments) !== hashJson(selected.arguments) ||
    boundSubmission.note !== expectedNote
  ) {
    throw Object.assign(new Error('The Review receipt and refreshed workspace diverge.'), {
      code: 'OPERATION_UNCERTAIN',
    });
  }
  return structuredClone(receipt);
}

/**
 * Opaque browser facade over runtime-issued actions. It never accepts a grant,
 * executor, connector, operation identity, target, approval set, payload, or
 * effect class from the caller.
 */
export class OperateCommandGateway {
  private readonly references = new Map<string, ActionReference>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly previewTombstones = new Map<string, PreviewTombstone>();
  private readonly confirmations: Map<string, GlobalConfirmation>;
  private readonly getOperatingReviewRead?: OperatingReviewReadGatewayV1;

  constructor(
    private readonly client: OperateClient,
    private readonly runtime: OperateCommandRuntimeV2,
    private readonly sessions: OperateSessionCapabilityIssuerV2 = createOperateSessionCapabilityIssuerV2(),
    private readonly now: () => number = Date.now,
    private readonly onView?: (view: JsonRecord) => void,
    getOperatingReviewRead?: OperatingReviewReadGatewayV1,
  ) {
    this.confirmations = processConfirmations(client);
    this.getOperatingReviewRead = getOperatingReviewRead;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [reference, value] of this.references) {
      if (now >= value.expiresAtMs) this.references.delete(reference);
    }
    for (const [key, value] of this.previews) {
      if (now >= value.expiresAtMs || now >= value.sessionExpiresAtMs) {
        this.previews.delete(key);
        this.previewTombstones.set(key, {
          sessionId: value.sessionId,
          retainedUntilMs: now + PREVIEW_TOMBSTONE_TTL_MS,
        });
      }
    }
    for (const [key, value] of this.previewTombstones) {
      if (now >= value.retainedUntilMs) this.previewTombstones.delete(key);
    }
    while (this.previewTombstones.size > MAX_PREVIEW_TOMBSTONES) {
      const oldest = this.previewTombstones.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.previewTombstones.delete(oldest);
    }
  }

  private previewCount(sessionId: string): number {
    let count = 0;
    for (const value of this.previews.values()) {
      if (value.sessionId === sessionId) count += 1;
    }
    return count;
  }

  private async resolveReviewSessionAction(
    selected: AllowedAction,
    actor: OperateActorV2,
    binding: OperateSessionBindingV2,
    requestedLocator: Readonly<{ subjectId: string; actionDigest: string }>,
  ): Promise<AllowedAction> {
    const readRequest = reviewDisplayRequest(selected, actor, binding);
    if (!this.getOperatingReviewRead) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_STALE',
        'The selected Review choice is unavailable from the exact owner read.',
        409,
      );
    }
    let workspace: ReviewWorkspace;
    try {
      workspace = await this.getOperatingReviewRead(readRequest);
      const payload = workspace.payload;
      const capability = payload.data.capability;
      const matches = capability.available
        ? commandActions(capability.actions).filter(
            (entry) =>
              entry.subjectId === requestedLocator.subjectId &&
              hashJson(entry.action) === requestedLocator.actionDigest,
          )
        : [];
      if (
        workspace.kind !== 'operate-review-display-workspace' ||
        payload.status !== 'ready' ||
        !payload.mutationEnabled ||
        payload.actorId !== binding.actorId ||
        payload.scopeId !== binding.scopeId ||
        payload.domainId !== binding.domainId ||
        payload.domainVersion !== binding.domainVersion ||
        payload.cycleId !== binding.cycleId ||
        payload.reviewId !== requestedLocator.subjectId ||
        !sameHead(payload.sourceEventHead, binding.eventHead) ||
        !sameHead(payload.sourceReadEventHead, binding.eventHead) ||
        payload.sourceViewHash !== binding.sourceViewHash ||
        matches.length !== 1
      ) {
        throw new Error('stale Review workspace');
      }
      reviewDisplayRequest(matches[0].action, actor, binding);
      return matches[0].action;
    } catch {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_STALE',
        'The selected Review choice is unavailable from the exact owner read.',
        409,
      );
    }
  }

  /**
   * Authenticate one process-local browser session without reading the current
   * projection, resolving an action/preview, publishing a view, or dispatching
   * the command runtime. The dashboard transport uses only this transient safe
   * binding to reject HTTP actor/scope substitution before preview/confirm.
   */
  assertSessionBinding(
    request: OperateCommandSessionAssertionV2,
  ): Readonly<OperateSessionBindingV2> {
    exactKeys(
      request as unknown as JsonRecord,
      ['sessionId', 'capability', 'origin'],
      'The session assertion',
    );
    try {
      const session = this.sessions.assert(request);
      return Object.freeze(structuredClone(session.binding));
    } catch (cause) {
      const code =
        typeof (cause as { code?: unknown })?.code === 'string'
          ? String((cause as { code: string }).code)
          : 'OPERATE_SESSION_DENIED';
      throw new OperateCommandGatewayErrorV2(
        code,
        'The local command session assertion was refused.',
        code === 'OPERATE_ORIGIN_INVALID' ? 403 : 401,
      );
    }
  }

  async issueSession(request: OperateCommandSessionRequestV2) {
    this.pruneExpired();
    exactKeys(
      request as unknown as JsonRecord,
      ['cycleId', 'eventHead', 'sourceViewHash', 'actionLocator', 'actor', 'origin'],
      'The session request',
    );
    const requestedHead = eventHead(request.eventHead);
    const requestedLocator = exactLocator(request.actionLocator);
    const view = await this.currentView(request.cycleId, request.actor);
    if (
      !sameHead(eventHead(view.eventHead), requestedHead) ||
      view.viewHash !== request.sourceViewHash
    ) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_SESSION_STALE',
        'The requested command session does not match the exact current view.',
      );
    }
    const binding: OperateSessionBindingV2 = {
      actorId: request.actor.actorId,
      scopeId: String(view.scopeId),
      domainId: String(view.domainId),
      domainVersion: String(view.domainVersion),
      cycleId: request.cycleId,
      eventHead: requestedHead,
      sourceViewHash: request.sourceViewHash,
      actionLocator: requestedLocator,
    };
    assertExactViewBinding(view, binding);
    const inboxMatches = (Array.isArray(view.inbox) ? view.inbox : []).filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const item = entry as JsonRecord;
      if (!item.actionLocator || typeof item.actionLocator !== 'object') return false;
      const locator = item.actionLocator as JsonRecord;
      return (
        locator.subjectId === requestedLocator.subjectId &&
        locator.actionDigest === requestedLocator.actionDigest
      );
    });
    const projected =
      view.status === 'ready'
        ? commandActions(view.allowedActions).filter(
            (entry) =>
              entry.subjectId === requestedLocator.subjectId &&
              hashJson(entry.action) === requestedLocator.actionDigest,
          )
        : [];
    if (projected.length !== 1) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_STALE',
        'The selected Inbox action is unavailable in the exact current owner view.',
        409,
      );
    }
    let selected = projected[0].action;
    if (selected.tool === 'operate.review.submit') {
      selected = await this.resolveReviewSessionAction(
        selected,
        request.actor,
        binding,
        requestedLocator,
      );
    } else if (inboxMatches.length > 1) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_STALE',
        'The selected Inbox action is unavailable in the exact current owner view.',
        409,
      );
    } else if (inboxMatches.length === 0) {
      const actions = Array.isArray(view.actions) ? view.actions : [];
      if (
        !actions.some(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            (entry as JsonRecord).actionId === requestedLocator.subjectId,
        )
      ) {
        throw new OperateCommandGatewayErrorV2(
          'OPERATE_ACTION_REFERENCE_STALE',
          'The selected Inbox action is unavailable in the exact current owner view.',
          409,
        );
      }
    }
    if (MAX_REFERENCES_PER_SESSION < 1 || this.references.size + 1 > MAX_REFERENCES_GLOBAL) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_REFERENCE_LIMIT',
        'The bounded command-reference capacity is temporarily exhausted.',
        429,
      );
    }
    this.publishView(view);
    const issued = this.sessions.issue(binding, request.origin);
    const reference = id('opact');
    this.references.set(reference, {
      reference,
      sessionId: issued.sessionId,
      binding: structuredClone(binding),
      action: selected,
      actionDigest: requestedLocator.actionDigest,
      expiresAtMs: Date.parse(issued.expiresAt),
    });
    return Object.freeze({
      kind: 'operate-command-session',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      sessionId: issued.sessionId,
      sessionCapability: issued.capability,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      binding,
      allowedActions: [
        Object.freeze({
          actionReference: reference,
          subjectId: requestedLocator.subjectId,
          actionDigest: requestedLocator.actionDigest,
        }),
      ],
      readOnly: view.status !== 'ready',
    });
  }

  async preview(request: OperateCommandPreviewRequestV2) {
    this.pruneExpired();
    exactKeys(
      request as unknown as JsonRecord,
      ['sessionId', 'capability', 'origin', 'actionReference'],
      'The preview request',
    );
    const reference = this.references.get(request.actionReference);
    if (!reference || reference.sessionId !== request.sessionId) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_INVALID',
        'The selected runtime-issued action is unavailable.',
        404,
      );
    }
    this.sessions.authorize({
      sessionId: request.sessionId,
      capability: request.capability,
      origin: request.origin,
      binding: reference.binding,
    });
    const current = await this.currentView(reference.binding.cycleId, {
      actorId: reference.binding.actorId,
      kind: 'human',
      runtime: 'openplanr',
    });
    const currentHead = eventHead(current.eventHead);
    assertExactViewBinding(current, reference.binding);
    if (
      !sameHead(currentHead, reference.binding.eventHead) ||
      current.viewHash !== reference.binding.sourceViewHash
    ) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_STALE',
        'Durable state changed. Refresh the current allowed actions before previewing.',
      );
    }
    const currentActions = commandActions(current.allowedActions).filter((entry) =>
      sameLocator(
        {
          subjectId: entry.subjectId,
          actionDigest: hashJson(entry.action),
        },
        reference.binding.actionLocator,
      ),
    );
    if (currentActions.length !== 1) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_ACTION_REFERENCE_STALE',
        'The selected action is no longer allowed for the current actor and state.',
      );
    }
    this.publishView(current);
    const issuedAtMs = this.now();
    if (
      this.previews.size >= MAX_PREVIEWS_GLOBAL ||
      this.previewCount(request.sessionId) >= MAX_PREVIEWS_PER_SESSION
    ) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_LIMIT',
        'The bounded preview capacity is temporarily exhausted.',
        429,
      );
    }
    const projection = await this.client.createExperiencePreview({
      stateCycleId: reference.binding.cycleId,
      actor: {
        actorId: reference.binding.actorId,
        kind: 'human',
        runtime: 'openplanr',
      },
      view: current,
      actionDigest: reference.actionDigest,
      authority: current.status === 'ready' ? 'allowed' : 'read-only',
      reasonCodes: current.status === 'ready' ? [] : ['OPERATE_READ_ONLY'],
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + PREVIEW_TTL_MS).toISOString(),
    });
    assertOperateExperienceArtifactV2('operate-experience-preview', projection);
    this.previews.set(previewKey(reference.sessionId, String(projection.previewId)), {
      preview: structuredClone(projection),
      sessionId: reference.sessionId,
      actionReference: reference.reference,
      action: structuredClone(reference.action),
      actionDigest: reference.actionDigest,
      binding: structuredClone(reference.binding),
      expiresAtMs: issuedAtMs + PREVIEW_TTL_MS,
      sessionExpiresAtMs: reference.expiresAtMs,
      terminal: null,
      terminalConfirmationHash: null,
      confirmation: null,
    });
    return Object.freeze(structuredClone(projection));
  }

  async confirm(request: OperateCommandConfirmRequestV2): Promise<CommandResult> {
    this.pruneExpired();
    exactConfirmationFields(request, 'The confirmation request');
    const note = confirmationNote(request);
    this.sessions.assert({
      sessionId: request.sessionId,
      capability: request.capability,
      origin: request.origin,
    });
    const key = previewKey(request.sessionId, request.previewId);
    const preview = this.previews.get(key);
    if (!preview || preview.sessionId !== request.sessionId) {
      if (this.previewTombstones.has(key)) {
        throw new OperateCommandGatewayErrorV2(
          'OPERATE_PREVIEW_EXPIRED',
          'The governed preview expired. Request a fresh preview.',
          409,
        );
      }
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_INVALID',
        'The governed preview is unavailable.',
        404,
      );
    }
    this.sessions.authorize({
      sessionId: request.sessionId,
      capability: request.capability,
      origin: request.origin,
      binding: preview.binding,
    });
    if (request.previewHash !== preview.preview.previewHash) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_CONFLICT',
        'The confirmation digest differs from the runtime-issued preview.',
      );
    }
    if (Object.hasOwn(request, 'note') && preview.action.tool !== 'operate.review.submit') {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_COMMAND_INVALID',
        'A confirmation note is supported only for Review submission.',
        400,
      );
    }
    const requestConfirmationHash = confirmationHash(preview.binding, note);
    if (preview.terminal) {
      if (preview.terminalConfirmationHash !== requestConfirmationHash) {
        throw new OperateCommandGatewayErrorV2(
          'OPERATE_PREVIEW_CONFLICT',
          'The confirmation differs from the already committed preview.',
          409,
        );
      }
      return structuredClone(preview.terminal);
    }
    if (this.now() >= preview.expiresAtMs) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_EXPIRED',
        'The governed preview expired. Request a fresh preview.',
      );
    }
    const identity = confirmationIdentity(preview.binding);
    const shared = this.confirmations.get(identity);
    if (shared) {
      if (shared.confirmationHash !== requestConfirmationHash) {
        throw new OperateCommandGatewayErrorV2(
          'OPERATE_PREVIEW_CONFLICT',
          'The confirmation differs from the in-flight or committed owner choice.',
          409,
        );
      }
      const result = structuredClone(await shared.promise);
      preview.terminal = structuredClone(result);
      preview.terminalConfirmationHash = requestConfirmationHash;
      return result;
    }
    if (this.confirmations.size >= MAX_GLOBAL_CONFIRMATIONS) {
      for (const [candidate, record] of this.confirmations) {
        if (record.terminal !== null) this.confirmations.delete(candidate);
        if (this.confirmations.size < MAX_GLOBAL_CONFIRMATIONS) break;
      }
    }
    if (this.confirmations.size >= MAX_GLOBAL_CONFIRMATIONS) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_CONFIRMATION_LIMIT',
        'The bounded process-local confirmation capacity is exhausted.',
        429,
      );
    }
    const promise = this.performConfirmation(preview, request, note);
    const global: GlobalConfirmation = {
      confirmationHash: requestConfirmationHash,
      promise,
      terminal: null,
    };
    this.confirmations.set(identity, global);
    preview.confirmation = { confirmationHash: requestConfirmationHash, promise };
    try {
      const result = structuredClone(await promise);
      global.terminal = structuredClone(result);
      if (preview.terminal) preview.terminalConfirmationHash = requestConfirmationHash;
      return result;
    } catch (cause) {
      this.confirmations.delete(identity);
      throw cause;
    } finally {
      if (!preview.terminal) preview.confirmation = null;
    }
  }

  assertPreviewBinding(request: OperateCommandConfirmRequestV2): {
    binding: OperateSessionBindingV2;
    operation: string;
  } {
    this.pruneExpired();
    exactConfirmationFields(request, 'The confirmation binding request');
    confirmationNote(request);
    this.sessions.assert({
      sessionId: request.sessionId,
      capability: request.capability,
      origin: request.origin,
    });
    const key = previewKey(request.sessionId, request.previewId);
    const preview = this.previews.get(key);
    if (!preview || preview.sessionId !== request.sessionId) {
      if (this.previewTombstones.has(key)) {
        throw new OperateCommandGatewayErrorV2(
          'OPERATE_PREVIEW_EXPIRED',
          'The governed preview expired. Request a fresh preview.',
          409,
        );
      }
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_INVALID',
        'The governed preview is unavailable.',
        404,
      );
    }
    this.sessions.authorize({
      sessionId: request.sessionId,
      capability: request.capability,
      origin: request.origin,
      binding: preview.binding,
    });
    if (request.previewHash !== preview.preview.previewHash) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_CONFLICT',
        'The confirmation digest differs from the runtime-issued preview.',
      );
    }
    if (Object.hasOwn(request, 'note') && preview.action.tool !== 'operate.review.submit') {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_COMMAND_INVALID',
        'A confirmation note is supported only for Review submission.',
        400,
      );
    }
    if (this.now() >= preview.expiresAtMs) {
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_EXPIRED',
        'The governed preview expired. Request a fresh preview.',
      );
    }
    return Object.freeze({
      binding: Object.freeze(structuredClone(preview.binding)),
      operation: preview.action.tool,
    });
  }

  private async performConfirmation(
    preview: PreviewRecord,
    request: OperateCommandConfirmRequestV2,
    note: string | null,
  ): Promise<CommandResult> {
    const authenticatedActor = {
      actorId: preview.binding.actorId,
      kind: 'human' as const,
      runtime: 'openplanr',
    };
    let current: JsonRecord;
    try {
      current = await this.currentView(preview.binding.cycleId, authenticatedActor);
      assertExactViewBinding(current, preview.binding);
    } catch (cause) {
      if (preview.action.tool === 'operate.review.submit' && this.getOperatingReviewRead) {
        return await this.reviewConflict(preview, { code: 'CONCURRENT_MODIFICATION' });
      }
      throw cause;
    }
    if (
      current.status !== 'ready' ||
      !sameHead(eventHead(current.eventHead), preview.binding.eventHead) ||
      current.viewHash !== preview.binding.sourceViewHash ||
      commandActions(current.allowedActions).filter((entry) =>
        sameLocator(
          {
            subjectId: entry.subjectId,
            actionDigest: hashJson(entry.action),
          },
          preview.binding.actionLocator,
        ),
      ).length !== 1
    ) {
      if (preview.action.tool === 'operate.review.submit' && this.getOperatingReviewRead) {
        return await this.reviewConflict(preview, { code: 'CONCURRENT_MODIFICATION' });
      }
      throw new OperateCommandGatewayErrorV2(
        'OPERATE_PREVIEW_STALE',
        'Authority or durable state changed after preview. Nothing was executed.',
      );
    }
    this.publishView(current);
    let result: OperateApiEnvelopeV2;
    try {
      result = await this.runtime.perform({
        action: structuredClone(preview.action),
        actor: {
          actorId: preview.binding.actorId,
          kind: 'human',
          runtime: 'openplanr',
        },
        binding: structuredClone(preview.binding),
        previewId: request.previewId,
        previewHash: request.previewHash,
        note,
      });
    } catch (cause) {
      const failure =
        preview.action.tool === 'operate.review.submit'
          ? await this.reviewConflict(preview, cause)
          : safeFailure(preview.action.tool, cause);
      if ((failure.error.code as string) === 'OPERATION_UNCERTAIN') preview.terminal = failure;
      return failure;
    }
    if (!result.ok) {
      const failure =
        preview.action.tool === 'operate.review.submit'
          ? await this.reviewConflict(preview, { code: result.error.code })
          : safeFailure(preview.action.tool, { code: result.error.code });
      if ((failure.error.code as string) === 'OPERATION_UNCERTAIN') preview.terminal = failure;
      return failure;
    }
    try {
      const durableView = await this.currentView(preview.binding.cycleId, {
        actorId: preview.binding.actorId,
        kind: 'human',
        runtime: 'openplanr',
      });
      const durableHead = eventHead(durableView.eventHead);
      assertExactViewBinding(durableView, preview.binding);
      if (
        durableHead.sequence <= preview.binding.eventHead.sequence ||
        durableHead.hash === preview.binding.eventHead.hash
      ) {
        throw Object.assign(new Error('The durable public projection did not advance.'), {
          code: 'OPERATION_UNCERTAIN',
        });
      }
      if (preview.action.tool === 'operate.review.submit' && this.getOperatingReviewRead) {
        const workspace = await this.getOperatingReviewRead(
          reviewDisplayRequest(preview.action, authenticatedActor, preview.binding),
        );
        const receipt = assertReviewConfirmation(result.data, workspace, preview.action, note);
        if (
          durableHead.sequence < receipt.eventHead.sequence ||
          (durableHead.sequence === receipt.eventHead.sequence &&
            durableHead.hash !== receipt.eventHead.hash)
        ) {
          throw Object.assign(
            new Error('The immutable Review receipt is not visible in the durable projection.'),
            { code: 'OPERATION_UNCERTAIN' },
          );
        }
        const publicResult: OperateReviewCommandConfirmationV1 = {
          ok: true,
          operation: 'operate.review.submit',
          data: { receipt, workspace: structuredClone(workspace) },
          allowedActions: [],
          eventHead: structuredClone(receipt.eventHead),
        };
        this.publishView(durableView);
        preview.terminal = structuredClone(publicResult);
        return publicResult;
      }
      const publicResult: CommandResult = {
        ok: true,
        operation: preview.action.tool as never,
        data: durableView,
        allowedActions: [],
        eventHead: durableHead,
      };
      this.publishView(durableView);
      preview.terminal = structuredClone(publicResult);
      return publicResult;
    } catch {
      const uncertainty = safeFailure(preview.action.tool, { code: 'OPERATION_UNCERTAIN' });
      preview.terminal = uncertainty;
      return uncertainty;
    }
  }

  private async reviewConflict(preview: PreviewRecord, cause: unknown): Promise<FailureEnvelope> {
    const sourceCode =
      typeof (cause as { code?: unknown })?.code === 'string'
        ? String((cause as { code: string }).code)
        : null;
    const publicCause =
      sourceCode === 'CAPABILITY_DENIED'
        ? cause
        : DETERMINATE_REVIEW_CONFLICT_CODES.has(sourceCode ?? '')
          ? { code: 'CONCURRENT_MODIFICATION' }
          : { code: 'OPERATION_UNCERTAIN' };
    if (!this.getOperatingReviewRead) return safeFailure(preview.action.tool, publicCause);
    try {
      const workspace = await this.getOperatingReviewRead(
        reviewDisplayRequest(
          preview.action,
          {
            actorId: preview.binding.actorId,
            kind: 'human',
            runtime: 'openplanr',
          },
          preview.binding,
        ),
      );
      return safeFailure(preview.action.tool, publicCause, currentReviewActions(workspace));
    } catch {
      return safeFailure(preview.action.tool, publicCause);
    }
  }

  /**
   * Read the adapter-owned recovery envelope without exposing the client's
   * generic dispatch surface to the dashboard server.
   */
  async inspectRecovery(): Promise<OperateApiEnvelopeV2> {
    return await this.client.dispatch({
      operation: 'operate.recovery.inspect',
      request: {},
    });
  }

  private async currentView(cycleId: string, actor: OperateActorV2): Promise<JsonRecord> {
    const envelope = await this.client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor, actionBinding: { cycleId, actorId: actor.actorId } },
    });
    if (!envelope.ok) {
      throw new OperateCommandGatewayErrorV2(
        envelope.error.code,
        envelope.error.message,
        envelope.error.code === 'CAPABILITY_DENIED' ? 403 : 409,
      );
    }
    const view = record(envelope.data, 'The current operating experience');
    assertOperateExperienceArtifactV2('operate-experience-view', view);
    return view;
  }

  private publishView(view: JsonRecord): void {
    this.onView?.(structuredClone(view));
  }
}

export function createOperateCommandGateway(input: {
  client: OperateClient;
  runtime: OperateCommandRuntimeV2;
  sessions?: OperateSessionCapabilityIssuerV2;
  now?: () => number;
  onView?: (view: JsonRecord) => void;
  getOperatingReviewRead?: OperatingReviewReadGatewayV1;
}): OperateCommandGateway {
  return new OperateCommandGateway(
    input.client,
    input.runtime,
    input.sessions,
    input.now,
    input.onView,
    input.getOperatingReviewRead,
  );
}

/**
 * In-process adapter to the real durable OpenPlanr consumer. Governed Action
 * commands are implemented by the client's installed public execution/recovery
 * APIs; verification and Review commands use the same T004 event store.
 */
export function createOperateClientCommandRuntime(
  client: OperateClient,
  getOperatingReviewRead: OperatingReviewReadGatewayV1 = createOperatingReviewReadGatewayV1({
    client,
  }),
): OperateCommandRuntimeV2 {
  return Object.freeze({
    async perform({ action: selected, actor, binding, note }) {
      switch (selected.tool) {
        case 'operate.assignment.submit':
          return await client.dispatch({
            operation: selected.tool,
            request: { ...selected.arguments } as never,
          });
        case 'operate.review.submit': {
          const workspace = await getOperatingReviewRead(
            reviewDisplayRequest(selected, actor, binding),
          );
          const submission = boundReviewSubmission(selected, workspace, binding, note);
          return await client.submitBoundReview(submission);
        }
        case 'operate.action.approve':
        case 'operate.action.execute':
        case 'operate.action.rollback':
          return await client.dispatch({
            operation: selected.tool,
            request: { ...selected.arguments, actor } as never,
          } as never);
        case 'operate.recovery.inspect':
          return await client.dispatch({
            operation: selected.tool,
            request: {},
          });
        case 'operate.recovery.restore':
        case 'operate.recovery.clear-stale-lock':
          return await client.dispatch({
            operation: selected.tool,
            request: selected.arguments as never,
          });
        default:
          throw new OperateCommandGatewayErrorV2(
            'OPERATE_ACTION_NOT_ALLOWED',
            'The runtime-issued action is not supported by the closed command adapter.',
            409,
          );
      }
    },
  });
}

export type { OperatePlanningGateway } from './planning-handoff-gateway.js';
export { createOperatePlanningGateway } from './planning-handoff-gateway.js';
export { createOperatingReviewReadGatewayV1 } from './review-read-gateway.js';
