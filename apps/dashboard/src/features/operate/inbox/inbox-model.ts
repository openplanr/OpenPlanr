import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import {
  isValidatedDashboardProductState,
  productStateAllowsMutation,
} from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type InboxDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;
type InboxSurface = Extract<InboxDisplay['payload'], { surface: 'inbox' }>;
type InboxItem = InboxSurface['data']['inbox'][number];

export const INBOX_CATEGORIES = Object.freeze(['decision', 'approval', 'verification'] as const);
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];
export type OperateInboxItem = InboxItem;
export type OperateInboxDisplay = InboxDisplay;

type InboxPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateInboxModel = Readonly<{
  kind: 'inbox';
  presentation: InboxPresentation;
  binding: DashboardQueryIdentity;
  actionContextKey: string;
  selectionScopeKey: string;
  display: InboxDisplay;
  surface: InboxSurface;
  items: InboxSurface['data']['inbox'];
  categories: Readonly<Record<InboxCategory, readonly InboxItem[]>>;
  detailRequested: boolean;
  detailItem: InboxItem | null;
  mutationEnabled: boolean;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<InboxPresentation, InboxPresentation>>);

function exactInboxBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      (binding.route === '#/operate/inbox' ||
        (binding.subjectId !== null &&
          binding.route === `#/operate/inbox/${encodeURIComponent(binding.subjectId)}`)) &&
      binding.cycleId !== null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Exact request custody plus the owner schema, semantic, and SHA-256-JCS verifier. */
export function createOperateInboxDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is InboxDisplay {
  const binding = exactInboxBinding(current);
  return (value: unknown): value is InboxDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
        payload.surface !== 'inbox' ||
        binding.eventHead === null ||
        binding.viewHash === null ||
        payload.eventHead.sequence !== binding.eventHead.sequence ||
        payload.eventHead.hash !== binding.eventHead.hash
      ) {
        return false;
      }
      const expected: OperateDisplayBindingV1 = Object.freeze({
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        generatedAt: payload.generatedAt,
        eventHead: payload.eventHead,
        viewHash: binding.viewHash,
        projectId: binding.projectId,
        generation: binding.generation,
        surface: 'inbox',
        subjectId: binding.subjectId,
        cycleId: binding.cycleId,
      });
      assertOperateExperienceDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

function selectionScopeKey(binding: DashboardQueryIdentity): string {
  return JSON.stringify([
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.cycleId,
    binding.generation,
  ]);
}

function actionContextKey(binding: DashboardQueryIdentity): string {
  return JSON.stringify([
    binding.route,
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.cycleId,
    binding.generation,
    binding.eventHead?.sequence ?? null,
    binding.eventHead?.hash ?? null,
    binding.viewHash,
  ]);
}

/** Resolve presentation truth only from a parser-branded, frozen, owner-issued Inbox envelope. */
export function resolveOperateInboxModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateInboxModel | null {
  const currentBinding = exactInboxBinding(current);
  if (
    !currentBinding ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, currentBinding)
  ) {
    return null;
  }
  const presentation = PRESENTATION[state.kind as InboxPresentation];
  if (presentation === undefined) return null;
  if (!createOperateInboxDisplayValidator(currentBinding)(state.data)) return null;
  const display = state.data;
  if (display.payload.surface !== 'inbox') return null;
  const surface = display.payload;
  if (
    surface.status !== presentation ||
    surface.mutationEnabled !== state.mutationEnabled ||
    surface.data.requestBinding.projectId !== currentBinding.projectId ||
    surface.data.requestBinding.generation !== currentBinding.generation
  ) {
    return null;
  }

  const items = surface.data.inbox;
  const categories = Object.freeze({
    decision: Object.freeze(items.filter((item) => item.kind === 'decision')),
    approval: Object.freeze(items.filter((item) => item.kind === 'approval')),
    verification: Object.freeze(items.filter((item) => item.kind === 'verification')),
  });
  const detailRequested = currentBinding.subjectId !== null;
  const detailItem = detailRequested
    ? (items.find((item) => item.itemId === currentBinding.subjectId) ?? null)
    : null;

  return Object.freeze({
    kind: 'inbox',
    presentation,
    binding: state.binding,
    actionContextKey: actionContextKey(currentBinding),
    selectionScopeKey: selectionScopeKey(currentBinding),
    display,
    surface,
    items,
    categories,
    detailRequested,
    detailItem,
    mutationEnabled: surface.mutationEnabled && productStateAllowsMutation(state, currentBinding),
  });
}
