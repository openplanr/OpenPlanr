import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';
import {
  createOperateActionDisplayWorkspaceValidator,
  type OperateActionModel,
} from '../actions/action-model.js';
import type { PlanningFraming } from './planning-actions.js';

type JsonRecord = Record<string, unknown>;

export const PLANNING_FRAMING_FIELDS = Object.freeze([
  ['title', 'SPEC title', 'text'],
  ['slug', 'SPEC slug', 'text'],
  ['problem', 'Problem', 'textarea'],
  ['objective', 'Objective', 'textarea'],
  ['users', 'Users', 'list'],
  ['scope', 'In scope', 'list'],
  ['nonScope', 'Out of scope', 'list'],
  ['risks', 'Risks', 'list'],
  ['constraints', 'Constraints', 'list'],
  ['requirements', 'Requirements', 'list'],
  ['acceptanceOutcomes', 'Acceptance outcomes', 'list'],
] as const);

export type PlanningHandoffModel = Readonly<{
  kind: 'planning-handoff';
  presentation: OperateActionModel['presentation'];
  binding: DashboardQueryIdentity;
  action: OperateActionModel['action'];
  workspace: OperateActionModel['workspace'];
  mutationEnabled: boolean;
  reasonCodes: readonly string[];
}>;

function exactPlanningHandoffBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.subjectId !== null &&
      binding.cycleId !== null &&
      binding.route === `#/operate/actions/${encodeURIComponent(binding.subjectId)}/planning` &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

function actionBindingForDisplay(binding: DashboardQueryIdentity): DashboardQueryIdentity {
  if (binding.subjectId === null) throw new Error('Planning handoff requires a subject identity.');
  return createDashboardQueryIdentity({
    ...binding,
    route: `#/operate/actions/${encodeURIComponent(binding.subjectId)}`,
  });
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameHead(
  left: { sequence?: unknown; hash?: unknown } | null | undefined,
  right: { sequence?: unknown; hash?: unknown } | null | undefined,
): boolean {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function exactAction(
  left: { actionId?: unknown; revision?: unknown; actionHash?: unknown } | null | undefined,
  right: { actionId?: unknown; revision?: unknown; actionHash?: unknown } | null | undefined,
): boolean {
  return Boolean(
    left?.actionId &&
      left.actionId === right?.actionId &&
      left.revision === right?.revision &&
      left.actionHash === right?.actionHash,
  );
}

function futureExpiry(value: unknown, now = Date.now()): boolean {
  const expiresAt = Date.parse(String(value ?? ''));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export type PlanningPreviewCurrent = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  action: JsonRecord;
  eventHead: NonNullable<DashboardQueryIdentity['eventHead']>;
}>;

/** A preview is current only for the live actor, scope, domain, Action, and Event head. */
export function isExactPlanningSpecPreview(
  proposal: JsonRecord,
  specPreview: JsonRecord,
  current: PlanningPreviewCurrent,
  now = Date.now(),
): boolean {
  const preview = record(proposal.preview);
  return Boolean(
    proposal.proposalId &&
      proposal.proposalHash &&
      preview.digest &&
      specPreview.contentHash &&
      current.actorId &&
      record(proposal.actor).actorId === current.actorId &&
      proposal.scopeId === current.scopeId &&
      proposal.domainId === current.domainId &&
      proposal.domainVersion === current.domainVersion &&
      exactAction(record(proposal.action), current.action) &&
      sameHead(record(proposal.eventHead), current.eventHead) &&
      specPreview.proposalId === proposal.proposalId &&
      specPreview.proposalHash === proposal.proposalHash &&
      specPreview.previewDigest === preview.digest &&
      sameHead(record(specPreview.eventHead), record(proposal.eventHead)) &&
      futureExpiry(preview.expiresAt, now),
  );
}

export function clonePlanningFraming(value: unknown): PlanningFraming {
  const framing = record(value);
  return Object.freeze({
    title: stringValue(framing.title),
    slug: stringValue(framing.slug),
    problem: stringValue(framing.problem),
    objective: stringValue(framing.objective),
    users: Object.freeze(array(framing.users).map(String)),
    scope: Object.freeze(array(framing.scope).map(String)),
    nonScope: Object.freeze(array(framing.nonScope).map(String)),
    risks: Object.freeze(array(framing.risks).map(String)),
    constraints: Object.freeze(array(framing.constraints).map(String)),
    requirements: Object.freeze(array(framing.requirements).map(String)),
    acceptanceOutcomes: Object.freeze(array(framing.acceptanceOutcomes).map(String)),
  });
}

export function framingMatchesCanonical(
  draft: PlanningFraming,
  canonical: PlanningFraming,
): boolean {
  return sameJson(clonePlanningFraming(draft), clonePlanningFraming(canonical));
}

export function isExactPlanningNextCommands(
  receipt: JsonRecord,
  commands: readonly string[],
): boolean {
  const specId = String(receipt.specId);
  const expected = [
    `planr spec show ${specId}`,
    `$planr:plan ${specId}`,
    `/planr:plan ${specId}`,
  ] as const;
  return (
    commands.length === expected.length &&
    commands.every(
      (entry, index) =>
        entry === expected[index] || (index === 1 && entry === `$planr-plan ${specId}`),
    )
  );
}

export function isExactPlanningCreation(
  receipt: JsonRecord,
  origin: JsonRecord,
  progress: JsonRecord,
): boolean {
  const spec = record(origin.spec);
  return Boolean(
    receipt.specId &&
      receipt.transactionId &&
      receipt.contentHash &&
      receipt.originHash &&
      receipt.receiptHash &&
      receipt.proposalId &&
      receipt.proposalHash &&
      receipt.correlationId &&
      receipt.provenanceEventId &&
      spec.specId === receipt.specId &&
      spec.contentHash === receipt.contentHash &&
      origin.originHash === receipt.originHash &&
      origin.proposalId === receipt.proposalId &&
      origin.proposalHash === receipt.proposalHash &&
      origin.correlationId === receipt.correlationId &&
      record(origin.action).id &&
      record(origin.decision).id &&
      origin.eventHead &&
      Array.isArray(progress.nodes),
  );
}

/** Resolve one exact planning-work Action handoff route from a parser-verified Action workspace. */
export function resolvePlanningHandoffModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): PlanningHandoffModel | null {
  const binding = exactPlanningHandoffBinding(current);
  if (
    binding === null ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding)
  ) {
    return null;
  }
  const displayBinding = actionBindingForDisplay(binding);
  const validate = createOperateActionDisplayWorkspaceValidator(displayBinding);
  if (!validate(state.data)) return null;
  const workspace = state.data.payload;
  const presentation = workspace.status;
  // The Action owner may advertise its own governed commands on the shared detail payload. The
  // Planning adapter never exposes those commands and must keep its route-local projection
  // read-only; Planning preview/create authority is issued independently by planning-actions.
  if (state.mutationEnabled) return null;
  const mutationEnabled = presentation === 'ready';
  return Object.freeze({
    kind: 'planning-handoff',
    presentation,
    binding: state.binding,
    action: workspace.data.action,
    workspace,
    mutationEnabled,
    reasonCodes: Object.freeze([...workspace.reasonCodes]),
  });
}
