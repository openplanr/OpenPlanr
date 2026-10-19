import type { KeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input, Kbd, PcIcon, SectionHeader, Select } from '../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { inspectPlanningNode } from '../planning/planning-inspector.js';
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

const EMPTY_SOURCES: DashboardSearchSources = Object.freeze({});
const EMPTY_OPERATE_BINDINGS = Object.freeze([]) as readonly DashboardQueryIdentity[];
const PLACEHOLDER = 'Jump to a view or an artifact…';

function humanLabel(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

export type CommandPaletteProps = Readonly<{
  open: boolean;
  onClose: () => void;
  onNavigate?: (href: string) => void;
  onCopy?: (text: string) => Promise<void>;
  singleLetters?: boolean;
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

type CopyFeedback = Readonly<{
  command: string;
  kind: 'command' | 'id';
  state: 'pending' | 'copied' | 'blocked';
}>;

function useCommandCopy(onCopy: CommandPaletteProps['onCopy']) {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const copy = async (command: string, kind: CopyFeedback['kind'] = 'command') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFeedback({ command, kind, state: 'pending' });
    try {
      if (!onCopy) throw new Error('Clipboard unavailable');
      await onCopy(command);
      if (mounted.current) setFeedback({ command, kind, state: 'copied' });
    } catch {
      if (mounted.current) setFeedback({ command, kind, state: 'blocked' });
    } finally {
      inFlight.current = false;
    }
  };
  return { copy, feedback };
}

function CommandCopyFeedback({ feedback }: Readonly<{ feedback: CopyFeedback | null }>) {
  if (!feedback) return null;
  const label = feedback.kind === 'command' ? 'command' : 'ID';
  return (
    <div
      className="pc-palette__command"
      role="status"
      aria-live="polite"
      aria-busy={feedback.state === 'pending' || undefined}
    >
      <p>
        {feedback.state === 'pending'
          ? `Copying ${label}…`
          : feedback.state === 'copied'
            ? `${feedback.kind === 'command' ? 'Command' : 'ID'} copied.`
            : `Copy blocked. Select the ${label} and copy it manually.`}
      </p>
      <input
        aria-label={
          feedback.kind === 'command' ? 'Command to copy manually' : 'Canonical ID to copy manually'
        }
        value={feedback.command}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  );
}

function ignoresQueryShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.shiftKey ||
    ((event.metaKey || event.ctrlKey) && event.key !== 'Enter')
  );
}

function resultKeyTarget(event: KeyboardEvent<HTMLDialogElement>): HTMLButtonElement | null {
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
    )
  )
    return null;
  const button = target?.closest<HTMLButtonElement>('[data-search-result]');
  return button && !button.disabled ? button : null;
}

function resultDirection(key: string, singleLetters: boolean): number {
  if (key === 'ArrowDown') return 1;
  if (key === 'ArrowUp') return -1;
  if (!singleLetters) return 0;
  if (key.toLowerCase() === 'j') return 1;
  return key.toLowerCase() === 'k' ? -1 : 0;
}

