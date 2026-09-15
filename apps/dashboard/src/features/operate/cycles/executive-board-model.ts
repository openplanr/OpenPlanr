import {
  assertOperateExecutiveBoardDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExecutiveBoardDisplayPayloadV1,
  type OperateExecutiveBoardDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';
import type { OperateCycleModel } from './cycle-model.js';

type BoardDisplay = Readonly<OperateExecutiveBoardDisplaySurfaceV1>;
type BoardPayload = Readonly<OperateExecutiveBoardDisplayPayloadV1>;

export type OperateExecutiveBoardProjection = BoardDisplay;

export type OperateExecutiveBoardModel = Readonly<{
  kind: 'executive-board';
  binding: DashboardQueryIdentity;
  display: BoardDisplay;
  board: BoardPayload['data']['executiveBoard'];
  mutationEnabled: false;
}>;

function exactExecutiveBoardBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.domainId === 'business' &&
      binding.cycleId !== null &&
      binding.subjectId === binding.cycleId &&
      binding.route === `#/operate/cycles/${encodeURIComponent(binding.cycleId)}` &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner schema/semantic/SHA-256-JCS verifier. */
export function createOperateExecutiveBoardDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is BoardDisplay {
  const binding = exactExecutiveBoardBinding(current);
  return (value: unknown): value is BoardDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExecutiveBoardDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
        binding.eventHead === null ||
        binding.viewHash === null ||
        binding.cycleId === null ||
        binding.subjectId === null ||
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
        subjectId: binding.subjectId,
        cycleId: binding.cycleId,
      });
      assertOperateExecutiveBoardDisplaySurfaceV1(display, expected);
      return payload.data.executiveBoard.seats.every(
        (seat) => seat.roleId !== seat.label && typeof seat.label === 'string',
      );
    } catch {
      return false;
    }
  };
}

export function isOperateExecutiveBoardProjection(
  value: unknown,
  current: DashboardQueryIdentity,
): value is OperateExecutiveBoardProjection {
  return createOperateExecutiveBoardDisplayValidator(current)(value);
}

/** Resolve one exact executive board route from a parser-issued, owner-verified display surface. */
export function resolveOperateExecutiveBoardModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateExecutiveBoardModel | null {
  const binding = exactExecutiveBoardBinding(current);
  if (
    binding === null ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, current) ||
    !createOperateExecutiveBoardDisplayValidator(current)(state.data) ||
    state.mutationEnabled
  ) {
    return null;
  }
  const display = state.data;
  const workspace = display.payload;
  if (workspace.mutationEnabled !== false) return null;
  return Object.freeze({
    kind: 'executive-board',
    binding: state.binding,
    display,
    board: workspace.data.executiveBoard,
    mutationEnabled: false,
  });
}

export type OperateExecutiveBoardSection =
  | Readonly<{ kind: 'hidden' }>
  | Readonly<{ kind: 'unavailable'; title: string; description: string }>
  | Readonly<{ kind: 'incompatible' }>
  | OperateExecutiveBoardModel;

/** Resolve the executive board section for one verified Cycle detail route. */
export function resolveOperateCycleExecutiveBoardSection(
  cycle: OperateCycleModel,
  executiveBoardSource: DashboardProductState<unknown> | null | undefined,
  current: DashboardQueryIdentity,
): OperateExecutiveBoardSection {
  if (cycle.vocabulary.domain !== 'business') {
    return Object.freeze({ kind: 'hidden' });
  }
  if (!executiveBoardSource) {
    return Object.freeze({
      kind: 'unavailable',
      title: 'Executive board not yet issued',
      description:
        'The owner has not issued a verified executive board display for this business Cycle.',
    });
  }
  const model = resolveOperateExecutiveBoardModel(executiveBoardSource, current);
  if (!model) {
    return Object.freeze({ kind: 'incompatible' });
  }
  return model;
}
