import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveOperateSharedTruthSummaryV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';
import { canonicalizeJson } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  connectDashboardSse,
  createDashboardSseReconciler,
  type DashboardLiveCursor,
  parseDashboardLiveEvent,
} from '../../../../apps/dashboard/src/lib/api/sse.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  createDashboardQueryClient,
  DashboardReadError,
  DashboardStaleResponseError,
} from '../../../../apps/dashboard/src/lib/query/create-dashboard-query-client.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const cursor = (sequence: number, head: string, view: string): DashboardLiveCursor => ({
  eventHead: { sequence, hash: hash(head) },
  viewHash: hash(view),
});
const baseCursor = cursor(1, 'a', 'b');
const nextCursor = cursor(2, 'c', 'd');
const identity = (overrides: Partial<DashboardQueryIdentity> = {}): DashboardQueryIdentity => ({
  productArea: 'operate',
  route: '#/operate/today',
  actorId: 'owner-acme',
  projectId: hash('f'),
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  cycleId: null,
  subjectId: null,
  eventHead: baseCursor.eventHead,
  viewHash: baseCursor.viewHash,
  generation: 7,
  ...overrides,
});
const binding = (overrides = {}) => ({
  actorId: 'owner-acme',
  projectId: hash('f'),
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  generation: 7,
  ...overrides,
});
const DISPLAY_DOMAIN = 'openplanr:operate-experience-display-surface:1.0.0';

