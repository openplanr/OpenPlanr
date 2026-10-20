import type { CSSProperties, ReactNode } from 'react';
import {
  Children,
  createContext,
  createElement,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import type { Camera, ChromeSurface } from '../index.mjs';
import type { ChromeAction, ChromeRegion, ChromeShortcut } from './chrome-provider.mjs';
import {
  formatShortcut,
  useChrome,
  useChromeBridge,
  useChromeCanvas,
  useChromeNodeStore,
  useReducedMotion,
} from './chrome-provider.mjs';
import { useCanvasBinding } from './provider.mjs';

export interface ChromeRootProps {
  children?: ReactNode;
  className?: string;
}
export interface MenuPillProps {
  children?: ReactNode;
  viewPicker?: ReactNode;
}
export interface MenuProps {
  children?: ReactNode;
  label?: string;
}
export interface MenuItemProps {
  children?: ReactNode;
  label?: string;
  icon?: ReactNode;
  shortcut?: ChromeShortcut | ChromeAction;
  onClick?: () => void;
  disabled?: boolean;
}
export interface FloatingToolbarProps {
  children?: ReactNode;
}
export interface ToolbarItemProps {
  label: string;
  icon?: ReactNode;
  shortcut?: ChromeShortcut | ChromeAction;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}
export interface ToolbarMoreProps {
  children?: ReactNode;
}
export interface ActionPillProps {
  children?: ReactNode;
}
export interface PrimaryActionProps {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}
export interface SidebarToggleProps {
  panelId?: string;
}
export interface SidebarProps {
  id?: string;
  inspector?: ReactNode;
  outline?: ReactNode;
  width?: number;
}
export interface NavigationPanelProps {
  id?: string;
  children?: ReactNode;
  width?: number;
}
export interface ZoomPillProps {
  label?: string;
}
export interface HistoryPillProps {
  onUndo: () => void;
  onRedo: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}
export interface HelpButtonProps {
  onClick?: () => void;
}
export interface WelcomeHintsProps {
  actions: readonly {
    label: string;
    onClick: () => void;
    shortcut?: ChromeShortcut | ChromeAction;
  }[];
  menuHint?: string;
  toolbarHint?: string;
}
export interface ToolbarHintProps {
  id: string;
  children?: ReactNode;
}

type KitState = {
  openMenu: string | null;
  setOpenMenu: (id: string | null, restoreFocus?: boolean) => void;
  mobileMenu: HTMLElement | null;
  setMobileMenu: (element: HTMLElement | null) => void;
  anchors: Map<string, HTMLElement>;
};
const KitContext = createContext<KitState | null>(null);
const MenuContext = createContext<{ open: boolean; close: () => void; main: boolean } | null>(null);

function useKit(): KitState {
  const kit = useContext(KitContext);
  if (!kit) throw new Error('Chrome slots require ChromeRoot');
  return kit;
}

function useHint(shortcut?: ChromeShortcut | ChromeAction): string | undefined {
  const { keymap } = useChrome();
  return shortcut === undefined
    ? undefined
    : formatShortcut(typeof shortcut === 'string' ? keymap[shortcut] : shortcut);
}

function useSlot(
  id: string,
  edge: ChromeSurface['edge'],
  region?: ChromeRegion,
  panelId?: string,
  enabled = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  const { registerSurface, registerRegion } = useChrome();
  const { anchors } = useKit();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    anchors.set(id, element);
    const surfaceOff = registerSurface(id, edge, element, {
      persistent: true,
      panelId,
      zoom: id === 'zoom',
    });
    const regionOff = region ? registerRegion(region, element, { panelId }) : undefined;
    return () => {
      regionOff?.();
      surfaceOff();
      anchors.delete(id);
    };
  }, [id, edge, region, panelId, registerSurface, registerRegion, anchors, enabled]);
  return ref;
}

function slotProps(
  slot: string,
  ref: ReturnType<typeof useSlot>,
  extra: Record<string, unknown> = {},
) {
  return {
    ref,
    className: `canvas-chrome-slot canvas-chrome-${slot}`,
    'data-chrome-slot': slot,
    tabIndex: -1,
    ...extra,
  };
}

