import { useEffect, useState } from 'react';
import { type RecentItemsPreference, rememberRecentItem } from '../../app/browser-preferences.js';
import { Kbd } from '../../design-system/components/index.js';
import type { DashboardSearchHit } from './search-index.js';

export type { RecentItemsPreference };

const NO_RECENT: readonly string[] = Object.freeze([]);

/** Recent item IDs for the bound project; unreadable or refused storage leaves Go to only. */
export function useRecentItems(
  open: boolean,
  store: RecentItemsPreference | undefined,
  projectId: string | null,
) {
  const [ids, setIds] = useState<readonly string[]>(NO_RECENT);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!open || !store || !projectId) {
      setIds(NO_RECENT);
      return;
    }
    try {
      setIds(store.load(projectId));
      setAvailable(true);
    } catch {
      // Unreadable storage leaves the opening state to Go to only.
      setIds(NO_RECENT);
      setAvailable(false);
    }
  }, [open, store, projectId]);
  const remember = (id: string) => {
    if (!store || !projectId || !available) return;
    const next = rememberRecentItem(ids, id);
    try {
      store.save(projectId, next);
      setIds(next);
    } catch {
      // A browser that refuses writes keeps the palette usable without Recent.
      setAvailable(false);
    }
  };
  return { ids: available ? ids : NO_RECENT, remember };
}

export type PaletteScope = 'all' | DashboardSearchHit['source'];

/** The scope to show: an empty scope falls back to All, except Operate while its read loads. */
export function shownScope(
  scope: PaletteScope,
  hits: readonly DashboardSearchHit[],
  operateLoading: boolean,
): PaletteScope {
  if (scope === 'all' || (scope === 'operate' && operateLoading)) return scope;
  return hits.some((hit) => hit.source === scope) ? scope : 'all';
}

const SCOPE_LABEL = Object.freeze({
  all: 'All',
  planning: 'Items',
  route: 'Views',
  command: 'Commands',
  operate: 'Operate',
} satisfies Record<PaletteScope, string>);

export function PaletteScopes({
  hits,
  scope,
  operate,
  operateLoading,
  onChange,
}: Readonly<{
  hits: readonly DashboardSearchHit[];
  scope: PaletteScope;
  operate: boolean;
  operateLoading: boolean;
  onChange: (scope: PaletteScope) => void;
}>) {
  const keys: readonly PaletteScope[] = operate
    ? ['all', 'planning', 'route', 'command', 'operate']
    : ['all', 'planning', 'route', 'command'];
  return (
    <fieldset className="pc-palette__scope-set" aria-label="Result scope">
      {keys.map((key) => {
        const count = key === 'all' ? hits.length : hits.filter((hit) => hit.source === key).length;
        return (
          <button
            key={key}
            type="button"
            className="pc-palette__scope"
            aria-pressed={key === scope}
            disabled={key !== 'all' && count === 0 && !(key === 'operate' && operateLoading)}
            onClick={() => onChange(key)}
          >
            {SCOPE_LABEL[key]}
            <span className="pc-palette__scope-count">{count}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

export type PaletteCopyFeedback = Readonly<{
  command: string;
  kind: 'command' | 'id';
  state: 'pending' | 'copied' | 'blocked';
}>;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);

function FooterKeys() {
  return (
    <>
      <span className="pc-palette__key">
        <Kbd size="sm">↑</Kbd>
        <Kbd size="sm">↓</Kbd> Move
      </span>
      <span className="pc-palette__key">
        <Kbd size="sm">↵</Kbd> Open
      </span>
      <span className="pc-palette__key">
        <Kbd size="sm">{IS_MAC ? '⌘C' : 'Ctrl C'}</Kbd> Copy command
      </span>
    </>
  );
}

function FooterFeedback({ feedback }: Readonly<{ feedback: PaletteCopyFeedback }>) {
  const label = feedback.kind === 'command' ? 'command' : 'ID';
  return (
    <div
      className="pc-palette__copy"
      role="status"
      aria-live="polite"
      aria-busy={feedback.state === 'pending' || undefined}
      data-state={feedback.state}
    >
      {feedback.state === 'blocked' ? (
        <>
          <span>Copy blocked. Select the {label} and copy it manually.</span>
          <input
            aria-label={
              feedback.kind === 'command'
                ? 'Command to copy manually'
                : 'Canonical ID to copy manually'
            }
            value={feedback.command}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      ) : (
        <>
          <span>{feedback.state === 'pending' ? `Copying ${label}…` : '✓ Copied'}</span>
          <code>{feedback.command}</code>
        </>
      )}
    </div>
  );
}

/** Key hints, replaced by the copy result or a hint while one is showing. */
export function PaletteFooter({
  count,
  feedback,
  hint,
}: Readonly<{ count: number; feedback: PaletteCopyFeedback | null; hint: string | null }>) {
  return (
    <div className="pc-palette__foot">
      {hint ? (
        <p className="pc-palette__copy" role="status">
          {hint}
        </p>
      ) : feedback ? (
        <FooterFeedback feedback={feedback} />
      ) : (
        <FooterKeys />
      )}
      <span className="pc-palette__count">
        {count} {count === 1 ? 'result' : 'results'}
      </span>
    </div>
  );
}

export function PaletteNothingMatches({ query }: Readonly<{ query: string }>) {
  return (
    <div className="pc-palette__empty" role="status">
      <p className="pc-palette__empty-title">Nothing matches “{query.trim()}”</p>
      <p>Try an item ID, a view like Board, or a word from a title.</p>
    </div>
  );
}