// This file's synthetic cursor hashes are the subject under test, so it cannot issue surfaces
// through the real producer the way the live-state boundary test does. The truth summary is still
// taken from the producer rather than hand-written: derived once from the package's own empty
// experience view, then rebound to whichever cursor a case supplies.
const packageRoot = resolvePipelinePackageRoot();
const EMPTY_EXPERIENCE_VIEW = JSON.parse(
  readFileSync(
    join(packageRoot, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
    'utf8',
  ),
)['operate-experience-view'];
const emptyTruthSummary = (eventHead: unknown, viewHash: unknown) => ({
  ...deriveOperateSharedTruthSummaryV1(EMPTY_EXPERIENCE_VIEW),
  sourceEventHead: eventHead,
  sourceViewHash: viewHash,
});
const surface = (overrides = {}) => {
  const payload = {
    ok: true,
    kind: 'operate-experience-surface',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    surface: 'today',
    readOnly: true,
    mutationEnabled: true,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-acme',
    accessLevel: 'public',
    generatedAt: '2026-08-13T00:00:00.000Z',
    eventHead: baseCursor.eventHead,
    viewHash: baseCursor.viewHash,
    status: 'ready',
    reasonCodes: [],
    data: {
      attention: [],
      domainMetrics: [],
      activeCycle: null,
      inbox: [],
      actions: [],
      outcomes: [],
      allowedActions: [],
    },
    ...overrides,
  };
  payload.truthSummary = emptyTruthSummary(payload.eventHead, payload.viewHash);
  const base = {
    kind: 'operate-experience-display-surface',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    payload,
    integrity: {
      algorithm: 'sha-256-jcs',
      domain: DISPLAY_DOMAIN,
      sourceViewHash: payload.viewHash,
    },
  };
  const contentHash = `sha256:${createHash('sha256')
    .update(`${DISPLAY_DOMAIN}\0${canonicalizeJson(base)}`)
    .digest('hex')}`;
  return { ...base, integrity: { ...base.integrity, contentHash } };
};
const envelope = (
  event: string,
  payload: unknown,
  eventCursor = baseCursor,
  eventBinding = binding(),
) =>
  JSON.stringify({
    kind: 'dashboard-live-event',
    schemaVersion: '1.0.0',
    event,
    binding: eventBinding,
    cursor: eventCursor,
    payload,
  });
const patch = (overrides = {}) => ({
  patchId: 'xpatch_12345678',
  patchHash: hash('e'),
  from: baseCursor,
  to: nextCursor,
  changedPaths: ['/status'],
  ...overrides,
});

function harness(currentIdentity = identity()) {
  const snapshots = vi.fn();
  const patches = vi.fn();
  const refetches = vi.fn();
  let active = true;
  const reconciler = createDashboardSseReconciler({
    identity: currentIdentity,
    isCurrent: () => active,
    onSnapshot: snapshots,
    onPatch: patches,
    onRefetch: refetches,
  });
  return {
    reconciler,
    snapshots,
    patches,
    refetches,
    deactivate: () => {
      active = false;
    },
  };
}

describe('dashboard SSE reconciliation', () => {
  it('accepts a validated snapshot and distinguishes exact from divergent duplicates', () => {
    const { reconciler, snapshots, refetches } = harness();
    const first = parseDashboardLiveEvent(envelope('snapshot', surface()));
    expect(reconciler.ingest(first)).toEqual({ kind: 'accepted', event: 'snapshot' });
    expect(reconciler.ingest(first)).toEqual({ kind: 'duplicate' });
    const divergent = parseDashboardLiveEvent(
      envelope(
        'snapshot',
        surface({
          generatedAt: '2026-08-13T00:00:02.000Z',
        }),
      ),
    );
    expect(reconciler.ingest(divergent)).toEqual({
      kind: 'refetch',
      reason: 'divergent-duplicate',
    });
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(snapshots.mock.calls[0]?.[0]).toMatchObject({
      kind: 'operate-experience-display-surface',
      payload: { surface: 'today' },
      integrity: { algorithm: 'sha-256-jcs' },
    });
    expect(refetches).toHaveBeenCalledOnce();
  });

  it('refuses snapshot content, digest, and exact Cycle binding tampering before callbacks', () => {
    const cases = [
      (() => {
        const display = structuredClone(surface());
        display.payload.generatedAt = '2026-08-13T00:00:09.000Z';
        return display;
      })(),
      (() => {
        const display = structuredClone(surface());
        display.integrity.contentHash = hash('9');
        return display;
      })(),
    ];
    for (const display of cases) {
      const current = harness();
      expect(current.reconciler.ingestJson(envelope('snapshot', display))).toEqual({
        kind: 'refetch',
        reason: 'invalid-event',
      });
      expect(current.snapshots).not.toHaveBeenCalled();
    }

    const cycleBound = harness(identity({ cycleId: 'cyc_00000001' }));
    expect(cycleBound.reconciler.ingestJson(envelope('snapshot', surface()))).toEqual({
      kind: 'refetch',
      reason: 'invalid-event',
    });
    expect(cycleBound.snapshots).not.toHaveBeenCalled();
  });

  it('rejects forked, regressed, and skipped initial snapshots from a current cursor', () => {
    const exact = harness();
    expect(
      exact.reconciler.ingest(parseDashboardLiveEvent(envelope('snapshot', surface()))),
    ).toEqual({ kind: 'accepted', event: 'snapshot' });

    const forkCursor = cursor(1, '9', '8');
    const fork = harness();
    expect(
      fork.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope(
            'snapshot',
            surface({ eventHead: forkCursor.eventHead, viewHash: forkCursor.viewHash }),
            forkCursor,
          ),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'divergent-duplicate' });

    const regressedCursor = { eventHead: { sequence: 0, hash: null }, viewHash: hash('7') };
    const regressed = harness();
    expect(
      regressed.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope(
            'snapshot',
            surface({ eventHead: regressedCursor.eventHead, viewHash: regressedCursor.viewHash }),
            regressedCursor,
          ),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'restart-regression' });

    const ahead = harness();
    expect(
      ahead.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope(
            'snapshot',
            surface({ eventHead: nextCursor.eventHead, viewHash: nextCursor.viewHash }),
            nextCursor,
          ),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'gap' });
  });

  it('never accepts a repeated snapshot with a different cursor', () => {
    const repeated = harness();
    repeated.reconciler.ingest(parseDashboardLiveEvent(envelope('snapshot', surface())));
    expect(
      repeated.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope(
            'snapshot',
            surface({ eventHead: nextCursor.eventHead, viewHash: nextCursor.viewHash }),
            nextCursor,
          ),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(repeated.snapshots).toHaveBeenCalledTimes(1);
  });

  it('couples ready mutation state to the last canonical snapshot', () => {
    const ready = harness();
    ready.reconciler.ingest(parseDashboardLiveEvent(envelope('snapshot', surface())));
    expect(
      ready.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope('ready', {
            mutationEnabled: true,
            reasonCodes: [],
          }),
        ),
      ),
    ).toEqual({ kind: 'accepted', event: 'ready' });

    const readOnlySurface = surface({
      status: 'read-only',
      mutationEnabled: false,
      reasonCodes: ['OPERATE_READ_ONLY'],
    });
    const readOnly = harness();
    readOnly.reconciler.ingest(parseDashboardLiveEvent(envelope('snapshot', readOnlySurface)));
    expect(
      readOnly.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope('ready', {
            mutationEnabled: false,
            reasonCodes: ['OPERATE_READ_ONLY'],
          }),
        ),
      ),
    ).toEqual({ kind: 'accepted', event: 'ready' });
    expect(
      readOnly.reconciler.ingest(
        parseDashboardLiveEvent(
          envelope('ready', {
            mutationEnabled: true,
            reasonCodes: [],
          }),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'state-mismatch' });
    expect(readOnly.refetches).toHaveBeenCalledOnce();
  });

  it('advances only one exact contiguous signal and never exposes operation values', () => {
    const { reconciler, patches, refetches } = harness();
    const event = parseDashboardLiveEvent(envelope('patch', patch(), nextCursor));
    expect(reconciler.ingest(event)).toEqual({ kind: 'accepted', event: 'patch' });
    expect(patches).toHaveBeenCalledWith({
      patchId: 'xpatch_12345678',
      patchHash: hash('e'),
      from: baseCursor,
      to: nextCursor,
      changedPaths: ['/status'],
    });
    expect(JSON.stringify(patches.mock.calls)).not.toContain('read-only');
    expect(reconciler.ingest(event)).toEqual({ kind: 'duplicate' });
    const divergent = parseDashboardLiveEvent(
      envelope('patch', patch({ patchHash: hash('9') }), nextCursor),
    );
    expect(reconciler.ingest(divergent)).toEqual({
      kind: 'refetch',
      reason: 'divergent-duplicate',
    });
    expect(patches).toHaveBeenCalledTimes(1);
    expect(refetches).toHaveBeenCalledOnce();
  });

  it('requests one refetch for gaps/reorder and permits another after a full-read reconciliation', () => {
    const { reconciler, refetches } = harness();
    const gapCursor = cursor(3, '7', '8');
    const gap = parseDashboardLiveEvent(
      envelope(
        'patch',
        patch({
          to: gapCursor,
        }),
        gapCursor,
      ),
    );
    expect(reconciler.ingest(gap)).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(reconciler.ingest(gap)).toEqual({ kind: 'refetch', reason: 'gap' });
    expect(refetches).toHaveBeenCalledTimes(1);
    expect(reconciler.markReconciled(nextCursor, { mutationEnabled: true, reasonCodes: [] })).toBe(
      true,
    );
    expect(
      reconciler.ingest(
        parseDashboardLiveEvent(
          envelope('ready', { mutationEnabled: true, reasonCodes: [] }, nextCursor),
        ),
      ),
    ).toEqual({ kind: 'accepted', event: 'ready' });
    expect(
      reconciler.ingest(
        parseDashboardLiveEvent(
          envelope(
            'ready',
            { mutationEnabled: false, reasonCodes: ['OPERATE_READ_ONLY'] },
            nextCursor,
          ),
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'state-mismatch' });
    const reordered = parseDashboardLiveEvent(envelope('patch', patch(), nextCursor));
    expect(reconciler.ingest(reordered)).toEqual({
      kind: 'refetch',
      reason: 'divergent-duplicate',
    });
    expect(refetches).toHaveBeenCalledTimes(2);
  });

  it('rejects foreign binding, generation, inactive routes, and hostile envelopes without callbacks', () => {
    const current = identity();
    const { reconciler, patches, refetches, deactivate } = harness(current);
    const foreign = parseDashboardLiveEvent(
      envelope('patch', patch(), nextCursor, binding({ scopeId: 'foreign' })),
    );
    expect(reconciler.ingest(foreign)).toEqual({ kind: 'rejected', reason: 'foreign-binding' });
    const generation = parseDashboardLiveEvent(
      envelope('patch', patch(), nextCursor, binding({ generation: 8 })),
    );
    expect(reconciler.ingest(generation)).toEqual({
      kind: 'rejected',
      reason: 'foreign-generation',
    });
    expect(
      reconciler.ingestJson(envelope('ready', { mutationEnabled: true, reasonCodes: ['OFFLINE'] })),
    ).toEqual({ kind: 'refetch', reason: 'invalid-event' });
    expect(
      reconciler.ingestJson(
        envelope(
          'patch',
          {
            ...patch(),
            operations: [{ value: { privateBody: '/private/provider/body' } }],
          },
          nextCursor,
        ),
      ),
    ).toEqual({ kind: 'refetch', reason: 'invalid-event' });
    deactivate();
    expect(
      reconciler.ingest(parseDashboardLiveEvent(envelope('patch', patch(), nextCursor))),
    ).toEqual({ kind: 'rejected', reason: 'inactive' });
    expect(patches).not.toHaveBeenCalled();
    expect(refetches).toHaveBeenCalledOnce();
  });

  it('closes the stream by aborting its request and disabling late events', async () => {
    let requestSignal: AbortSignal | undefined;
    const { reconciler } = harness();
    const stream = connectDashboardSse({
      origin: 'http://127.0.0.1:7473',
      identity: identity(),
      reconciler,
      fetcher: vi.fn(async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), {
            once: true,
          });
        });
      }) as typeof fetch,
    });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    stream.close();
    await expect(stream.completion).resolves.toBeUndefined();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('fails closed for an already-aborted request and a truncated final frame', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const first = harness();
    const fetcher = vi.fn(async (_url, init) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      throw new Error('expected an aborted signal');
    }) as typeof fetch;
    const closed = connectDashboardSse({
      origin: 'http://localhost:7473',
      identity: identity(),
      reconciler: first.reconciler,
      signal: aborted.signal,
      fetcher,
    });
    await expect(closed.completion).resolves.toBeUndefined();

    const second = harness();
    const partial = connectDashboardSse({
      origin: 'http://127.0.0.1:7473',
      identity: identity(),
      reconciler: second.reconciler,
      fetcher: vi.fn(
        async () =>
          new Response('event: snapshot\ndata: {', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ) as typeof fetch,
    });
    await expect(partial.completion).rejects.toThrow(/partial frame/u);
  });

  it('normalizes private fetch and stream-read errors to fixed safe failures', async () => {
    const privateMarker = 'private-fetch-error-must-not-leak';
    const fetchFailure = connectDashboardSse({
      origin: 'http://127.0.0.1:7473',
      identity: identity(),
      reconciler: harness().reconciler,
      fetcher: vi.fn(async () => {
        throw new Error(privateMarker);
      }) as typeof fetch,
    });
    await expect(fetchFailure.completion).rejects.toMatchObject({
      name: 'DashboardValidationError',
      message: '$: live stream failed safely',
    });

    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(privateMarker);
      },
    });
    const readFailure = connectDashboardSse({
      origin: 'http://127.0.0.1:7473',
      identity: identity(),
      reconciler: harness().reconciler,
      fetcher: vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ) as typeof fetch,
    });
    await expect(readFailure.completion).rejects.toMatchObject({
      name: 'DashboardValidationError',
      message: '$: live stream failed safely',
    });
  });

  it('parses snapshot and ready frames when every CRLF boundary is split across chunks', async () => {
    const current = harness();
    const wire = [
      `event: snapshot\r\ndata: ${envelope('snapshot', surface())}\r\n\r\n`,
      `event: ready\r\ndata: ${envelope('ready', {
        mutationEnabled: true,
        reasonCodes: [],
      })}\r\n\r\n`,
    ].join('');
    const bytes = new TextEncoder().encode(wire);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const stream = connectDashboardSse({
      origin: 'http://127.0.0.1:7473',
      identity: identity(),
      reconciler: current.reconciler,
      fetcher: vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ) as typeof fetch,
    });
    await expect(stream.completion).resolves.toBeUndefined();
    expect(current.snapshots).toHaveBeenCalledOnce();
    expect(current.refetches).not.toHaveBeenCalled();
  });
});

