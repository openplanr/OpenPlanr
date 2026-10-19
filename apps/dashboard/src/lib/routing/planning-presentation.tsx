import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { type PlanningView, serializePlanningViewHref } from './planning-view-codec.js';

// Presentation survives page promotion without caching a projection or its authority.
const PresentationContext = createContext<Map<string, unknown> | null>(null);
const CopyContext = createContext<((text: string) => Promise<void>) | undefined>(undefined);
const InvalidViewContext = createContext(false);
const ViewContext = createContext<PlanningView | null>(null);

type PresentationProps = {
  children: ReactNode;
  scope: string;
  view: PlanningView | null;
  onCopy?: (text: string) => Promise<void>;
  invalidView?: boolean;
};

export function PlanningPresentationProvider({ scope, ...props }: PresentationProps) {
  return <PresentationScope key={scope} {...props} />;
}

function PresentationScope({
  children,
  view,
  onCopy,
  invalidView = false,
}: Omit<PresentationProps, 'scope'>) {
  const cache = useRef(new Map<string, unknown>());
  return (
    <PresentationContext.Provider value={cache.current}>
      <ViewContext.Provider value={view}>
        <CopyContext.Provider value={onCopy}>
          <InvalidViewContext.Provider value={invalidView}>{children}</InvalidViewContext.Provider>
        </CopyContext.Provider>
      </ViewContext.Provider>
    </PresentationContext.Provider>
  );
}

export function usePlanningPresentation<T>(
  key: string,
  initial: () => T,
): [T, (value: T | ((current: T) => T)) => void] {
  const cache = useContext(PresentationContext);
  const [value, setValue] = useState<T>(() =>
    cache?.has(key) ? (cache.get(key) as T) : initial(),
  );
  const update = useCallback(
    (next: T | ((current: T) => T)) =>
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
        cache?.set(key, resolved);
        return resolved;
      }),
    [cache, key],
  );
  return [value, update];
}

export function useListPresentation(initialStatus: () => string) {
  const view = useContext(ViewContext);
  const copy = useContext(CopyContext);
  const invalidView = useContext(InvalidViewContext);
  const [copyMessage, setCopyMessage] = useState('');
  const initial = () => ({
    query: '',
    type: 'all',
    status: initialStatus(),
    compact: false,
    sort: { key: 'updated', dir: 'desc' as 'asc' | 'desc' },
    page: 0,
    collapsed: false,
    collapsedGroups: [] as string[],
    ignoreViewFilters: false,
  });
  const [state, set] = usePlanningPresentation('list', initial);
  useEffect(() => {
    if (invalidView) {
      set({
        query: '',
        type: 'all',
        status: 'all',
        compact: false,
        sort: { key: 'updated', dir: 'desc' },
        page: 0,
        collapsed: false,
        collapsedGroups: [] as string[],
        ignoreViewFilters: false,
      });
      return;
    }
    if (view?.route !== 'list') return;
    set((current) => ({
      ...current,
      query: view.filters.query,
      type: view.filters.type.length === 1 ? view.filters.type[0] : 'all',
      status: view.filters.status.length === 1 ? view.filters.status[0] : 'all',
      compact: view.density === 'compact',
      sort: { key: view.sort.field, dir: view.sort.direction },
      page: 0,
      ignoreViewFilters: false,
    }));
  }, [view, invalidView, set]);
  const field =
    <K extends keyof typeof state>(key: K) =>
    (value: (typeof state)[K] | ((current: (typeof state)[K]) => (typeof state)[K])) =>
      set((current) => ({
        ...current,
        [key]:
          typeof value === 'function'
            ? (value as (current: (typeof state)[K]) => (typeof state)[K])(current[key])
            : value,
      }));
  return {
    ...state,
    view: state.ignoreViewFilters ? null : view,
    clearFilters: () =>
      set((current) => ({
        ...current,
        query: '',
        type: 'all',
        status: 'all',
        page: 0,
        ignoreViewFilters: true,
      })),
    copyMessage,
    share: async (presentation: PlanningView) => {
      const hash = serializePlanningViewHref(presentation);
      const href =
        typeof window === 'undefined' ? hash : `${window.location.href.split('#')[0]}${hash}`;
      try {
        if (!copy) throw new Error('Clipboard adapter unavailable');
        await copy(href);
        setCopyMessage('Filter link copied.');
      } catch {
        setCopyMessage(`Copy blocked. Select and copy this filter link manually: ${href}`);
      }
    },
    setQuery: field('query'),
    setType: field('type'),
    setStatus: field('status'),
    setCompact: field('compact'),
    setSort: field('sort'),
    setPage: field('page'),
    setCollapsed: field('collapsed'),
    setCollapsedGroups: field('collapsedGroups'),
  };
}

export function usePlanningView(): PlanningView | null {
  return useContext(ViewContext);
}
