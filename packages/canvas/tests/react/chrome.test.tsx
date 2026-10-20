// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasController } from '../../src/index.mjs';
import { createCanvas } from '../../src/index.mjs';
import type { ChromeKeymap, ChromeState, ChromeStorage } from '../../src/react/chrome-provider.mjs';
import {
  ChromeProvider,
  defaultChromeKeymap,
  formatShortcut,
  useChrome,
  useChromeBridge,
  useReducedMotion,
  useShortcut,
} from '../../src/react/chrome-provider.mjs';

let state: ChromeState | undefined;
let media: Map<string, MediaQueryList>;
let width: number;
let reduced: boolean;
let observations: Set<ResizeObserverCallback>;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const controllers: CanvasController[] = [];

function current(): ChromeState {
  if (!state) throw new Error('Chrome probe did not render');
  return state;
}
function refreshMedia() {
  for (const query of media.values()) query.dispatchEvent(new Event('change'));
}
function frame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(performance.now());
}
function Probe({ onRender }: { onRender?: () => void }) {
  state = useChrome();
  onRender?.();
  const shortcut = useShortcut('menu');
  const motion = useReducedMotion();
  return (
    <output data-testid="probe">
      {formatShortcut(shortcut, 'Windows')}:{String(motion)}
    </output>
  );
}
function Panels() {
  const { registerPanel } = useChrome();
  useEffect(() => {
    const left = registerPanel('navigation', { side: 'left', role: 'navigation' });
    const right = registerPanel('inspector', { side: 'right', role: 'sidebar' });
    return () => {
      left();
      right();
    };
  }, [registerPanel]);
  return null;
}
function RegisteredMenu({ open }: { open: () => void }) {
  const { registerMenu } = useChrome();
  useEffect(() => registerMenu(open), [registerMenu, open]);
  return null;
}
function RegisteredCanvas() {
  const bridge = useChromeBridge();
  useEffect(() => {
    const controller = createCanvas({ label: 'Chrome test', motion: 'none' });
    controllers.push(controller);
    const stage = document.createElement('div');
    const world = document.createElement('div');
    stage.append(world);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 800, 600));
    vi.spyOn(controller, 'setChrome');
    vi.spyOn(controller, 'removeChrome');
    controller.attach({ stage, world });
    controller.setNodes([{ id: 'node', bounds: { x: 0, y: 0, width: 20, height: 20 } }]);
    const unregisterRegion = bridge?.registerRegion('canvas', stage);
    const unregister = bridge?.registerCanvas(controller);
    return () => {
      unregister?.();
      unregisterRegion?.();
      controller.destroy();
      controllers.splice(controllers.indexOf(controller), 1);
    };
  }, [bridge]);
  return <div>Canvas route</div>;
}
function Regions() {
  const root = useRef<HTMLDivElement>(null);
  const { registerRegion } = useChrome();
  useEffect(() => {
    const elements = root.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!elements) throw new Error('Region elements missing');
    const off = [...elements].map((element) => {
      const region = element.textContent;
      if (
        region === 'skip-link' ||
        region === 'menu' ||
        region === 'toolbar' ||
        region === 'action' ||
        region === 'canvas' ||
        region === 'zoom' ||
        region === 'history' ||
        region === 'help'
      )
        return registerRegion(region, element);
      return registerRegion('sidebar', element, { panelId: 'inspector' });
    });
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, [registerRegion]);
  return (
    <div ref={root}>
      {[
        'skip-link',
        'menu',
        'toolbar',
        'action',
        'canvas',
        'sidebar',
        'zoom',
        'history',
        'help',
      ].map((region) => (
        <button type="button" key={region}>
          {region}
        </button>
      ))}
    </div>
  );
}