function button(
  label: string | undefined,
  children: ReactNode,
  onClick?: () => void,
  extra: Record<string, unknown> = {},
) {
  return createElement(
    'button',
    { type: 'button', 'aria-label': label, onClick, ...extra },
    children,
  );
}

function decorativeIcon(icon: ReactNode, className?: string): ReactNode {
  return createElement(
    'span',
    {
      className: ['canvas-chrome-glyph', className].filter(Boolean).join(' '),
      'aria-hidden': true,
      'data-chrome-glyph': typeof icon === 'string' ? icon : undefined,
    },
    typeof icon === 'string' ? undefined : icon,
  );
}

/** Fixed overlay containing the shared chrome slots. */
export function ChromeRoot({ children, className }: ChromeRootProps): ReactNode {
  const chrome = useChrome();
  const controller = useChromeCanvas();
  const reduced = useReducedMotion();
  const [openMenu, updateOpenMenu] = useState<string | null>(null);
  const bridge = useChromeBridge();
  const menuOpener = useRef<HTMLElement | null>(null);
  const setOpenMenu = useCallback(
    (id: string | null, restoreFocus = true) => {
      if (id !== null) {
        menuOpener.current =
          document.getElementById(id)?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
      } else {
        if (restoreFocus && menuOpener.current) bridge?.returnFocus(menuOpener.current);
        menuOpener.current = null;
      }
      updateOpenMenu(id);
    },
    [bridge],
  );
  const [mobileMenu, setMobileMenu] = useState<HTMLElement | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>()).current;
  const press = useRef<{
    stage: Element;
    pointerId: number;
    x: number;
    y: number;
    dragged: boolean;
    released: boolean;
  } | null>(null);
  const kit = useMemo(
    () => ({ openMenu, setOpenMenu, mobileMenu, setMobileMenu, anchors }),
    [openMenu, setOpenMenu, mobileMenu, anchors],
  );
  useEffect(() => {
    if (chrome.chromeHidden) setOpenMenu(null);
  }, [chrome.chromeHidden, setOpenMenu]);
  useEffect(() => {
    const emptyStage = (event: MouseEvent): Element | null => {
      if (!(event.target instanceof Element)) return null;
      const stage = event.target.closest('.canvas-stage');
      if (!stage || event.target.closest('[data-canvas-node-id]')) return null;
      const rect = stage.getBoundingClientRect();
      const point = { x: event.clientX - rect.x, y: event.clientY - rect.y };
      if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) return null;
      return controller?.hitTest(point) ? null : stage;
    };
    const dismissMenus = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canvas-stage') || !target.closest('[data-canvas-menu-host]'))
        setOpenMenu(null, false);
    };
    const pointerdown = (event: PointerEvent) => {
      dismissMenus(event);
      const stage = emptyStage(event);
      press.current =
        stage && event.button === 0 && event.isPrimary !== false
          ? {
              stage,
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              dragged: false,
              released: false,
            }
          : null;
    };
    const pointermove = (event: PointerEvent) => {
      const start = press.current;
      if (
        start &&
        start.pointerId === event.pointerId &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
      )
        start.dragged = true;
    };
    const pointerup = (event: PointerEvent) => {
      const start = press.current;
      if (!start || start.pointerId !== event.pointerId) return;
      pointermove(event);
      if (start.dragged || emptyStage(event) !== start.stage) press.current = null;
      else start.released = true;
    };
    const pointercancel = () => {
      press.current = null;
    };
    const click = (event: MouseEvent) => {
      dismissMenus(event);
      const start = press.current;
      press.current = null;
      if (!start?.released || start.dragged || emptyStage(event) !== start.stage) return;
      for (const [id, panel] of Object.entries(chrome.panels)) {
        if (panel.open && !panel.pinned) chrome.setPanelOpen(id, false);
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (openMenu !== null) {
        setOpenMenu(null);
      } else {
        const panels = Object.entries(chrome.panels).filter(
          ([, panel]) => panel.open && !panel.pinned,
        );
        if (!panels.length) return;
        for (const [id] of panels) chrome.setPanelOpen(id, false);
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const stageKeydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.canvas-stage'))
        dismissEscape(event);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '.canvas-stage, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [aria-modal="true"]',
        )
      )
        return;
      dismissEscape(event);
    };
    document.addEventListener('click', click, true);
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('pointermove', pointermove, true);
    document.addEventListener('pointerup', pointerup, true);
    document.addEventListener('pointercancel', pointercancel, true);
    document.addEventListener('keydown', stageKeydown, true);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('pointermove', pointermove, true);
      document.removeEventListener('pointerup', pointerup, true);
      document.removeEventListener('pointercancel', pointercancel, true);
      document.removeEventListener('keydown', stageKeydown, true);
      document.removeEventListener('keydown', keydown);
    };
  }, [chrome.panels, chrome.setPanelOpen, controller, openMenu, setOpenMenu]);
  return createElement(
    KitContext.Provider,
    { value: kit },
    createElement(
      'div',
      {
        className: ['canvas-chrome-root', className].filter(Boolean).join(' '),
        'data-layout': chrome.layout,
        'data-chrome-hidden': chrome.chromeHidden,
        style: {
          '--canvas-chrome-transition': `${reduced ? 0 : chrome.transitionMs}ms`,
        } as CSSProperties,
      },
      children,
    ),
  );
}

