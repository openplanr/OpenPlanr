import {
  assertOperateCycleDisplayWorkspaceV1,
  type OperateCycleDisplayWorkspaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateExperienceAuditDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { DashboardQueryRoot } from '../lib/api/bootstrap.js';
import { freezeDashboardWire } from '../lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../lib/binding/query-identity.js';
import type { ParsedDashboardRoute } from './router.js';
import { serializeDashboardRoute } from './router.js';

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u;
const MAX_OPERATE_BYTES = 4 * 1024 * 1024;

type OperateDisplaySurface = 'today' | 'cycles';
type OperateAuditSurface = 'evidence' | 'outcomes' | 'outcome' | 'history';

function loopbackUrl(origin: string, path: string): URL {
  if (!LOOPBACK.test(origin)) throw new Error('Dashboard reads require an exact loopback origin.');
  return new URL(path, origin);
}

async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw signal.reason;
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error('The owner-issued dashboard projection is unavailable.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OPERATE_BYTES) {
    throw new Error('The owner-issued dashboard projection exceeds its wire limit.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('The owner-issued dashboard projection is not JSON.');
  }
}

function operateUrl(origin: string, path: string, root: DashboardQueryRoot): URL {
  const url = loopbackUrl(origin, path);
  url.searchParams.set('scopeId', root.scopeId);
  url.searchParams.set('domainId', root.domainId);
  url.searchParams.set('domainVersion', root.domainVersion);
  return url;
}

function operateHeaders(root: DashboardQueryRoot): Readonly<Record<string, string>> {
  return Object.freeze({
    accept: 'application/json',
    'x-openplanr-actor': root.actorId,
  });
}

export function queryIdentityFromRoot(
  root: DashboardQueryRoot,
  route: ParsedDashboardRoute,
  options: Readonly<{
    cycleId?: string | null;
    eventHead?: DashboardQueryIdentity['eventHead'];
    viewHash?: string | null;
  }> = {},
): DashboardQueryIdentity {
  if (route.kind === 'not-found' || route.product === null) {
    throw new Error('A query root cannot bind an unknown or system route.');
  }
  return createDashboardQueryIdentity({
    productArea: route.product,
    route: serializeDashboardRoute(route),
    actorId: root.actorId,
    projectId: root.projectId,
    scopeId: root.scopeId,
    domainId: root.domainId,
    domainVersion: root.domainVersion,
    cycleId: options.cycleId ?? null,
    subjectId: route.subjectId,
    eventHead: options.eventHead ?? null,
    viewHash: options.viewHash ?? null,
    generation: root.generation,
  });
}

export async function fetchOperateRootDisplay(
  options: Readonly<{
    origin: string;
    root: DashboardQueryRoot;
    surface: OperateDisplaySurface;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateExperienceDisplaySurfaceV1> {
  const url = operateUrl(options.origin, `/api/operate/${options.surface}`, options.root);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: operateHeaders(options.root),
    cache: 'no-store',
    signal: options.signal,
  });
  const display = freezeDashboardWire(
    await readJson(response, options.signal),
  ) as OperateExperienceDisplaySurfaceV1;
  const payload = assertOperateExperienceDisplaySurfaceV1(display).payload;
  assertOperateExperienceDisplaySurfaceV1(display, {
    actorId: options.root.actorId,
    scopeId: options.root.scopeId,
    domainId: options.root.domainId,
    domainVersion: options.root.domainVersion,
    generatedAt: payload.generatedAt,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    surface: options.surface,
    subjectId: null,
    cycleId: null,
  });
  if (payload.surface !== options.surface) {
    throw new Error('The owner returned a display for a different Operate surface.');
  }
  return display;
}

function auditPath(route: ParsedDashboardRoute, surface: OperateAuditSurface): string {
  if (surface === 'history') return '/api/operate/history';
  if (surface === 'outcome') {
    if (route.subjectId === null) throw new Error('Outcome detail requires an exact subject.');
    return `/api/operate/outcomes/${encodeURIComponent(route.subjectId)}`;
  }
  const subject = route.subjectId ? `/${encodeURIComponent(route.subjectId)}` : '';
  return `/api/operate/${surface}${subject}`;
}

export async function fetchOperateAuditDisplay(
  options: Readonly<{
    origin: string;
    root: DashboardQueryRoot;
    route: ParsedDashboardRoute;
    surface: OperateAuditSurface;
    cycleId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateExperienceAuditDisplaySurfaceV1> {
  const url = operateUrl(options.origin, auditPath(options.route, options.surface), options.root);
  url.searchParams.set('cycleId', options.cycleId);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: operateHeaders(options.root),
    cache: 'no-store',
    signal: options.signal,
  });
  const display = freezeDashboardWire(
    await readJson(response, options.signal),
  ) as OperateExperienceAuditDisplaySurfaceV1;
  const payload = assertOperateExperienceAuditDisplaySurfaceV1(display).payload;
  assertOperateExperienceAuditDisplaySurfaceV1(display, {
    actorId: options.root.actorId,
    scopeId: options.root.scopeId,
    domainId: options.root.domainId,
    domainVersion: options.root.domainVersion,
    cycleId: options.cycleId,
    subjectId: options.route.subjectId,
    surface: options.surface,
    query: null,
    format: null,
    generatedAt: payload.generatedAt,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
  });
  if (payload.surface !== options.surface) {
    throw new Error('The owner returned a display for a different Operate audit surface.');
  }
  return display;
}

export async function fetchOperateCycleDisplay(
  options: Readonly<{
    origin: string;
    root: DashboardQueryRoot;
    cycleId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateCycleDisplayWorkspaceV1> {
  const url = operateUrl(
    options.origin,
    `/api/operate/cycles/${encodeURIComponent(options.cycleId)}`,
    options.root,
  );
  const response = await (options.fetcher ?? fetch)(url, {
    headers: operateHeaders(options.root),
    cache: 'no-store',
    signal: options.signal,
  });
  const display = freezeDashboardWire(
    await readJson(response, options.signal),
  ) as OperateCycleDisplayWorkspaceV1;
  const payload = assertOperateCycleDisplayWorkspaceV1(display).payload;
  assertOperateCycleDisplayWorkspaceV1(display, {
    actorId: options.root.actorId,
    scopeId: options.root.scopeId,
    domainId: options.root.domainId,
    domainVersion: options.root.domainVersion,
    generatedAt: payload.generatedAt,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    subjectId: options.cycleId,
    cycleId: options.cycleId,
  });
  return display;
}
