import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { DashboardEventHead, DashboardQueryIdentity } from '../binding/query-identity.js';
import {
  DashboardValidationError,
  exactBoolean,
  exactRecord,
  exactString,
  parseExactJson,
} from './validation.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const REASON = /^[A-Z][A-Z0-9_]{0,127}$/u;
const PATCH_ID = /^xpatch_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const PATCH_PATHS = new Set([
  '/status',
  '/attention',
  '/domainMetrics',
  '/cycles',
  '/inbox',
  '/actions',
  '/evidence',
  '/claims',
  '/rationale',
  '/outcomes',
  '/learnings',
  '/history',
  '/replay',
  '/allowedActions',
  '/omissions',
  '/export',
]);
const PATCH_WIRE_SIGNATURES = new WeakMap<object, string>();

export type DashboardLiveBinding = Readonly<{
  actorId: string;
  projectId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generation: number;
}>;
export type DashboardLiveCursor = Readonly<{
  eventHead: DashboardEventHead;
  viewHash: string;
}>;
export type DashboardLivePatchSignal = Readonly<{
  patchId: string;
  patchHash: string;
  from: DashboardLiveCursor;
  to: DashboardLiveCursor;
  changedPaths: readonly string[];
}>;

type SnapshotEvent = Readonly<{
  kind: 'dashboard-live-event';
  schemaVersion: '1.0.0';
  event: 'snapshot';
  binding: DashboardLiveBinding;
  cursor: DashboardLiveCursor;
  payload: OperateExperienceDisplaySurfaceV1;
}>;
type PatchEvent = Readonly<{
  kind: 'dashboard-live-event';
  schemaVersion: '1.0.0';
  event: 'patch';
  binding: DashboardLiveBinding;
  cursor: DashboardLiveCursor;
  payload: DashboardLivePatchSignal;
}>;
type ReadyEvent = Readonly<{
  kind: 'dashboard-live-event';
  schemaVersion: '1.0.0';
  event: 'ready';
  binding: DashboardLiveBinding;
  cursor: DashboardLiveCursor;
  payload: Readonly<{ mutationEnabled: boolean; reasonCodes: readonly string[] }>;
}>;
type StaleEvent = Readonly<{
  kind: 'dashboard-live-event';
  schemaVersion: '1.0.0';
  event: 'stale';
  binding: DashboardLiveBinding;
  cursor: DashboardLiveCursor;
  payload: Readonly<{ mutationEnabled: false; reasonCodes: readonly string[]; recovery: string }>;
}>;
export type DashboardLiveEvent = SnapshotEvent | PatchEvent | ReadyEvent | StaleEvent;

function head(value: unknown, path: string): DashboardEventHead {
  const record = exactRecord(value, ['sequence', 'hash'], path);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0) {
    throw new DashboardValidationError(`${path}.sequence`, 'expected a non-negative safe integer');
  }
  const sequence = record.sequence as number;
  const hash = record.hash === null ? null : exactString(record.hash, `${path}.hash`, HASH);
  if ((sequence === 0) !== (hash === null)) {
    throw new DashboardValidationError(path, 'sequence and hash are inconsistent');
  }
  return Object.freeze({ sequence, hash });
}

function cursor(value: unknown, path: string): DashboardLiveCursor {
  const record = exactRecord(value, ['eventHead', 'viewHash'], path);
  return Object.freeze({
    eventHead: head(record.eventHead, `${path}.eventHead`),
    viewHash: exactString(record.viewHash, `${path}.viewHash`, HASH),
  });
}

