// @vitest-environment jsdom

import { ChromeProvider } from '@openplanr/canvas/react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type GraphEdge,
  type GraphNode,
  graphLayout,
} from '../../../../apps/dashboard/src/design-system/components/console-planr.js';
import {
  GraphCanvas,
  graphCanvasModel,
} from '../../../../apps/dashboard/src/features/planning/graph-canvas.js';
import { minimapFit } from '../../../../apps/dashboard/src/features/planning/graph-minimap.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import { routeSlotRef } from '../../../../apps/dashboard/src/features/shell/route-tools.js';
import {
  captureCanvasControllers,
  liveController,
  settleFrames,
  stubStageSize,
} from './fixtures/graph-canvas-harness.js';

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value unavailable');
  return value;
}

function node(index: number): GraphNode {
  const id = `T-${String(index).padStart(4, '0')}`;
  return {
    id,
    canonicalId: id,
    type: 'task',
    label: `Task ${index}`,
    status: 'outstanding',
  };
}

function chain(count: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: count }, (_, index) => node(index));
  return {
    nodes,
    edges: nodes.slice(1).map((item, index) => ({
      from: required(nodes[index]).id,
      to: item.id,
      kind: 'depends_on',
    })),
  };
}

type Props = Partial<ComponentProps<typeof GraphCanvas>> &
  Pick<ComponentProps<typeof GraphCanvas>, 'nodes' | 'edges'>;

function Graph(props: Props) {
  return (
    <section data-route-kind="planning.graph">
      <GraphCanvas
        flow="source-to-target"
        scope="scope"
        selectedId={null}
        onSelect={() => undefined}
        onFocusSelect={() => undefined}
        {...props}
      />
    </section>
  );
}

function keyboard(root: HTMLElement) {
  const announce = vi.fn();
  disposers.push(
    installKeyboardCoordinator(document, () => ({
      root,
      singleLetters: true,
      paletteOpen: false,
      togglePalette: vi.fn(),
      openHelp: vi.fn(),
      navigate: vi.fn(),
      closeInspector: () => false,
      selectedId: () => null,
      copy: async () => undefined,
      announce,
    })),
  );
  return announce;
}

/** Mounts a chrome slot the way the floating chrome does, for the minimap and the Outline. */
function chromeSlot(name: 'panel' | 'outline'): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  act(() => routeSlotRef(name)(element));
  disposers.push(() => {
    act(() => routeSlotRef(name)(null));
    element.remove();
  });
  return element;
}

function item(container: HTMLElement, id: string): HTMLElement {
  return required(container.querySelector<HTMLElement>(`[data-keyboard-item="${id}"]`));
}

