import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  connectDashboardSse,
  createDashboardSseReconciler,
  type DashboardLiveCursor,
  type DashboardSseRefetchReason,
} from '../api/sse.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../binding/query-identity.js';
import {
  createDashboardQueryClient,
  type DashboardReadContext,
  DashboardStaleResponseError,
} from './create-dashboard-query-client.js';

const SAFE_REASON = Object.freeze({
  checking: 'Checking the current durable projection.',
  changed: 'Durable state changed. Controls remain unavailable until the bound view is current.',
  failed: 'The current projection could not be reconciled safely.',
});

export type BoundProjectionPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'stale';

export type BoundProjectionSnapshot<T> = Readonly<{
  phase: BoundProjectionPhase;
  identity: DashboardQueryIdentity | null;
  data: T | null;
  mutationEnabled: boolean;
  reason: string | null;
  refetch: () => void;
  reconcile: () => Promise<BoundProjectionSnapshot<T>>;
}>;

export type BoundProjectionReconciliation = Readonly<{
  cursor: DashboardLiveCursor;
  mutationEnabled: boolean;
  reasonCodes: readonly string[];
}>;

export type BoundProjectionOptions<T> = Readonly<{
  identity: DashboardQueryIdentity;
  /** Advance only when intentionally replacing the reader/validator owner for this identity. */
  sourceKey?: string;
  read: (context: DashboardReadContext) => Promise<unknown>;
  validate: (value: unknown) => T;
  live?: Readonly<{
    origin: string;
    fetcher?: typeof fetch;
    lastEventId?: string;
    reconcile: (value: T) => BoundProjectionReconciliation;
  }>;
}>;

type Listener = () => void;
type ActiveOptions = BoundProjectionOptions<unknown> & Readonly<{ sourceKey: string }>;

const SOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function exactSourceKey(value: string | undefined): string {
  const candidate = value ?? 'default';
  if (!SOURCE_KEY.test(candidate)) {
    throw new Error('Bound projection source key is invalid.');
  }
  return candidate;
}

function idleSnapshot(
  refetch: () => void = () => undefined,
  reconcile: () => Promise<BoundProjectionSnapshot<unknown>> = () =>
    Promise.reject(new Error(SAFE_REASON.failed)),
): BoundProjectionSnapshot<unknown> {
  return Object.freeze({
    phase: 'idle',
    identity: null,
    data: null,
    mutationEnabled: false,
    reason: null,
    refetch,
    reconcile,
  });
}

function sameRouteBinding(left: DashboardQueryIdentity, right: DashboardQueryIdentity): boolean {
  return (
    left.productArea === right.productArea &&
    left.route === right.route &&
    left.actorId === right.actorId &&
    left.projectId === right.projectId &&
    left.scopeId === right.scopeId &&
    left.domainId === right.domainId &&
    left.domainVersion === right.domainVersion &&
    left.cycleId === right.cycleId &&
    left.subjectId === right.subjectId &&
    left.generation === right.generation
  );
}

/**
 * Presentation coordinator around the certified T-008 query and SSE transports. It never applies
 * patch values: a patch is only an invalidation signal and always reconciles with one full read.
 */
