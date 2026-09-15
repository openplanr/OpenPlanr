import {
  assertOperateRecoveryDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateRecoveryDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-recovery-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type RecoveryPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';
type RecoveryDisplay = Readonly<OperateRecoveryDisplaySurfaceV1>;
type RecoveryPayload = RecoveryDisplay['payload'];
type RecoveryState = RecoveryPayload['data']['recoveryState'];

export type OperateRecoveryModel = Readonly<{
  kind: 'recovery';
  presentation: RecoveryPresentation;
  binding: DashboardQueryIdentity;
  display: RecoveryDisplay;
  payload: RecoveryPayload;
  recoveryState: RecoveryState;
  inspection: RecoveryPayload['data']['inspection'];
  history: RecoveryPayload['data']['history'];
  allowedActions: RecoveryPayload['data']['allowedActions'];
  mutationEnabled: false;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<RecoveryPresentation, RecoveryPresentation>>);

function exactRecoveryBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.route === '#/operate/recovery' &&
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

/** Parser validator: exact query custody plus the owner schema, semantic, and SHA-256-JCS verifier. */
export function createOperateRecoveryDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is RecoveryDisplay {
  const binding = exactRecoveryBinding(current);
  return (value: unknown): value is RecoveryDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateRecoveryDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
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
      });
      assertOperateRecoveryDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

/** Resolve one exact Recovery route from a parser-issued, owner-verified display surface. */
export function resolveOperateRecoveryModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateRecoveryModel | null {
  const binding = exactRecoveryBinding(current);
  if (
    binding === null ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding) ||
    !createOperateRecoveryDisplayValidator(binding)(state.data)
  ) {
    return null;
  }
  const display = state.data;
  const payload = display.payload;
  const presentation = PRESENTATION[state.kind as RecoveryPresentation];
  if (
    presentation === undefined ||
    payload.status !== presentation ||
    payload.mutationEnabled !== false ||
    state.mutationEnabled
  ) {
    return null;
  }
  return Object.freeze({
    kind: 'recovery',
    presentation,
    binding: state.binding,
    display,
    payload,
    recoveryState: payload.data.recoveryState,
    inspection: payload.data.inspection,
    history: payload.data.history,
    allowedActions: payload.data.allowedActions,
    mutationEnabled: false,
  });
}
