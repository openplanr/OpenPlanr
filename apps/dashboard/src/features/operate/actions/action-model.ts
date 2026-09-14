import {
  assertOperateActionDisplayWorkspaceV1,
  type OperateActionDisplayWorkspacePayloadV1,
  type OperateActionDisplayWorkspaceV1,
  type OperateDisplayBindingV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-action-display-workspace.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type ActionPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';
type ActionDisplay = Readonly<OperateActionDisplayWorkspaceV1>;
type ActionWorkspace = Readonly<OperateActionDisplayWorkspacePayloadV1>;

export type OperateActionWorkspaceProjection = ActionDisplay;

export type OperateActionModel = Readonly<{
  kind: 'action';
  presentation: ActionPresentation;
  binding: DashboardQueryIdentity;
  display: ActionDisplay;
  workspace: ActionWorkspace;
  action: ActionWorkspace['data']['action'];
  outcome: ActionWorkspace['data']['outcome'];
  learnings: ActionWorkspace['data']['learnings'];
  inbox: ActionWorkspace['data']['inbox'];
  history: ActionWorkspace['data']['history'];
  replay: ActionWorkspace['data']['replay'];
  verification: ActionWorkspace['data']['verification'];
  boundaries: ActionWorkspace['data']['boundaries'];
  allowedActions: ActionWorkspace['data']['allowedActions'];
  mutationEnabled: boolean;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<ActionPresentation, ActionPresentation>>);

function exactActionBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.subjectId !== null &&
      binding.cycleId !== null &&
      binding.route === `#/operate/actions/${encodeURIComponent(binding.subjectId)}` &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner schema/semantic/SHA-256-JCS verifier. */
export function createOperateActionDisplayWorkspaceValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is ActionDisplay {
  const binding = exactActionBinding(current);
  return (value: unknown): value is ActionDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateActionDisplayWorkspaceV1(value);
      const payload = display.payload;
      if (
        binding.eventHead === null ||
        binding.viewHash === null ||
        binding.subjectId === null ||
        payload.eventHead.sequence !== binding.eventHead.sequence ||
        payload.eventHead.hash !== binding.eventHead.hash
      ) {
        return false;
      }
      const expected: OperateDisplayBindingV1 & { actionId: string } = Object.freeze({
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
        cycleId: binding.cycleId,
        subjectId: binding.subjectId,
        actionId: binding.subjectId,
      });
      assertOperateActionDisplayWorkspaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

export function isOperateActionWorkspaceProjection(
  value: unknown,
  current: DashboardQueryIdentity,
): value is OperateActionWorkspaceProjection {
  return createOperateActionDisplayWorkspaceValidator(current)(value);
}

/** Resolve one exact Action route from a parser-issued, owner-verified display workspace. */
export function resolveOperateActionModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateActionModel | null {
  const binding = exactActionBinding(current);
  if (
    binding === null ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding) ||
    !createOperateActionDisplayWorkspaceValidator(binding)(state.data)
  ) {
    return null;
  }
  const display = state.data;
  const workspace = display.payload;
  const presentation = PRESENTATION[state.kind as ActionPresentation];
  if (
    presentation === undefined ||
    workspace.status !== presentation ||
    workspace.mutationEnabled !== state.mutationEnabled
  ) {
    return null;
  }
  return Object.freeze({
    kind: 'action',
    presentation,
    binding: state.binding,
    display,
    workspace,
    action: workspace.data.action,
    outcome: workspace.data.outcome,
    learnings: workspace.data.learnings,
    inbox: workspace.data.inbox,
    history: workspace.data.history,
    replay: workspace.data.replay,
    verification: workspace.data.verification,
    boundaries: workspace.data.boundaries,
    allowedActions: workspace.data.allowedActions,
    mutationEnabled: presentation === 'ready' && workspace.mutationEnabled,
  });
}
