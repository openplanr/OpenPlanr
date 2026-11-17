import { type ChromeShortcut, formatShortcut, useChrome } from '@openplanr/canvas/react';
import { Fragment, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HELP_SHORTCUT, PALETTE_SHORTCUT } from './keyboard-coordinator.js';

export const NAVIGATION_PANEL = 'navigation';
export const SIDEBAR_PANEL = 'sidebar';

/** The palette chord as typed on this platform: Command on Apple devices, Control elsewhere. */
export function paletteShortcut(platform?: string): ChromeShortcut {
  const name = platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform);
  return /mac|iphone|ipad/i.test(name)
    ? PALETTE_SHORTCUT
    : { ...PALETTE_SHORTCUT, metaKey: false, ctrlKey: true };
}

function closeUnpinned(chrome: ReturnType<typeof useChrome>): boolean {
  let closed = false;
  for (const [id, panel] of Object.entries(chrome.panels)) {
    if (!panel.open || panel.pinned) continue;
    chrome.setPanelOpen(id, false);
    closed = true;
  }
  return closed;
}

/** Closes open, unpinned panels; true when one closed. */
export function useCloseUnpinnedPanels(): () => boolean {
  const chrome = useChrome();
  const latest = useRef(chrome);
  latest.current = chrome;
  return () => closeUnpinned(latest.current);
}

// Shared single-line ellipsis rule; reused so the help card adds no stylesheet bytes.
const FACT = 'pc-palette__row-title';

const OUTSIDE_IGNORED = [
  '.canvas-chrome-root',
  '[data-keyboard-item]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
].join(', ');
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]:not([tabindex="-1"])';

/** Registers the skip link and main content as focus-cycle regions once both are mounted. */
export function useChromeRegions(
  enabled: boolean,
  main: RefObject<HTMLElement | null>,
  skipLink: RefObject<HTMLAnchorElement | null>,
): void {
  const { registerRegion } = useChrome();
  useLayoutEffect(() => {
    const content = main.current;
    const skip = skipLink.current;
    if (!enabled || !content || !skip) return;
    const contentOff = registerRegion('canvas', content);
    const skipOff = registerRegion('skip-link', skip);
    return () => {
      skipOff();
      contentOff();
    };
  }, [enabled, main, skipLink, registerRegion]);
}

/**
 * Page routes have no canvas stage, so the kit's empty-stage dismissal never fires there.
 * A press outside the chrome closes unpinned panels; rows reopen the sidebar themselves.
 */
export function usePageChromeBehavior({
  routeKey,
  main,
}: Readonly<{
  routeKey: string;
  main: RefObject<HTMLElement | null>;
}>): void {
  const chrome = useChrome();
  const latest = useRef(chrome);
  latest.current = chrome;
  const { chromeHidden } = chrome;
  // biome-ignore lint/correctness/useExhaustiveDependencies: every route change closes unpinned panels.
  useEffect(() => {
    closeUnpinned(latest.current);
  }, [routeKey]);
  useEffect(() => {
    let closedByPress = false;
    const pointerdown = (event: PointerEvent) => {
      closedByPress =
        event.target instanceof Element &&
        !event.target.closest(OUTSIDE_IGNORED) &&
        closeUnpinned(latest.current);
    };
    // A press on blank page space keeps focus on the panel's origin instead of the page.
    const mousedown = (event: MouseEvent) => {
      if (closedByPress && !(event.target instanceof Element && event.target.closest(FOCUSABLE)))
        event.preventDefault();
      closedByPress = false;
    };
    // Focus never stays hidden under an unpinned panel; reaching covered content closes it.
    const focusin = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target === main.current ||
        target.closest(OUTSIDE_IGNORED)
      )
        return;
      const box = target.getBoundingClientRect();
      for (const [id, panel] of Object.entries(latest.current.panels)) {
        if (!panel.open || panel.pinned) continue;
        const slot = document.querySelector(`[data-chrome-slot="${id}"]`)?.getBoundingClientRect();
        if (
          slot &&
          box.left < slot.right &&
          box.right > slot.left &&
          box.top < slot.bottom &&
          box.bottom > slot.top
        )
          latest.current.setPanelOpen(id, false);
      }
    };
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('mousedown', mousedown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('mousedown', mousedown, true);
      document.removeEventListener('focusin', focusin);
    };
  }, [main]);
  useEffect(() => {
    if (chromeHidden && document.activeElement?.closest('.canvas-chrome-root'))
      main.current?.focus({ preventScroll: true });
  }, [chromeHidden, main]);
}

type HelpStatus = Readonly<{
  project: string;
  buildId: string;
  branch: string | null;
  access: string;
  totals: string | null;
  storageNotice: string | null;
}>;

