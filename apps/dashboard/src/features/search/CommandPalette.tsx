import type { KeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input, Kbd, PcIcon, SectionHeader, Select } from '../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { SearchResults } from './SearchResults.js';
import {
  buildDashboardSearchIndex,
  type DashboardSearchHit,
  type DashboardSearchSources,
  queryDashboardSearchIndex,
  queryUnsupportedPlanningIdentities,
} from './search-index.js';
import { createSearchKeyNav, type SearchKeyNav } from './search-key-nav.js';
import { useOperateSearchHits } from './use-operate-search-hits.js';
import './command-palette.css';

const EMPTY_OPERATE_BINDINGS = Object.freeze([]) as readonly DashboardQueryIdentity[];
const PLACEHOLDER = 'Jump to a view or an artifact…';

function humanLabel(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

export type CommandPaletteProps = Readonly<{
  open: boolean;
  onClose: () => void;
  sources?: DashboardSearchSources;
  initialQuery?: string;
  operateBindings?: readonly DashboardQueryIdentity[];
  preferredOperateCycleId?: string | null;
  connectionState?: string;
}>;

function useSelectedOperateBinding(
  bindings: readonly DashboardQueryIdentity[],
  preferredCycleId: string | null,
) {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(preferredCycleId);
  useEffect(() => {
    if (preferredCycleId && bindings.some((binding) => binding.cycleId === preferredCycleId)) {
      setSelectedCycleId(preferredCycleId);
      return;
    }
    setSelectedCycleId((current) =>
      current && bindings.some((binding) => binding.cycleId === current) ? current : null,
    );
  }, [bindings, preferredCycleId]);
  const binding = useMemo(
    () => bindings.find((candidate) => candidate.cycleId === selectedCycleId) ?? null,
    [bindings, selectedCycleId],
  );
  return Object.freeze({ binding, selectedCycleId, setSelectedCycleId });
}

function OperateCycleSelector({
  bindings,
  selectedCycleId,
  onSelect,
}: Readonly<{
  bindings: readonly DashboardQueryIdentity[];
  selectedCycleId: string | null;
  onSelect: (cycleId: string | null) => void;
}>) {
  if (bindings.length === 0) return null;
  return (
    <div className="pc-palette__cycle">
      <span>operate cycle</span>
      <Select
        size="sm"
        ariaLabel="Operate Cycle for search results"
        value={selectedCycleId ?? ''}
        onChange={(value) => onSelect(value || null)}
        options={[
          { value: '', label: 'Select a cycle' },
          ...bindings.map((binding, index) => ({
            value: binding.cycleId ?? '',
            label: `${humanLabel(binding.domainId)} cycle${bindings.length > 1 ? ` ${index + 1}` : ''}`,
          })),
        ]}
      />
    </div>
  );
}

function navigateTo(href: string): void {
  if (typeof window === 'undefined') return;
  window.location.hash = href;
}

/** Search state shared by the modal palette and the `#/search` route. */
function useSearchState(
  sources: DashboardSearchSources,
  initialQuery: string,
  operateBindings: readonly DashboardQueryIdentity[],
  preferredOperateCycleId: string | null,
  connectionState: string,
) {
  const [query, setQuery] = useState(initialQuery);
  const [nav, setNav] = useState<SearchKeyNav<DashboardSearchHit>>(() =>
    createSearchKeyNav<DashboardSearchHit>([]),
  );
  const selectedOperate = useSelectedOperateBinding(operateBindings, preferredOperateCycleId);
  const operateHits = useOperateSearchHits({
    binding: selectedOperate.binding,
    connectionState,
    query,
  });
  const mergedSources = useMemo(
    () => Object.freeze({ ...sources, operateResults: operateHits }),
    [sources, operateHits],
  );
  const index = useMemo(() => buildDashboardSearchIndex(mergedSources), [mergedSources]);
  const hits = useMemo(() => queryDashboardSearchIndex(index, query), [index, query]);
  const unsupported = useMemo(
    () => queryUnsupportedPlanningIdentities(index, query),
    [index, query],
  );
  useEffect(() => {
    setNav(createSearchKeyNav(hits));
  }, [hits]);

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    onEnter: (hit: DashboardSearchHit) => void,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setNav((current) => current.moveDown());
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setNav((current) => current.moveUp());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = nav.getActive() ?? hits[0] ?? null;
      if (selected) onEnter(selected);
    }
  };

  return {
    query,
    setQuery,
    hits,
    unsupported,
    active: nav.getActive(),
    selectedOperate,
    onKeyDown,
  };
}