export function MenuPill({ children, viewPicker }: MenuPillProps): ReactNode {
  const ref = useSlot('menu', 'top', 'menu');
  const id = useId();
  const { openMenu, setOpenMenu } = useKit();
  const { registerMenu, layout } = useChrome();
  const hint = useHint('menu');
  const open = openMenu === id;
  const openMain = useCallback(() => setOpenMenu(id), [id, setOpenMenu]);
  useEffect(() => registerMenu(openMain), [registerMenu, openMain]);
  return createElement(
    'div',
    slotProps('menu', ref, { id, 'data-canvas-menu-host': '' }),
    button('Menu', '☰', () => setOpenMenu(open ? null : id), {
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      title: `Menu (${hint})`,
    }),
    viewPicker &&
      createElement(
        'span',
        { className: 'canvas-chrome-view-picker' },
        viewPicker,
        createElement('span', { 'aria-hidden': true }, '⌄'),
      ),
    createElement(
      MenuContext.Provider,
      { value: { open, close: () => setOpenMenu(null), main: true } },
      children ?? createElement(Menu, null),
    ),
    layout === 'mobile' &&
      createElement(
        'span',
        { className: 'canvas-chrome-mobile-menu-label', 'aria-hidden': true },
        'Menu',
      ),
  );
}

export function Menu({ children, label = 'Menu' }: MenuProps): ReactNode {
  const context = useContext(MenuContext);
  const { setMobileMenu } = useKit();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (context?.open) ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [context?.open]);
  if (!context) throw new Error('Menu requires MenuPill or ToolbarMore');
  return createElement(
    'div',
    {
      ref,
      role: 'menu',
      'aria-label': label,
      hidden: !context.open,
      className: 'canvas-chrome-menu-card',
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'),
        ];
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
        event.preventDefault();
      },
    },
    children,
    context.main &&
      createElement('div', { ref: setMobileMenu, className: 'canvas-chrome-menu-overflow' }),
  );
}

export function MenuItem({
  children,
  label,
  icon,
  shortcut,
  onClick,
  disabled,
}: MenuItemProps): ReactNode {
  const hint = useHint(shortcut);
  const context = useContext(MenuContext);
  return button(
    undefined,
    createElement(
      Fragment,
      null,
      decorativeIcon(icon ?? '·', 'canvas-chrome-menu-icon'),
      createElement('span', null, children ?? label),
      hint && createElement('kbd', null, ` ${hint}`),
    ),
    () => {
      onClick?.();
      context?.close();
    },
    {
      role: 'menuitem',
      disabled,
      className: 'canvas-chrome-menu-item',
      title: hint ? `${label ?? children} (${hint})` : undefined,
    },
  );
}

