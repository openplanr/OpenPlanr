import { useCallback, useRef, useState } from 'react';
import { StatePanel } from '../../design-system/components/index.js';
import {
  type DashboardProductState,
  type DashboardProductStateKind,
  type DashboardQueryIdentity,
  operateLiveCapabilities,
} from './live/index.js';

const OPERATE_PRESENTATIONS = new Set<DashboardProductStateKind>([
  'ready',
  'read-only',
  'stale',
  'partial',
  'blocked',
  'offline',
]);

function verifiedProductState<T>(
  binding: DashboardQueryIdentity,
  kind: DashboardProductStateKind,
  data: T,
  validate: (value: unknown) => value is T,
  mutationEnabled: boolean,
): DashboardProductState<T> {
  return operateLiveCapabilities.projection.parseState<T>(
    {
      kind,
      binding,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: kind === 'ready' ? [] : [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled,
      policy: operateLiveCapabilities.projection.statePolicy(kind),
    },
    { currentBinding: binding, validateData: validate },
  );
}

function projectionPanel(
  routeKind: string,
  eyebrow: string,
  title: string,
  description: string,
  state: 'booting' | 'unavailable' | 'offline' = 'unavailable',
) {
  return (
    <div className="op-workspace pc-operate" data-route-kind={routeKind}>
      <StatePanel state={state} eyebrow={eyebrow} title={title} description={description} />
    </div>
  );
}

function useVerifiedProjection<T>(options: {
  binding: DashboardQueryIdentity;
  sourceKey: string;
  read: (context: { identity: DashboardQueryIdentity; signal?: AbortSignal }) => Promise<unknown>;
  validate: (value: unknown) => value is T;
  presentationOf: (value: T) => DashboardProductStateKind | null;
  mutationEnabledOf: (value: T) => boolean;
}): Readonly<{
  state: DashboardProductState<T> | null | undefined;
  refetch: () => void;
  reconcile: () => Promise<DashboardProductState<T>>;
}> {
  const liveEnabled = operateLiveCapabilities.projection.readsEnabled();
  const [retainDuringReconciliation, setRetainDuringReconciliation] = useState(false);
  const reconciliationRef = useRef<Promise<DashboardProductState<T>> | null>(null);
  const projection =
    operateLiveCapabilities.projection.useBoundProjection<DashboardProductState<T> | null>({
      identity: options.binding,
      sourceKey: liveEnabled ? options.sourceKey : `${options.sourceKey}-offline`,
      read: async (context) => {
        if (!liveEnabled) return null;
        return options.read(context);
      },
      validate: (value) => {
        if (value === null) return null;
        const frozen = operateLiveCapabilities.projection.freezeWire(value) as T;
        const kind = options.presentationOf(frozen);
        if (kind === null || !options.validate(frozen)) {
          throw new Error('Operate display did not verify.');
        }
        return verifiedProductState(
          options.binding,
          kind,
          frozen,
          options.validate,
          options.mutationEnabledOf(frozen),
        );
      },
    });
  const reconcile = useCallback((): Promise<DashboardProductState<T>> => {
    if (reconciliationRef.current !== null) return reconciliationRef.current;
    setRetainDuringReconciliation(true);
    const pending = projection
      .reconcile()
      .then((snapshot) => {
        if (snapshot.phase !== 'ready' || snapshot.data === null) {
          throw new Error('The exact projection did not reconcile.');
        }
        setRetainDuringReconciliation(false);
        return snapshot.data;
      })
      .finally(() => {
        if (reconciliationRef.current === pending) reconciliationRef.current = null;
      });
    reconciliationRef.current = pending;
    return pending;
  }, [projection]);
  if (!liveEnabled) {
    return Object.freeze({ state: null, refetch: projection.refetch, reconcile });
  }
  if (projection.phase === 'loading' || projection.phase === 'refreshing') {
    return Object.freeze({
      state: retainDuringReconciliation && projection.data !== null ? projection.data : undefined,
      refetch: projection.refetch,
      reconcile,
    });
  }
  if (projection.phase !== 'ready') {
    return Object.freeze({
      state: retainDuringReconciliation && projection.data !== null ? projection.data : null,
      refetch: projection.refetch,
      reconcile,
    });
  }
  return Object.freeze({ state: projection.data, refetch: projection.refetch, reconcile });
}

export type OperateBoundRouteProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
}>;

export function ActionsListRoute({ currentBinding }: OperateBoundRouteProps) {
  const { state } = useVerifiedProjection({
    binding: currentBinding,
    sourceKey: 'actions-list',
    read: ({ identity, signal }) =>
      operateLiveCapabilities.actions.fetchList({
        origin: operateLiveCapabilities.projection.origin(),
        identity,
        signal,
      }),
    validate: operateLiveCapabilities.actions.createListValidator(currentBinding),
    presentationOf: (display) =>
      OPERATE_PRESENTATIONS.has(display.payload.status as DashboardProductStateKind)
        ? (display.payload.status as DashboardProductStateKind)
        : null,
    mutationEnabledOf: (display) => display.payload.mutationEnabled,
  });
  if (state === undefined) {
    return projectionPanel(
      'operate.actions',
      'Action projection',
      'Loading Actions',
      'Waiting for the owner-issued Actions display for this Cycle.',
      'booting',
    );
  }
  if (state === null) {
    return projectionPanel(
      'operate.actions',
      'Action projection',
      'Actions cannot be trusted',
      'The owner-issued Actions display did not pass exact binding and integrity verification.',
    );
  }
  return (
    <operateLiveCapabilities.actions.ListPage currentBinding={currentBinding} current={state} />
  );
}

