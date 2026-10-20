import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ShellAdapters } from '../../app/browser-preferences.js';
import { IconButton, Inspector, Switch } from '../../design-system/components/index.js';
import {
  installKeyboardCoordinator,
  type KeyboardContext,
  SHORTCUT_MAP,
} from './keyboard-coordinator.js';

export type { ShellAdapters } from '../../app/browser-preferences.js';
export { PlanningPresentationProvider } from '../../lib/routing/planning-presentation.js';
export { PlanningDetailInspector } from '../planning/DetailPage.js';
export { selectPlanningAttention } from '../planning/planning-model.js';
export { CommandPalette } from '../search/CommandPalette.js';
export { useSearchCoordinator } from '../search/search-coordinator.js';

const MEMORY_ADAPTERS: ShellAdapters = {
  loadSingleLetters: () => true,
  saveSingleLetters: () => undefined,
  copy: () => Promise.reject(new Error('Clipboard adapter unavailable')),
};

type ScrollRegion = { key: string; top: number; left: number };
type ReturnContext = {
  top: number;
  left: number;
  focusId: string | null;
  regions: readonly ScrollRegion[];
};

function scrollRegions(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-context]'));
}
function snapshotRegions(root: HTMLElement): readonly ScrollRegion[] {
  return scrollRegions(root).map((region) => ({
    key: region.dataset.scrollContext ?? '',
    top: region.scrollTop,
    left: region.scrollLeft,
  }));
}
type InteractionProps = {
  adapters?: ShellAdapters;
  routeKey: string;
  scope: string;
  selectedId: string | null;
  paletteOpen: boolean;
  togglePalette: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
};

