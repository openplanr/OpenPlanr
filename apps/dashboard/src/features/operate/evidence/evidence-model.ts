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
type EvidenceSurface = Extract<AuditDisplay['payload'], { surface: 'evidence' }>;
type EvidencePresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateEvidenceDisplay = AuditDisplay;

export type OperateEvidenceModel = Readonly<{
  kind: 'evidence';
  presentation: EvidencePresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: EvidenceSurface;
  data: EvidenceSurface['data'];
  evidence: EvidenceSurface['data']['evidence'];
  claims: EvidenceSurface['data']['claims'];
  rationale: EvidenceSurface['data']['rationale'];
  detailRequested: boolean;
  subjectId: string | null;
  readOnly: true;
  mutationEnabled: false;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<EvidencePresentation, EvidencePresentation>>);

function exactEvidenceBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    const evidenceRoute =
      binding.route === '#/operate/evidence' ||
      (binding.subjectId !== null &&
        binding.route === `#/operate/evidence/${encodeURIComponent(binding.subjectId)}`);
    return binding.productArea === 'operate' &&
      evidenceRoute &&
      binding.cycleId !== null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Exact parser custody plus the owner's schema, semantic, and SHA-256-JCS verifier. */
export function createOperateEvidenceDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is AuditDisplay {
  const binding = exactEvidenceBinding(current);
  return (value: unknown): value is AuditDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceAuditDisplaySurfaceV1(value);
      const surface = display.payload;
      if (
        surface.surface !== 'evidence' ||
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
        subjectId: binding.subjectId,
        surface: 'evidence',
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

/** Resolve only parser-branded, frozen owner-selected Evidence bytes in owner order. */
export function resolveOperateEvidenceModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateEvidenceModel | null {
  const binding = exactEvidenceBinding(current);
  if (
    !binding ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding) ||
    !createOperateEvidenceDisplayValidator(binding)(state.data)
  ) {
    return null;
  }
  const presentation = PRESENTATION[state.kind as EvidencePresentation];
  const display = state.data;
  if (presentation === undefined || display.payload.surface !== 'evidence') return null;
  const surface = display.payload;
  if (surface.status !== presentation || surface.readOnly !== true) return null;

  return Object.freeze({
    kind: 'evidence',
    presentation,
    binding: state.binding,
    display,
    surface,
    data: surface.data,
    evidence: surface.data.evidence,
    claims: surface.data.claims,
    rationale: surface.data.rationale,
    detailRequested: binding.subjectId !== null,
    subjectId: binding.subjectId,
    readOnly: true,
    mutationEnabled: false,
  });
}
