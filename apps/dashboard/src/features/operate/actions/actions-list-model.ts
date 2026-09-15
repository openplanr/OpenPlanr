import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type ActionsDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;
type ActionsSurface = Extract<ActionsDisplay['payload'], { surface: 'actions' }>;
type GovernedAction = ActionsSurface['data']['actions'][number];

type ActionsPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateActionsListModel = Readonly<{
  kind: 'actions';
  presentation: ActionsPresentation;
  binding: DashboardQueryIdentity;
  display: ActionsDisplay;
  surface: ActionsSurface;
  actions: readonly GovernedAction[];
  mutationEnabled: boolean;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<ActionsPresentation, ActionsPresentation>>);

function exactActionsBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.route === '#/operate/actions' &&
      binding.subjectId === null &&
      binding.cycleId !== null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner display-surface verifier. */
export function createOperateActionsSurfaceValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is ActionsDisplay {
  const binding = exactActionsBinding(current);
  return (value: unknown): value is ActionsDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
        payload.surface !== 'actions' ||
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
        surface: 'actions',
        subjectId: null,
        cycleId: binding.cycleId,
      });
      assertOperateExperienceDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

/** Resolve one exact Actions collection route from a parser-verified display surface. */
export function resolveOperateActionsListModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateActionsListModel | null {
  const binding = exactActionsBinding(current);
  if (
    binding === null ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding) ||
    !createOperateActionsSurfaceValidator(binding)(state.data)
  ) {
    return null;
  }
  const display = state.data;
  const surface = display.payload;
  if (surface.surface !== 'actions') {
    return null;
  }
  const presentation = PRESENTATION[state.kind as ActionsPresentation];
  if (
    presentation === undefined ||
    surface.status !== presentation ||
    surface.mutationEnabled !== state.mutationEnabled ||
    surface.data.requestBinding.projectId !== binding.projectId ||
    surface.data.requestBinding.generation !== binding.generation
  ) {
    return null;
  }
  return Object.freeze({
    kind: 'actions',
    presentation,
    binding: state.binding,
    display,
    surface,
    actions: Object.freeze(surface.data.actions),
    mutationEnabled: state.mutationEnabled,
  });
}
