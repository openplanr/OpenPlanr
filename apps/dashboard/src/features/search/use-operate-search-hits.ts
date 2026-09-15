import { useEffect, useState } from 'react';
import type { AccessSafeOperateSearchHitV1 } from '../../contracts/search-hit.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { fetchOperateSearchHits } from './operate-search-api.js';

const DEBOUNCE_MS = 200;

/** Fetch owner-issued Operate search rows for the active query. */
export function useOperateSearchHits(
  options: Readonly<{
    binding: DashboardQueryIdentity | null;
    connectionState: string;
    query: string;
  }>,
): readonly AccessSafeOperateSearchHitV1[] {
  const [hits, setHits] = useState<readonly AccessSafeOperateSearchHitV1[]>([]);
  const { binding, connectionState, query } = options;

  useEffect(() => {
    const needle = query.trim();
    if (
      typeof window === 'undefined' ||
      !binding ||
      binding.productArea !== 'operate' ||
      binding.cycleId === null ||
      connectionState !== 'connected' ||
      needle.length === 0
    ) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchOperateSearchHits({
        origin: window.location.origin,
        identity: binding,
        query: needle,
        signal: controller.signal,
      })
        .then((results) => {
          if (!controller.signal.aborted) setHits(results);
        })
        .catch(() => {
          if (!controller.signal.aborted) setHits([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [binding, connectionState, query]);

  return hits;
}
