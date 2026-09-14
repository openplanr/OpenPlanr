import type { OperateCycleDisplayWorkspaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import type { OperateExecutiveBoardDisplaySurfaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import { assertOperateExecutiveBoardDisplaySurfaceV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import type { OperateActorV2, OperateCycleReader } from '../../../contracts/operate.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import type { OperateCycleModelSources } from './cycle-model.js';
import { createOperateExecutiveBoardDisplayValidator } from './executive-board-model.js';

type OperateClient = OperateCycleReader;

export type OperateCycleDetailProjections = Readonly<{
  workspace: OperateCycleDisplayWorkspaceV1;
  executiveBoard: OperateExecutiveBoardDisplaySurfaceV1 | null;
}>;

const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u;
const MAX_WIRE_BYTES = 4 * 1024 * 1024;

function isExecutiveBoardDisplaySurface(
  value: unknown,
): value is OperateExecutiveBoardDisplaySurfaceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: string }).kind === 'operate-executive-board-display-surface'
  );
}

function isCycleWorkspaceDisplay(value: unknown): value is OperateCycleDisplayWorkspaceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: string }).kind === 'operate-cycle-display-workspace'
  );
}

function operateBindingUrl(origin: string, path: string, identity: DashboardQueryIdentity): URL {
  if (!LOOPBACK_ORIGIN.test(origin)) {
    throw new Error('Operate dashboard reads require an exact loopback origin.');
  }
  if (
    identity.productArea !== 'operate' ||
    identity.cycleId === null ||
    identity.subjectId === null
  ) {
    throw new Error('Operate Cycle detail identity is incomplete.');
  }
  const url = new URL(path, origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  return url;
}

/**
 * Fetch the owner-issued executive board display for one bound business Cycle.
 * Missing or refused boards return null rather than synthetic seats.
 */
export async function fetchOperateExecutiveBoardDisplay(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateExecutiveBoardDisplaySurfaceV1 | null> {
  const { identity } = options;
  if (identity.domainId !== 'business' || identity.cycleId === null) return null;
  const url = operateBindingUrl(
    options.origin,
    `/api/operate/cycles/${encodeURIComponent(identity.cycleId)}/executive-board`,
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
    throw new Error('Executive board response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Executive board response is not JSON.');
  }
  if (!response.ok) return null;
  if (!isExecutiveBoardDisplaySurface(payload)) return null;
  try {
    assertOperateExecutiveBoardDisplaySurfaceV1(payload, {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      generatedAt: payload.payload.generatedAt,
      eventHead: payload.payload.eventHead,
      viewHash: identity.viewHash ?? payload.payload.viewHash,
      subjectId: identity.subjectId,
      cycleId: identity.cycleId,
    });
  } catch {
    return null;
  }
  return payload;
}

/**
 * Read the closed Cycle workspace display and, when the owner issues one, the
 * matching executive board display for the same Cycle. Missing or refused board
 * surfaces return null rather than synthetic seats.
 */
export async function readOperateCycleDetailProjections(
  client: OperateClient,
  cycleId: string,
  actor: OperateActorV2,
): Promise<OperateCycleDetailProjections> {
  const workspace = await client.readCycleWorkspace(cycleId, actor);
  if (!isCycleWorkspaceDisplay(workspace)) {
    throw new Error('The Cycle workspace display did not verify.');
  }
  let executiveBoard: OperateExecutiveBoardDisplaySurfaceV1 | null = null;
  try {
    const candidate = await client.readExecutiveBoardDisplay(cycleId, actor);
    executiveBoard = isExecutiveBoardDisplaySurface(candidate) ? candidate : null;
  } catch {
    executiveBoard = null;
  }
  return Object.freeze({ workspace, executiveBoard });
}

/**
 * Pair an already-bound workspace projection with the optional executive board
 * display for live Cycle detail. Software Cycles omit the board read entirely.
 */
export async function readOperateCycleDetailSources(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    workspace: DashboardProductState<unknown>;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateCycleModelSources['current']> {
  const { identity, workspace } = options;
  if (identity.domainId !== 'business') {
    return Object.freeze({ workspace });
  }
  const executiveBoard = await fetchOperateExecutiveBoardDisplay(options);
  const validate = createOperateExecutiveBoardDisplayValidator(identity);
  return Object.freeze({
    workspace,
    executiveBoard:
      executiveBoard === null
        ? null
        : parseDashboardProductState(
            {
              kind: 'ready',
              binding: identity,
              data: executiveBoard,
              reasonCodes: [],
              error: null,
              mutationEnabled: false,
              policy: dashboardProductStatePolicy('ready'),
            },
            { currentBinding: identity, validateData: validate },
          ),
  });
}