export function FloatingToolbar({ children }: FloatingToolbarProps): ReactNode {
  const { layout } = useChrome();
  const ref = useSlot('toolbar', layout === 'mobile' ? 'bottom' : 'top', 'toolbar');
  return createElement(
    'div',
    slotProps('toolbar', ref, { role: 'toolbar', 'aria-label': 'Canvas tools' }),
    children,
  );
}

export function ToolbarItem({
  label,
  icon,
  shortcut,
  active = false,
  onClick,
  disabled,
}: ToolbarItemProps): ReactNode {
  const hint = useHint(shortcut);
  return button(
    hint ? `${label} ${hint}` : label,
    createElement(
      Fragment,
      null,
      decorativeIcon(icon ?? label),
      hint && createElement('kbd', { className: 'canvas-chrome-tool-shortcut' }, ` ${hint}`),
    ),
    onClick,
    {
      className: 'canvas-chrome-tool',
      'aria-pressed': active,
      disabled,
      title: hint ? `${label} (${hint})` : label,
    },
  );
}

export function ToolbarMore({ children }: ToolbarMoreProps): ReactNode {
  const id = useId();
  const { openMenu, setOpenMenu } = useKit();
  const open = openMenu === id;
  return createElement(
    'div',
    { id, 'data-canvas-menu-host': '', className: 'canvas-chrome-more' },
    button('More tools', '⋮', () => setOpenMenu(open ? null : id), {
      'aria-haspopup': 'menu',
      'aria-expanded': open,
    }),
    createElement(
      MenuContext.Provider,
      { value: { open, close: () => setOpenMenu(null), main: false } },
      createElement(Menu, { label: 'More tools' }, children),
    ),
  );
}

function primaryActions(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === PrimaryAction) return [child];
    return primaryActions(child.props.children);
  });
}

export function ActionPill({ children }: ActionPillProps): ReactNode {
  const ref = useSlot('action', 'top', 'action');
  const actions = primaryActions(children);
  if (actions.length > 1) {
    const second = actions[1];
    const name = isValidElement<{ children?: ReactNode }>(second) ? second.props.children : '';
    throw new TypeError(
      `ActionPill permits one PrimaryAction; second PrimaryAction: ${String(name)}`,
    );
  }
  return createElement('div', slotProps('action', ref), children);
}

function mobileContent(content: ReactNode, mobile: boolean, target: HTMLElement | null): ReactNode {
  return mobile ? (target ? createPortal(content, target) : null) : content;
}

export function PrimaryAction({ children, onClick, disabled }: PrimaryActionProps): ReactNode {
  const { layout } = useChrome();
  const { mobileMenu, setOpenMenu } = useKit();
  const content = button(
    undefined,
    children,
    () => {
      onClick?.();
      if (layout === 'mobile') setOpenMenu(null);
    },
    {
      className: 'canvas-chrome-primary',
      disabled,
      role: layout === 'mobile' ? 'menuitem' : undefined,
    },
  );
  return mobileContent(content, layout === 'mobile', mobileMenu);
}

export function SidebarToggle({ panelId = 'sidebar' }: SidebarToggleProps): ReactNode {
  const { panels, togglePanel, inspectorPending } = useChrome();
  const hint = useHint('sidebar');
  return button(
    'Sidebar',
    createElement(
      Fragment,
      null,
      createElement('span', { 'aria-hidden': true }, '◧'),
      inspectorPending &&
        createElement('span', {
          className: 'canvas-chrome-selection-dot',
          'data-inspector-pending': '',
          'aria-hidden': true,
        }),
    ),
    () => togglePanel(panelId),
    {
      className: 'canvas-chrome-sidebar-toggle',
      'aria-pressed': Boolean(panels[panelId]?.open),
      title: `Sidebar (${hint})`,
    },
  );
}

function usePanel(id: string, side: 'left' | 'right') {
  const { registerPanel, panels, layout } = useChrome();
  useEffect(
    () => registerPanel(id, { side, role: side === 'right' ? 'sidebar' : 'navigation' }),
    [id, side, registerPanel],
  );
  const ref = useSlot(
    side === 'right' ? 'sidebar' : 'navigation',
    layout === 'mobile' ? 'bottom' : side,
    side === 'right' ? 'sidebar' : undefined,
    id,
  );
  return { ref, panel: panels[id] ?? { open: false, pinned: false } };
}