function binding(value: unknown): DashboardLiveBinding {
  const record = exactRecord(
    value,
    ['actorId', 'projectId', 'scopeId', 'domainId', 'domainVersion', 'generation'],
    '$.binding',
  );
  if (!Number.isSafeInteger(record.generation) || (record.generation as number) < 0) {
    throw new DashboardValidationError(
      '$.binding.generation',
      'expected a non-negative safe integer',
    );
  }
  return Object.freeze({
    actorId: exactString(record.actorId, '$.binding.actorId', ID),
    projectId: exactString(record.projectId, '$.binding.projectId', HASH),
    scopeId: exactString(record.scopeId, '$.binding.scopeId', ID),
    domainId: exactString(record.domainId, '$.binding.domainId', ID),
    domainVersion: exactString(record.domainVersion, '$.binding.domainVersion', ID),
    generation: record.generation as number,
  });
}

function reasons(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new DashboardValidationError(path, 'expected an array');
  return Object.freeze(
    value.map((entry, index) => exactString(entry, `${path}[${index}]`, REASON)),
  );
}

function readyPayload(value: unknown, path = '$.payload'): ReadyEvent['payload'] {
  const payload = exactRecord(value, ['mutationEnabled', 'reasonCodes'], path);
  const mutationEnabled = exactBoolean(payload.mutationEnabled, `${path}.mutationEnabled`);
  const reasonCodes = reasons(payload.reasonCodes, `${path}.reasonCodes`);
  if (
    (mutationEnabled && reasonCodes.length !== 0) ||
    (!mutationEnabled && reasonCodes.length === 0)
  ) {
    throw new DashboardValidationError(path, 'ready mutation and reason state are inconsistent');
  }
  return Object.freeze({ mutationEnabled, reasonCodes });
}

function recoveryText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 240 ||
    [...value].some((character) => (character.codePointAt(0) ?? 0) <= 31)
  ) {
    throw new DashboardValidationError('$.payload.recovery', 'contains invalid recovery text');
  }
  return value;
}

function sameHead(a: DashboardEventHead, b: DashboardEventHead): boolean {
  return a.sequence === b.sequence && a.hash === b.hash;
}

function sameCursor(a: DashboardLiveCursor, b: DashboardLiveCursor): boolean {
  return sameHead(a.eventHead, b.eventHead) && a.viewHash === b.viewHash;
}

function liveSurface(identity: DashboardQueryIdentity | null): 'today' | 'inbox' {
  return identity?.route === '#/operate/inbox' || identity?.route.startsWith('#/operate/inbox/')
    ? 'inbox'
    : 'today';
}

function parsePatch(value: unknown, expected: DashboardLiveCursor): DashboardLivePatchSignal {
  const record = exactRecord(
    value,
    ['patchId', 'patchHash', 'from', 'to', 'changedPaths'],
    '$.payload',
  );
  const from = cursor(record.from, '$.payload.from');
  const to = cursor(record.to, '$.payload.to');
  if (!sameCursor(to, expected)) {
    throw new DashboardValidationError('$.payload', 'patch target does not equal envelope cursor');
  }
  if (!Array.isArray(record.changedPaths)) {
    throw new DashboardValidationError('$.payload.changedPaths', 'expected an array');
  }
  const changedPaths = record.changedPaths.map((path, index) => {
    if (typeof path !== 'string' || !PATCH_PATHS.has(path)) {
      throw new DashboardValidationError(
        `$.payload.changedPaths[${index}]`,
        'contains an unsupported path',
      );
    }
    return path;
  });
  if (new Set(changedPaths).size !== changedPaths.length) {
    throw new DashboardValidationError('$.payload.changedPaths', 'contains duplicate paths');
  }
  const signal = {
    patchId: exactString(record.patchId, '$.payload.patchId', PATCH_ID),
    patchHash: exactString(record.patchHash, '$.payload.patchHash', HASH),
    from,
    to,
    changedPaths: Object.freeze(changedPaths),
  };
  PATCH_WIRE_SIGNATURES.set(signal, JSON.stringify(value));
  return Object.freeze(signal);
}