export function useShellInteractions({
  adapters = MEMORY_ADAPTERS,
  routeKey,
  scope,
  selectedId,
  paletteOpen,
  togglePalette,
  inspectorOpen,
  setInspectorOpen,
}: InteractionProps) {
  const [singleLetters, setSingleLetters] = useState(true);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, announce] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLElement | null>(null);
  const originItem = useRef<HTMLElement | null>(null);
  const contexts = useRef(new Map<string, ReturnContext>());
  const captured = useRef<string | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const activeScope = useRef(scope);
  if (activeScope.current !== scope) {
    activeScope.current = scope;
    contexts.current.clear();
  }
  useEffect(() => {
    try {
      setSingleLetters(adapters.loadSingleLetters());
      setPreferenceError(null);
    } catch {
      setPreferenceError('Shortcut preference could not be read in this browser.');
    }
  }, [adapters]);

  const contextKey = `${scope}:${routeKey}`;
  const capture = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const focused = document.activeElement?.closest<HTMLElement>('[data-keyboard-item]');
    captured.current = contextKey;
    contexts.current.set(contextKey, {
      top: scroll.scrollTop,
      left: scroll.scrollLeft,
      focusId: focused?.dataset.keyboardItem ?? selectedId,
      regions: snapshotRegions(scroll),
    });
  };
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    const beforeRouteChange = () => captureRef.current();
    const beforeLink = (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0)
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      if (anchor) captureRef.current();
    };
    window.addEventListener('hashchange', beforeRouteChange, true);
    document.addEventListener('click', beforeLink, true);
    return () => {
      window.removeEventListener('hashchange', beforeRouteChange, true);
      document.removeEventListener('click', beforeLink, true);
    };
  }, []);
  const navigate = (href: string) => {
    capture();
    window.location.hash = href;
  };
  // Selection changes must not reset an in-progress scroll or focus.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    captured.current = null;
    const saved = contexts.current.get(contextKey);
    if (!saved) {
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
    }
    let restoredFocus: HTMLElement | null = null;
    const restore = () => {
      if (!saved) return true;
      if (
        scroll.childElementCount === 0 ||
        scroll.querySelector('[data-route-kind][aria-busy="true"], [data-route-pending]')
      )
        return false;
      scroll.scrollTop = saved.top;
      scroll.scrollLeft = saved.left;
      const item = Array.from(scroll.querySelectorAll<HTMLElement>('[data-keyboard-item]')).find(
        (node) =>
          node.dataset.keyboardItem === saved.focusId || node.dataset.canonicalId === saved.focusId,
      );
      const focusTarget = item?.closest('[hidden]')
        ? item.closest('[data-keyboard-group]')?.querySelector<HTMLElement>('[aria-expanded]')
        : item;
      // The parent live boundary runs after this layout effect and must honor return focus.
      if (focusTarget) {
        restoredFocus?.removeAttribute('data-live-focus-return');
        restoredFocus = focusTarget;
        restoredFocus.setAttribute('data-live-focus-return', '');
      }
      focusTarget?.focus({ preventScroll: true });
      const regions = scrollRegions(scroll);
      for (const savedRegion of saved.regions) {
        const region = regions.find((entry) => entry.dataset.scrollContext === savedRegion.key);
        if (region) {
          region.scrollTop = savedRegion.top;
          region.scrollLeft = savedRegion.left;
        }
      }
      return true;
    };
    const restored = restore();
    const observer = new MutationObserver(() => {
      if (restore()) {
        observer.disconnect();
        window.clearTimeout(timeout);
      }
    });
    const timeout = restored ? undefined : window.setTimeout(() => observer.disconnect(), 500);
    if (!restored)
      observer.observe(scroll, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-busy', 'data-route-pending'],
      });
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      restoredFocus?.removeAttribute('data-live-focus-return');
      if (captured.current === contextKey) return;
      const focused = document.activeElement?.closest<HTMLElement>('[data-keyboard-item]');
      contexts.current.set(contextKey, {
        top: scroll.scrollTop,
        left: scroll.scrollLeft,
        focusId: focused?.dataset.keyboardItem ?? selectedRef.current,
        regions: snapshotRegions(scroll),
      });
    };
  }, [contextKey]);
  const restoreInspectorFocus = () => {
    const item = originItem.current;
    if (item?.isConnected) item.focus({ preventScroll: true });
  };
  const closeInspector = () => {
    if (!inspectorOpen) return false;
    setInspectorOpen(false);
    restoreInspectorFocus();
    return true;
  };
  const latest = useRef<KeyboardContext | null>(null);
  latest.current = {
    root: rootRef.current as HTMLElement,
    selectionScope: contextKey,
    singleLetters,
    paletteOpen,
    togglePalette,
    openHelp: () => {
      launcher.current = document.activeElement as HTMLElement;
      setHelpOpen(true);
    },
    navigate,
    closeInspector,
    selectedId: () => selectedId,
    copy: adapters.copy,
    announce,
  };
  useEffect(
    () =>
      installKeyboardCoordinator(document, () => ({
        ...(latest.current as KeyboardContext),
        root: rootRef.current as HTMLElement,
      })),
    [],
  );
  useEffect(() => {
    const remember = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-keyboard-item]')
          : null;
      if (target) originItem.current = target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  const help = (
    <>
      <IconButton
        icon="info"
        label="Keyboard shortcuts"
        size="sm"
        onClick={() => {
          launcher.current = document.activeElement as HTMLElement;
          setHelpOpen(true);
        }}
      />
      <span className="pc-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      <Inspector
        open={helpOpen}
        onOpenChange={setHelpOpen}
        modal
        title="Keyboard shortcuts"
        description="View shortcuts pause while typing, composing text or using another dialog."
        closeLabel="Close keyboard shortcuts"
        onRestoreFocus={() => launcher.current?.focus()}
      >
        <Switch
          checked={singleLetters}
          onChange={(enabled) => {
            setSingleLetters(enabled);
            try {
              adapters.saveSingleLetters(enabled);
              setPreferenceError(null);
            } catch {
              setPreferenceError(
                'Shortcut preference could not be saved. It applies until this page is closed.',
              );
            }
          }}
          label="Enable single-letter shortcuts"
        />
        {preferenceError ? <p role="status">{preferenceError}</p> : null}
        <dl>
          {SHORTCUT_MAP.map(([keys, behavior]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{behavior}</dd>
            </div>
          ))}
        </dl>
      </Inspector>
    </>
  );
  return {
    help,
    navigate,
    scrollRef,
    rootRef,
    closeInspector,
    restoreInspectorFocus,
    singleLetters,
  };
}
