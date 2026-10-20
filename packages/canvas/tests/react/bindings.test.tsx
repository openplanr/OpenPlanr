// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasController, CanvasNode } from '../../src/index.mjs';
import * as core from '../../src/index.mjs';
import { ChromeProvider } from '../../src/react/chrome-provider.mjs';
import { OutlinePanel } from '../../src/react/outline-panel.mjs';
import { CanvasProvider, useCamera, useCanvas } from '../../src/react/provider.mjs';
import { CanvasStage } from '../../src/react/stage.mjs';
import { WorldNodes } from '../../src/react/world-nodes.mjs';
import { generateLayeredGraph } from '../../src/testing/index.mjs';

let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let now: number;
let created: CanvasController[];

beforeEach(() => {
  frames = new Map();
  sequence = 0;
  now = 0;
  created = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(window.performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  const create = core.createCanvas;
  vi.spyOn(core, 'createCanvas').mockImplementation((options) => {
    const controller = create(options);
    vi.spyOn(controller, 'attach');
    vi.spyOn(controller, 'detach');
    vi.spyOn(controller, 'destroy');
    created.push(controller);
    return controller;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function frame(step = 16): Promise<void> {
  await act(async () => {
    now += step;
    vi.advanceTimersByTime(step);
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
    await Promise.resolve();
  });
}

function node(id: string, x: number): CanvasNode {
  return { id, bounds: { x, y: 100, width: 40, height: 40 } };
}

function liveController(): CanvasController {
  const controller = created.at(-1);
  if (!controller) throw new Error('Test canvas did not create a controller');
  return controller;
}

describe('React canvas bindings', () => {
  it('attaches the surviving Strict Mode controller once and destroys every controller', async () => {
    const additions = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removals = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const controllerRef = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <ChromeProvider>
          <CanvasProvider label="Strict canvas" controllerRef={controllerRef}>
            <CanvasStage />
          </CanvasProvider>
        </ChromeProvider>
      </StrictMode>,
    );
    await frame();
    expect(created).toHaveLength(2);
    expect(created[0]?.attach).toHaveBeenCalledTimes(0);
    expect(liveController().attach).toHaveBeenCalledTimes(1);
    expect(controllerRef).toHaveBeenCalledWith(liveController());
    unmount();
    for (const controller of created) expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(liveController().detach).toHaveBeenCalledTimes(1);
    expect(controllerRef).toHaveBeenLastCalledWith(null);
    expect(frames.size).toBe(0);
    for (const [index, [type, listener]] of additions.mock.calls.entries()) {
      const target = additions.mock.contexts[index];
      if (
        target !== window &&
        target !== document &&
        !(target instanceof HTMLElement && target.classList.contains('canvas-stage'))
      )
        continue;
      if (target === document && type !== 'keydown') continue;
      expect(
        removals.mock.calls.some(
          ([removedType, removedListener], removedIndex) =>
            removedType === type &&
            removedListener === listener &&
            removals.mock.contexts[removedIndex] === target,
        ),
      ).toBe(true);
    }
  });

  it('keeps equal camera selections stable and supports a custom comparator', async () => {
    const zoomCommits = vi.fn();
    function Zoom() {
      const selected = useCamera(
        (camera) => ({ zoom: camera.zoom }),
        (a, b) => a.zoom === b.zoom,
      );
      return (
        <Profiler id="zoom" onRender={zoomCommits}>
          <output>{selected.zoom}</output>
        </Profiler>
      );
    }
    render(
      <CanvasProvider label="Camera">
        <CanvasStage />
        <Zoom />
      </CanvasProvider>,
    );
    await frame();
    const before = zoomCommits.mock.calls.length;
    act(() => liveController().panBy(10, 10));
    await frame();
    expect(zoomCommits).toHaveBeenCalledTimes(before);
    act(() => liveController().setCamera({ x: 10, y: 10, zoom: 0.8 }));
    await frame();
    expect(zoomCommits).toHaveBeenCalledTimes(before + 1);
    expect(screen.getByText('0.8')).toBeDefined();
  });

  it('memoizes object selectors against unchanged camera coordinates', async () => {
    function CameraObject() {
      const selected = useCamera((camera) => ({ zoom: camera.zoom }));
      return <output aria-label="Object zoom">{selected.zoom}</output>;
    }
    render(
      <CanvasProvider label="Object camera">
        <CanvasStage />
        <CameraObject />
      </CanvasProvider>,
    );
    await frame();
    expect(screen.getByLabelText('Object zoom').textContent).toBe('1');
    act(() => liveController().setCamera({ x: 0, y: 0, zoom: 0.9 }));
    await frame();
    expect(screen.getByLabelText('Object zoom').textContent).toBe('0.9');
  });

  it('renders mounted IDs and only rerenders the item whose identity changed', async () => {
    const nodes = [node('a', 100), node('b', 200), node('far', 10000)];
    const a = { title: 'A' };
    const b = { title: 'B' };
    const calls = vi.fn();
    const view = (data: ReadonlyMap<string, { title: string }>) => (
      <CanvasProvider label="Items" nodes={nodes}>
        <CanvasStage>
          <WorldNodes
            data={data}
            renderNode={(id, item) => {
              calls(id);
              return <span>{item?.title}</span>;
            }}
          />
        </CanvasStage>
      </CanvasProvider>
    );
    const result = render(
      view(
        new Map([
          ['a', a],
          ['b', b],
          ['far', { title: 'Far' }],
        ]),
      ),
    );
    await frame();
    expect(calls.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b']);
    calls.mockClear();
    result.rerender(
      view(
        new Map([
          ['a', a],
          ['b', { title: 'Updated' }],
        ]),
      ),
    );
    expect(calls.mock.calls.map(([id]) => id)).toEqual(['b']);
    calls.mockClear();
    result.rerender(
      view(
        new Map([
          ['a', a],
          ['b', { title: 'Updated again' }],
        ]),
      ),
    );
    expect(calls.mock.calls.map(([id]) => id)).toEqual(['b']);
    calls.mockClear();
    const stable = new Map([
      ['a', a],
      ['b', b],
    ]);
    result.rerender(view(stable));
    calls.mockClear();
    result.rerender(view(stable));
    expect(calls).not.toHaveBeenCalled();
  });

  it('writes changed geometry and preserves zero commits during stable pans and zooms', async () => {
    const data = new Map([['a', 'Card']]);
    const commits = vi.fn();
    const view = (nodes: readonly CanvasNode[]) => (
      <CanvasProvider label="Geometry" nodes={nodes} options={{ lod: false }}>
        <Profiler id="world" onRender={commits}>
          <CanvasStage>
            <WorldNodes data={data} renderNode={(_id, item) => <span>{item}</span>} />
          </CanvasStage>
        </Profiler>
      </CanvasProvider>
    );
    const result = render(view([node('a', 100)]));
    await frame();
    const wrapper = result.container.querySelector('[data-canvas-node-id="a"]');
    expect(wrapper).toBeInstanceOf(HTMLElement);
    result.rerender(view([node('a', 120)]));
    const beforeGeometry = commits.mock.calls.length;
    await frame();
    expect((wrapper as HTMLElement).style.transform).toBe('translate(120px, 100px)');
    expect(commits).toHaveBeenCalledTimes(beforeGeometry);
    const beforeCamera = commits.mock.calls.length;
    for (let index = 0; index < 5; index += 1) {
      act(() => liveController().setCamera({ x: index, y: index, zoom: 1 - index * 0.01 }));
      await frame();
    }
    expect(commits).toHaveBeenCalledTimes(beforeCamera);
  });

  it('replaces mounted node lists without rendering removed data or destroying the controller', async () => {
    const view = (ids: readonly string[]) => (
      <ChromeProvider>
        <CanvasProvider
          label="Replacement"
          nodes={ids.map((id, index) => node(id, 100 + index * 80))}
        >
          <CanvasStage>
            <WorldNodes
              data={new Map(ids.map((id) => [id, { title: id }]))}
              renderNode={(id, item) => {
                if (!item) throw new Error(`Replacement card ${id} has no data`);
                return <span>{item.title}</span>;
              }}
            />
          </CanvasStage>
        </CanvasProvider>
      </ChromeProvider>
    );
    const result = render(view(['a', 'b']));
    await frame();
    expect(screen.getByText('a')).toBeDefined();
    expect(screen.getByText('b')).toBeDefined();
    const controller = liveController();
    result.rerender(view(['replacement']));
    await frame();
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByText('replacement')).toBeDefined();
    expect(liveController()).toBe(controller);
    expect(controller.destroy).not.toHaveBeenCalled();
    act(() => controller.setCamera({ x: 5, y: 10, zoom: 1 }));
    await frame();
    result.rerender(view([]));
    await frame();
    result.rerender(view(['remounted']));
    await frame();
    expect(screen.getByText('remounted')).toBeDefined();
    expect(liveController()).toBe(controller);
    expect(controller.destroy).not.toHaveBeenCalled();
  });

  it.each(['pan', 'zoom'] as const)(
    'keeps the 708-node fixture stable over 180 pure %s frames',
    async (interaction) => {
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
        new DOMRect(0, 0, 1440, 900),
      );
      const fixture = generateLayeredGraph(708, 997);
      const nodes = fixture.nodes.map((value) => ({
        ...value,
        bounds: { ...value.bounds, width: 220, height: 76 },
      }));
      const data = new Map(fixture.nodes.map((value) => [value.id, value.title]));
      const commits = vi.fn();
      render(
        <Profiler id="fixture" onRender={commits}>
          <ChromeProvider>
            <CanvasProvider label="Fixture" nodes={nodes}>
              <CanvasStage>
                <WorldNodes data={data} renderNode={(_id, title) => title} />
              </CanvasStage>
            </CanvasProvider>
          </ChromeProvider>
        </Profiler>,
      );
      await frame();
      const controller = liveController();
      const mounted = [...controller.getMountedIds()];
      expect(controller.getOutline()).toHaveLength(708);
      expect(mounted.length).toBeGreaterThan(1);
      const mount = vi.fn();
      const level = vi.fn();
      const offMount = controller.on('mount', mount);
      const offLevel = controller.on('level', level);
      const before = commits.mock.calls.length;
      for (let index = 0; index < 180; index += 1) {
        const phase = Math.sin(index / 20);
        act(() =>
          controller.setCamera(
            interaction === 'pan'
              ? { x: phase * 10, y: phase * 10, zoom: 1 }
              : { x: 0, y: 0, zoom: 1 + phase * 0.02 },
          ),
        );
        await frame();
      }
      await frame(150);
      expect([...controller.getMountedIds()]).toEqual(mounted);
      expect(mount).not.toHaveBeenCalled();
      expect(level).not.toHaveBeenCalled();
      expect(commits).toHaveBeenCalledTimes(before);
      offMount();
      offLevel();
    },
  );

  it('renders compact fixture cards after the initial zoom freeze', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 1440, 900),
    );
    const fixture = generateLayeredGraph(708, 997);
    render(
      <CanvasProvider label="Compact fixture" nodes={fixture.nodes}>
        <CanvasStage>
          <WorldNodes
            data={new Map(fixture.nodes.map((value) => [value.id, value.title]))}
            nodeAttributes={(_id, _item, level) => ({ 'data-card-level': level })}
            renderNode={(_id, title, level) => (
              <>
                <strong>{title}</strong>
                {level === 'dom' && <span>Detail</span>}
              </>
            )}
          />
        </CanvasStage>
      </CanvasProvider>,
    );
    act(() => liveController().setCamera({ x: 0, y: 0, zoom: 0.4 }));
    await frame();
    expect(liveController().getLevel()).toBe('compact');
    for (let index = 0; index < 12; index += 1) await frame();
    const cards = document.querySelectorAll('[data-canvas-node-id]');
    expect(cards.length).toBeGreaterThan(0);
    expect(
      [...cards].every(
        (card) =>
          card.getAttribute('data-card-level') === 'compact' &&
          card.querySelectorAll('*').length === 1,
      ),
    ).toBe(true);
  });

  it('publishes null before mounting and a live controller afterwards', () => {
    const observed: (CanvasController | null)[] = [];
    function Probe() {
      const controller = useCanvas();
      useEffect(() => {
        observed.push(controller);
      }, [controller]);
      return null;
    }
    render(
      <CanvasProvider label="Probe">
        <Probe />
      </CanvasProvider>,
    );
    expect(observed[0]).toBeNull();
    expect(observed.at(-1)).toBe(liveController());
  });

  it('renders wrapper attributes from the latest callback only when node inputs change', async () => {
    const nodes = [node('a', 100), node('b', 200)];
    const a = { title: 'A' };
    const b = { title: 'B' };
    const attributes = vi.fn();
    const content = vi.fn();
    const view = (data: ReadonlyMap<string, { title: string }>, suffix: string) => (
      <CanvasProvider label="Attributes" nodes={nodes}>
        <CanvasStage>
          <WorldNodes
            data={data}
            className="node"
            nodeAttributes={(id, item, level) => {
              attributes(id);
              return {
                role: 'button',
                'aria-label': `${item?.title} ${suffix}`,
                'data-level': level,
                className: level,
              };
            }}
            renderNode={(id, item) => {
              content(id);
              return item?.title;
            }}
          />
        </CanvasStage>
      </CanvasProvider>
    );
    const data = new Map([
      ['a', a],
      ['b', b],
    ]);
    const result = render(view(data, 'initial'));
    await frame();
    expect(screen.getByRole('button', { name: 'A initial' }).className).toBe('node dom');
    attributes.mockClear();
    content.mockClear();
    result.rerender(view(data, 'updated'));
    expect(attributes).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    result.rerender(
      view(
        new Map([
          ['a', a],
          ['b', { title: 'B2' }],
        ]),
        'updated',
      ),
    );
    expect(attributes.mock.calls.map(([id]) => id)).toEqual(['b']);
    expect(content.mock.calls.map(([id]) => id)).toEqual(['b']);
    expect(screen.getByRole('button', { name: 'B2 updated' }).getAttribute('data-level')).toBe(
      'dom',
    );
    act(() => liveController().setCamera({ x: 0, y: 0, zoom: 0.5 }));
    await frame();
    expect(screen.getByRole('button', { name: 'A updated' }).getAttribute('data-level')).toBe(
      'compact',
    );
    expect(screen.getByRole('button', { name: 'B2 updated' }).className).toBe('node compact');
  });

  it('surfaces render errors for nodes that remain in the provider', async () => {
    render(
      <CanvasProvider label="Render errors" nodes={[node('a', 100)]}>
        <CanvasStage>
          <WorldNodes
            data={new Map()}
            renderNode={(id, item) => {
              if (!item) throw new Error(`Visible card ${id} has no data`);
              return item;
            }}
          />
        </CanvasStage>
      </CanvasProvider>,
    );
    await expect(frame()).rejects.toThrow('Visible card a has no data');
  });

  it('refreshes a pinned node level without a global level change', async () => {
    const nodes = [node('a', 100)];
    const levels: string[] = [];
    render(
      <CanvasProvider label="Pinned levels" nodes={nodes}>
        <CanvasStage>
          <WorldNodes
            data={new Map()}
            renderNode={(_id, _item, level) => {
              levels.push(level);
              return level;
            }}
          />
        </CanvasStage>
      </CanvasProvider>,
    );
    await frame();
    act(() => liveController().setCamera({ x: 0, y: 0, zoom: 0.5 }));
    await frame();
    expect(levels.at(-1)).toBe('compact');
    act(() => liveController().setPinned('editing', ['a']));
    await frame();
    expect(levels.at(-1)).toBe('dom');
  });
});

