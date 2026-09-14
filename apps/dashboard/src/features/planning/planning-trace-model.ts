import { serializeDashboardRoute } from '../../app/router.js';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function text(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function canonicalPlanningDetailHref(subjectId: string): string {
  return serializeDashboardRoute({
    kind: 'planning.detail',
    product: 'planning',
    subjectId,
  });
}

function canonicalOperatePlanningHref(actionId: string): string {
  return serializeDashboardRoute({
    kind: 'operate.action-planning',
    product: 'operate',
    subjectId: actionId,
  });
}

/** Keep only destinations that match the dashboard route grammar. */
export function callablePlanningTraceHref(node: JsonRecord): string | null {
  const href = text(node.href);
  const subjectId = text(node.subjectId);
  if (!href || !subjectId) return null;
  const canonicalDetail = canonicalPlanningDetailHref(subjectId);
  if (href === canonicalDetail || href === `#detail/${encodeURIComponent(subjectId)}`) {
    return canonicalDetail;
  }
  const canonicalOperate = canonicalOperatePlanningHref(subjectId);
  if (href === canonicalOperate) return canonicalOperate;
  return null;
}

export type PlanningDeliveryTraceNode = Readonly<{
  kind: string;
  label: string;
  state: string;
  owner: string;
  reason: string | null;
  time: string | null;
  subjectId: string | null;
  href: string | null;
}>;

function traceNode(value: unknown): PlanningDeliveryTraceNode {
  const node = record(value);
  return Object.freeze({
    kind: text(node.kind, 'unknown') ?? 'unknown',
    label: text(node.label, text(node.kind, 'Trace step') ?? 'Trace step') ?? 'Trace step',
    state: text(node.state, 'unknown') ?? 'unknown',
    owner: text(node.owner, 'OpenPlanr') ?? 'OpenPlanr',
    reason: text(node.reason),
    time: text(node.time),
    subjectId: text(node.subjectId),
    href: callablePlanningTraceHref(node),
  });
}

export type PlanningOperatingOrigin = Readonly<{
  kind: string | null;
  status: string;
  correlationId: string | null;
  proposalId: string | null;
  proposalRevision: number | null;
  proposalHash: string | null;
  scopeId: string | null;
  domainId: string | null;
  domainVersion: string | null;
  cycleId: string | null;
  eventHead: Readonly<{ sequence: number | null; hash: string | null }>;
  decision: Readonly<{ id: string | null; revision: number | null; hash: string | null }>;
  action: Readonly<{ id: string | null; revision: number | null; hash: string | null }>;
  metric: JsonRecord;
  verification: JsonRecord;
  evidence: readonly JsonRecord[];
  spec: Readonly<{
    specId: string | null;
    slug: string | null;
    contentHash: string | null;
    status: string;
  }>;
  actor: Readonly<{ actorId: string | null; kind: string | null }>;
  transaction: Readonly<{
    transactionId: string | null;
    receiptHash: string | null;
    planningProvenanceEventId: string | null;
  }>;
  createdAt: string | null;
  originHash: string | null;
}>;

/** Normalize an access-safe origin projection without exposing source bodies. */
export function normalizePlanningOperatingOrigin(value: unknown): PlanningOperatingOrigin {
  const origin = record(value);
  const decision = record(origin.decision);
  const action = record(origin.action);
  const spec = record(origin.spec);
  const transaction = record(origin.transaction);
  const eventHead = record(origin.eventHead);
  return Object.freeze({
    kind: text(origin.kind),
    status: text(origin.status, text(spec.status, 'unknown') ?? 'unknown') ?? 'unknown',
    correlationId: text(origin.correlationId),
    proposalId: text(origin.proposalId),
    proposalRevision: typeof origin.proposalRevision === 'number' ? origin.proposalRevision : null,
    proposalHash: text(origin.proposalHash),
    scopeId: text(origin.scopeId),
    domainId: text(origin.domainId),
    domainVersion: text(origin.domainVersion),
    cycleId: text(origin.cycleId),
    eventHead: Object.freeze({
      sequence: typeof eventHead.sequence === 'number' ? eventHead.sequence : null,
      hash: text(eventHead.hash),
    }),
    decision: Object.freeze({
      id: text(decision.id),
      revision: typeof decision.revision === 'number' ? decision.revision : null,
      hash: text(decision.hash),
    }),
    action: Object.freeze({
      id: text(action.id),
      revision: typeof action.revision === 'number' ? action.revision : null,
      hash: text(action.hash),
    }),
    metric: Object.freeze({ ...record(origin.metric) }),
    verification: Object.freeze({ ...record(origin.verification) }),
    evidence: Object.freeze(
      array<JsonRecord>(origin.evidence).map((entry) => Object.freeze(record(entry))),
    ),
    spec: Object.freeze({
      specId: text(spec.specId),
      slug: text(spec.slug),
      contentHash: text(spec.contentHash),
      status: text(spec.status, 'unknown') ?? 'unknown',
    }),
    actor: Object.freeze({
      actorId: text(record(origin.actor).actorId),
      kind: text(record(origin.actor).kind),
    }),
    transaction: Object.freeze({
      transactionId: text(transaction.transactionId),
      receiptHash: text(transaction.receiptHash),
      planningProvenanceEventId: text(transaction.planningProvenanceEventId),
    }),
    createdAt: text(origin.createdAt),
    originHash: text(origin.originHash),
  });
}

/** Keep service-owned order; missing progress stays visibly unknown. */
export function normalizePlanningDeliveryTrace(
  value: unknown,
  options: Readonly<{ label?: string; reason?: string }> = {},
): readonly PlanningDeliveryTraceNode[] {
  const progress = record(value);
  const nodes = array<unknown>(progress.nodes).map(traceNode);
  if (nodes.length > 0) return Object.freeze(nodes);
  return Object.freeze([
    traceNode({
      kind: 'trace',
      label: options.label ?? 'Delivery trace unavailable',
      state: 'unknown',
      owner: 'OpenPlanr',
      reason: options.reason ?? 'No ledger-owned Planning progress projection is available.',
    }),
  ]);
}

export function planningReturnHref(origin: PlanningOperatingOrigin): string | null {
  return origin.action.id ? canonicalOperatePlanningHref(origin.action.id) : null;
}