export function ActionDetailRoute({ currentBinding }: OperateBoundRouteProps) {
  const { state, reconcile } = useVerifiedProjection({
    binding: currentBinding,
    sourceKey: 'action-detail',
    read: ({ identity, signal }) =>
      operateLiveCapabilities.actions.fetchDetail({
        origin: operateLiveCapabilities.projection.origin(),
        identity,
        signal,
      }),
    validate: operateLiveCapabilities.actions.createDetailValidator(currentBinding),
    presentationOf: (display) =>
      OPERATE_PRESENTATIONS.has(display.payload.status as DashboardProductStateKind)
        ? (display.payload.status as DashboardProductStateKind)
        : null,
    mutationEnabledOf: (display) => display.payload.mutationEnabled,
  });
  if (state === undefined) {
    return projectionPanel(
      'operate.action',
      'Action projection',
      'Loading Action',
      'Waiting for the owner-issued Action workspace for this subject.',
      'booting',
    );
  }
  if (state === null) {
    return projectionPanel(
      'operate.action',
      'Action projection',
      'Action cannot be trusted',
      'The owner-issued Action workspace did not pass exact binding and integrity verification.',
    );
  }
  return (
    <operateLiveCapabilities.actions.DetailPage
      currentBinding={currentBinding}
      current={state}
      onRefetch={reconcile}
    />
  );
}

export function PlanningHandoffRoute({ currentBinding }: OperateBoundRouteProps) {
  const { state, reconcile } = useVerifiedProjection({
    binding: currentBinding,
    sourceKey: 'planning-handoff',
    read: ({ identity, signal }) =>
      operateLiveCapabilities.actions.fetchDetail({
        origin: operateLiveCapabilities.projection.origin(),
        identity,
        signal,
      }),
    validate: operateLiveCapabilities.actions.createDetailValidator(currentBinding),
    presentationOf: (display) =>
      OPERATE_PRESENTATIONS.has(display.payload.status as DashboardProductStateKind)
        ? (display.payload.status as DashboardProductStateKind)
        : null,
    mutationEnabledOf: (display) => display.payload.mutationEnabled,
  });
  if (state === undefined) {
    return projectionPanel(
      'operate.action-planning',
      'Planning handoff',
      'Loading Planning handoff',
      'Waiting for the owner-issued Action workspace before Planning handoff.',
      'booting',
    );
  }
  if (state === null) {
    return projectionPanel(
      'operate.action-planning',
      'Planning handoff',
      'Planning handoff cannot be trusted',
      'The owner-issued Action workspace did not pass exact binding and integrity verification.',
    );
  }
  return (
    <operateLiveCapabilities.actions.PlanningHandoffPage
      currentBinding={currentBinding}
      current={state}
      onRefetch={reconcile}
    />
  );
}

export function InboxRoute({ currentBinding }: OperateBoundRouteProps) {
  const { state, reconcile } = useVerifiedProjection({
    binding: currentBinding,
    sourceKey: 'inbox',
    read: ({ identity, signal }) =>
      operateLiveCapabilities.inboxRecovery.fetchInbox({
        origin: operateLiveCapabilities.projection.origin(),
        identity,
        signal,
      }),
    validate: operateLiveCapabilities.inboxRecovery.createInboxValidator(currentBinding),
    presentationOf: (display) =>
      OPERATE_PRESENTATIONS.has(display.payload.status as DashboardProductStateKind)
        ? (display.payload.status as DashboardProductStateKind)
        : null,
    mutationEnabledOf: (display) => display.payload.mutationEnabled,
  });
  if (state === undefined) {
    return projectionPanel(
      'operate.inbox',
      'Inbox projection',
      'Loading Inbox',
      'Waiting for the owner-issued Inbox display for this scope.',
      'booting',
    );
  }
  if (state === null) {
    return projectionPanel(
      'operate.inbox',
      'Inbox projection',
      'Inbox cannot be trusted',
      'The owner-issued Inbox display did not pass exact binding and integrity verification.',
    );
  }
  return (
    <operateLiveCapabilities.inboxRecovery.InboxPage
      currentBinding={currentBinding}
      current={state}
      onRefetch={reconcile}
    />
  );
}

export function RecoveryRoute({ currentBinding }: OperateBoundRouteProps) {
  const { state } = useVerifiedProjection({
    binding: currentBinding,
    sourceKey: 'recovery',
    read: ({ identity, signal }) =>
      operateLiveCapabilities.inboxRecovery.fetchRecovery({
        origin: operateLiveCapabilities.projection.origin(),
        identity,
        signal,
      }),
    validate: operateLiveCapabilities.inboxRecovery.createRecoveryValidator(currentBinding),
    presentationOf: (display) =>
      OPERATE_PRESENTATIONS.has(display.payload.status as DashboardProductStateKind)
        ? (display.payload.status as DashboardProductStateKind)
        : null,
    mutationEnabledOf: () => false,
  });
  if (state === undefined) {
    return projectionPanel(
      'operate.recovery',
      'Recovery projection',
      'Loading Recovery',
      'Waiting for the owner-issued recovery display for this scope.',
      'booting',
    );
  }
  if (state === null) {
    return projectionPanel(
      'operate.recovery',
      'Recovery projection',
      'Recovery cannot be trusted',
      'The owner-issued recovery display did not pass exact binding and integrity verification.',
    );
  }
  return (
    <operateLiveCapabilities.inboxRecovery.RecoveryPage
      currentBinding={currentBinding}
      current={state}
    />
  );
}
