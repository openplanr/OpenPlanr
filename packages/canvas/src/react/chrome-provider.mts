import type { ReactNode } from 'react';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CanvasController, ChromeSurface, Rect } from '../index.mjs';
import { CHROME_TRANSITION_MS, computeSafeArea } from '../safe-area.mjs';

export type ChromeStorage = Readonly<{
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}>;
export type ChromeShortcut = Readonly<{
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}>;
export type ChromeAction = 'menu' | 'sidebar' | 'hideChrome' | 'nextRegion' | 'previousRegion';
export type ChromeKeymap = Readonly<Record<ChromeAction, ChromeShortcut>>;
export type ChromePanelState = Readonly<{ open: boolean; pinned: boolean }>;
export type ChromePanelOptions = Readonly<{
  side: 'left' | 'right';
  role?: 'navigation' | 'sidebar';
}>;
export type ChromeRegion =
  | 'skip-link'
  | 'menu'
  | 'toolbar'
  | 'action'
  | 'canvas'
  | 'sidebar'
  | 'zoom'
  | 'history'
  | 'help';
export type ChromeRegionOptions = Readonly<{ panelId?: string }>;
export type ChromeSurfaceOptions = Readonly<{
  persistent: boolean;
  panelId?: string;
  zoom?: boolean;
}>;
export type ChromeStorageErrorContext = Readonly<{ key: string; operation: 'get' | 'set' }>;
export type ChromeProviderProps = Readonly<{
  storage?: ChromeStorage;
  onStorageError?: (error: unknown, context: ChromeStorageErrorContext) => void;
  keymap?: ChromeKeymap;
  mobileBreakpoint?: number;
  onePanelBreakpoint?: number;
  children?: ReactNode;
}>;
export type ChromeState = Readonly<{
  panels: Readonly<Record<string, ChromePanelState>>;
  layout: 'desktop' | 'one-panel' | 'mobile';
  chromeHidden: boolean;
  inspectorPending: boolean;
  safeArea: Rect;
  dismissedHints: readonly string[];
  keymap: ChromeKeymap;
  transitionMs: number;
  registerPanel(id: string, options: ChromePanelOptions): () => void;
  registerMenu(open: () => void): () => void;
  setPanelOpen(id: string, open: boolean): void;
  togglePanel(id: string): void;
  setPanelPinned(id: string, pinned: boolean): void;
  setChromeHidden(hidden: boolean): void;
  dismissHint(id: string): void;
  registerSurface(
    id: string,
    edge: ChromeSurface['edge'],
    element: HTMLElement,
    options: ChromeSurfaceOptions,
  ): () => void;
  registerRegion(
    region: ChromeRegion,
    element: HTMLElement,
    options?: ChromeRegionOptions,
  ): () => void;
}>;

type ChromeNodeStore = {
  subscribe(notify: () => void): () => void;
  snapshot(): number;
};
type Bridge = Pick<ChromeState, 'registerRegion'> & {
  registerCanvas(controller: CanvasController, nodes?: ChromeNodeStore): () => void;
  returnFocus(opener: HTMLElement | null): void;
};
type SurfaceRegistration = {
  edge: ChromeSurface['edge'];
  element: HTMLElement;
  options: ChromeSurfaceOptions;
  visibility: string;
  inert: boolean;
};
type RegionRegistration = { element: HTMLElement; options: ChromeRegionOptions };

export const defaultChromeKeymap: ChromeKeymap = {
  menu: { code: 'BracketLeft', altKey: true },
  sidebar: { code: 'BracketRight', altKey: true },
  hideChrome: { code: 'KeyZ', altKey: true },
  nextRegion: { code: 'F6' },
  previousRegion: { code: 'F6', shiftKey: true },
};
const regionOrder: readonly ChromeRegion[] = [
  'skip-link',
  'menu',
  'toolbar',
  'action',
  'canvas',
  'sidebar',
  'zoom',
  'history',
  'help',
];
const closedPanel: ChromePanelState = { open: false, pinned: false };
const emptyArea: Rect = { x: 0, y: 0, width: 0, height: 0 };
const hintsKey = 'canvas.chrome.dismissedHints';
const ChromeContext = createContext<ChromeState | null>(null);
const BridgeContext = createContext<Bridge | null>(null);
const ChromeCanvasContext = createContext<CanvasController | null>(null);
const ChromeNodeStoreContext = createContext<ChromeNodeStore | null>(null);

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function matches(event: KeyboardEvent, binding: ChromeShortcut): boolean {
  return (
    event.code === binding.code &&
    event.altKey === Boolean(binding.altKey) &&
    event.ctrlKey === Boolean(binding.ctrlKey) &&
    event.metaKey === Boolean(binding.metaKey) &&
    event.shiftKey === Boolean(binding.shiftKey)
  );
}

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
    )
  );
}

