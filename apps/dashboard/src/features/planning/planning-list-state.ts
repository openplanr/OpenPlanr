import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { DataTableSort } from '../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { takeListStatus } from './planning-list-filter.js';

type ListViewState = Readonly<{
  query: string;
  type: string;
  status: string;
  compact: boolean;
  sort: DataTableSort;
  page: number;
}>;

const DEFAULT_VIEW: ListViewState = Object.freeze({
  query: '',
  type: 'all',
  status: 'all',
  compact: false,
  sort: Object.freeze({ key: 'updated', dir: 'desc' }),
  page: 0,
});
const views = new Map<string, ListViewState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Session view state follows route custody independently of live cursor progress. */
export function usePlanningListState(binding: DashboardQueryIdentity) {
  const key = JSON.stringify([
    binding.productArea,
    binding.route,
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.cycleId,
    binding.subjectId,
    binding.generation,
  ]);
  const initializedKey = useRef<string | null>(null);
  if (initializedKey.current !== key) {
    const status = takeListStatus();
    if (status !== null) {
      views.set(key, Object.freeze({ ...(views.get(key) ?? DEFAULT_VIEW), status, page: 0 }));
    }
    initializedKey.current = key;
  }
  const getSnapshot = useCallback(() => views.get(key) ?? DEFAULT_VIEW, [key]);
  const update = useCallback(
    (changes: Partial<ListViewState>) => {
      views.set(key, Object.freeze({ ...(views.get(key) ?? DEFAULT_VIEW), ...changes }));
      for (const listener of listeners) listener();
    },
    [key],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [state, update] as const;
}