/** The round help button's card: build, branch, access, totals and the chrome shortcuts. */
export function HelpCard({
  status,
  onClose,
  onAllShortcuts,
}: Readonly<{ status: HelpStatus; onClose: () => void; onAllShortcuts: () => void }>) {
  const { keymap } = useChrome();
  const card = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    const pointerdown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.pc-help-card, [data-chrome-slot="help"]')
      )
        latestClose.current();
    };
    document.addEventListener('pointerdown', pointerdown, true);
    return () => document.removeEventListener('pointerdown', pointerdown, true);
  }, []);
  const facts = [
    ['Project', status.project],
    ['Branch', status.branch ?? 'Unavailable'],
    ['Access', status.access],
    ['Totals', status.totals ?? 'Unavailable'],
  ] as const;
  const rows = [
    ['Next region', formatShortcut(keymap.nextRegion)],
    ['Menu and navigation', formatShortcut(keymap.menu)],
    ['Sidebar', formatShortcut(keymap.sidebar)],
    ['Focus mode', formatShortcut(keymap.hideChrome)],
  ] as const;
  return (
    <div
      ref={card}
      className="canvas-chrome-menu-card pc-help-card"
      role="dialog"
      aria-label="Help and status"
      data-state="open"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
        document.querySelector<HTMLElement>('[data-chrome-slot="help"] button')?.focus();
      }}
    >
      <header>
        <strong>OpenPlanr</strong>
        {/* One-line ellipsis keeps the card's geometry fixed whatever the values; titles hold the full text. */}
        <span className={FACT} title={status.buildId}>
          {status.buildId}
        </span>
      </header>
      <dl>
        {facts.map(([term, value]) => (
          <Fragment key={term}>
            <dt>{term}</dt>
            <dd className={FACT} title={value}>
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
      <ul className="pc-chrome-list" aria-label="Chrome shortcuts">
        {rows.map(([label, keys]) => (
          <li key={label}>
            <span>{label}</span>
            <kbd>{keys}</kbd>
          </li>
        ))}
      </ul>
      <button type="button" className="canvas-chrome-menu-item" onClick={onAllShortcuts}>
        <span>All shortcuts</span>
        <kbd>{HELP_SHORTCUT.key}</kbd>
      </button>
      {status.storageNotice ? <p role="status">{status.storageNotice}</p> : null}
    </div>
  );
}

const WELCOME_LABELS = [
  ['menu', 'Every view, the palette and preferences live behind the menu'],
  ['toolbar', 'Search everything or run a command'],
  ['action', 'Read-only, and Live while the files change'],
] as const;

/** Anchored labels for an empty project, measured from the rendered menu, tool and action pills. */
export function WelcomeLabels() {
  const [anchors, setAnchors] = useState<ReadonlyMap<string, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const slots = WELCOME_LABELS.map(([slot]) =>
      document.querySelector<HTMLElement>(`.canvas-chrome-root [data-chrome-slot="${slot}"]`),
    );
    const update = () =>
      setAnchors(
        new Map(
          WELCOME_LABELS.flatMap(([slot], index) => {
            const element = slots[index];
            return element ? [[slot, element.getBoundingClientRect()] as const] : [];
          }),
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    for (const slot of slots) if (slot) observer.observe(slot);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <div>
      {WELCOME_LABELS.map(([slot, text]) => {
        const rect = anchors.get(slot);
        if (!rect) return null;
        const style =
          slot === 'action'
            ? { top: rect.bottom + 8, right: window.innerWidth - rect.right, transform: 'none' }
            : slot === 'menu'
              ? { top: rect.bottom + 8, left: rect.left, transform: 'none' }
              : { top: rect.bottom + 8, left: rect.left + rect.width / 2 };
        return (
          <p
            key={slot}
            className="canvas-chrome-welcome-label"
            data-welcome-anchor={slot}
            style={style}
          >
            {text}
          </p>
        );
      })}
    </div>
  );
}

type OutlineEntry = Readonly<{ id: string; text: string; element: HTMLElement }>;

/** Page headings in reading order, so the sidebar's Outline tab can jump between sections. */
export function PageOutline({
  main,
  refreshKey,
}: Readonly<{ main: RefObject<HTMLElement | null>; refreshKey: string }>) {
  const [entries, setEntries] = useState<readonly OutlineEntry[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: headings are re-read when the route or panel state changes.
  useEffect(() => {
    const root = main.current;
    if (!root) return;
    const frame = requestAnimationFrame(() =>
      setEntries(
        Array.from(root.querySelectorAll<HTMLElement>('h1, h2'))
          .filter((heading) => !heading.closest('[hidden], [inert]') && heading.textContent?.trim())
          .map((heading, index) => ({
            id: `${index}:${heading.textContent}`,
            text: heading.textContent?.trim() ?? '',
            element: heading,
          })),
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [main, refreshKey]);
  if (entries.length === 0) return <p>No sections on this page.</p>;
  return (
    <ul className="pc-chrome-list" aria-label="Page sections">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            className="canvas-chrome-menu-item"
            onClick={() => {
              if (!entry.element.hasAttribute('tabindex'))
                entry.element.setAttribute('tabindex', '-1');
              entry.element.scrollIntoView({ block: 'start' });
              entry.element.focus({ preventScroll: true });
            }}
          >
            {entry.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