export function CommandPalette({
  open,
  onClose,
  sources = Object.freeze({}),
  initialQuery = '',
  operateBindings = EMPTY_OPERATE_BINDINGS,
  preferredOperateCycleId = null,
  connectionState = 'disconnected',
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const search = useSearchState(
    sources,
    initialQuery,
    operateBindings,
    preferredOperateCycleId,
    connectionState,
  );
  const { setQuery } = search;

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
  }, [open, initialQuery, setQuery]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  function selectHit(hit: DashboardSearchHit): void {
    navigateTo(hit.href);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="pc-palette"
      aria-labelledby={`${listId}-label`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="pc-palette__panel" role="document">
        <div className="pc-palette__input-row">
          <PcIcon name="search" size={15} color="var(--pc-text-tertiary)" />
          <span id={`${listId}-label`} className="pc-visually-hidden">
            Command palette
          </span>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            className="pc-palette__input"
            type="search"
            value={search.query}
            placeholder={PLACEHOLDER}
            aria-label="Search views and artifacts"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              search.onKeyDown(event, selectHit);
            }}
          />
          <Kbd size="sm">esc</Kbd>
        </div>
        <OperateCycleSelector
          bindings={operateBindings}
          selectedCycleId={search.selectedOperate.selectedCycleId}
          onSelect={search.selectedOperate.setSelectedCycleId}
        />
        <SearchResults
          hits={search.hits}
          unsupported={search.unsupported}
          activeHref={search.active?.href ?? null}
          listId={listId}
          onSelect={selectHit}
        />
        <div className="pc-palette__foot" aria-hidden="true">
          <span className="pc-palette__key">
            <Kbd size="sm">↑</Kbd>
            <Kbd size="sm">↓</Kbd> move
          </span>
          <span className="pc-palette__key">
            <Kbd size="sm">⏎</Kbd> open
          </span>
          <span className="pc-palette__count">{search.hits.length} results</span>
        </div>
      </div>
    </dialog>
  );
}

/** Embedded search surface for the `#/search` route without modal chrome. */
export type SearchWorkspaceProps = Readonly<{
  sources?: DashboardSearchSources;
  initialQuery?: string;
  operateBindings?: readonly DashboardQueryIdentity[];
  preferredOperateCycleId?: string | null;
  connectionState?: string;
}>;

export function SearchWorkspace({
  sources = Object.freeze({}),
  initialQuery = '',
  operateBindings = EMPTY_OPERATE_BINDINGS,
  preferredOperateCycleId = null,
  connectionState = 'disconnected',
}: SearchWorkspaceProps) {
  const listId = useId();
  const search = useSearchState(
    sources,
    initialQuery,
    operateBindings,
    preferredOperateCycleId,
    connectionState,
  );

  return (
    <section className="op-workspace pc-search-page" data-route-kind="planning.search">
      <SectionHeader
        eyebrow="planr-status · search"
        title="Search"
        count={`${search.hits.length} ${search.hits.length === 1 ? 'result' : 'results'}`}
        description="Planning work and Operate items, from access-safe projections."
      />
      <div className="pc-search-page__query">
        <Input
          value={search.query}
          onChange={search.setQuery}
          ariaLabel="Search query"
          placeholder={PLACEHOLDER}
          icon="search"
          size="lg"
          width={560}
        />
      </div>
      <OperateCycleSelector
        bindings={operateBindings}
        selectedCycleId={search.selectedOperate.selectedCycleId}
        onSelect={search.selectedOperate.setSelectedCycleId}
      />
      <SearchResults
        hits={search.hits}
        unsupported={search.unsupported}
        activeHref={search.active?.href ?? null}
        listId={listId}
        onSelect={(hit) => navigateTo(hit.href)}
      />
    </section>
  );
}