/** Parses one SSE data field and returns only validated, presentation-safe event data. */
export function parseDashboardLiveEvent(
  data: string,
  identity: DashboardQueryIdentity | null = null,
): DashboardLiveEvent {
  const raw = exactRecord(
    parseExactJson(data),
    ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload'],
    '$',
  );
  if (raw.kind !== 'dashboard-live-event' || raw.schemaVersion !== '1.0.0') {
    throw new DashboardValidationError('$', 'has an unsupported live event contract');
  }
  const parsedBinding = binding(raw.binding);
  const parsedCursor = cursor(raw.cursor, '$.cursor');
  const base = {
    kind: 'dashboard-live-event' as const,
    schemaVersion: '1.0.0' as const,
    binding: parsedBinding,
    cursor: parsedCursor,
  };
  if (raw.event === 'snapshot') {
    const display = assertOperateExperienceDisplaySurfaceV1(raw.payload);
    const payload = display.payload;
    const expectedSurface = liveSurface(identity);
    const committedCycleId =
      payload.surface === 'today' ? (payload.data.activeCycle?.cycleId ?? null) : null;
    if (
      payload.surface !== expectedSurface ||
      payload.eventHead.sequence !== parsedCursor.eventHead.sequence ||
      payload.eventHead.hash !== parsedCursor.eventHead.hash ||
      (expectedSurface === 'today' &&
        identity !== null &&
        identity.cycleId !== null &&
        committedCycleId !== identity.cycleId)
    ) {
      throw new DashboardValidationError('$.payload', 'snapshot binding or cursor is inconsistent');
    }
    const expected: OperateDisplayBindingV1 = Object.freeze({
      actorId: parsedBinding.actorId,
      scopeId: parsedBinding.scopeId,
      domainId: parsedBinding.domainId,
      domainVersion: parsedBinding.domainVersion,
      generatedAt: payload.generatedAt,
      eventHead: payload.eventHead,
      viewHash: parsedCursor.viewHash,
      surface: expectedSurface,
      subjectId: null,
      cycleId: identity?.cycleId ?? committedCycleId,
      ...(expectedSurface === 'inbox'
        ? { projectId: parsedBinding.projectId, generation: parsedBinding.generation }
        : {}),
    });
    try {
      assertOperateExperienceDisplaySurfaceV1(display, expected);
    } catch {
      throw new DashboardValidationError('$.payload', 'snapshot binding or cursor is inconsistent');
    }
    return Object.freeze({ ...base, event: 'snapshot', payload: display });
  }
  if (raw.event === 'patch') {
    const payload = parsePatch(raw.payload, parsedCursor);
    return Object.freeze({ ...base, event: 'patch', payload });
  }
  if (raw.event === 'ready') {
    return Object.freeze({
      ...base,
      event: 'ready',
      payload: readyPayload(raw.payload),
    });
  }
  if (raw.event === 'stale') {
    const payload = exactRecord(
      raw.payload,
      ['mutationEnabled', 'reasonCodes', 'recovery'],
      '$.payload',
    );
    if (payload.mutationEnabled !== false) {
      throw new DashboardValidationError(
        '$.payload.mutationEnabled',
        'stale events disable mutation',
      );
    }
    const reasonCodes = reasons(payload.reasonCodes, '$.payload.reasonCodes');
    if (reasonCodes.length === 0) {
      throw new DashboardValidationError('$.payload.reasonCodes', 'stale events require a reason');
    }
    return Object.freeze({
      ...base,
      event: 'stale',
      payload: Object.freeze({
        mutationEnabled: false,
        reasonCodes,
        recovery: recoveryText(payload.recovery),
      }),
    });
  }
  throw new DashboardValidationError('$.event', 'contains an unsupported event');
}

export type DashboardSseRefetchReason =
  | 'invalid-event'
  | 'gap'
  | 'reordered'
  | 'divergent-duplicate'
  | 'cursor-mismatch'
  | 'restart-regression'
  | 'state-mismatch'
  | 'stale';