describe('virtual outline', () => {
  it('refreshes default IDs when an offscreen node changes without mount changes', async () => {
    const view = (nodes: readonly CanvasNode[]) => (
      <CanvasProvider label="Offscreen outline" nodes={nodes}>
        <CanvasStage />
        <OutlinePanel rowHeight={28} height={100} label="Offscreen" renderRow={(id) => id} />
      </CanvasProvider>
    );
    const result = render(view([node('a', 100)]));
    await frame();
    result.rerender(view([node('a', 100), node('far', 10000)]));
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['a', 'far']);
    result.rerender(view([node('a', 100)]));
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['a']);
  });

  it('keeps 5,000 rows virtualized with positions and complete keyboard navigation', () => {
    const ids = Array.from({ length: 5000 }, (_, index) => `n${index}`);
    const activate = vi.fn();
    render(
      <OutlinePanel
        ids={ids}
        rowHeight={28}
        height={600}
        label="Outline"
        renderRow={(id) => id}
        onActivate={activate}
      />,
    );
    const list = screen.getByRole('listbox', { name: 'Outline' });
    expect(screen.getAllByRole('option').length).toBeLessThan(60);
    const first = screen.getByRole('option', { name: 'n0' });
    expect(first.getAttribute('aria-setsize')).toBe('5000');
    expect(first.getAttribute('aria-posinset')).toBe('1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('n1');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(document.activeElement?.textContent).toBe('n22');
    fireEvent.keyDown(list, { key: 'PageUp' });
    expect(document.activeElement?.textContent).toBe('n1');
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('n4999');
    expect(document.activeElement?.getAttribute('aria-posinset')).toBe('5000');
    expect(screen.getAllByRole('option').length).toBeLessThan(60);
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(activate).toHaveBeenLastCalledWith('n4999');
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: ' ' });
    expect(activate).toHaveBeenLastCalledWith('n0');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('n0');
  });

  it('uses the controller outline and activates through focus before selection', async () => {
    const nodes = [node('b', 200), node('a', 100)];
    render(
      <CanvasProvider label="Default outline" nodes={nodes}>
        <CanvasStage>
          <WorldNodes data={new Map()} renderNode={(id) => id} />
        </CanvasStage>
        <OutlinePanel rowHeight={28} height={100} label="All nodes" renderRow={(id) => id} />
      </CanvasProvider>,
    );
    await frame();
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['a', 'b']);
    fireEvent.keyDown(screen.getByRole('option', { name: 'a' }), { key: 'Enter' });
    await frame();
    expect(liveController().getFocus()).toBe('a');
    expect(liveController().getSelection()).toEqual(['a']);
  });
});