function moveResultFocus(
  dialog: HTMLDialogElement,
  result: HTMLButtonElement,
  direction: number,
): void {
  const results = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-search-result]'),
  ).filter((button) => !button.disabled);
  const index = results.indexOf(result);
  results[Math.max(0, Math.min(results.length - 1, index + direction))]?.focus();
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
    onEnter: (hit: DashboardSearchHit, fullPage: boolean) => void,
  ) => {
    if (ignoresQueryShortcut(event)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setNav((current) => current.moveDown());
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setNav((current) => current.moveUp());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = nav.getActive() ?? hits[0] ?? null;
      if (selected) onEnter(selected, event.metaKey || event.ctrlKey);
    }
  };

  const activateHit = (hit: DashboardSearchHit) => {
    const index = hits.findIndex((candidate) => candidate.id === hit.id);
    let next = createSearchKeyNav(hits);
    for (let position = 0; position <= index; position += 1) next = next.moveDown();
    setNav(next);
  };

  return {
    query,
    setQuery,
    activateHit,
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
  onNavigate = navigateTo,
  onCopy,
  singleLetters = true,
  sources = EMPTY_SOURCES,
  initialQuery = '',
  operateBindings = EMPTY_OPERATE_BINDINGS,
  preferredOperateCycleId = null,
  connectionState = 'disconnected',
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLElement | null>(null);
  const composingRef = useRef(false);
  const listId = useId();
  const search = useSearchState(
    sources,
    initialQuery,
    operateBindings,
    preferredOperateCycleId,
    connectionState,
  );
  const { setQuery } = search;
  const commandCopy = useCommandCopy(onCopy);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const selectedCommand = search.active ?? search.hits[0];

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
  }, [open, initialQuery, setQuery]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      launcherRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    launcherRef.current?.focus({ preventScroll: true });
    launcherRef.current = null;
    composingRef.current = false;
  }, [open]);

  useEffect(() => () => launcherRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  function isTopmost(): boolean {
    const dialogs = Array.from(
      document.querySelectorAll(
        'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]',
      ),
    ).filter((dialog) => !dialog.closest('[hidden], [inert], [aria-hidden="true"]'));
    return dialogs[dialogs.length - 1] === dialogRef.current;
  }

  function selectHit(hit: DashboardSearchHit, fullPage = false): void {
    setCopyHint(null);
    if (hit.source === 'command') {
      if (!fullPage) void commandCopy.copy(hit.command);
      return;
    }
    const node =
      hit.source === 'planning'
        ? sources.planningNodes?.find((candidate) => `planning:${candidate.id}` === hit.id)
        : null;
    if (node && !fullPage) inspectPlanningNode(node);
    else onNavigate(hit.href);
    onClose();
  }

  function copyResult(hit: DashboardSearchHit): void {
    setCopyHint(null);
    if (hit.source === 'command') {
      void commandCopy.copy(hit.command);
      return;
    }
    const node =
      hit.source === 'planning'
        ? sources.planningNodes?.find((candidate) => `planning:${candidate.id}` === hit.id)
        : null;
    if (node) void commandCopy.copy(node.id, 'id');
    else
      setCopyHint(
        'This result has no canonical artifact ID to copy. Select a Planning item or a command.',
      );
  }

  function onResultKeyDown(event: KeyboardEvent<HTMLDialogElement>): void {
    if (composingRef.current || !isTopmost() || ignoresQueryShortcut(event)) return;
    const result = resultKeyTarget(event);
    if (!result) return;
    const hit = search.hits.find((candidate) => candidate.id === result.dataset.searchResult);
    if (!hit) return;
    if (singleLetters && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyResult(hit);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectHit(hit, event.metaKey || event.ctrlKey);
      return;
    }
    const direction = resultDirection(event.key, singleLetters);
    if (!direction) return;
    event.preventDefault();
    moveResultFocus(event.currentTarget, result, direction);
  }

  return (
    <dialog
      ref={dialogRef}
      className="pc-palette"
      aria-labelledby={`${listId}-label`}
      onKeyDown={onResultKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (!composingRef.current && isTopmost()) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current && isTopmost()) onClose();
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
            aria-describedby={
              selectedCommand?.source === 'command' ? `${listId}-command-reason` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                composingRef.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229 ||
                !isTopmost()
              )
                return;
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
          activeId={search.active?.id ?? null}
          commandBusy={commandCopy.feedback?.state === 'pending'}
          listId={listId}
          onSelect={selectHit}
          onFocus={search.activateHit}
        />
        {selectedCommand?.source === 'command' ? (
          <div className="pc-palette__command">
            <p id={`${listId}-command-reason`}>
              Enter copies this command. Commands cannot open a full page with Cmd/Ctrl-Enter.
            </p>
            <code>{selectedCommand.command}</code>
          </div>
        ) : null}
        {copyHint ? (
          <p className="pc-palette__command" role="status">
            {copyHint}
          </p>
        ) : (
          <CommandCopyFeedback feedback={commandCopy.feedback} />
        )}
        <div className="pc-palette__foot" aria-hidden="true">
          <span className="pc-palette__key">
            <Kbd size="sm">↑</Kbd>
            <Kbd size="sm">↓</Kbd> move
          </span>
          <span className="pc-palette__key">
            <Kbd size="sm">⏎</Kbd> inspect
          </span>
          <span className="pc-palette__key">
            <Kbd size="sm">⌘/Ctrl ⏎</Kbd> full page
          </span>
          <span className="pc-palette__count">{search.hits.length} results</span>
        </div>
      </div>
    </dialog>
  );
}

/** Embedded search surface for the `#/search` route without modal chrome. */
export type SearchWorkspaceProps = Readonly<{
  onCopy?: (text: string) => Promise<void>;
  sources?: DashboardSearchSources;
  initialQuery?: string;
  operateBindings?: readonly DashboardQueryIdentity[];
  preferredOperateCycleId?: string | null;
  connectionState?: string;
}>;

export function SearchWorkspace({
  onCopy,
  sources = EMPTY_SOURCES,
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

  const commandCopy = useCommandCopy(onCopy);

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
        activeId={search.active?.id ?? null}
        commandBusy={commandCopy.feedback?.state === 'pending'}
        onSelect={(hit) => {
          if (hit.source === 'command') void commandCopy.copy(hit.command);
          else navigateTo(hit.href);
        }}
      />
      <CommandCopyFeedback feedback={commandCopy.feedback} />
    </section>
  );
}
