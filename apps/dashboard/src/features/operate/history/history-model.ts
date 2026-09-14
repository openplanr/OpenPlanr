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
type HistorySurface = Extract<AuditDisplay['payload'], { surface: 'history' }>;
type SearchSurface = Extract<AuditDisplay['payload'], { surface: 'search' }>;
type ExportSurface = Extract<AuditDisplay['payload'], { surface: 'export' }>;
type HistoryPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type OperateHistoryDisplay = AuditDisplay;
export type OperateHistoryAuxiliaryRequest =
  | Readonly<{ surface: 'search'; query: string; format: null }>
  | Readonly<{ surface: 'export'; query: null; format: 'json' | 'html' }>;

export type OperateHistoryModel = Readonly<{
  kind: 'history';
  presentation: HistoryPresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: HistorySurface;
  data: HistorySurface['data'];
  history: HistorySurface['data']['history'];
  replay: HistorySurface['data']['replay'];
  readOnly: true;
  mutationEnabled: false;
}>;

export type OperateAuditSearchModel = Readonly<{
  kind: 'search';
  presentation: HistoryPresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: SearchSurface;
  data: SearchSurface['data'];
  query: string;
  results: SearchSurface['data']['results'];
  readOnly: true;
  mutationEnabled: false;
}>;

export type OperateAuditExportModel = Readonly<{
  kind: 'export';
  presentation: HistoryPresentation;
  binding: DashboardQueryIdentity;
  display: AuditDisplay;
  surface: ExportSurface;
  data: ExportSurface['data'];
  format: 'json' | 'html';
  mediaType: ExportSurface['data']['mediaType'];
  contentText: string;
  readOnly: true;
  mutationEnabled: false;
}>;

export type OperateHistoryAuxiliaryModel = OperateAuditSearchModel | OperateAuditExportModel;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<HistoryPresentation, HistoryPresentation>>);

function exactHistoryBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.route === '#/operate/history' &&
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

function validator(
  current: DashboardQueryIdentity,
  request:
    | Readonly<{ surface: 'history'; query: null; format: null }>
    | OperateHistoryAuxiliaryRequest,
): (value: unknown) => value is AuditDisplay {
  const binding = exactHistoryBinding(current);
  return (value: unknown): value is AuditDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceAuditDisplaySurfaceV1(value);
      const surface = display.payload;
      if (
        surface.surface !== request.surface ||
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
        subjectId: null,
        surface: request.surface,
        query: request.query,
        format: request.format,
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

export function createOperateHistoryDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is AuditDisplay {
  return validator(current, Object.freeze({ surface: 'history', query: null, format: null }));
}

export function createOperateHistoryAuxiliaryDisplayValidator(
  current: DashboardQueryIdentity,
  request: OperateHistoryAuxiliaryRequest,
): (value: unknown) => value is AuditDisplay {
  return validator(current, request);
}

function exactState(
  state: DashboardProductState<unknown>,
  binding: DashboardQueryIdentity,
  validate: (value: unknown) => value is AuditDisplay,
): AuditDisplay | null {
  return isValidatedDashboardProductState(state) &&
    state.binding !== null &&
    state.data !== null &&
    isCurrentDashboardQuery(state.binding, binding) &&
    validate(state.data)
    ? state.data
    : null;
}

/** Resolve only parser-branded, frozen owner-selected History and replay proof. */
export function resolveOperateHistoryModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): OperateHistoryModel | null {
  const binding = exactHistoryBinding(current);
  if (!binding) return null;
  const display = exactState(state, binding, createOperateHistoryDisplayValidator(binding));
  const presentation = PRESENTATION[state.kind as HistoryPresentation];
  if (
    !display ||
    presentation === undefined ||
    display.payload.surface !== 'history' ||
    display.payload.status !== presentation ||
    display.payload.readOnly !== true
  ) {
    return null;
  }
  const surface = display.payload;
  return Object.freeze({
    kind: 'history',
    presentation,
    binding: state.binding as DashboardQueryIdentity,
    display,
    surface,
    data: surface.data,
    history: surface.data.history,
    replay: surface.data.replay,
    readOnly: true,
    mutationEnabled: false,
  });
}

/** Search results and Export content remain owner-selected inert data, never local route/HTML authority. */
export function resolveOperateHistoryAuxiliaryModel(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
  request: OperateHistoryAuxiliaryRequest,
): OperateHistoryAuxiliaryModel | null {
  const binding = exactHistoryBinding(current);
  if (!binding) return null;
  const display = exactState(
    state,
    binding,
    createOperateHistoryAuxiliaryDisplayValidator(binding, request),
  );
  const presentation = PRESENTATION[state.kind as HistoryPresentation];
  if (
    !display ||
    presentation === undefined ||
    display.payload.surface !== request.surface ||
    display.payload.status !== presentation ||
    display.payload.readOnly !== true
  ) {
    return null;
  }
  if (display.payload.surface === 'search' && request.surface === 'search') {
    const surface = display.payload;
    return Object.freeze({
      kind: 'search',
      presentation,
      binding: state.binding as DashboardQueryIdentity,
      display,
      surface,
      data: surface.data,
      query: request.query,
      results: surface.data.results,
      readOnly: true,
      mutationEnabled: false,
    });
  }
  if (display.payload.surface === 'export' && request.surface === 'export') {
    const surface = display.payload;
    return Object.freeze({
      kind: 'export',
      presentation,
      binding: state.binding as DashboardQueryIdentity,
      display,
      surface,
      data: surface.data,
      format: request.format,
      mediaType: surface.data.mediaType,
      contentText: surface.data.content,
      readOnly: true,
      mutationEnabled: false,
    });
  }
  return null;
}