export function createDashboardSseReconciler(
  options: Readonly<{
    identity: DashboardQueryIdentity;
    isCurrent: (identity: DashboardQueryIdentity) => boolean;
    onSnapshot: (surface: OperateExperienceDisplaySurfaceV1, cursor: DashboardLiveCursor) => void;
    onPatch: (patch: DashboardLivePatchSignal) => void;
    onReady?: (payload: ReadyEvent['payload']) => void;
    onStale?: (payload: StaleEvent['payload']) => void;
    onRefetch: (reason: DashboardSseRefetchReason) => void;
  }>,
) {
  const identity = options.identity;
  let current =
    identity.eventHead && identity.viewHash
      ? Object.freeze({ eventHead: identity.eventHead, viewHash: identity.viewHash })
      : null;
  let disposed = false;
  let refetchPending = false;
  let receivedSnapshot = false;
  let snapshotSignature: string | null = null;
  let snapshotReadyState: string | null = null;
  const acceptedPatchSignatures = new Map<string, string>();

  const requestRefetch = (reason: DashboardSseRefetchReason) => {
    if (!refetchPending) {
      refetchPending = true;
      options.onRefetch(reason);
    }
    return Object.freeze({ kind: 'refetch' as const, reason });
  };
  const acceptsBinding = (candidate: DashboardLiveBinding) =>
    candidate.actorId === identity.actorId &&
    candidate.projectId === identity.projectId &&
    candidate.scopeId === identity.scopeId &&
    candidate.domainId === identity.domainId &&
    candidate.domainVersion === identity.domainVersion;

  const ingest = (event: DashboardLiveEvent) => {
    if (disposed || !options.isCurrent(identity)) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'inactive' as const });
    }
    if (event.binding.generation !== identity.generation) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'foreign-generation' as const });
    }
    if (!acceptsBinding(event.binding)) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'foreign-binding' as const });
    }
    if (event.event === 'snapshot') {
      if (current) {
        if (event.cursor.eventHead.sequence < current.eventHead.sequence) {
          return requestRefetch('restart-regression');
        }
        if (
          event.cursor.eventHead.sequence > current.eventHead.sequence &&
          !(
            event.payload.payload.surface === 'inbox' &&
            event.cursor.eventHead.sequence === current.eventHead.sequence + 1
          )
        ) {
          return requestRefetch('gap');
        }
        if (
          event.cursor.eventHead.sequence === current.eventHead.sequence &&
          !sameCursor(event.cursor, current)
        ) {
          return requestRefetch('divergent-duplicate');
        }
      }
      if (receivedSnapshot && current && sameCursor(event.cursor, current)) {
        return snapshotSignature === JSON.stringify(event.payload)
          ? Object.freeze({ kind: 'duplicate' as const })
          : requestRefetch('divergent-duplicate');
      }
      current = event.cursor;
      receivedSnapshot = true;
      snapshotSignature = JSON.stringify(event.payload);
      snapshotReadyState = JSON.stringify({
        mutationEnabled: event.payload.payload.mutationEnabled,
        reasonCodes: event.payload.payload.reasonCodes,
      });
      refetchPending = false;
      acceptedPatchSignatures.clear();
      options.onSnapshot(event.payload, event.cursor);
      return Object.freeze({ kind: 'accepted' as const, event: 'snapshot' as const });
    }
    if (!current) return requestRefetch('cursor-mismatch');
    if (event.event === 'ready') {
      if (!sameCursor(event.cursor, current)) return requestRefetch('cursor-mismatch');
      if (snapshotReadyState === null || snapshotReadyState !== JSON.stringify(event.payload)) {
        return requestRefetch('state-mismatch');
      }
      options.onReady?.(event.payload);
      return Object.freeze({ kind: 'accepted' as const, event: 'ready' as const });
    }
    if (event.event === 'stale') {
      options.onStale?.(event.payload);
      return requestRefetch('stale');
    }
    const patch = event.payload;
    const cursorKey = `${patch.to.eventHead.sequence}:${patch.to.eventHead.hash}:${patch.to.viewHash}`;
    const signature = PATCH_WIRE_SIGNATURES.get(patch) ?? JSON.stringify(patch);
    if (sameCursor(patch.to, current)) {
      return acceptedPatchSignatures.get(cursorKey) === signature
        ? Object.freeze({ kind: 'duplicate' as const })
        : requestRefetch('divergent-duplicate');
    }
    if (patch.to.eventHead.sequence <= current.eventHead.sequence) {
      return requestRefetch('reordered');
    }
    if (patch.to.eventHead.sequence !== current.eventHead.sequence + 1) {
      return requestRefetch('gap');
    }
    if (!sameCursor(patch.from, current)) return requestRefetch('reordered');
    acceptedPatchSignatures.set(cursorKey, signature);
    current = patch.to;
    snapshotReadyState = null;
    options.onPatch(patch);
    return Object.freeze({ kind: 'accepted' as const, event: 'patch' as const });
  };

  return Object.freeze({
    ingest,
    ingestJson: (data: string) => {
      try {
        return ingest(parseDashboardLiveEvent(data, identity));
      } catch {
        return requestRefetch('invalid-event');
      }
    },
    getCursor: () => current,
    markReconciled: (next: DashboardLiveCursor, state: ReadyEvent['payload']) => {
      if (disposed) return false;
      current = cursor(next, '$.cursor');
      snapshotReadyState = JSON.stringify(readyPayload(state, '$.state'));
      refetchPending = false;
      receivedSnapshot = false;
      snapshotSignature = null;
      acceptedPatchSignatures.clear();
      return true;
    },
    dispose: () => {
      disposed = true;
    },
  });
}