beforeEach(() => {
  state = undefined;
  width = 1200;
  reduced = false;
  media = new Map();
  observations = new Set();
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {
        observations.add(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        observations.delete(this.callback);
      }
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => {
    const existing = media.get(query);
    if (existing) return existing;
    const events = new EventTarget();
    const value: MediaQueryList = {
      get matches() {
        return query.includes('reduced-motion')
          ? reduced
          : width <= Number(query.match(/[\d.]+/)?.[0]);
      },
      media: query,
      onchange: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      addListener(listener) {
        if (listener) events.addEventListener('change', listener as EventListener);
      },
      removeListener(listener) {
        if (listener) events.removeEventListener('change', listener as EventListener);
      },
    };
    media.set(query, value);
    return value;
  });
});
afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('chrome state and keyboard', () => {
  it('keeps panels across canvas and page routes without subscribing to camera moves', () => {
    let renders = 0;
    const tree = (canvas: boolean) => (
      <ChromeProvider>
        <Panels />
        <Probe onRender={() => renders++} />
        {canvas ? <RegisteredCanvas /> : <div>Page route</div>}
      </ChromeProvider>
    );
    const view = render(tree(true));
    act(() => current().setPanelOpen('navigation', true));
    act(() => {
      controllers[0]?.setCamera({ x: 3, y: 9, zoom: 1 });
      frame();
    });
    const previous = current();
    const count = renders;
    act(() => {
      controllers[0]?.setCamera({ x: 7, y: 15, zoom: 1 });
      frame();
    });
    expect(renders).toBe(count);
    expect(current()).toBe(previous);
    view.rerender(tree(false));
    expect(current().panels.navigation?.open).toBe(true);
    view.rerender(tree(true));
    expect(current().panels.navigation?.open).toBe(true);
    act(() => {
      controllers[0]?.setSelection(['node']);
      frame();
    });
    expect(current().inspectorPending).toBe(true);
    expect(current().panels.inspector?.open).toBe(false);
    act(() => current().setPanelOpen('inspector', true));
    expect(current().inspectorPending).toBe(false);
  });

  it('matches physical codes with Option characters and uses the live keymap for hints', () => {
    const view = render(
      <ChromeProvider>
        <Panels />
        <Probe />
      </ChromeProvider>,
    );
    fireEvent.keyDown(document, { code: 'BracketLeft', key: '“', altKey: true });
    expect(current().panels.navigation?.open).toBe(true);
    fireEvent.keyDown(document, { code: 'BracketRight', key: '‘', altKey: true });
    expect(current().panels.inspector?.open).toBe(true);
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'Ω', altKey: true });
    expect(current().chromeHidden).toBe(true);
    const keymap: ChromeKeymap = { ...defaultChromeKeymap, menu: { code: 'KeyM', ctrlKey: true } };
    view.rerender(
      <ChromeProvider keymap={keymap}>
        <Panels />
        <Probe />
      </ChromeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('Ctrl+M:false');
    fireEvent.keyDown(document, { code: 'BracketLeft', altKey: true });
    expect(current().panels.navigation?.open).toBe(true);
    fireEvent.keyDown(document, { code: 'KeyM', ctrlKey: true });
    expect(current().panels.navigation?.open).toBe(false);
    expect(formatShortcut({ code: 'BracketLeft', altKey: true }, 'MacIntel')).toBe('⌥[');
  });

  it('opens a registered menu when no navigation panel exists and cleans up registration', () => {
    const open = vi.fn();
    const tree = (panels: boolean, menu: boolean) => (
      <ChromeProvider>
        <Probe />
        {panels ? <Panels /> : null}
        {menu ? <RegisteredMenu open={open} /> : null}
      </ChromeProvider>
    );
    const view = render(tree(false, true));
    const register = current().registerMenu;
    expect(current().keymap).toBe(defaultChromeKeymap);
    expect(screen.getByTestId('probe').textContent).toBe('Alt+[:false');
    fireEvent.keyDown(document, { code: 'BracketLeft', key: '“', altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    view.rerender(tree(true, true));
    expect(current().registerMenu).toBe(register);
    fireEvent.keyDown(document, { code: 'BracketLeft', key: '“', altKey: true });
    expect(current().panels.navigation?.open).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    view.rerender(tree(false, true));
    fireEvent.keyDown(document, { code: 'BracketLeft', key: '“', altKey: true });
    expect(open).toHaveBeenCalledTimes(2);
    view.rerender(tree(false, false));
    fireEvent.keyDown(document, { code: 'BracketLeft', key: '“', altKey: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('ignores editable targets and composition', () => {
    render(
      <ChromeProvider>
        <Panels />
        <Probe />
        <input aria-label="Name" />
        <div contentEditable suppressContentEditableWarning>
          Editor
        </div>
      </ChromeProvider>,
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { code: 'BracketLeft', altKey: true });
    fireEvent.keyDown(screen.getByText('Editor'), { code: 'BracketRight', altKey: true });
    fireEvent.keyDown(document, { code: 'KeyZ', altKey: true, isComposing: true });
    fireEvent.compositionStart(document);
    fireEvent.keyDown(document, { code: 'BracketLeft', altKey: true });
    fireEvent.compositionEnd(document);
    expect(current().panels.navigation?.open).toBe(false);
    expect(current().panels.inspector?.open).toBe(false);
    expect(current().chromeHidden).toBe(false);
  });

  it('cycles F6 regions in order and skips closed panels', () => {
    render(
      <ChromeProvider>
        <Panels />
        <Probe />
        <Regions />
      </ChromeProvider>,
    );
    for (const region of [
      'skip-link',
      'menu',
      'toolbar',
      'action',
      'canvas',
      'zoom',
      'history',
      'help',
      'skip-link',
    ]) {
      fireEvent.keyDown(document, { code: 'F6' });
      expect(document.activeElement).toBe(screen.getByText(region));
    }
    fireEvent.keyDown(document, { code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('help'));
    act(() => current().setPanelOpen('inspector', true));
    for (const region of [
      'history',
      'zoom',
      'sidebar',
      'canvas',
      'action',
      'toolbar',
      'menu',
      'skip-link',
    ]) {
      fireEvent.keyDown(document, { code: 'F6', shiftKey: true });
      expect(document.activeElement).toBe(screen.getByText(region));
    }
  });

  it('closes other panels when opening or entering constrained layouts', () => {
    render(
      <ChromeProvider onePanelBreakpoint={1000}>
        <Panels />
        <Probe />
      </ChromeProvider>,
    );
    act(() => {
      current().setPanelOpen('navigation', true);
      current().setPanelOpen('inspector', true);
    });
    expect(current().layout).toBe('desktop');
    expect(current().panels.navigation?.open).toBe(true);
    act(() => {
      width = 900;
      refreshMedia();
    });
    expect(current().layout).toBe('one-panel');
    expect(Object.values(current().panels).filter((panel) => panel.open)).toHaveLength(1);
    act(() => current().setPanelOpen('inspector', true));
    expect(current().panels.navigation?.open).toBe(false);
    act(() => {
      width = 500;
      refreshMedia();
      current().setPanelOpen('navigation', true);
    });
    expect(current().layout).toBe('mobile');
    expect(current().panels.inspector?.open).toBe(false);
    expect(current().panels.navigation?.open).toBe(true);
  });

  it('tracks reduced motion without accessing browser globals during render', () => {
    render(
      <ChromeProvider>
        <Probe />
      </ChromeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toContain('false');
    act(() => {
      reduced = true;
      refreshMedia();
    });
    expect(screen.getByTestId('probe').textContent).toContain('true');
  });
});

describe('chrome surfaces and persistence', () => {
  it('measures persistent surfaces relative to the canvas and keeps zoom visible', () => {
    render(
      <ChromeProvider>
        <Panels />
        <Probe />
        <RegisteredCanvas />
      </ChromeProvider>,
    );
    const controller = controllers[0];
    if (!controller) throw new Error('Controller was not registered');
    const toolbar = document.createElement('div');
    const menu = document.createElement('div');
    const zoom = document.createElement('div');
    const bounds = vi
      .spyOn(toolbar, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 200, 500, 50));
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 300, 400));
    vi.spyOn(zoom, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 730, 100, 40));
    let removeToolbar = () => {};
    let removeMenu = () => {};
    let removeZoom = () => {};
    const initialObservers = observations.size;
    act(() => {
      removeToolbar = current().registerSurface('toolbar', 'top', toolbar, { persistent: true });
      removeMenu = current().registerSurface('menu', 'left', menu, { persistent: false });
      removeZoom = current().registerSurface('zoom', 'bottom', zoom, {
        persistent: true,
        zoom: true,
      });
    });
    expect(controller.setChrome).toHaveBeenCalledWith({
      id: 'toolbar',
      edge: 'top',
      open: true,
      rect: { x: 0, y: 0, width: 500, height: 50 },
    });
    expect(
      vi.mocked(controller.setChrome).mock.calls.some(([surface]) => surface.id === 'menu'),
    ).toBe(false);
    expect(current().safeArea.y).toBe(62);
    expect(current().safeArea.x).toBe(12);
    bounds.mockReturnValue(new DOMRect(100, 200, 500, 70));
    act(() => {
      const observer = new ResizeObserver(() => {});
      for (const callback of [...observations]) callback([], observer);
      observer.disconnect();
    });
    expect(current().safeArea.y).toBe(82);
    act(() => current().setChromeHidden(true));
    expect(current().safeArea.y).toBe(12);
    expect(toolbar.style.visibility).toBe('hidden');
    expect(menu.style.visibility).toBe('hidden');
    expect(toolbar.inert).toBe(true);
    expect(zoom.style.visibility).toBe('');
    expect(zoom.inert).not.toBe(true);
    act(() => current().setChromeHidden(false));
    expect(toolbar.style.visibility).toBe('');
    act(() => {
      removeToolbar();
      removeMenu();
      removeZoom();
    });
    expect(controller.removeChrome).toHaveBeenCalledWith('toolbar');
    expect(controller.removeChrome).toHaveBeenCalledWith('zoom');
    expect(controller.removeChrome).not.toHaveBeenCalledWith('menu');
    expect(observations.size).toBe(initialObservers);
  });

  it('gives page routes a window safe area and restores it after canvas removal', () => {
    const tree = (canvas: boolean) => (
      <ChromeProvider>
        <Probe />
        {canvas ? <RegisteredCanvas /> : <div>Page</div>}
      </ChromeProvider>
    );
    const view = render(tree(false));
    const toolbar = document.createElement('div');
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 50));
    let unregister = () => {};
    act(() => {
      unregister = current().registerSurface('toolbar', 'top', toolbar, { persistent: true });
    });
    expect(current().safeArea).toEqual({
      x: 12,
      y: 62,
      width: window.innerWidth - 24,
      height: window.innerHeight - 74,
    });
    view.rerender(tree(true));
    expect(current().safeArea.width).toBe(776);
    view.rerender(tree(false));
    expect(current().safeArea).toEqual({
      x: 12,
      y: 62,
      width: window.innerWidth - 24,
      height: window.innerHeight - 74,
    });
    act(unregister);
  });

  it('loads and saves panel open/pin state and dismissed hints through the adapter', async () => {
    const values = new Map<string, unknown>();
    const storage: ChromeStorage = {
      get: (key) => Promise.resolve(values.get(key)),
      set: (key, value) => {
        values.set(key, value);
        return Promise.resolve();
      },
    };
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        <ChromeProvider storage={storage}>
          <Panels />
          <Probe />
        </ChromeProvider>,
      );
    });
    act(() => {
      current().setPanelOpen('inspector', true);
      current().setPanelPinned('inspector', true);
      current().dismissHint('welcome');
    });
    if (!view) throw new Error('Provider was not rendered');
    view.unmount();
    await act(async () => {
      render(
        <ChromeProvider storage={storage}>
          <Panels />
          <Probe />
        </ChromeProvider>,
      );
    });
    expect(current().panels.inspector).toEqual({ open: true, pinned: true });
    expect(current().dismissedHints).toEqual(['welcome']);
    expect(values.size).toBe(2);
  });

  it('keeps a user toggle when a pending stored panel read resolves', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const storage: ChromeStorage = {
      get: (key) => (key === 'canvas.chrome.panel.inspector' ? pending : undefined),
      set: () => {},
    };
    render(
      <ChromeProvider storage={storage}>
        <Panels />
        <Probe />
      </ChromeProvider>,
    );
    act(() => current().setPanelOpen('inspector', true));
    await act(async () => {
      resolve?.({ open: false, pinned: false });
    });
    expect(current().panels.inspector?.open).toBe(true);
  });

  it.each(['throw', 'reject'] as const)(
    'reports adapter %s errors for reads and writes',
    async (mode) => {
      const error = new Error(`Storage ${mode}`);
      const report = vi.fn();
      const fail = () => {
        if (mode === 'throw') throw error;
        return Promise.reject(error);
      };
      const storage: ChromeStorage = { get: fail, set: fail };
      await act(async () => {
        render(
          <ChromeProvider storage={storage} onStorageError={report}>
            <Panels />
            <Probe />
          </ChromeProvider>,
        );
      });
      expect(current().panels.inspector).toEqual({ open: false, pinned: false });
      expect(report).toHaveBeenCalledWith(error, {
        key: 'canvas.chrome.panel.inspector',
        operation: 'get',
      });
      await act(async () => {
        current().setPanelOpen('inspector', true);
      });
      expect(report).toHaveBeenCalledWith(error, {
        key: 'canvas.chrome.panel.inspector',
        operation: 'set',
      });
      expect(current().panels.inspector?.open).toBe(true);
    },
  );

  it('surfaces thrown storage failures when no error callback is supplied', () => {
    const error = new Error('Storage unavailable');
    const storage: ChromeStorage = {
      get: () => {
        throw error;
      },
      set: () => {},
    };
    expect(() =>
      render(
        <ChromeProvider storage={storage}>
          <Probe />
        </ChromeProvider>,
      ),
    ).toThrow(error);
  });

  it('saves each dismissed hint once under Strict Mode', () => {
    const storage: ChromeStorage = { get: () => undefined, set: vi.fn() };
    render(
      <StrictMode>
        <ChromeProvider storage={storage}>
          <Probe />
        </ChromeProvider>
      </StrictMode>,
    );
    act(() => current().dismissHint('welcome'));
    expect(storage.set).toHaveBeenCalledExactlyOnceWith('canvas.chrome.dismissedHints', [
      'welcome',
    ]);
  });

  it('reports invalid stored values and uses the closed default', () => {
    const report = vi.fn();
    const storage: ChromeStorage = { get: () => ({ open: 'yes' }), set: () => {} };
    render(
      <ChromeProvider storage={storage} onStorageError={report}>
        <Panels />
        <Probe />
      </ChromeProvider>,
    );
    expect(current().panels.inspector).toEqual({ open: false, pinned: false });
    expect(report).toHaveBeenCalledWith(expect.any(TypeError), {
      key: 'canvas.chrome.panel.inspector',
      operation: 'get',
    });
  });

  it('merges newly dismissed hints with an outstanding storage read', async () => {
    let resolveHints: ((value: string[]) => void) | undefined;
    const pending = new Promise<string[]>((resolve) => {
      resolveHints = resolve;
    });
    const storage: ChromeStorage = { get: () => pending, set: vi.fn() };
    render(
      <ChromeProvider storage={storage}>
        <Probe />
      </ChromeProvider>,
    );
    act(() => current().dismissHint('welcome'));
    await act(async () => {
      resolveHints?.(['navigation']);
    });
    expect(current().dismissedHints).toEqual(['navigation', 'welcome']);
    expect(storage.set).toHaveBeenLastCalledWith('canvas.chrome.dismissedHints', [
      'navigation',
      'welcome',
    ]);
  });
});