function updateSurfaceVisibility(
  registration: SurfaceRegistration,
  panels: Readonly<Record<string, ChromePanelState>>,
  chromeHidden: boolean,
): void {
  const hidden = chromeHidden && registration.options.zoom !== true;
  registration.element.style.visibility = hidden ? 'hidden' : registration.visibility;
  const panelId = registration.options.panelId;
  const closed = panelId !== undefined && !panels[panelId]?.open;
  registration.element.inert = hidden || closed || registration.inert;
}

function measureSurface(
  id: string,
  registration: SurfaceRegistration,
  panels: Readonly<Record<string, ChromePanelState>>,
  chromeHidden: boolean,
  origin: Readonly<{ x: number; y: number }>,
): ChromeSurface {
  const bounds = registration.element.getBoundingClientRect();
  const panel = registration.options.panelId;
  return {
    id,
    edge: registration.edge,
    open:
      (!panel || Boolean(panels[panel]?.open)) &&
      (!chromeHidden || registration.options.zoom === true),
    rect: {
      x: bounds.x - origin.x,
      y: bounds.y - origin.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

/** Formats the same physical-key binding used by the chrome keyboard listener. */
export function formatShortcut(binding: ChromeShortcut, platform?: string): string {
  const mac = /mac|iphone|ipad/i.test(
    platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform),
  );
  const key = binding.code.startsWith('Key')
    ? binding.code.slice(3)
    : binding.code.startsWith('Digit')
      ? binding.code.slice(5)
      : ({ BracketLeft: '[', BracketRight: ']', Space: 'Space' }[binding.code] ?? binding.code);
  const names = mac
    ? { ctrlKey: '⌃', altKey: '⌥', shiftKey: '⇧', metaKey: '⌘' }
    : { ctrlKey: 'Ctrl', altKey: 'Alt', shiftKey: 'Shift', metaKey: 'Meta' };
  const modifiers = (Object.keys(names) as (keyof typeof names)[])
    .filter((modifier) => binding[modifier])
    .map((modifier) => names[modifier]);
  const parts = [...modifiers, key];
  return parts.join(mac ? '' : '+');
}

/** Owns shell chrome independently of canvas route lifetimes. */
export function ChromeProvider({
  storage,
  onStorageError,
  keymap = defaultChromeKeymap,
  mobileBreakpoint = 720,
  onePanelBreakpoint,
  children,
}: ChromeProviderProps): ReactNode {
  const [panels, setPanels] = useState<Readonly<Record<string, ChromePanelState>>>({});
  const [layout, setLayout] = useState<ChromeState['layout']>('desktop');
  const [chromeHidden, setChromeHidden] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [registeredCanvas, setRegisteredCanvas] = useState<CanvasController | null>(null);
  const [nodeStore, setNodeStore] = useState<ChromeNodeStore | null>(null);
  const [safeArea, setSafeArea] = useState<Rect>(emptyArea);
  const [dismissedHints, setDismissedHints] = useState<readonly string[]>([]);
  const hints = useRef(dismissedHints);
  const latest = useRef({
    storage,
    onStorageError,
    keymap,
    panels,
    layout,
    chromeHidden,
  });
  latest.current = { storage, onStorageError, keymap, panels, layout, chromeHidden };
  const surfaces = useRef(new Map<string, SurfaceRegistration>());
  const panelRegistrations = useRef(new Map<string, ChromePanelOptions>());
  const panelVersions = useRef(new Map<string, number>());
  const regions = useRef(new Map<ChromeRegion, RegionRegistration>());
  const canvas = useRef<CanvasController | null>(null);
  const menu = useRef<(() => void) | null>(null);
  const forwarded = useRef(new Set<string>());
  const panelOpeners = useRef(new Map<string, HTMLElement | null>());
  const returnFocus = useCallback((opener: HTMLElement | null) => {
    let focusable = Boolean(
      opener?.isConnected &&
        opener.matches('button, input, textarea, select, a[href], [tabindex], [contenteditable]') &&
        !opener.matches(':disabled') &&
        !opener.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
    for (let element = opener; element && focusable; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.inert || style.display === 'none' || style.visibility === 'hidden')
        focusable = false;
    }
    if (focusable && opener) {
      opener.focus({ preventScroll: true });
      if (document.activeElement === opener) return;
    }
    regions.current.get('canvas')?.element.focus({ preventScroll: true });
  }, []);

  const reportStorageError = useCallback((error: unknown, context: ChromeStorageErrorContext) => {
    const callback = latest.current.onStorageError;
    if (callback) callback(error, context);
    else throw error;
  }, []);
  const save = useCallback(
    (key: string, value: unknown) => {
      const adapter = latest.current.storage;
      if (!adapter) return;
      let result: void | Promise<void>;
      try {
        result = adapter.set(key, value);
      } catch (error) {
        reportStorageError(error, { key, operation: 'set' });
        return;
      }
      if (result)
        void Promise.resolve(result).catch((error: unknown) =>
          reportStorageError(error, { key, operation: 'set' }),
        );
    },
    [reportStorageError],
  );
  const read = useCallback(
    (key: string, apply: (value: unknown) => void, fallback: () => void) => {
      const adapter = latest.current.storage;
      if (!adapter) return () => {};
      let active = true;
      const failed = (error: unknown) => {
        if (active) fallback();
        reportStorageError(error, { key, operation: 'get' });
      };
      let result: unknown;
      try {
        result = adapter.get(key);
      } catch (error) {
        failed(error);
        return () => {
          active = false;
        };
      }
      if (
        result !== null &&
        typeof result === 'object' &&
        'then' in result &&
        typeof result.then === 'function'
      ) {
        void Promise.resolve(result)
          .then((value) => {
            if (active) apply(value);
          })
          .catch(failed);
      } else {
        try {
          apply(result);
        } catch (error) {
          failed(error);
        }
      }
      return () => {
        active = false;
      };
    },
    [reportStorageError],
  );

  const publishPanels = useCallback((next: Readonly<Record<string, ChromePanelState>>) => {
    latest.current.panels = next;
    setPanels(next);
  }, []);
  const updatePanel = useCallback(
    (id: string, value: ChromePanelState, persist = true) => {
      const current = latest.current;
      const wasOpen = current.panels[id]?.open === true;
      if (value.open && !wasOpen) {
        const active = document.activeElement;
        const host = active?.closest('[data-canvas-menu-host]');
        panelOpeners.current.set(
          id,
          host?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ??
            (active instanceof HTMLElement ? active : null),
        );
      }
      if (persist) panelVersions.current.set(id, (panelVersions.current.get(id) ?? 0) + 1);
      const next = { ...current.panels, [id]: value };
      if (value.open && current.layout !== 'desktop' && panelRegistrations.current.has(id)) {
        for (const other of panelRegistrations.current.keys()) {
          if (other === id || !next[other]?.open) continue;
          next[other] = { ...next[other], open: false };
          if (persist) {
            panelVersions.current.set(other, (panelVersions.current.get(other) ?? 0) + 1);
            save(`canvas.chrome.panel.${other}`, next[other]);
          }
        }
      }
      publishPanels(next);
      if (wasOpen && !value.open && !document.activeElement?.closest('.canvas-stage'))
        returnFocus(panelOpeners.current.get(id) ?? null);
      if (persist) save(`canvas.chrome.panel.${id}`, value);
    },
    [publishPanels, returnFocus, save],
  );
  const setPanelOpen = useCallback(
    (id: string, open: boolean) => {
      updatePanel(id, { ...(latest.current.panels[id] ?? closedPanel), open });
    },
    [updatePanel],
  );
  const togglePanel = useCallback(
    (id: string) => {
      setPanelOpen(id, !latest.current.panels[id]?.open);
    },
    [setPanelOpen],
  );
  const setPanelPinned = useCallback(
    (id: string, pinned: boolean) => {
      updatePanel(id, { ...(latest.current.panels[id] ?? closedPanel), pinned });
    },
    [updatePanel],
  );
  const registerPanel = useCallback(
    (id: string, options: ChromePanelOptions) => {
      if (panelRegistrations.current.has(id))
        throw new Error(`Chrome panel ${id} is already registered`);
      panelRegistrations.current.set(id, options);
      if (!latest.current.panels[id]) updatePanel(id, closedPanel, false);
      const version = panelVersions.current.get(id);
      const cancel = read(
        `canvas.chrome.panel.${id}`,
        (value) => {
          if (version !== panelVersions.current.get(id)) return;
          if (value === undefined || value === null) return;
          if (
            typeof value !== 'object' ||
            !('open' in value) ||
            typeof value.open !== 'boolean' ||
            !('pinned' in value) ||
            typeof value.pinned !== 'boolean'
          ) {
            throw new TypeError(`Invalid chrome panel state for ${id}`);
          }
          updatePanel(id, { open: value.open, pinned: value.pinned }, false);
        },
        () => updatePanel(id, closedPanel, false),
      );
      return () => {
        cancel();
        panelRegistrations.current.delete(id);
      };
    },
    [read, updatePanel],
  );

  const registerMenu = useCallback((open: () => void) => {
    if (menu.current) throw new Error('Chrome menu is already registered');
    menu.current = open;
    return () => {
      menu.current = null;
    };
  }, []);

  const refreshSurfaces = useCallback(() => {
    if (typeof window === 'undefined') return;
    const active: ChromeSurface[] = [];
    const controller = canvas.current;
    const stage = regions.current.get('canvas')?.element.getBoundingClientRect();
    for (const [id, registration] of surfaces.current) {
      updateSurfaceVisibility(registration, latest.current.panels, latest.current.chromeHidden);
      if (!registration.options.persistent) continue;
      const origin = controller && stage ? stage : { x: 0, y: 0 };
      const surface = measureSurface(
        id,
        registration,
        latest.current.panels,
        latest.current.chromeHidden,
        origin,
      );
      active.push(surface);
      if (controller) {
        controller.setChrome(surface);
        forwarded.current.add(id);
      }
    }
    const next = controller
      ? controller.getSafeArea()
      : computeSafeArea({ width: window.innerWidth, height: window.innerHeight }, active);
    setSafeArea((previous) => (sameRect(previous, next) ? previous : next));
  }, []);
  const registerSurface = useCallback(
    (
      id: string,
      edge: ChromeSurface['edge'],
      element: HTMLElement,
      options: ChromeSurfaceOptions,
    ) => {
      if (surfaces.current.has(id)) throw new Error(`Chrome surface ${id} is already registered`);
      const registration = {
        edge,
        element,
        options,
        visibility: element.style.visibility,
        inert: Boolean(element.inert),
      };
      surfaces.current.set(id, registration);
      const observer = new ResizeObserver(refreshSurfaces);
      observer.observe(element);
      refreshSurfaces();
      return () => {
        observer.disconnect();
        surfaces.current.delete(id);
        element.style.visibility = registration.visibility;
        element.inert = registration.inert;
        if (forwarded.current.delete(id)) canvas.current?.removeChrome(id);
        refreshSurfaces();
      };
    },
    [refreshSurfaces],
  );
  const registerRegion = useCallback(
    (region: ChromeRegion, element: HTMLElement, options: ChromeRegionOptions = {}) => {
      if (regions.current.has(region))
        throw new Error(`Chrome region ${region} is already registered`);
      regions.current.set(region, { element, options });
      refreshSurfaces();
      return () => {
        regions.current.delete(region);
        refreshSurfaces();
      };
    },
    [refreshSurfaces],
  );
  const registerCanvas = useCallback(
    (controller: CanvasController, nodes?: ChromeNodeStore) => {
      if (canvas.current) throw new Error('ChromeProvider already has a registered canvas');
      canvas.current = controller;
      setRegisteredCanvas(controller);
      setNodeStore(nodes ?? null);
      setHasSelection(controller.getSelection().length > 0);
      const selectionOff = controller.on('selection', () =>
        setHasSelection(controller.getSelection().length > 0),
      );
      const areaOff = controller.on('safe-area', () => {
        const next = controller.getSafeArea();
        setSafeArea((previous) => (sameRect(previous, next) ? previous : next));
      });
      refreshSurfaces();
      return () => {
        selectionOff();
        areaOff();
        for (const id of forwarded.current) controller.removeChrome(id);
        forwarded.current.clear();
        canvas.current = null;
        setRegisteredCanvas(null);
        setNodeStore(null);
        setHasSelection(false);
        refreshSurfaces();
      };
    },
    [refreshSurfaces],
  );

  useEffect(() => {
    const initialHints = hints.current;
    return read(
      hintsKey,
      (value) => {
        if (value === undefined || value === null) return;
        if (!Array.isArray(value) || !value.every((id): id is string => typeof id === 'string')) {
          throw new TypeError('Invalid dismissed chrome hints');
        }
        const changed = hints.current !== initialHints;
        const next = [...new Set([...value, ...hints.current])];
        hints.current = next;
        setDismissedHints(next);
        if (changed) save(hintsKey, next);
      },
      () => {
        hints.current = [];
        setDismissedHints([]);
      },
    );
  }, [read, save]);
  const dismissHint = useCallback(
    (id: string) => {
      if (hints.current.includes(id)) return;
      const next = [...hints.current, id];
      hints.current = next;
      setDismissedHints(next);
      save(hintsKey, next);
    },
    [save],
  );

  useEffect(() => {
    const mobile = window.matchMedia(`(max-width: ${mobileBreakpoint - 0.01}px)`);
    const onePanel =
      onePanelBreakpoint === undefined
        ? null
        : window.matchMedia(`(max-width: ${onePanelBreakpoint - 0.01}px)`);
    const update = () => {
      const next = mobile.matches ? 'mobile' : onePanel?.matches ? 'one-panel' : 'desktop';
      latest.current.layout = next;
      setLayout(next);
      if (next !== 'desktop') {
        const open = [...panelRegistrations.current.keys()].filter(
          (id) => latest.current.panels[id]?.open,
        );
        for (const id of open.slice(1))
          updatePanel(id, { ...latest.current.panels[id], open: false }, false);
      }
    };
    update();
    mobile.addEventListener('change', update);
    onePanel?.addEventListener('change', update);
    return () => {
      mobile.removeEventListener('change', update);
      onePanel?.removeEventListener('change', update);
    };
  }, [mobileBreakpoint, onePanelBreakpoint, updatePanel]);
  useEffect(() => {
    refreshSurfaces();
    window.addEventListener('resize', refreshSurfaces);
    return () => window.removeEventListener('resize', refreshSurfaces);
  }, [refreshSurfaces]);
  useLayoutEffect(() => {
    latest.current.panels = panels;
    latest.current.chromeHidden = chromeHidden;
    latest.current.layout = layout;
    refreshSurfaces();
  }, [panels, chromeHidden, layout, refreshSurfaces]);

  useEffect(() => {
    let composing = false;
    const compositionStart = () => {
      composing = true;
    };
    const compositionEnd = () => {
      composing = false;
    };
    const cycle = (backward: boolean) => {
      const active = regionOrder.flatMap((name) => {
        const region = regions.current.get(name);
        if (
          !region ||
          region.element.hidden ||
          region.element.closest('[hidden], [inert], [aria-hidden="true"]') ||
          (region.options.panelId && !latest.current.panels[region.options.panelId]?.open) ||
          (latest.current.chromeHidden &&
            name !== 'zoom' &&
            name !== 'canvas' &&
            name !== 'skip-link')
        )
          return [];
        return [region.element];
      });
      if (!active.length) return false;
      const current = active.findIndex(
        (element) => element === document.activeElement || element.contains(document.activeElement),
      );
      const index =
        current < 0 ? (backward ? active.length - 1 : 0) : current + (backward ? -1 : 1);
      if (index < 0 || index >= active.length) return false;
      active[index]?.focus();
      return true;
    };
    const toggleRole = (role: 'navigation' | 'sidebar', side: 'left' | 'right') => {
      const panel = [...panelRegistrations.current].find(
        ([, options]) => options.role === role || (!options.role && options.side === side),
      );
      if (!panel) return false;
      togglePanel(panel[0]);
      return true;
    };
    const actions: Record<ChromeAction, () => boolean> = {
      menu: () => {
        if (!toggleRole('navigation', 'left')) menu.current?.();
        return true;
      },
      sidebar: () => toggleRole('sidebar', 'right'),
      hideChrome: () => {
        setChromeHidden((hidden) => !hidden);
        return true;
      },
      nextRegion: () => cycle(false),
      previousRegion: () => cycle(true),
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || composing || event.isComposing || editable(event.target))
        return;
      const bindings = latest.current.keymap;
      const action = (Object.keys(bindings) as ChromeAction[]).find((name) =>
        matches(event, bindings[name]),
      );
      if (!action) return;
      if (actions[action]() !== false) event.preventDefault();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('compositionstart', compositionStart);
    document.addEventListener('compositionend', compositionEnd);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('compositionstart', compositionStart);
      document.removeEventListener('compositionend', compositionEnd);
    };
  }, [togglePanel]);

  const sidebarOpen = Object.entries(panels).some(
    ([id, panel]) =>
      panel.open &&
      (panelRegistrations.current.get(id)?.role === 'sidebar' ||
        panelRegistrations.current.get(id)?.side === 'right'),
  );
  const bridge = useMemo(
    () => ({ registerCanvas, registerRegion, returnFocus }),
    [registerCanvas, registerRegion, returnFocus],
  );
  const value = useMemo<ChromeState>(
    () => ({
      panels,
      layout,
      chromeHidden,
      inspectorPending: hasSelection && !sidebarOpen,
      safeArea,
      dismissedHints,
      keymap,
      transitionMs: CHROME_TRANSITION_MS,
      registerPanel,
      registerMenu,
      setPanelOpen,
      togglePanel,
      setPanelPinned,
      setChromeHidden,
      dismissHint,
      registerSurface,
      registerRegion,
    }),
    [
      panels,
      layout,
      chromeHidden,
      hasSelection,
      sidebarOpen,
      safeArea,
      dismissedHints,
      keymap,
      registerPanel,
      registerMenu,
      setPanelOpen,
      togglePanel,
      setPanelPinned,
      dismissHint,
      registerSurface,
      registerRegion,
    ],
  );
  return createElement(
    BridgeContext.Provider,
    { value: bridge },
    createElement(
      ChromeCanvasContext.Provider,
      { value: registeredCanvas },
      createElement(
        ChromeNodeStoreContext.Provider,
        { value: nodeStore },
        createElement(ChromeContext.Provider, { value }, children),
      ),
    ),
  );
}

export function useChrome(): ChromeState {
  const context = useContext(ChromeContext);
  if (!context) throw new Error('useChrome requires ChromeProvider');
  return context;
}

export function useChromeBridge(): Bridge | null {
  return useContext(BridgeContext);
}

export function useChromeCanvas(): CanvasController | null {
  return useContext(ChromeCanvasContext);
}

export function useChromeNodeStore(): ChromeNodeStore | null {
  return useContext(ChromeNodeStoreContext);
}

/** Returns the live binding shared by keyboard handling and shortcut hints. */
export function useShortcut(action: ChromeAction): ChromeShortcut {
  return useChrome().keymap[action];
}

const motionQuery = '(prefers-reduced-motion: reduce)';
const serverMotionSnapshot = () => false;
function motionSnapshot(): boolean {
  return window.matchMedia(motionQuery).matches;
}
function subscribeMotion(listener: () => void): () => void {
  const media = window.matchMedia(motionQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
}