type DashboardSseReconciler = ReturnType<typeof createDashboardSseReconciler>;

/** Opens one abortable loopback SSE stream; close removes listeners and cancels the read. */
export function connectDashboardSse(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    reconciler: DashboardSseReconciler;
    lastEventId?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
) {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(origin.hostname) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new DashboardValidationError('$.origin', 'expected an exact loopback HTTP origin');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener('abort', abort, { once: true });
  const url = new URL('/api/operate/events', origin);
  url.searchParams.set('scopeId', options.identity.scopeId);
  url.searchParams.set('domainId', options.identity.domainId);
  url.searchParams.set('domainVersion', options.identity.domainVersion);
  url.searchParams.set('generation', String(options.identity.generation));
  if (liveSurface(options.identity) === 'inbox') {
    url.searchParams.set('projectId', options.identity.projectId);
    url.searchParams.set('surface', 'inbox');
  }
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'x-openplanr-actor': options.identity.actorId,
  };
  if (options.lastEventId) headers['last-event-id'] = options.lastEventId;
  const completion = (async () => {
    const response = await (options.fetcher ?? fetch)(url, { headers, signal: controller.signal });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('text/event-stream') ||
      !response.body
    ) {
      throw new DashboardValidationError('$', 'live stream response is unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!controller.signal.aborted) {
        const result = await reader.read();
        buffer += decoder.decode(result.value, { stream: !result.done });
        buffer = buffer.replaceAll('\r\n', '\n').replace(/\r(?!$)/gu, '\n');
        if (result.done && buffer.endsWith('\r')) buffer = `${buffer.slice(0, -1)}\n`;
        if (buffer.length > 256 * 1024)
          throw new DashboardValidationError('$', 'live frame exceeds limit');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const eventName = lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim();
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            const parsed = parseDashboardLiveEvent(data, options.identity);
            if (eventName && eventName !== parsed.event) {
              throw new DashboardValidationError('$.event', 'SSE name and envelope event differ');
            }
            options.reconciler.ingest(parsed);
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (result.done) {
          if (buffer.trim().length > 0) {
            throw new DashboardValidationError('$', 'live stream ended with a partial frame');
          }
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  })()
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof DashboardValidationError) throw error;
      throw new DashboardValidationError('$', 'live stream failed safely');
    })
    .finally(() => options.signal?.removeEventListener('abort', abort));
  return Object.freeze({
    completion,
    close: () => {
      controller.abort();
      options.reconciler.dispose();
      options.signal?.removeEventListener('abort', abort);
    },
  });
}