export function Sidebar({
  id = 'sidebar',
  inspector,
  outline,
  width = 312,
}: SidebarProps): ReactNode {
  if (width !== undefined && (!Number.isFinite(width) || width < 280 || width > 400))
    throw new TypeError(`Sidebar width ${width} must be between 280 and 400`);
  const { ref, panel } = usePanel(id, 'right');
  const { setPanelOpen, setPanelPinned } = useChrome();
  const controller = useChromeCanvas();
  const [tab, setTab] = useState<'inspector' | 'outline'>(
    inspector === undefined ? 'outline' : 'inspector',
  );
  const tabId = useId();
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      if (!(event.target instanceof Element) || !event.target.closest('.canvas-stage')) return;
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!controller?.getSelection().length) return;
      const node = event.target.closest<HTMLElement>('[data-canvas-node-id]');
      if (
        node?.dataset.canvasNodeId &&
        !controller.getSelection().includes(node.dataset.canvasNodeId)
      )
        return;
      setTab(inspector === undefined ? 'outline' : 'inspector');
      setPanelOpen(id, true);
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [controller, id, inspector, setPanelOpen]);
  return createElement(
    'div',
    slotProps('sidebar', ref, {
      'data-open': panel.open,
      style:
        width === undefined
          ? undefined
          : ({ '--canvas-chrome-panel-width': `${width}px` } as CSSProperties),
    }),
    createElement(
      'section',
      {
        className: 'canvas-chrome-panel-surface',
        'data-chrome-panel-content': '',
        inert: !panel.open,
        'aria-label': 'Sidebar',
      },
      createElement(
        'header',
        null,
        createElement(
          'div',
          { role: 'tablist', 'aria-label': 'Sidebar tabs' },
          ...(['inspector', 'outline'] as const)
            .filter((name) => name !== 'inspector' || inspector !== undefined)
            .map((name) =>
              button(
                undefined,
                createElement(
                  Fragment,
                  null,
                  decorativeIcon(name === 'inspector' ? 'ⓘ' : '☷'),
                  createElement('span', null, name === 'inspector' ? 'Inspector' : 'Outline'),
                ),
                () => setTab(name),
                {
                  key: name,
                  role: 'tab',
                  id: `${tabId}-${name}`,
                  'aria-controls': `${tabId}-content-${name}`,
                  'aria-selected': tab === name,
                  tabIndex: tab === name ? 0 : -1,
                  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                    const next =
                      name === 'inspector'
                        ? 'outline'
                        : inspector !== undefined
                          ? 'inspector'
                          : 'outline';
                    setTab(next);
                    document.getElementById(`${tabId}-${next}`)?.focus();
                    event.preventDefault();
                  },
                },
              ),
            ),
        ),
        button('Pin sidebar', '♧', () => setPanelPinned(id, !panel.pinned), {
          'aria-pressed': panel.pinned,
        }),
        button('Close sidebar', '×', () => setPanelOpen(id, false)),
      ),
      ...(['inspector', 'outline'] as const)
        .filter((name) => name !== 'inspector' || inspector !== undefined)
        .map((name) =>
          createElement(
            'div',
            {
              key: name,
              role: 'tabpanel',
              id: `${tabId}-content-${name}`,
              'aria-labelledby': `${tabId}-${name}`,
              hidden: tab !== name,
              className: 'canvas-chrome-panel-body',
              tabIndex: 0,
            },
            (name === 'inspector' ? inspector : outline) ??
              createElement(
                'div',
                { className: 'canvas-chrome-empty' },
                'Nothing here yet',
                button(undefined, 'Return to canvas', () => setPanelOpen(id, false)),
              ),
          ),
        ),
    ),
  );
}

