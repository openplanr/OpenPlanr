import type {
  OperateActionDisplayWorkspaceV1,
  OperateDisplayBindingV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-action-display-workspace.mjs';
import { assertOperateActionDisplayWorkspaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-action-display-workspace.mjs';
import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { OperateRecoveryDisplaySurfaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-recovery-display-surface.mjs';
import { assertOperateRecoveryDisplaySurfaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-recovery-display-surface.mjs';
import type { OperateActionReader, OperateActorV2 } from '../../../contracts/operate.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';

type OperateClient = OperateActionReader;

const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u;
const MAX_WIRE_BYTES = 4 * 1024 * 1024;

function isActionWorkspaceDisplay(value: unknown): value is OperateActionDisplayWorkspaceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: string }).kind === 'operate-action-display-workspace'
  );
}

function isRecoveryDisplaySurface(value: unknown): value is OperateRecoveryDisplaySurfaceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: string }).kind === 'operate-recovery-display-surface'
  );
}

function isActionsDisplaySurface(value: unknown): value is OperateExperienceDisplaySurfaceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: string }).kind === 'operate-experience-display-surface'
  );
}

function operateCycleBindingUrl(
  origin: string,
  path: string,
  identity: DashboardQueryIdentity,
): URL {
  if (!LOOPBACK_ORIGIN.test(origin)) {
    throw new Error('Operate dashboard reads require an exact loopback origin.');
  }
  if (identity.productArea !== 'operate' || identity.cycleId === null) {
    throw new Error('Operate collection identity is incomplete.');
  }
  const url = new URL(path, origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  url.searchParams.set('cycleId', identity.cycleId);
  url.searchParams.set('projectId', identity.projectId);
  url.searchParams.set('generation', String(identity.generation));
  return url;
}

/** Fetch the owner-issued Actions collection display for one bound Cycle. */
export async function fetchOperateActionsDisplay(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateExperienceDisplaySurfaceV1 | null> {
  const { identity } = options;
  if (identity.cycleId === null) return null;
  const url = operateCycleBindingUrl(options.origin, '/api/operate/actions', identity);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal: options.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    throw new Error('Actions display response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Actions display response is not JSON.');
  }
  if (!response.ok) return null;
  if (!isActionsDisplaySurface(payload)) return null;
  try {
    assertOperateExperienceDisplaySurfaceV1(payload, {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      generatedAt: payload.payload.generatedAt,
      eventHead: payload.payload.eventHead,
      viewHash: identity.viewHash ?? payload.payload.viewHash,
      projectId: identity.projectId,
      generation: identity.generation,
      surface: 'actions',
      subjectId: null,
      cycleId: identity.cycleId,
    });
  } catch {
    return null;
  }
  return payload;
}

function operateActionBindingUrl(
  origin: string,
  path: string,
  identity: DashboardQueryIdentity,
): URL {
  if (!LOOPBACK_ORIGIN.test(origin)) {
    throw new Error('Operate dashboard reads require an exact loopback origin.');
  }
  if (
    identity.productArea !== 'operate' ||
    identity.cycleId === null ||
    identity.subjectId === null
  ) {
    throw new Error('Operate Action detail identity is incomplete.');
  }
  const url = new URL(path, origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  return url;
}

/** Fetch the owner-issued Action display for one bound subject. */
export async function fetchOperateActionDisplay(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateActionDisplayWorkspaceV1 | null> {
  const { identity } = options;
  if (identity.subjectId === null || identity.cycleId === null) return null;
  const url = operateActionBindingUrl(
    options.origin,
    `/api/operate/actions/${encodeURIComponent(identity.subjectId)}`,
    identity,
  );
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal: options.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    throw new Error('Action display response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Action display response is not JSON.');
  }
  if (!response.ok) return null;
  if (!isActionWorkspaceDisplay(payload)) return null;
  try {
    const expected: OperateDisplayBindingV1 & { actionId: string } = {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      generatedAt: payload.payload.generatedAt,
      eventHead: payload.payload.eventHead,
      viewHash: identity.viewHash ?? payload.payload.viewHash,
      projectId: identity.projectId,
      generation: identity.generation,
      surface: 'actions',
      cycleId: identity.cycleId,
      subjectId: identity.subjectId,
      actionId: identity.subjectId,
    };
    assertOperateActionDisplayWorkspaceV1(payload, expected);
  } catch {
    return null;
  }
  return payload;
}

/** Fetch the owner-issued Inbox display for the current operating scope. */
export async function fetchOperateInboxDisplay(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateExperienceDisplaySurfaceV1 | null> {
  const { identity } = options;
  const inboxPath =
    identity.subjectId === null
      ? '/api/operate/inbox'
      : `/api/operate/inbox/${encodeURIComponent(identity.subjectId)}`;
  const url = new URL(inboxPath, options.origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  url.searchParams.set('projectId', identity.projectId);
  url.searchParams.set('generation', String(identity.generation));
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal: options.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    throw new Error('Inbox display response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Inbox display response is not JSON.');
  }
  if (!response.ok) return null;
  if (!isActionsDisplaySurface(payload)) return null;
  try {
    assertOperateExperienceDisplaySurfaceV1(payload, {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      generatedAt: payload.payload.generatedAt,
      eventHead: payload.payload.eventHead,
      viewHash: identity.viewHash ?? payload.payload.viewHash,
      projectId: identity.projectId,
      generation: identity.generation,
      surface: 'inbox',
      subjectId: identity.subjectId,
      cycleId: identity.cycleId,
    });
  } catch {
    return null;
  }
  return payload;
}

/** Fetch the owner-issued recovery display for the current operating scope. */
export async function fetchOperateRecoveryDisplay(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateRecoveryDisplaySurfaceV1 | null> {
  const { identity } = options;
  const url = new URL('/api/operate/recovery', options.origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal: options.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    throw new Error('Recovery display response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Recovery display response is not JSON.');
  }
  if (!response.ok) return null;
  if (!isRecoveryDisplaySurface(payload)) return null;
  try {
    assertOperateRecoveryDisplaySurfaceV1(payload, {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      generatedAt: payload.payload.generatedAt,
      eventHead: payload.payload.eventHead,
      viewHash: identity.viewHash ?? payload.payload.viewHash,
    });
  } catch {
    return null;
  }
  return payload;
}

/** Read the closed Action workspace display through the installed OpenPlanr client. */
export async function readOperateActionWorkspace(
  client: OperateClient,
  actionId: string,
  cycleId: string,
  actor: OperateActorV2,
): Promise<OperateActionDisplayWorkspaceV1> {
  const workspace = await client.readActionWorkspace(actionId, cycleId, actor);
  if (!isActionWorkspaceDisplay(workspace)) {
    throw new Error('The Action workspace display did not verify.');
  }
  return workspace;
}
