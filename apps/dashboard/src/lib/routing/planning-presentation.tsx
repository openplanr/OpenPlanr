import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type PlanningView, serializePlanningViewHref } from './planning-view-codec.js';

// Presentation survives page promotion without caching a projection or its authority.
const PresentationContext = createContext<Map<string, unknown> | null>(null);
const CopyContext = createContext<((text: string) => Promise<void>) | undefined>(undefined);
const InvalidViewContext = createContext(false);
const ViewContext = createContext<PlanningView | null>(null);
const ShortcutsContext = createContext(true);

type PresentationProps = {
  children: ReactNode;
  scope: string;
  view: PlanningView | null;
  onCopy?: (text: string) => Promise<void>;
  invalidView?: boolean;
  singleLetters?: boolean;
};

export function PlanningPresentationProvider({ scope, ...props }: PresentationProps) {
  return <PresentationScope key={scope} {...props} />;
}

function PresentationScope({
  children,
  view,
  onCopy,
  invalidView = false,
  singleLetters = true,
}: Omit<PresentationProps, 'scope'>) {
  const cache = useRef(new Map<string, unknown>());
  return (
    <PresentationContext.Provider value={cache.current}>
      <ShortcutsContext.Provider value={singleLetters}>
        <ViewContext.Provider value={view}>
          <CopyContext.Provider value={onCopy}>
            <InvalidViewContext.Provider value={invalidView}>
              {children}
            </InvalidViewContext.Provider>
          </CopyContext.Provider>
        </ViewContext.Provider>
      </ShortcutsContext.Provider>
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
  const [sharePending, setSharePending] = useState(false);
  const sharing = useRef(false);
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
    presentation: null as PlanningView | null,
    appliedView: null as string | null,
    selected: [] as string[],
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
        presentation: null,
        appliedView: null,
        selected: [],
      });
      return;
    }
    if (view?.route !== 'list') {
      set((current) =>
        current.appliedView === null ? current : { ...current, appliedView: null },
      );
      return;
    }
    const appliedView = JSON.stringify(view);
    // Returning from Detail must keep edits made after this same URL was first applied.
    set((current) =>
      current.appliedView === appliedView
        ? current
        : {
            ...current,
            appliedView,
            query: view.filters.query,
            type: view.filters.type.length === 1 ? view.filters.type[0] : 'all',
            status: view.filters.status.length === 1 ? view.filters.status[0] : 'all',
            compact: view.density === 'compact',
            sort: { key: view.sort.field, dir: view.sort.direction },
            page: 0,
            ignoreViewFilters: false,
            presentation: view,
          },
    );
  }, [view, invalidView, set]);
  const fields = useMemo(() => {
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
      setQuery: field('query'),
      setType: field('type'),
      setStatus: field('status'),
      setCompact: field('compact'),
      setSort: field('sort'),
      setPage: field('page'),
      setCollapsed: field('collapsed'),
      setCollapsedGroups: field('collapsedGroups'),
      setSelected: field('selected'),
    };
  }, [set]);
  return {
    ...state,
    view: state.ignoreViewFilters ? null : (state.presentation ?? view),
    clearFilters: () =>
      set((current) => ({
        ...current,
        query: '',
        type: 'all',
        status: 'all',
        page: 0,
        ignoreViewFilters: true,
        presentation: null,
      })),
    copyMessage,
    sharePending,
    share: async (presentation: PlanningView) => {
      if (sharing.current) return;
      sharing.current = true;
      setSharePending(true);
      let href = '';
      try {
        const hash = serializePlanningViewHref(presentation);
        href =
          typeof window === 'undefined' ? hash : `${window.location.href.split('#')[0]}${hash}`;
        if (!copy) throw new Error('Clipboard adapter unavailable');
        await copy(href);
        setCopyMessage('Filter link copied.');
      } catch {
        setCopyMessage(
          href
            ? `Copy blocked. Select and copy this filter link manually: ${href}`
            : 'These filters cannot be shared. Shorten the query or labels and try again.',
        );
      } finally {
        sharing.current = false;
        setSharePending(false);
      }
    },
    setPresentation: (presentation: PlanningView) =>
      set((current) => ({
        ...current,
        presentation,
        query: presentation.filters.query,
        type: presentation.filters.type.length === 1 ? presentation.filters.type[0] : 'all',
        status: presentation.filters.status.length === 1 ? presentation.filters.status[0] : 'all',
        sort: { key: presentation.sort.field, dir: presentation.sort.direction },
        page: 0,
        ignoreViewFilters: false,
      })),
    ...fields,
  };
}

export function usePlanningView(): PlanningView | null {
  return useContext(ViewContext);
}

export function usePlanningCopy() {
  return useContext(CopyContext);
}

export type ListPreferenceAdapter = Readonly<{
  load: (key: string) => string | null;
  save: (key: string, value: string) => void;
}>;

export const browserListPreferences: ListPreferenceAdapter = {
  load: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  save: (key, value) => localStorage.setItem(key, value),
};

export function usePlanningShortcuts() {
  return useContext(ShortcutsContext);
}