describe('dashboard query coordinator', () => {
  it('aborts binding A and refuses its late validated response after binding B becomes current', async () => {
    const coordinator = createDashboardQueryClient();
    let resolveA!: (value: unknown) => void;
    let signalA: AbortSignal | undefined;
    const bindingA = identity();
    const bindingB = identity({ scopeId: 'scope-beta', generation: 8 });
    const late = coordinator.read(
      bindingA,
      ({ signal }) => {
        signalA = signal;
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      },
      (value) => value,
    );
    await Promise.resolve();
    coordinator.activate(bindingB);
    expect(signalA?.aborted).toBe(true);
    resolveA({ from: 'A' });
    await expect(late).rejects.toBeInstanceOf(DashboardStaleResponseError);
    expect(coordinator.getData(bindingA)).toBeUndefined();
    coordinator.dispose();
  });

  it('coalesces an exact direct-route read and releases all resources on dispose', async () => {
    const coordinator = createDashboardQueryClient();
    const reader = vi.fn(async () => ({ ok: true }));
    const first = coordinator.read(identity(), reader, (value) => value);
    const second = coordinator.read(identity(), reader, (value) => value);
    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ ok: true });
    expect(reader).toHaveBeenCalledOnce();
    expect(coordinator.inFlightCount()).toBe(0);
    coordinator.dispose();
    expect(coordinator.getCurrentIdentity()).toBeNull();
    expect(() => coordinator.activate(identity())).toThrow(/disposed/u);
  });

  it('cleans up and normalizes private reader and validator failures', async () => {
    const coordinator = createDashboardQueryClient();
    const privateMarker = 'private-reader-error-must-not-leak';
    await expect(
      coordinator.read(
        identity(),
        () => {
          throw new Error(privateMarker);
        },
        (value) => value,
      ),
    ).rejects.toBeInstanceOf(DashboardReadError);
    await expect(
      coordinator.read(
        identity(),
        async () => ({ privateMarker }),
        () => {
          throw new Error(privateMarker);
        },
      ),
    ).rejects.toMatchObject({
      code: 'DASHBOARD_READ_FAILED',
      message: 'The dashboard read failed safely.',
    });
    expect(coordinator.inFlightCount()).toBe(0);
    coordinator.dispose();
  });
});
