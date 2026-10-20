// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasController, CanvasNode } from '../../src/index.mjs';
import * as core from '../../src/index.mjs';
import type { ChromeKeymap, ChromeProviderProps, ChromeState } from '../../src/react/index.mjs';
import {
  ActionPill,
  CanvasProvider,
  CanvasStage,
  ChromeProvider,
  ChromeRoot,
  defaultChromeKeymap,
  FloatingToolbar,
  HelpButton,
  HistoryPill,
  Menu,
  MenuItem,
  MenuPill,
  NavigationPanel,
  PrimaryAction,
  Sidebar,
  SidebarToggle,
  ToolbarHint,
  ToolbarItem,
  ToolbarMore,
  useChrome,
  WelcomeHints,
  WorldNodes,
  ZoomPill,
} from '../../src/react/index.mjs';

let state: ChromeState | undefined;
let controller: CanvasController | undefined;
let width: number;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let media: Map<string, MediaQueryList>;
const nodes: readonly CanvasNode[] = [
  { id: 'card', bounds: { x: 100, y: 100, width: 100, height: 60 } },
];

function current(): ChromeState {
  if (!state) throw new Error('Chrome state probe did not render');
  return state;
}
function canvas(): CanvasController {
  if (!controller) throw new Error('Canvas did not mount');
  return controller;
}
function Probe() {
  state = useChrome();
  return null;
}
function Slots() {
  return (
    <ChromeRoot>
      <MenuPill viewPicker={<span>Board</span>}>
        <Menu>
          <MenuItem shortcut="sidebar">Inspect selection</MenuItem>
          <MenuItem shortcut="hideChrome">Hide chrome</MenuItem>
        </Menu>
      </MenuPill>
      <FloatingToolbar>
        <ToolbarItem label="Select" active shortcut="menu" icon={<span>S</span>} />
        <ToolbarItem label="Hand" shortcut={{ code: 'KeyH' }} icon={<span>H</span>} />
        <ToolbarMore>
          <MenuItem shortcut={{ code: 'KeyR' }}>Rectangle</MenuItem>
        </ToolbarMore>
      </FloatingToolbar>
      <ActionPill>
        <PrimaryAction>Share</PrimaryAction>
        <SidebarToggle />
      </ActionPill>
      <Sidebar inspector={<p>Inspector content</p>} outline={<p>Outline content</p>} />
      <NavigationPanel>
        <p>Navigation content</p>
      </NavigationPanel>
      <ZoomPill />
      <HistoryPill onUndo={() => {}} onRedo={() => {}} canUndo canRedo />
      <HelpButton onClick={() => {}} />
      <WelcomeHints actions={[{ label: 'Create card', onClick: () => {} }]} />
      <ToolbarHint id="tools">Choose a tool</ToolbarHint>
    </ChromeRoot>
  );
}
function Tree({
  nodeList = nodes,
  ...props
}: ChromeProviderProps & { nodeList?: readonly CanvasNode[] }) {
  return (
    <ChromeProvider {...props}>
      <Probe />
      <CanvasProvider label="Chrome canvas" nodes={nodeList} options={{ motion: 'none' }}>
        <CanvasStage>
          <WorldNodes data={new Map()} renderNode={(id) => id} />
        </CanvasStage>
        <Slots />
      </CanvasProvider>
    </ChromeProvider>
  );
}
async function frame() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(performance.now());
  });
}
function pointerEvent(target: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}
function canvasClick(target: HTMLElement, x = 10, y = 10) {
  pointerEvent(target, 'pointerdown', x, y);
  pointerEvent(target, 'pointerup', x, y);
  fireEvent.click(target, { clientX: x, clientY: y });
}
function changeWidth(next: number) {
  act(() => {
    width = next;
    for (const query of media.values()) query.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('resize'));
  });
}
function sidebar(): HTMLElement {
  const element = document.querySelector('[data-chrome-slot="sidebar"]');
  if (!(element instanceof HTMLElement)) throw new Error('Sidebar slot did not render');
  return element;
}