export function createBoundProjectionController() {
  let query = createDashboardQueryClient();
  const listeners = new Set<Listener>();
  let snapshot = idleSnapshot();
  let active: ActiveOptions | null = null;
  let stream: ReturnType<typeof connectDashboardSse> | null = null;
  let reconciler: ReturnType<typeof createDashboardSseReconciler> | null = null;
  let refetchInFlight: Promise<void> | null = null;
  let disposed = false;
  let leases = 0;
  let releaseToken = 0;
  let readAttempt = 0;
  let liveContinuityLost = false;
  let streamEpoch = 0;
  let refetchEpoch = 0;
  let trailingInvalidation = false;

  const requestRefetch = (_reason: DashboardSseRefetchReason | 'patch') => {
    if (disposed || !active) return;
    if (refetchInFlight) {
      trailingInvalidation = true;
      publish({
        phase: snapshot.data === null ? 'stale' : 'refreshing',
        identity: snapshot.identity ?? active.identity,
        data: snapshot.data,
        mutationEnabled: false,
        reason: SAFE_REASON.changed,
      });
      return;
    }
    resetQuery(active.identity);
    publish({
      phase: snapshot.data === null ? 'stale' : 'refreshing',
      identity: snapshot.identity ?? active.identity,
      data: snapshot.data,
      mutationEnabled: false,
      reason: SAFE_REASON.changed,
    });
    const epoch = refetchEpoch;
    refetchInFlight = readCurrent(true).finally(() => {
      if (epoch !== refetchEpoch) return;
      refetchInFlight = null;
      if (trailingInvalidation) {
        trailingInvalidation = false;
        requestRefetch('patch');
      }
    });
  };

  const refetchProjection = () => requestRefetch('patch');

  const publish = (next: Omit<BoundProjectionSnapshot<unknown>, 'refetch' | 'reconcile'>) => {
    snapshot = Object.freeze({
      ...next,
      refetch: refetchProjection,
      reconcile: reconcileProjection,
    });
    for (const listener of listeners) listener();
  };
  const isActive = (identity: DashboardQueryIdentity) =>
    !disposed && active !== null && isCurrentDashboardQuery(identity, active.identity);
  const stopStream = () => {
    streamEpoch += 1;
    stream?.close();
    stream = null;
    reconciler?.dispose();
    reconciler = null;
  };
  const resetQuery = (identity: DashboardQueryIdentity) => {
    readAttempt += 1;
    query.dispose();
    query = createDashboardQueryClient();
    query.activate(identity);
  };
  const cancelRefetch = () => {
    refetchEpoch += 1;
    refetchInFlight = null;
    trailingInvalidation = false;
  };

  const reconcileProjection = async (): Promise<BoundProjectionSnapshot<unknown>> => {
    const expected = active?.identity ?? null;
    if (disposed || expected === null) throw new Error(SAFE_REASON.failed);
    requestRefetch('patch');
    while (refetchInFlight !== null) {
      const pending = refetchInFlight;
      await pending;
      if (pending === refetchInFlight) break;
    }
    if (
      disposed ||
      active === null ||
      !isCurrentDashboardQuery(expected, active.identity) ||
      snapshot.phase !== 'ready' ||
      snapshot.identity === null ||
      snapshot.data === null ||
      !sameRouteBinding(snapshot.identity, expected)
    ) {
      throw new Error(SAFE_REASON.failed);
    }
    return snapshot;
  };

  const readCurrent = async (refreshing: boolean): Promise<void> => {
    const options = active;
    if (!options || disposed) return;
    const attempt = ++readAttempt;
    const canRetainData =
      snapshot.identity !== null &&
      (isCurrentDashboardQuery(snapshot.identity, options.identity) ||
        (refreshing && sameRouteBinding(snapshot.identity, options.identity)));
    const previousData = canRetainData ? snapshot.data : null;
    const retainedIdentity = previousData !== null ? snapshot.identity : options.identity;
    publish({
      phase: refreshing && previousData !== null ? 'refreshing' : 'loading',
      identity: retainedIdentity,
      data: previousData,
      mutationEnabled: false,
      reason: refreshing ? SAFE_REASON.changed : SAFE_REASON.checking,
    });
    try {
      const data = await query.read(options.identity, options.read, options.validate);
      if (!isActive(options.identity) || attempt !== readAttempt) return;
      let currentIdentity = options.identity;
      let mutationEnabled = false;
      if (options.live) {
        const state = options.live.reconcile(data);
        const knownCursor = reconciler?.getCursor();
        if (
          knownCursor &&
          (state.cursor.eventHead.sequence < knownCursor.eventHead.sequence ||
            (state.cursor.eventHead.sequence === knownCursor.eventHead.sequence &&
              (state.cursor.eventHead.hash !== knownCursor.eventHead.hash ||
                state.cursor.viewHash !== knownCursor.viewHash)))
        ) {
          throw new DashboardStaleResponseError();
        }
        if (reconciler) {
          if (
            !reconciler.markReconciled(state.cursor, {
              mutationEnabled: state.mutationEnabled,
              reasonCodes: state.reasonCodes,
            })
          ) {
            throw new DashboardStaleResponseError();
          }
        } else if (!liveContinuityLost) {
          throw new DashboardStaleResponseError();
        }
        currentIdentity = createDashboardQueryIdentity({
          ...options.identity,
          eventHead: state.cursor.eventHead,
          viewHash: state.cursor.viewHash,
        });
        mutationEnabled = state.mutationEnabled;
      }
      publish({
        phase: options.live && liveContinuityLost ? 'stale' : 'ready',
        identity: currentIdentity,
        data,
        mutationEnabled: liveContinuityLost ? false : mutationEnabled,
        reason: liveContinuityLost ? SAFE_REASON.failed : null,
      });
    } catch {
      if (!isActive(options.identity) || attempt !== readAttempt) return;
      publish({
        phase: 'stale',
        identity: retainedIdentity,
        data: previousData,
        mutationEnabled: false,
        reason: SAFE_REASON.failed,
      });
    }
  };

  const startStream = (options: ActiveOptions) => {
    liveContinuityLost = false;
    if (!options.live) return;
    const epoch = ++streamEpoch;
    reconciler = createDashboardSseReconciler({
      identity: options.identity,
      isCurrent: () => isActive(options.identity),
      onSnapshot: (value, cursor) => {
        if (!isActive(options.identity)) return;
        try {
          const data = options.validate(value);
          cancelRefetch();
          resetQuery(options.identity);
          publish({
            phase: 'refreshing',
            identity: createDashboardQueryIdentity({
              ...options.identity,
              eventHead: cursor.eventHead,
              viewHash: cursor.viewHash,
            }),
            data,
            mutationEnabled: false,
            reason: SAFE_REASON.checking,
          });
        } catch {
          requestRefetch('invalid-event');
        }
      },
      onPatch: () => requestRefetch('patch'),
      onReady: (state) => {
        if (!isActive(options.identity) || snapshot.data === null || liveContinuityLost) return;
        publish({
          ...snapshot,
          phase: 'ready',
          mutationEnabled: state.mutationEnabled,
          reason: null,
        });
      },
      onStale: () => {
        if (!isActive(options.identity)) return;
        publish({
          phase: snapshot.data === null ? 'stale' : 'refreshing',
          identity: snapshot.identity ?? options.identity,
          data: snapshot.data,
          mutationEnabled: false,
          reason: SAFE_REASON.changed,
        });
      },
      onRefetch: requestRefetch,
    });
    try {
      stream = connectDashboardSse({
        origin: options.live.origin,
        identity: options.identity,
        reconciler,
        fetcher: options.live.fetcher,
        lastEventId: options.live.lastEventId,
      });
    } catch {
      liveContinuityLost = true;
      reconciler.dispose();
      reconciler = null;
      stream = null;
      return;
    }
    const failClosed = () => {
      if (epoch !== streamEpoch || !isActive(options.identity)) return;
      liveContinuityLost = true;
      cancelRefetch();
      publish({
        phase: 'stale',
        identity: snapshot.identity ?? options.identity,
        data: snapshot.data,
        mutationEnabled: false,
        reason: SAFE_REASON.failed,
      });
    };
    void stream.completion.then(failClosed, failClosed);
  };

  const activate = <T>(options: BoundProjectionOptions<T>) => {
    if (disposed) throw new Error('Bound projection controller is disposed.');
    const validatedIdentity = createDashboardQueryIdentity(options.identity);
    const validatedSourceKey = exactSourceKey(options.sourceKey);
    const sourceUnchanged =
      active?.sourceKey === validatedSourceKey &&
      active.live?.origin === options.live?.origin &&
      active.live?.lastEventId === options.live?.lastEventId;
    if (active && isCurrentDashboardQuery(active.identity, validatedIdentity) && sourceUnchanged) {
      return;
    }
    stopStream();
    cancelRefetch();
    if (active && isCurrentDashboardQuery(active.identity, validatedIdentity)) {
      resetQuery(validatedIdentity);
    }
    active = {
      ...options,
      identity: validatedIdentity,
      sourceKey: validatedSourceKey,
    } as ActiveOptions;
    query.activate(validatedIdentity);
    startStream(active);
    void readCurrent(false);
  };

  return Object.freeze({
    activate,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isActiveIdentity: (identity: DashboardQueryIdentity) =>
      active !== null && isCurrentDashboardQuery(active.identity, identity),
    retain: <T>(options: BoundProjectionOptions<T>) => {
      const token = ++releaseToken;
      leases += 1;
      activate(options);
      return () => {
        leases = Math.max(0, leases - 1);
        queueMicrotask(() => {
          if (leases === 0 && token === releaseToken && !disposed) {
            stopStream();
            cancelRefetch();
            query.dispose();
            query = createDashboardQueryClient();
            active = null;
            refetchInFlight = null;
          }
        });
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopStream();
      cancelRefetch();
      query.dispose();
      active = null;
      refetchInFlight = null;
      listeners.clear();
      snapshot = idleSnapshot();
    },
  });
}

export function useBoundProjection<T>(
  options: BoundProjectionOptions<T>,
): BoundProjectionSnapshot<T> {
  const [controller] = useState(createBoundProjectionController);
  const { identity, read, sourceKey = 'default', validate, live } = options;
  const identityKey = JSON.stringify(identity);
  const requestedIdentity = useMemo(
    () => createDashboardQueryIdentity(JSON.parse(identityKey)),
    [identityKey],
  );
  const liveOrigin = live?.origin;
  const liveFetcher = live?.fetcher;
  const liveLastEventId = live?.lastEventId;
  const liveReconcile = live?.reconcile;
  const liveEnabled = live !== undefined;
  const readRef = useRef(read);
  const validateRef = useRef(validate);
  const fetcherRef = useRef(liveFetcher);
  const reconcileRef = useRef(liveReconcile);
  readRef.current = read;
  validateRef.current = validate;
  fetcherRef.current = liveFetcher;
  reconcileRef.current = liveReconcile;
  const stableRead = useCallback((context: DashboardReadContext) => readRef.current(context), []);
  const stableValidate = useCallback((value: unknown) => validateRef.current(value), []);
  const stableFetcher = useCallback(
    (...args: Parameters<typeof fetch>) => (fetcherRef.current ?? fetch)(...args),
    [],
  );
  const stableReconcile = useCallback((value: T) => {
    const reconcileCurrent = reconcileRef.current;
    if (!reconcileCurrent) throw new Error('Bound projection live reconciler is unavailable.');
    return reconcileCurrent(value);
  }, []);
  const stableLive = useMemo(
    () =>
      liveEnabled && liveOrigin !== undefined
        ? Object.freeze({
            origin: liveOrigin,
            fetcher: stableFetcher,
            lastEventId: liveLastEventId,
            reconcile: stableReconcile,
          })
        : undefined,
    [liveEnabled, liveLastEventId, liveOrigin, stableFetcher, stableReconcile],
  );
  const activeOptions = useMemo<BoundProjectionOptions<T>>(
    () =>
      Object.freeze({
        identity: requestedIdentity,
        sourceKey,
        read: stableRead,
        validate: stableValidate,
        live: stableLive,
      }),
    [requestedIdentity, sourceKey, stableLive, stableRead, stableValidate],
  );
  useEffect(() => controller.retain(activeOptions), [activeOptions, controller]);
  const current = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  ) as BoundProjectionSnapshot<T>;
  if (
    current.identity === null ||
    !controller.isActiveIdentity(requestedIdentity) ||
    !sameRouteBinding(current.identity, requestedIdentity)
  ) {
    return Object.freeze({
      phase: 'loading',
      identity: requestedIdentity,
      data: null,
      mutationEnabled: false,
      reason: SAFE_REASON.checking,
      refetch: current.refetch,
      reconcile: current.reconcile,
    });
  }
  return current;
}
