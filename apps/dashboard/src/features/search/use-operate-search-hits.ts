import { useEffect, useState } from 'react';
import type { AccessSafeOperateSearchHitV1 } from '../../contracts/search-hit.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { fetchOperateSearchHits } from './operate-search-api.js';

const DEBOUNCE_MS = 200;
const EMPTY_HITS: readonly AccessSafeOperateSearchHitV1[] = Object.freeze([]);
type SearchRead = Readonly<{
  hits: readonly AccessSafeOperateSearchHitV1[];
  state: 'idle' | 'loading' | 'ready' | 'error';
}>;

export function useOperateSearchHits(
  options: Readonly<{
    binding: DashboardQueryIdentity | null;
    connectionState: string;
    query: string;
  }>,
): SearchRead {
  const { binding, connectionState, query } = options;
  const needle = query.trim();
  const key =
    binding &&
    binding.productArea === 'operate' &&
    binding.cycleId !== null &&
    connectionState === 'connected' &&
    needle.length > 0
      ? JSON.stringify([binding, needle])
      : null;
  const [read, setRead] = useState<SearchRead & { key: string | null }>({
    key: null,
    hits: EMPTY_HITS,
    state: 'idle',
  });

  useEffect(() => {
    if (typeof window === 'undefined' || key === null || !binding) return;
    const controller = new AbortController();
    setRead({ key, hits: EMPTY_HITS, state: 'loading' });
    const timer = setTimeout(() => {
      void fetchOperateSearchHits({
        origin: window.location.origin,
        identity: binding,
        query: needle,
        signal: controller.signal,
      })
        .then((hits) => {
          if (!controller.signal.aborted) setRead({ key, hits, state: 'ready' });
        })
        .catch(() => {
          if (!controller.signal.aborted) setRead({ key, hits: EMPTY_HITS, state: 'error' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [binding, key, needle]);

  // A changed binding or query must never borrow rows or errors from the previous read.
  if (key === null) return { hits: EMPTY_HITS, state: 'idle' };
  return read.key === key ? read : { hits: EMPTY_HITS, state: 'loading' };
}
