import { QueryClient } from '@tanstack/react-query';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
  dashboardQueryKey,
  isCurrentDashboardQuery,
} from '../binding/query-identity.js';

export class DashboardStaleResponseError extends Error {
  readonly code = 'DASHBOARD_STALE_RESPONSE';

  constructor() {
    super('The dashboard read was superseded by a newer route or binding generation.');
    this.name = 'DashboardStaleResponseError';
  }
}

export class DashboardReadError extends Error {
  readonly code = 'DASHBOARD_READ_FAILED';

  constructor() {
    super('The dashboard read failed safely.');
    this.name = 'DashboardReadError';
  }
}

export type DashboardReadContext = Readonly<{
  identity: DashboardQueryIdentity;
  signal: AbortSignal;
}>;

const COMPATIBLE_FIELDS = [
  'productArea',
  'route',
  'actorId',
  'projectId',
  'scopeId',
  'domainId',
  'domainVersion',
  'cycleId',
  'subjectId',
  'generation',
] as const;

function compatibleBinding(a: DashboardQueryIdentity, b: DashboardQueryIdentity): boolean {
  return COMPATIBLE_FIELDS.every((field) => a[field] === b[field]);
}

function pendingKey(identity: DashboardQueryIdentity): string {
  return JSON.stringify(dashboardQueryKey(identity));
}

/** Owns dashboard reads so superseded responses can never populate a current cache. */
export function createDashboardQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false, staleTime: 0 },
    },
  });
  const controllers = new Map<string, AbortController>();
  const pending = new Map<string, Promise<unknown>>();
  let current: DashboardQueryIdentity | null = null;
  let disposed = false;

  const abortReads = () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    pending.clear();
    void queryClient.cancelQueries();
  };

  const activate = (value: unknown): DashboardQueryIdentity => {
    if (disposed) throw new Error('Dashboard query client is disposed.');
    const identity = createDashboardQueryIdentity(value);
    if (current && isCurrentDashboardQuery(current, identity)) return current;
    const previous = current;
    current = identity;
    abortReads();
    for (const query of queryClient.getQueryCache().findAll()) {
      const candidate =
        Array.isArray(query.queryKey) && query.queryKey[0] === 'dashboard-projection'
          ? query.queryKey[1]
          : null;
      if (!candidate) continue;
      try {
        const cachedIdentity = createDashboardQueryIdentity(candidate);
        if (!compatibleBinding(cachedIdentity, identity)) {
          queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
        }
      } catch {
        queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
    if (previous && compatibleBinding(previous, identity)) {
      queryClient.invalidateQueries({ queryKey: ['dashboard-projection'], refetchType: 'none' });
    }
    return identity;
  };

  const read = <T>(
    value: unknown,
    reader: (context: DashboardReadContext) => Promise<unknown>,
    validate: (value: unknown) => T,
  ): Promise<T> => {
    const identity = activate(value);
    const key = pendingKey(identity);
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const controller = new AbortController();
    controllers.set(key, controller);
    const promise = Promise.resolve()
      .then(() => reader({ identity, signal: controller.signal }))
      .then((response) => {
        const validated = validate(response);
        if (controller.signal.aborted || !current || !isCurrentDashboardQuery(identity, current)) {
          throw new DashboardStaleResponseError();
        }
        queryClient.setQueryData(dashboardQueryKey(identity), validated);
        return validated;
      })
      .catch((error: unknown) => {
        if (error instanceof DashboardStaleResponseError) throw error;
        if (controller.signal.aborted || !current || !isCurrentDashboardQuery(identity, current)) {
          throw new DashboardStaleResponseError();
        }
        throw new DashboardReadError();
      })
      .finally(() => {
        if (controllers.get(key) === controller) controllers.delete(key);
        if (pending.get(key) === promise) pending.delete(key);
      });
    pending.set(key, promise);
    return promise;
  };

  return Object.freeze({
    queryClient,
    activate,
    read,
    getCurrentIdentity: () => current,
    getData: <T>(identity: DashboardQueryIdentity) =>
      queryClient.getQueryData<T>(dashboardQueryKey(identity)),
    inFlightCount: () => pending.size,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abortReads();
      current = null;
      queryClient.clear();
    },
  });
}