export function NavigationPanel({
  id = 'navigation',
  children,
  width,
}: NavigationPanelProps): ReactNode {
  if (width !== undefined && (!Number.isFinite(width) || width < 240 || width > 320))
    throw new TypeError(`NavigationPanel width ${width} must be between 240 and 320`);
  const { ref, panel } = usePanel(id, 'left');
  const { setPanelOpen, setPanelPinned } = useChrome();
  return createElement(
    'div',
    slotProps('navigation', ref, {
      'data-open': panel.open,
      style:
        width === undefined
          ? undefined
          : ({ '--canvas-chrome-panel-width': `${width}px` } as CSSProperties),
    }),
    createElement(
      'nav',
      {
        className: 'canvas-chrome-panel-surface',
        'data-chrome-panel-content': '',
        inert: !panel.open,
        'aria-label': 'Navigation',
      },
      createElement(
        'header',
        null,
        createElement('strong', null, 'Navigation'),
        button('Pin navigation', '♧', () => setPanelPinned(id, !panel.pinned), {
          'aria-pressed': panel.pinned,
        }),
        button('Close navigation', '×', () => setPanelOpen(id, false)),
      ),
      createElement('div', { className: 'canvas-chrome-panel-body' }, children),
    ),
  );
}

export function ZoomPill({ label = 'Zoom' }: ZoomPillProps): ReactNode {
  const controller = useChromeCanvas();
  return controller ? createElement(RegisteredZoom, { label }) : null;
}
function RegisteredZoom({ label }: ZoomPillProps): ReactNode {
  const controller = useChromeCanvas();
  const { layout } = useChrome();
  const ref = useSlot('zoom', layout === 'mobile' ? 'top' : 'bottom', 'zoom');
  const value = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (!controller) return;
    const update = (camera: Camera) => {
      if (value.current) value.current.textContent = `${Math.round(camera.zoom * 100)}%`;
    };
    update(controller.getCamera());
    return controller.on('camera', update);
  }, [controller]);
  const zoom = (factor: number) => {
    if (!controller) return;
    controller.zoomAt(factor);
  };
  return createElement(
    'div',
    slotProps('zoom', ref, { role: 'group', 'aria-label': label }),
    button('Zoom out', '−', () => zoom(1 / 1.25)),
    createElement(
      'output',
      { ref: value, 'aria-label': 'Zoom percentage', 'aria-live': 'off' },
      `${Math.round((controller?.getCamera().zoom ?? 1) * 100)}%`,
    ),
    button('Zoom in', '+', () => zoom(1.25)),
  );
}

export function HistoryPill(props: HistoryPillProps): ReactNode {
  const controller = useChromeCanvas();
  return controller ? createElement(RegisteredHistory, props) : null;
}
function RegisteredHistory({
  onUndo,
  onRedo,
  canUndo = true,
  canRedo = true,
}: HistoryPillProps): ReactNode {
  const { layout } = useChrome();
  const { mobileMenu, setOpenMenu } = useKit();
  const ref = useSlot('history', 'bottom', 'history', undefined, layout !== 'mobile');
  const content = createElement(
    'div',
    { className: 'canvas-chrome-history-actions' },
    button(
      'Undo',
      '↶',
      () => {
        onUndo();
        setOpenMenu(null);
      },
      { disabled: !canUndo, role: layout === 'mobile' ? 'menuitem' : undefined },
    ),
    button(
      'Redo',
      '↷',
      () => {
        onRedo();
        setOpenMenu(null);
      },
      { disabled: !canRedo, role: layout === 'mobile' ? 'menuitem' : undefined },
    ),
  );
  return createElement(
    'div',
    slotProps('history', ref, { hidden: layout === 'mobile' }),
    mobileContent(content, layout === 'mobile', mobileMenu),
  );
}

export function HelpButton({ onClick }: HelpButtonProps): ReactNode {
  const { layout } = useChrome();
  const { mobileMenu, setOpenMenu } = useKit();
  const ref = useSlot('help', 'bottom', 'help', undefined, layout !== 'mobile');
  const content = button(
    layout === 'mobile' ? undefined : 'Help',
    layout === 'mobile' ? 'Help' : '?',
    () => {
      onClick?.();
      setOpenMenu(null);
    },
    { role: layout === 'mobile' ? 'menuitem' : undefined },
  );
  return createElement(
    'div',
    slotProps('help', ref, { hidden: layout === 'mobile' }),
    mobileContent(content, layout === 'mobile', mobileMenu),
  );
}

