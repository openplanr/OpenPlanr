import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
  type OperateExperienceAuditDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import { exactAuditEventHead } from '../../../lib/binding/audit-event-head.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';

type AuditDisplay = Readonly<OperateExperienceAuditDisplaySurfaceV1>;
type OutcomesSurface = Extract<AuditDisplay['payload'], { surface: 'outcomes' }>;
type OutcomeSurface = Extract<AuditDisplay['payload'], { surface: 'outcome' }>;
type OutcomePresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateOutcomeDisplay = AuditDisplay;

export type OperateOutcomesModel = Readonly<{
  kind: 'outcomes';
  presentation: OutcomePresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: OutcomesSurface;
  data: OutcomesSurface['data'];
  domainMetrics: OutcomesSurface['data']['domainMetrics'];
  outcomes: OutcomesSurface['data']['outcomes'];
  learnings: OutcomesSurface['data']['learnings'];
  readOnly: true;
  mutationEnabled: false;
}>;

export type OperateOutcomeDetailModel = Readonly<{
  kind: 'outcome';
  presentation: OutcomePresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: OutcomeSurface;
  data: OutcomeSurface['data'];
  outcome: OutcomeSurface['data']['outcome'];
  learnings: OutcomeSurface['data']['learnings'];
  subjectId: string;
  readOnly: true;
  mutationEnabled: false;
}>;

export type OperateOutcomeModel = OperateOutcomesModel | OperateOutcomeDetailModel;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<OutcomePresentation, OutcomePresentation>>);

function exactOutcomeBinding(
  value: DashboardQueryIdentity,
): Readonly<{ binding: DashboardQueryIdentity; surface: 'outcomes' | 'outcome' }> | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    let surface: 'outcomes' | 'outcome' | null = null;
    if (binding.route === '#/operate/outcomes' && binding.subjectId === null) {
      surface = 'outcomes';
    } else if (
      binding.subjectId !== null &&
      binding.route === `#/operate/outcomes/${encodeURIComponent(binding.subjectId)}`
    ) {
      surface = 'outcome';
    }
    return binding.productArea === 'operate' &&
      surface !== null &&
      binding.cycleId !== null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? Object.freeze({ binding, surface })
      : null;
  } catch {
    return null;
  }
}

/** Exact parser custody plus the owner's schema, semantic, and SHA-256-JCS verifier. */
export function createOperateOutcomeDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is AuditDisplay {
  const expectedRoute = exactOutcomeBinding(current);
  return (value: unknown): value is AuditDisplay => {
    if (!expectedRoute || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceAuditDisplaySurfaceV1(value);
      const surface = display.payload;
      const { binding, surface: expectedSurface } = expectedRoute;
      if (
        surface.surface !== expectedSurface ||
        binding.eventHead === null ||
        binding.viewHash === null ||
        binding.cycleId === null ||
        surface.eventHead.sequence !== binding.eventHead.sequence ||
        surface.eventHead.hash !== binding.eventHead.hash ||
        surface.viewHash !== binding.viewHash
      ) {
        return false;
      }
      const auditEventHead = exactAuditEventHead(binding.eventHead);
      if (auditEventHead === null) {
        return false;
      }
      const expected: OperateAuditDisplayBindingV1 = Object.freeze({
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        cycleId: binding.cycleId,
        subjectId: expectedSurface === 'outcome' ? binding.subjectId : null,
        surface: expectedSurface,
        query: null,
        format: null,
        generatedAt: surface.generatedAt,
        eventHead: auditEventHead,
        viewHash: binding.viewHash,
      });
      assertOperateExperienceAuditDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

/** Resolve only parser-branded, frozen owner-selected Outcome bytes in owner order. */
export function resolveOperateOutcomeModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateOutcomeModel | null {
  const expectedRoute = exactOutcomeBinding(current);
  if (
    !expectedRoute ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, expectedRoute.binding) ||
    !createOperateOutcomeDisplayValidator(expectedRoute.binding)(state.data)
  ) {
    return null;
  }
  const presentation = PRESENTATION[state.kind as OutcomePresentation];
  const display = state.data;
  if (presentation === undefined || display.payload.surface !== expectedRoute.surface) return null;
  if (display.payload.status !== presentation || display.payload.readOnly !== true) return null;

  if (display.payload.surface === 'outcome') {
    if (expectedRoute.binding.subjectId === null) return null;
    const surface = display.payload;
    return Object.freeze({
      kind: 'outcome',
      presentation,
      binding: state.binding,
      display,
      surface,
      data: surface.data,
      outcome: surface.data.outcome,
      learnings: surface.data.learnings,
      subjectId: expectedRoute.binding.subjectId,
      readOnly: true,
      mutationEnabled: false,
    });
  }
  const surface = display.payload;
  return Object.freeze({
    kind: 'outcomes',
    presentation,
    binding: state.binding,
    display,
    surface,
    data: surface.data,
    domainMetrics: surface.data.domainMetrics,
    outcomes: surface.data.outcomes,
    learnings: surface.data.learnings,
    readOnly: true,
    mutationEnabled: false,
  });
}
