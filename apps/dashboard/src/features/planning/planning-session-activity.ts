import { createContext, useContext } from 'react';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import type { PlanningGraphEnvelope, PlanningPatchSignal } from './planning-api.js';
import type { PlanningModelNode } from './planning-model.js';

export const SESSION_ACTIVITY_LIMIT = 200;

export type PlanningSessionActivityEntry = Readonly<{
  id: string;
  patchId: string;
  sequence: number;
  kind: 'added' | 'updated' | 'removed' | 'relationships';
  node: PlanningModelNode | null;
  /** Browser arrival time; null for patches replayed after a reconnect, whose time is unknown. */
  receivedAt: number | null;
  /** Status before an update, when the node was known. */
  previousStatus: string | null;
  /** Fields an update changed; status and the authored updated date are not listed. */
  fields: readonly string[];
}>;

export type PlanningSessionActivity = Readonly<{
  scope: string | null;
  connection?: 'connecting' | 'connected' | 'paused';
  entries: readonly PlanningSessionActivityEntry[];
  patchIds: readonly string[];
  truncated: boolean;
}>;

export const EMPTY_SESSION_ACTIVITY: PlanningSessionActivity = Object.freeze({
  scope: null,
  entries: Object.freeze([]),
  patchIds: Object.freeze([]),
  truncated: false,
});

/** Cursor and route progress do not change custody of this browser session's feed. */
export function planningActivityScope(
  identity: Pick<
    DashboardQueryIdentity,
    'actorId' | 'projectId' | 'scopeId' | 'domainId' | 'domainVersion' | 'generation'
  >,
): string {
  return JSON.stringify([
    identity.actorId,
    identity.projectId,
    identity.scopeId,
    identity.domainId,
    identity.domainVersion,
    identity.generation,
  ]);
}

const UNLISTED_FIELDS = new Set(['status', 'updated']);

function changedFields(previous: PlanningModelNode | undefined, next: PlanningModelNode) {
  if (!previous) return Object.freeze([]);
  const fields: string[] = [];
  if (previous.title !== next.title) fields.push('title');
  if ((previous.body ?? '') !== (next.body ?? '')) fields.push('body');
  const keys = new Set([...Object.keys(previous.frontmatter), ...Object.keys(next.frontmatter)]);
  for (const key of keys) {
    if (UNLISTED_FIELDS.has(key)) continue;
    if (JSON.stringify(previous.frontmatter[key]) !== JSON.stringify(next.frontmatter[key]))
      fields.push(key);
  }
  return Object.freeze(fields);
}

/** Called only by the owner reconciler after a complete patch has been accepted. */
export function appendPlanningSessionPatch(
  activity: PlanningSessionActivity,
  scope: string,
  before: PlanningGraphEnvelope,
  signal: PlanningPatchSignal,
  receivedAt: number | null = null,
): PlanningSessionActivity {
  if (planningActivityScope(before.binding) !== scope) return activity;
  const retained = activity.scope === scope ? activity : EMPTY_SESSION_ACTIVITY;
  if (retained.patchIds.includes(signal.patchId)) return retained;
  const previous = new Map(before.graph.nodes.map((node) => [node.id, node]));
  const entries: PlanningSessionActivityEntry[] = [];
  for (const kind of ['added', 'updated', 'removed'] as const) {
    for (const value of signal.patch[kind]) {
      const node = typeof value === 'string' ? (previous.get(value) ?? null) : value;
      const prior = typeof value === 'string' ? undefined : previous.get(value.id);
      entries.push(
        Object.freeze({
          id: `${signal.patchId}:${kind}:${typeof value === 'string' ? value : value.id}`,
          patchId: signal.patchId,
          sequence: signal.to.eventHead.sequence,
          kind,
          node,
          receivedAt,
          previousStatus: kind === 'updated' ? (prior?.status ?? null) : null,
          fields:
            kind === 'updated' && typeof value !== 'string'
              ? changedFields(prior, value)
              : Object.freeze([]),
        }),
      );
    }
  }
  if (entries.length === 0) {
    entries.push(
      Object.freeze({
        id: `${signal.patchId}:relationships`,
        patchId: signal.patchId,
        sequence: signal.to.eventHead.sequence,
        kind: 'relationships',
        node: null,
        receivedAt,
        previousStatus: null,
        fields: Object.freeze([]),
      }),
    );
  }
  const combined = [...retained.entries, ...entries];
  return Object.freeze({
    scope,
    entries: Object.freeze(combined.slice(-SESSION_ACTIVITY_LIMIT)),
    patchIds: Object.freeze([...retained.patchIds, signal.patchId].slice(-SESSION_ACTIVITY_LIMIT)),
    truncated: retained.truncated || combined.length > SESSION_ACTIVITY_LIMIT,
  });
}

const SessionActivityContext = createContext<PlanningSessionActivity>(EMPTY_SESSION_ACTIVITY);
export const PlanningSessionActivityProvider = SessionActivityContext.Provider;
export function usePlanningSessionActivity(): PlanningSessionActivity {
  return useContext(SessionActivityContext);
}