const emptySubscribe = () => () => {};
export function WelcomeHints({
  actions,
  menuHint = 'Open the menu',
  toolbarHint = 'Choose a tool',
}: WelcomeHintsProps): ReactNode {
  const binding = useCanvasBinding();
  const controller = useChromeCanvas();
  const externalNodes = useChromeNodeStore();
  const hasCanvas = binding !== null || controller !== null;
  const { chromeHidden } = useChrome();
  const { anchors } = useKit();
  const subscribe = useCallback(
    (notify: () => void) => {
      if (binding) return binding.subscribeNodes(notify);
      if (externalNodes) return externalNodes.subscribe(notify);
      if (!controller) return emptySubscribe();
      const geometryOff = controller.on('geometry', notify);
      const mountOff = controller.on('mount', notify);
      return () => {
        geometryOff();
        mountOff();
      };
    },
    [binding, controller, externalNodes],
  );
  const snapshot = useCallback(
    () =>
      binding
        ? binding.renderNodes.size
        : externalNodes
          ? externalNodes.snapshot()
          : (controller?.getOutline().length ?? 0),
    [binding, controller, externalNodes],
  );
  const count = useSyncExternalStore(subscribe, snapshot, () => binding?.renderNodes.size ?? 0);
  const menu = useRef<HTMLSpanElement>(null);
  const toolbar = useRef<HTMLSpanElement>(null);
  const { layout } = useChrome();
  useLayoutEffect(() => {
    if (count > 0 || chromeHidden || !hasCanvas) return;
    const update = () => {
      for (const [id, ref] of [
        ['menu', menu],
        ['toolbar', toolbar],
      ] as const) {
        const bounds = anchors.get(id)?.getBoundingClientRect();
        if (!bounds || !ref.current) continue;
        ref.current.style.left = `${bounds.x + bounds.width / 2}px`;
        ref.current.style.top = `${layout === 'mobile' && id === 'toolbar' ? bounds.y - 28 : bounds.bottom + 4}px`;
      }
    };
    update();
    const observer = new ResizeObserver(update);
    for (const id of ['menu', 'toolbar']) {
      const element = anchors.get(id);
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchors, count, chromeHidden, layout, hasCanvas]);
  if (count > 0 || chromeHidden || !hasCanvas) return null;
  return createElement(
    'div',
    { className: 'canvas-chrome-welcome', 'aria-label': 'Getting started' },
    createElement(
      'div',
      {
        className: 'canvas-chrome-welcome-actions',
        role: 'group',
        'aria-label': 'Getting started actions',
      },
      actions.map((action) => createElement(WelcomeAction, { key: action.label, ...action })),
    ),
    createElement(
      'span',
      { ref: menu, className: 'canvas-chrome-welcome-label', 'data-welcome-anchor': 'menu' },
      menuHint,
    ),
    createElement(
      'span',
      { ref: toolbar, className: 'canvas-chrome-welcome-label', 'data-welcome-anchor': 'toolbar' },
      toolbarHint,
    ),
  );
}

function WelcomeAction({
  label,
  onClick,
  shortcut,
}: WelcomeHintsProps['actions'][number]): ReactNode {
  const hint = useHint(shortcut);
  return button(
    undefined,
    createElement(
      Fragment,
      null,
      createElement('span', null, label),
      hint && createElement('kbd', null, ` ${hint}`),
    ),
    onClick,
    {
      className: 'canvas-chrome-menu-item',
      title: hint ? `${label} (${hint})` : undefined,
    },
  );
}

export function ToolbarHint({ id, children }: ToolbarHintProps): ReactNode {
  const { dismissedHints, dismissHint, layout, chromeHidden } = useChrome();
  const { mobileMenu } = useKit();
  if (dismissedHints.includes(id) || chromeHidden) return null;
  const content = createElement(
    'div',
    { className: 'canvas-chrome-toolbar-hint' },
    children,
    button('Dismiss toolbar hint', '×', () => dismissHint(id), {
      role: layout === 'mobile' ? 'menuitem' : undefined,
    }),
  );
  return mobileContent(content, layout === 'mobile', mobileMenu);
}