describe('dependency graph on the canvas engine', () => {
  it('names nodes with the full rendered ID and title, keeping status out of the visible label', async () => {
    stubStageSize({ width: 1000, height: 600 });
    const title =
      'Preserve the full artifact title for speech navigation even when its visual line is truncated';
    const artifact = { ...node(0), label: title, status: 'done' };
    const rendered = render(<Graph nodes={[artifact]} edges={[]} />);
    await settleFrames();
    const button = rendered.getByRole('button', { name: `${artifact.id} ${title}`, exact: true });
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.querySelector('.pc-graph-node__label')?.textContent).toBe(title);
    expect(button.getAttribute('aria-description')).toBe('Done');
    expect(button.querySelector('.pc-artifact')?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('admits no nodes until the stage has a measured size', async () => {
    const size = { width: 0, height: 0 };
    stubStageSize(size);
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          observers.push(() => callback([], this));
        }
      },
    );
    const { nodes, edges } = chain(20);
    const rendered = render(<Graph nodes={nodes} edges={edges} />);
    await settleFrames();
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(0);
    size.width = 800;
    size.height = 400;
    act(() => {
      for (const notify of observers) notify();
    });
    window.dispatchEvent(new Event('resize'));
    await waitFor(() =>
      expect(rendered.container.querySelectorAll('.pc-graph-node').length).toBeGreaterThan(0),
    );
    expect(rendered.container.querySelector('.pc-graph-stage')?.getAttribute('style')).toBeNull();
  });

  it('keeps mounted geometry world-fixed while the camera pans and zooms', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    const { nodes, edges } = chain(4);
    const rendered = render(<Graph nodes={nodes} edges={edges} />);
    await settleFrames();
    const first = item(rendered.container, 'T-0000');
    const geometry = first.style.cssText;
    const world = required(rendered.container.querySelector<HTMLElement>('.canvas-world'));
    const camera = world.style.transform;
    act(() => liveController(created).panBy(40, 30));
    await settleFrames(2);
    expect(world.style.transform).not.toBe(camera);
    expect(first.isConnected).toBe(true);
    expect(first.style.cssText).toBe(geometry);
  });

  it('fits a new focus scope into the safe area once and keeps the camera across live geometry', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    const { nodes, edges } = chain(4);
    const rendered = render(<Graph nodes={nodes} edges={edges} scope="first" />);
    await settleFrames();
    const controller = liveController(created);
    const fitted = controller.getCamera();
    expect(fitted.zoom).toBeLessThanOrEqual(1);
    for (const id of nodes.map((entry) => entry.id)) {
      const box = item(rendered.container, id)
        .style.transform.match(/-?[\d.]+/gu)
        ?.map(Number);
      const corner = controller.worldToScreen({
        x: required(box)[0] ?? 0,
        y: required(box)[1] ?? 0,
      });
      expect(corner.x).toBeGreaterThanOrEqual(0);
      expect(corner.x + 230 * fitted.zoom).toBeLessThanOrEqual(1000);
    }
    act(() => controller.setCamera({ x: 300, y: 10, zoom: 0.7 }));
    rendered.rerender(
      <Graph
        nodes={nodes.map((entry) => ({ ...entry, label: `${entry.label} updated` }))}
        edges={edges}
        scope="first"
      />,
    );
    await settleFrames(4);
    expect(controller.getCamera()).toEqual({ x: 300, y: 10, zoom: 0.7 });
    expect(item(rendered.container, 'T-0000').textContent).toContain('Task 0 updated');
    rendered.rerender(<Graph nodes={nodes} edges={edges} scope="second" />);
    await waitFor(() => expect(controller.getCamera()).toEqual(fitted));
  });

  it('culls offscreen nodes from the DOM and keeps the pinned selection mounted', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 800, height: 400 });
    const nodes = Array.from({ length: 30 }, (_, index) => node(index));
    const rendered = render(<Graph nodes={nodes} edges={[]} selectedId="T-0000" />);
    await settleFrames();
    const controller = liveController(created);
    act(() => controller.setCamera({ x: 0, y: 0, zoom: 1 }));
    await settleFrames();
    expect(rendered.container.querySelector('[data-keyboard-item="T-0029"]')).toBeNull();
    act(() => controller.setCamera({ x: 0, y: 2400, zoom: 1 }));
    await settleFrames();
    expect(rendered.container.querySelector('[data-keyboard-item="T-0029"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-keyboard-item="T-0001"]')).toBeNull();
    const selected = item(rendered.container, 'T-0000');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(rendered.container.querySelectorAll('.pc-graph-node').length).toBeLessThan(30);
  });

  it('zooms at the pointer over a card within 0.0001 and 2 and pans from the keyboard', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    const { nodes, edges } = chain(6);
    const rendered = render(<Graph nodes={nodes} edges={edges} />);
    await settleFrames();
    const controller = liveController(created);
    const before = controller.getCamera().zoom;
    fireEvent.wheel(item(rendered.container, 'T-0000'), {
      deltaY: -40,
      ctrlKey: true,
      clientX: 200,
      clientY: 120,
    });
    await settleFrames(2);
    expect(controller.getCamera().zoom).toBeGreaterThan(before);
    for (let index = 0; index < 40; index += 1) act(() => controller.zoomAt(1.25));
    expect(controller.getCamera().zoom).toBe(2);
    for (let index = 0; index < 80; index += 1) act(() => controller.zoomAt(0.5));
    expect(controller.getCamera().zoom).toBe(0.0001);
    const stage = rendered.getByRole('group', { name: 'Dependency graph' });
    act(() => controller.setCamera({ x: 0, y: 0, zoom: 1 }));
    act(() => stage.focus());
    fireEvent.keyDown(stage, { key: 'ArrowDown', shiftKey: true });
    expect(controller.getCamera().y).toBeGreaterThan(0);
  });

  it('centres the stage on the clicked minimap point and reveals the selection from the keyboard', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    chromeSlot('panel');
    const { nodes, edges } = chain(30);
    const rendered = render(
      <ChromeProvider>
        <Graph nodes={nodes} edges={edges} selectedId="T-0029" />
      </ChromeProvider>,
    );
    await settleFrames();
    const controller = liveController(created);
    const minimap = rendered.getByRole('button', { name: 'Graph minimap, center viewport' });
    const canvas = required(minimap.querySelector('canvas'));
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 400, 188, 116));
    const start = controller.screenToWorld({ x: 0, y: 0 });
    const end = controller.screenToWorld({ x: 1000, y: 600 });
    const transform = minimapFit(
      graphCanvasModel(graphLayout(nodes, edges, 'source-to-target')).nodes,
      {
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y,
      },
    );
    fireEvent.click(minimap, { detail: 1, clientX: 600, clientY: 470 });
    const centre = controller.screenToWorld({ x: 500, y: 300 });
    const expected = {
      x: (100 - transform.offsetX) / transform.scale,
      y: (70 - transform.offsetY) / transform.scale,
    };
    const zoom = controller.getCamera().zoom;
    expect(Math.abs(centre.x - expected.x) * zoom).toBeLessThanOrEqual(2);
    expect(Math.abs(centre.y - expected.y) * zoom).toBeLessThanOrEqual(2);
    fireEvent.click(minimap, { detail: 0 });
    await settleFrames();
    const safe = controller.getSafeArea();
    const selected = graphCanvasModel(graphLayout(nodes, edges, 'source-to-target')).nodes.find(
      (entry) => entry.id === 'T-0029',
    );
    const middle = controller.worldToScreen({
      x: required(selected).bounds.x + 115,
      y: required(selected).bounds.y + 33,
    });
    expect(Math.abs(middle.x - (safe.x + safe.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(middle.y - (safe.y + safe.height / 2))).toBeLessThanOrEqual(2);
  });

  it('keeps the minimap viewport frame inside the map and draws one node well inside it', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1440, height: 900 });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    chromeSlot('panel');
    render(
      <ChromeProvider>
        <Graph nodes={[node(0)]} edges={[]} />
      </ChromeProvider>,
    );
    await settleFrames();
    const controller = liveController(created);
    const frame = required(document.querySelector<HTMLElement>('.pc-graph-minimap__viewport'));
    const [x, y] = required(
      /translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)/u.exec(frame.style.transform),
    )
      .slice(1)
      .map(Number);
    const width = Number.parseFloat(frame.style.width);
    const height = Number.parseFloat(frame.style.height);
    expect(required(x)).toBeGreaterThanOrEqual(-0.5);
    expect(required(y)).toBeGreaterThanOrEqual(-0.5);
    expect(required(x) + width).toBeLessThanOrEqual(188.5);
    expect(required(y) + height).toBeLessThanOrEqual(116.5);
    // The frame is the stage in minimap pixels, which gives the map scale for the 230 px card.
    const scale = width / (1440 / controller.getCamera().zoom);
    expect(230 * scale).toBeLessThan(188 / 2);
  });

  it('dispatches each arrow once through the engine along connected neighbours and a cycle', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    const nodes = Array.from({ length: 18 }, (_, index) => node(index));
    const edges: GraphEdge[] = nodes.slice(1, 16).map((entry, index) => ({
      from: required(nodes[index]).id,
      to: entry.id,
      kind: 'depends_on',
    }));
    edges.push({ from: required(nodes[16]).id, to: required(nodes[17]).id, kind: 'depends_on' });
    edges.push({ from: required(nodes[17]).id, to: required(nodes[16]).id, kind: 'depends_on' });
    const rendered = render(<Graph nodes={nodes} edges={edges} />);
    const announce = keyboard(rendered.container);
    await settleFrames();
    const controller = liveController(created);
    const handled = vi.spyOn(controller, 'handleKey');
    const moves: (string | null)[] = [];
    controller.on('focus', (id) => moves.push(id));
    await act(() => controller.focusNode('T-0000'));
    moves.length = 0;
    for (let index = 0; index < 15; index += 1) {
      const current = required(document.activeElement);
      fireEvent.keyDown(current, { key: 'ArrowRight' });
      await waitFor(() =>
        expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe(
          required(nodes[index + 1]).id,
        ),
      );
    }
    expect(moves).toHaveLength(15);
    // The coordinator forwards once; the engine's own stage listener sees the event consumed.
    expect(handled.mock.results.filter((result) => result.value === true)).toHaveLength(15);
    expect(announce).not.toHaveBeenCalled();
    fireEvent.keyDown(required(document.activeElement), { key: 'ArrowRight' });
    await waitFor(() => expect(rendered.getByRole('status').textContent).toBe('Edge of canvas'));
    await act(() => controller.focusNode('T-0016'));
    fireEvent.keyDown(item(rendered.container, 'T-0016'), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe('T-0017'),
    );
  });

  it('fits a graph-focus node into the scoped layout committed during the event', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1000, height: 600 });
    const nodes = Array.from({ length: 20 }, (_, index) => node(index));
    const selected = required(nodes[19]);
    function Scope() {
      const [visible, setVisible] = useState(nodes);
      const root = useRef<HTMLElement>(null);
      useEffect(() => {
        const element = required(root.current);
        const focus = () => setVisible([selected]);
        element.addEventListener('graph-focus', focus);
        return () => element.removeEventListener('graph-focus', focus);
      }, []);
      return (
        <section ref={root} data-route-kind="planning.graph">
          <GraphCanvas
            nodes={visible}
            edges={[]}
            flow="source-to-target"
            scope={String(visible.length)}
            selectedId={selected.id}
            onSelect={() => undefined}
            onFocusSelect={() => undefined}
          />
        </section>
      );
    }
    const rendered = render(<Scope />);
    await settleFrames();
    const controller = liveController(created);
    await act(() => controller.focusNode(selected.id));
    fireEvent(
      item(rendered.container, selected.id),
      new CustomEvent('graph-focus', { bubbles: true, detail: { id: selected.id } }),
    );
    await settleFrames();
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(1);
    const camera = controller.getCamera();
    expect(camera.zoom).toBe(1);
    const safe = controller.getSafeArea();
    const middle = controller.worldToScreen({ x: 48 + 115, y: 62 + 33 });
    expect(Math.abs(middle.x - (safe.x + safe.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle.y - (safe.y + safe.height / 2))).toBeLessThanOrEqual(1);
  });

  it('keeps every node and relationship reachable in the cycle-safe Outline', async () => {
    stubStageSize({ width: 1000, height: 600 });
    const outline = chromeSlot('outline');
    const nodes = [node(0), node(1)];
    const edges = [
      { from: required(nodes[0]).id, to: required(nodes[1]).id },
      { from: required(nodes[1]).id, to: required(nodes[0]).id },
    ];
    const focusSelect = vi.fn();
    render(<Graph nodes={nodes} edges={edges} onFocusSelect={focusSelect} />);
    await settleFrames();
    const options = outline.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(outline.textContent).toContain('depends on T-0000');
    act(() => required(options[1]).focus());
    fireEvent.keyDown(required(options[1]), { key: 'Enter' });
    await waitFor(() => expect(focusSelect).toHaveBeenCalledWith(required(nodes[1]).id));
    expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe(required(nodes[1]).id);
  });

  it('keeps source relationship statements intact when prerequisites are laid out first', async () => {
    stubStageSize({ width: 1000, height: 600 });
    const outline = chromeSlot('outline');
    const nodes = [node(0), node(1)];
    const edges = [{ from: required(nodes[0]).id, to: required(nodes[1]).id, kind: 'depends_on' }];
    render(<Graph nodes={nodes} edges={edges} flow="target-to-source" />);
    await settleFrames();
    const [dependent, prerequisite] = Array.from(
      outline.querySelectorAll<HTMLElement>('[role="option"]'),
    ).sort((left, right) => (left.textContent ?? '').localeCompare(right.textContent ?? ''));
    expect(dependent?.textContent).toContain('depends on T-0001');
    expect(prerequisite?.textContent).not.toContain('depends on T-0000');
  });

  it('lays out the five-thousand-node depth tier without recursive stack overflow or full DOM admission', async () => {
    stubStageSize({ width: 1440, height: 900 });
    const { nodes, edges } = chain(5000);
    const rendered = render(<Graph nodes={nodes} edges={edges} />);
    await settleFrames();
    expect(rendered.container.querySelectorAll('.pc-graph-node').length).toBeLessThan(20);
    expect(rendered.container.querySelectorAll('.canvas-edges path').length).toBeLessThanOrEqual(6);
  });
});