beforeEach(() => {
  state = undefined;
  controller = undefined;
  width = 1200;
  sequence = 0;
  frames = new Map();
  media = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const existing = media.get(query);
    if (existing) return existing;
    const events = new EventTarget();
    const result: MediaQueryList = {
      get matches() {
        return !query.includes('reduced-motion') && width < Number(query.match(/[\d.]+/)?.[0]);
      },
      media: query,
      onchange: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      addListener: () => {},
      removeListener: () => {},
    };
    media.set(query, result);
    return result;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1200, 900),
  );
  const create = core.createCanvas;
  vi.spyOn(core, 'createCanvas').mockImplementation((options) => {
    const live = create(options);
    controller = live;
    vi.spyOn(live, 'setChrome');
    return live;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('floating chrome slots', () => {
  it('renders every fixed slot, registers persistent surfaces, and keeps menus transient', async () => {
    render(<Tree />);
    await frame();
    expect(screen.getByRole('toolbar')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Share' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Help' })).toBeDefined();
    const surfaces = vi.mocked(canvas().setChrome).mock.calls.map(([surface]) => surface.id);
    expect(new Set(surfaces).size).toBeGreaterThanOrEqual(8);
    const before = [...new Set(surfaces)];
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menuitem', { name: /Inspect selection/u })).toBeDefined();
    expect([
      ...new Set(vi.mocked(canvas().setChrome).mock.calls.map(([surface]) => surface.id)),
    ]).toEqual(before);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    expect(screen.queryByRole('menuitem', { name: /Inspect selection/u })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Rectangle/u })).toBeDefined();
    canvasClick(document.querySelector('.canvas-stage') as HTMLElement);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('rejects a second primary action with a named TypeError', () => {
    expect(() =>
      render(
        <ChromeProvider>
          <ChromeRoot>
            <ActionPill>
              <PrimaryAction>Save</PrimaryAction>
              <PrimaryAction>Publish</PrimaryAction>
            </ActionPill>
          </ChromeRoot>
        </ChromeProvider>,
      ),
    ).toThrow(TypeError);
    expect(() =>
      render(
        <ChromeProvider>
          <ChromeRoot>
            <ActionPill>
              <PrimaryAction>Save</PrimaryAction>
              <PrimaryAction>Publish</PrimaryAction>
            </ActionPill>
          </ChromeRoot>
        </ChromeProvider>,
      ),
    ).toThrow(/second PrimaryAction: Publish/u);
  });

  it('limits camera controls to canvas routes and zooms around the safe-area centre', async () => {
    const page = render(
      <ChromeProvider>
        <Slots />
      </ChromeProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Create card' })).toBeNull();
    page.unmount();
    render(<Tree />);
    await frame();
    const zoom = vi.spyOn(canvas(), 'zoomAt');
    const area = canvas().getSafeArea();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom).toHaveBeenCalledWith(1.25, {
      x: area.x + area.width / 2,
      y: area.y + area.height / 2,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom).toHaveBeenLastCalledWith(1 / 1.25, {
      x: area.x + area.width / 2,
      y: area.y + area.height / 2,
    });
  });

  it('connects sibling chrome slots to the registered canvas outside CanvasProvider', async () => {
    render(
      <ChromeProvider>
        <Probe />
        <CanvasProvider label="Sibling canvas" nodes={nodes} options={{ motion: 'none' }}>
          <CanvasStage>
            <WorldNodes data={new Map()} renderNode={(id) => id} />
          </CanvasStage>
        </CanvasProvider>
        <Slots />
      </ChromeProvider>,
    );
    await frame();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Create card' })).toBeNull();
    act(() => canvas().setSelection(['card']));
    await frame();
    expect(current().inspectorPending).toBe(true);
    fireEvent.keyDown(document.querySelector('.canvas-stage') as HTMLElement, {
      code: 'Enter',
      key: 'Enter',
    });
    expect(current().panels.sidebar?.open).toBe(true);
    const zoom = vi.spyOn(canvas(), 'zoomAt');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom).toHaveBeenCalledTimes(1);
  });

  it('updates sibling welcome hints for offscreen nodes and removes them on page routes', async () => {
    const shell = (nodeList: readonly CanvasNode[], mounted = true) => (
      <ChromeProvider>
        {mounted && (
          <CanvasProvider label="Routed canvas" nodes={nodeList} options={{ motion: 'none' }}>
            <CanvasStage />
          </CanvasProvider>
        )}
        <Slots />
      </ChromeProvider>
    );
    const view = render(shell([]));
    await frame();
    const live = canvas();
    expect(live.getMountedIds().size).toBe(0);
    expect(screen.getByRole('menuitem', { name: 'Create card' })).toBeDefined();
    view.rerender(
      shell([{ id: 'offscreen', bounds: { x: 1_000_000, y: 1_000_000, width: 100, height: 60 } }]),
    );
    await frame();
    expect(canvas()).toBe(live);
    expect(live.getMountedIds().size).toBe(0);
    expect(screen.queryByRole('menuitem', { name: 'Create card' })).toBeNull();
    view.rerender(shell([]));
    await frame();
    expect(screen.getByRole('menuitem', { name: 'Create card' })).toBeDefined();
    view.rerender(shell([], false));
    expect(screen.queryByRole('menuitem', { name: 'Create card' })).toBeNull();
  });

  it.each(['pan', 'zoom'] as const)(
    'keeps every chrome slot free of React commits during 180 pure %s frames',
    async (interaction) => {
      const commits = vi.fn();
      render(
        <Profiler id="chrome-kit" onRender={commits}>
          <Tree />
        </Profiler>,
      );
      await frame();
      fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
      await frame();
      const live = canvas();
      const mounted = [...live.getMountedIds()];
      expect(mounted).toEqual(['card']);
      const initial = commits.mock.calls.length;
      for (let index = 0; index < 180; index += 1) {
        const phase = Math.sin(index / 20);
        act(() =>
          live.setCamera(
            interaction === 'pan'
              ? { x: phase * 10, y: phase * 10, zoom: 1 }
              : { x: 0, y: 0, zoom: 1 + phase * 0.02 },
          ),
        );
        await frame();
      }
      expect([...live.getMountedIds()]).toEqual(mounted);
      expect(commits).toHaveBeenCalledTimes(initial);
      if (interaction === 'zoom')
        expect(screen.getByLabelText('Zoom percentage').textContent).toBe(
          `${Math.round(live.getCamera().zoom * 100)}%`,
        );
    },
  );

  it('uses the live keymap for corner hints, tooltips, and menu rows', () => {
    const view = render(<Tree />);
    const keymap: ChromeKeymap = {
      ...defaultChromeKeymap,
      menu: { code: 'KeyM', ctrlKey: true },
      sidebar: { code: 'KeyI', ctrlKey: true },
    };
    view.rerender(<Tree keymap={keymap} />);
    expect(screen.getByRole('button', { name: /Select/u }).textContent).toContain('Ctrl+M');
    expect(
      screen.getByRole('button', { name: /^Select Ctrl\+M$/u }).getAttribute('aria-label'),
    ).toBe('Select Ctrl+M');
    expect(screen.getByRole('button', { name: /Select/u }).getAttribute('title')).toContain(
      'Ctrl+M',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(
      screen.getByRole('menuitem', { name: 'Inspect selection Ctrl+I', exact: true }),
    ).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Inspect selection/u }).textContent).toContain(
      'Ctrl+I',
    );
  });

  it('derives action names from visible text instead of internal labels', () => {
    render(
      <ChromeProvider>
        <Probe />
        <ChromeRoot>
          <MenuPill>
            <Menu>
              <MenuItem label="Internal">Visible</MenuItem>
            </Menu>
          </MenuPill>
          <ActionPill>
            <PrimaryAction>
              <span>Publish board</span>
            </PrimaryAction>
            <SidebarToggle />
          </ActionPill>
          <Sidebar />
        </ChromeRoot>
      </ChromeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Publish board', exact: true })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Menu', exact: true }));
    expect(screen.getByRole('menuitem', { name: 'Visible', exact: true })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Internal', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar', exact: true }));
    const returnButton = screen.getByRole('button', { name: 'Return to canvas', exact: true });
    expect(returnButton.textContent).toBe('Return to canvas');
    fireEvent.click(returnButton);
    expect(current().panels.sidebar?.open).toBe(false);
  });

  it('keeps selection pending until inspection and closes only unpinned empty-canvas interactions', async () => {
    render(<Tree />);
    await frame();
    expect(sidebar().inert).toBe(true);
    expect(sidebar().hasAttribute('aria-hidden')).toBe(false);
    act(() => canvas().setSelection(['card']));
    await frame();
    expect(current().inspectorPending).toBe(true);
    expect(current().panels.sidebar?.open).toBe(false);
    const stage = document.querySelector('.canvas-stage') as HTMLElement;
    fireEvent.keyDown(stage, { code: 'Enter', key: 'Enter' });
    expect(current().panels.sidebar?.open).toBe(true);
    expect(sidebar().inert).not.toBe(true);
    canvasClick(document.querySelector('[data-canvas-node-id="card"]') as HTMLElement, 150, 120);
    expect(current().panels.sidebar?.open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(current().panels.sidebar?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin sidebar' }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    canvasClick(stage);
    expect(current().panels.sidebar).toEqual({ open: true, pinned: true });
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin sidebar' }));
    canvasClick(stage);
    expect(current().panels.sidebar?.open).toBe(false);
  });

  it('dismisses only completed empty-canvas clicks within four pixels', async () => {
    render(<Tree />);
    await frame();
    const stage = document.querySelector('.canvas-stage');
    if (!(stage instanceof HTMLElement)) throw new Error('Canvas stage did not render');
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    pointerEvent(stage, 'pointerdown', 10, 10);
    expect(current().panels.sidebar?.open).toBe(true);
    pointerEvent(stage, 'pointermove', 15, 10);
    pointerEvent(stage, 'pointerup', 15, 10);
    fireEvent.click(stage, { clientX: 15, clientY: 10 });
    expect(current().panels.sidebar?.open).toBe(true);
    pointerEvent(stage, 'pointerdown', 10, 10);
    pointerEvent(stage, 'pointermove', 30, 10);
    pointerEvent(stage, 'pointermove', 10, 10);
    pointerEvent(stage, 'pointerup', 10, 10);
    fireEvent.click(stage, { clientX: 10, clientY: 10 });
    expect(current().panels.sidebar?.open).toBe(true);
    const node = document.querySelector('[data-canvas-node-id="card"]');
    if (!(node instanceof HTMLElement)) throw new Error('Canvas node did not render');
    canvasClick(node, 150, 120);
    expect(current().panels.sidebar?.open).toBe(true);
    pointerEvent(stage, 'pointerdown', 10, 10);
    pointerEvent(stage, 'pointercancel', 10, 10);
    fireEvent.click(stage, { clientX: 10, clientY: 10 });
    expect(current().panels.sidebar?.open).toBe(true);
    pointerEvent(stage, 'pointerdown', 10, 10);
    pointerEvent(document.body, 'pointerup', 10, 10);
    fireEvent.click(document.body, { clientX: 10, clientY: 10 });
    expect(current().panels.sidebar?.open).toBe(true);
    pointerEvent(stage, 'pointerdown', 10, 10);
    pointerEvent(stage, 'pointerup', 14, 10);
    fireEvent.click(stage, { clientX: 14, clientY: 10 });
    expect(current().panels.sidebar?.open).toBe(false);
  });

  it('publishes the mobile sheet safe area to both canvas and chrome snapshots', async () => {
    width = 390;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      if (this.matches('.canvas-stage')) return new DOMRect(0, 0, 390, 844);
      const name = this.getAttribute('data-chrome-slot');
      if (name === 'sidebar' || name === 'navigation') return new DOMRect(0, 380, 390, 464);
      if (name === 'toolbar') return new DOMRect(70, 788, 250, 44);
      if (name === 'zoom' || name === 'menu') return new DOMRect(12, 12, 120, 44);
      return new DOMRect();
    });
    render(<Tree />);
    expect(current().layout).toBe('mobile');
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    const controllerArea = canvas().getSafeArea();
    expect(controllerArea.y + controllerArea.height).toBeLessThanOrEqual(380);
    expect(current().safeArea).toEqual(controllerArea);
    expect(current().safeArea.y + current().safeArea.height).toBeLessThanOrEqual(380);
    await frame();
    expect(current().safeArea).toEqual(controllerArea);
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    const closedArea = canvas().getSafeArea();
    expect(closedArea.y + closedArea.height).toBeGreaterThan(380);
    expect(current().safeArea).toEqual(closedArea);
    await frame();
    expect(current().safeArea).toEqual(closedArea);
  });

  it('switches mobile and one-panel components without allowing two open panels', () => {
    render(<Tree onePanelBreakpoint={1000} />);
    act(() => {
      current().setPanelOpen('navigation', true);
      current().setPanelOpen('sidebar', true);
    });
    expect(current().panels.navigation?.open).toBe(true);
    changeWidth(900);
    expect(current().layout).toBe('one-panel');
    expect(Object.values(current().panels).filter((panel) => panel.open)).toHaveLength(1);
    changeWidth(390);
    expect(current().layout).toBe('mobile');
    act(() => current().setPanelOpen('navigation', true));
    expect(current().panels.sidebar?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Help' })).toBeDefined();
  });

  it('round trips panel pin and dismissed hint state through component interactions', async () => {
    const values = new Map<string, unknown>();
    const storage = {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        values.set(key, value);
      },
    };
    const view = render(<Tree storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss toolbar hint' }));
    expect(screen.queryByText('Choose a tool')).toBeNull();
    view.unmount();
    render(<Tree storage={storage} />);
    await frame();
    expect(current().panels.sidebar).toEqual({ open: true, pinned: true });
    expect(screen.queryByText('Choose a tool')).toBeNull();
  });

  it('reports component storage failures with the operation and key', () => {
    const failure = new Error('Panel storage unavailable');
    const report = vi.fn();
    const storage = {
      get: () => undefined,
      set: () => {
        throw failure;
      },
    };
    render(<Tree storage={storage} onStorageError={report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    expect(report).toHaveBeenCalledWith(failure, {
      operation: 'set',
      key: 'canvas.chrome.panel.sidebar',
    });
  });

  it('shows empty-canvas actions and removes them as soon as nodes exist', () => {
    const view = render(<Tree nodeList={[]} />);
    expect(screen.getByRole('menuitem', { name: 'Create card' })).toBeDefined();
    view.rerender(<Tree />);
    expect(screen.queryByRole('menuitem', { name: 'Create card' })).toBeNull();
  });

  it('uses the settled panel layout rect while a transform transition is active', () => {
    render(<Tree />);
    const panel = sidebar();
    const content = panel.querySelector('[data-chrome-panel-content]');
    if (!(content instanceof HTMLElement)) throw new Error('Panel content did not render');
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      if (this === panel) return new DOMRect(876, 64, 312, 772);
      if (this === content) return new DOMRect(1100, 64, 312, 772);
      return new DOMRect(0, 0, 1200, 900);
    });
    content.style.transform = 'translateX(224px)';
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    expect(
      vi
        .mocked(canvas().setChrome)
        .mock.calls.some(
          ([surface]) =>
            surface.open &&
            surface.edge === 'right' &&
            surface.rect.x === 876 &&
            surface.rect.width === 312,
        ),
    ).toBe(true);
  });

  it('renders every new component on the server without a window global', () => {
    const browserWindow = window;
    vi.stubGlobal('window', undefined);
    expect(typeof window).toBe('undefined');
    let html: string;
    try {
      html = renderToString(<Tree nodeList={[]} />);
    } finally {
      vi.stubGlobal('window', browserWindow);
    }
    expect(html).toContain('Share');
    expect(html).toContain('Choose a tool');
    expect(html).toContain('Navigation content');
  });
});
