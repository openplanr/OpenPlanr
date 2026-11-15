// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
} from '../../../../apps/dashboard/src/design-system/components/console-planr.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';

let frames: FrameRequestCallback[];
const disposers: (() => void)[] = [];

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 1000 : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 520 : 0;
  });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFrames() {
  act(() => {
    for (const callback of frames.splice(0)) callback(0);
  });
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value unavailable');
  return value;
}

function node(index: number): GraphNode {
  const id = `T-${String(index).padStart(4, '0')}`;
  return {
    id,
    canonicalId: `SPEC-A/${id}`,
    type: 'task',
    label: `Task ${index}`,
    status: 'outstanding',
  };
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

function viewport(figure: HTMLElement, width = 800, height = 400) {
  Object.defineProperties(figure, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  fireEvent.scroll(figure);
}

describe('dependency graph navigation', () => {
  it('names nodes with the full rendered ID and title, keeping status out of the visible label', () => {
    const title =
      'Preserve the full artifact title for speech navigation even when its visual line is truncated';
    const artifact = { ...node(0), label: title, status: 'done' };
    const rendered = render(<DependencyGraph nodes={[artifact]} edges={[]} />);
    const button = rendered.getByRole('button', { name: `${artifact.id} ${title}`, exact: true });
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.querySelector('.pc-graph-node__label')?.textContent).toBe(title);
    expect(button.getAttribute('aria-description')).toBe('Done');
    expect(button.querySelector('.pc-artifact')?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('measures the real viewport before admitting any nodes and keeps that first painted set stable', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(index));
    const edges = nodes
      .slice(1)
      .map((item, index) => ({ from: required(nodes[index]).id, to: item.id }));
    const nodesAtMeasurement: number[] = [];
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      if (!this.classList.contains('pc-graph')) return 0;
      nodesAtMeasurement.push(this.querySelectorAll('.pc-graph-node').length);
      return 300;
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pc-graph') ? 200 : 0;
    });
    const rendered = render(<DependencyGraph nodes={nodes} edges={edges} />);
    expect(nodesAtMeasurement[0]).toBe(0);
    const painted = Array.from(rendered.container.querySelectorAll<HTMLElement>('.pc-graph-node'));
    expect(painted.map((item) => item.dataset.keyboardItem)).toEqual([
      'SPEC-A/T-0000',
      'SPEC-A/T-0001',
    ]);
    const geometry = painted.map((item) => item.style.cssText);
    flushFrames();
    fireEvent.scroll(rendered.getByRole('figure', { name: 'Dependency graph' }));
    expect(painted.every((item) => item.isConnected)).toBe(true);
    expect(painted.map((item) => item.style.cssText)).toEqual(geometry);
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(painted.length);
  });

  it('keeps a zero-size graph empty until ResizeObserver reports a visible viewport', () => {
    let width = 0;
    let height = 0;
    let notify: (() => void) | undefined;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pc-graph') ? width : 0;
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pc-graph') ? height : 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          notify = () => callback([], this);
        }
      },
    );
    const nodes = Array.from({ length: 20 }, (_, index) => node(index));
    const edges = nodes
      .slice(1)
      .map((item, index) => ({ from: required(nodes[index]).id, to: item.id }));
    const rendered = render(<DependencyGraph nodes={nodes} edges={edges} />);
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    const canvas = required(rendered.container.querySelector<HTMLElement>('.pc-graph__canvas'));
    const geometry = canvas.style.cssText;
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(0);
    expect(rendered.container.querySelectorAll('.pc-graph__edge')).toHaveLength(0);
    width = 300;
    act(() => required(notify)());
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(0);
    height = 200;
    act(() => required(notify)());
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(2);
    expect(rendered.container.querySelectorAll('.pc-graph__edge').length).toBeGreaterThan(0);
    expect(figure.style.height).toBe('520px');
    expect(canvas.style.cssText).toBe(geometry);
  });

  it('refits a focused component when its canvas narrows without a window resize and never culls it', () => {
    const nodes = Array.from({ length: 4 }, (_, index) => node(index));
    const edges = nodes
      .slice(1)
      .map((item, index) => ({ from: required(nodes[index]).id, to: item.id }));
    const focusedIds = new Set(nodes.map((item) => required(item.canonicalId)));
    let width = 1000;
    let notify: (() => void) | undefined;
    const observe = vi.fn();
    vi.stubGlobal('innerWidth', 1440);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pc-graph') ? width : 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          notify = () => callback([], this);
        }
      },
    );
    const rendered = render(
      <DependencyGraph nodes={nodes} edges={edges} focusedIds={focusedIds} />,
    );
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    const canvas = required(rendered.container.querySelector<HTMLElement>('.pc-graph__canvas'));
    const content = required(rendered.container.querySelector<HTMLElement>('.pc-graph__content'));
    expect(observe).toHaveBeenCalledExactlyOnceWith(figure, { box: 'border-box' });
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(4);
    const initialZoom = content.style.transform;
    width -= 344;
    act(() => required(notify)());
    expect(window.innerWidth).toBe(1440);
    expect(content.style.transform).not.toBe(initialZoom);
    expect(Number.parseFloat(canvas.style.width)).toBeLessThanOrEqual(width);
    expect(Number.parseFloat(canvas.style.height)).toBeLessThanOrEqual(figure.clientHeight);
    expect(figure.style.height).toBe('520px');
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(4);
    for (const item of rendered.container.querySelectorAll<HTMLElement>('.pc-graph-node')) {
      expect(item.style.visibility).toBe('');
      expect(item.hasAttribute('inert')).toBe(false);
    }
    fireEvent.click(rendered.getByRole('button', { name: 'Zoom in', exact: true }));
    flushFrames();
    const manualZoom = content.style.transform;
    Object.defineProperty(figure, 'clientHeight', { configurable: true, value: 500 });
    figure.scrollLeft = 8000;
    fireEvent.scroll(figure);
    expect(content.style.transform).toBe(manualZoom);
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(4);
    expect(rendered.container.querySelectorAll('.pc-graph-node[aria-hidden="true"]')).toHaveLength(
      0,
    );
    const panned = figure.scrollLeft;
    const zoom = content.style.transform;
    rendered.rerender(
      <DependencyGraph
        nodes={nodes.map((item) => ({ ...item, label: `${item.label} updated` }))}
        edges={edges}
        focusedIds={new Set(focusedIds)}
      />,
    );
    expect(figure.scrollLeft).toBe(panned);
    expect(content.style.transform).toBe(zoom);
    expect(figure.style.height).toBe('520px');
  });

  it('retains painted geometry while culling content and keyboard access outside the viewport', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => node(index));
    const rendered = render(
      <section data-route-kind="planning.graph">
        <DependencyGraph nodes={nodes} edges={[]} />
      </section>,
    );
    keyboard(rendered.container);
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    viewport(figure);
    const first = required(
      rendered.container.querySelector<HTMLElement>('[data-keyboard-item="SPEC-A/T-0000"]'),
    );
    const canvas = required(rendered.container.querySelector<HTMLElement>('.pc-graph__canvas'));
    const geometry = [first.style.left, first.style.top, first.style.width, first.style.height];
    const canvasGeometry = canvas.style.cssText;
    figure.scrollTop = 2000;
    fireEvent.scroll(figure);
    expect(first.isConnected).toBe(true);
    expect([first.style.left, first.style.top, first.style.width, first.style.height]).toEqual(
      geometry,
    );
    expect(first.style.visibility).toBe('hidden');
    expect(first.getAttribute('aria-hidden')).toBe('true');
    expect(first.hasAttribute('inert')).toBe(true);
    expect(first.tabIndex).toBe(-1);
    expect(first.textContent).toBe('');
    expect(canvas.style.cssText).toBe(canvasGeometry);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.hasAttribute('aria-hidden')).toBe(false);
    figure.scrollTop = 0;
    fireEvent.scroll(figure);
    expect(first.style.visibility).toBe('');
    expect(first.hasAttribute('inert')).toBe(false);
    expect(first.textContent).toContain('Task 0');
  });

  it('zooms the actual canvas, fits its bounds and pans through keyboard-operable controls', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(index));
    const rendered = render(<DependencyGraph nodes={nodes} edges={[]} height={400} />);
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    viewport(figure);
    const content = required(rendered.container.querySelector<HTMLElement>('.pc-graph__content'));
    const canvas = required(rendered.container.querySelector<HTMLElement>('.pc-graph__canvas'));
    expect(content.style.transform).toBe('scale(1)');
    fireEvent.click(rendered.getByRole('button', { name: 'Zoom in', exact: true }));
    expect(content.style.transform).toBe('scale(1.1)');
    expect(Number.parseFloat(canvas.style.height)).toBeGreaterThan(
      Number.parseFloat(content.style.height),
    );
    flushFrames();
    fireEvent.click(rendered.getByRole('button', { name: 'Pan down', exact: true }));
    expect(figure.scrollTop).toBeGreaterThan(0);
    fireEvent.click(rendered.getByRole('button', { name: 'Fit graph', exact: true }));
    expect(figure.scrollTop).toBe(0);
    expect(Number.parseFloat(canvas.style.height)).toBeLessThanOrEqual(400);
    expect(rendered.getByLabelText('Graph zoom').textContent).not.toBe('100%');
    for (let index = 0; index < 25; index += 1) {
      fireEvent.click(rendered.getByRole('button', { name: 'Zoom in', exact: true }));
    }
    const zoomIn = rendered.getByRole('button', {
      name: 'Zoom in',
      exact: true,
    }) as HTMLButtonElement;
    expect(zoomIn.disabled).toBe(true);
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect(zoomIn.title).toBe('Maximum zoom reached');
  });

  it('uses the minimap to move the viewport and its keyboard activation to reveal selection', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => node(index));
    const rendered = render(
      <DependencyGraph nodes={nodes} edges={[]} selectedId={nodes[29]?.canonicalId} />,
    );
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    viewport(figure);
    const minimap = rendered.getByRole('button', { name: 'Graph minimap, center viewport' });
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 148,
      height: 88,
    } as DOMRect);
    fireEvent.click(minimap, { detail: 1, clientX: 74, clientY: 70 });
    expect(figure.scrollTop).toBeGreaterThan(1000);
    fireEvent.click(minimap, { detail: 0 });
    const selected = required(
      rendered.container.querySelector<HTMLElement>('[data-keyboard-item="SPEC-A/T-0029"]'),
    );
    expect(figure.scrollTop).toBe(Number(selected.dataset.y) + 33 - 200);
  });

  it('retains connected offscreen neighbours for canonical arrow navigation through a cycle', () => {
    const nodes = Array.from({ length: 18 }, (_, index) => node(index));
    const edges: GraphEdge[] = nodes
      .slice(1, 16)
      .map((item, index) => ({ from: required(nodes[index]).id, to: item.id, kind: 'depends_on' }));
    edges.push({ from: required(nodes[16]).id, to: required(nodes[17]).id, kind: 'depends_on' });
    edges.push({ from: required(nodes[17]).id, to: required(nodes[16]).id, kind: 'depends_on' });
    const rendered = render(
      <section data-route-kind="planning.graph">
        <DependencyGraph nodes={nodes} edges={edges} />
      </section>,
    );
    const announce = keyboard(rendered.container);
    expect(rendered.container.querySelectorAll('.pc-graph-node').length).toBeLessThan(nodes.length);
    const item = (index: number) =>
      required(
        rendered.container.querySelector<HTMLElement>(
          `[data-keyboard-item="${required(nodes[index]).canonicalId}"]`,
        ),
      );
    act(() => item(0).focus());
    for (let index = 0; index < 15; index += 1) {
      expect(item(index + 1)).toBeTruthy();
      const current = required(document.activeElement);
      fireEvent.keyDown(current, { key: 'ArrowRight' });
      expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe(
        required(nodes[index + 1]).canonicalId,
      );
    }
    act(() => item(16).focus());
    fireEvent.keyDown(item(16), { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe(
      required(nodes[17]).canonicalId,
    );
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/no connected/i));
  });

  it('reveals the focused node using the scoped layout committed during the focus event', () => {
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
          <DependencyGraph nodes={visible} edges={[]} selectedId={selected.canonicalId} />
        </section>
      );
    }
    const rendered = render(<Scope />);
    keyboard(rendered.container);
    const figure = rendered.getByRole('figure', { name: 'Dependency graph' });
    viewport(figure);
    const current = required(
      rendered.container.querySelector<HTMLElement>(
        `[data-keyboard-item="${selected.canonicalId}"]`,
      ),
    );
    act(() => current.focus());
    fireEvent.keyDown(current, { key: 'f' });
    flushFrames();
    expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(1);
    expect(figure.scrollTop).toBe(0);
  });

  it('keeps every node and relationship reachable in the cycle-safe structural list', () => {
    const nodes = [node(0), node(1)];
    const edges = [
      { from: required(nodes[0]).id, to: required(nodes[1]).id },
      { from: required(nodes[1]).id, to: required(nodes[0]).id },
    ];
    const select = vi.fn();
    const rendered = render(
      <DependencyGraph nodes={nodes} edges={edges} view="outline" onSelect={select} />,
    );
    expect(rendered.container.querySelectorAll('[data-keyboard-item]')).toHaveLength(2);
    expect(rendered.getByRole('region', { name: 'Graph structural list' }).textContent).toContain(
      'depends on T-0000',
    );
    fireEvent.click(rendered.getByRole('button', { name: /Task 1/u }));
    expect(select).toHaveBeenCalledWith(required(nodes[1]).id);
  });

  it('keeps source relationship statements intact when prerequisites are laid out first', () => {
    const nodes = [node(0), node(1)];
    const edges = [{ from: required(nodes[0]).id, to: required(nodes[1]).id, kind: 'depends_on' }];
    const rendered = render(
      <DependencyGraph nodes={nodes} edges={edges} flow="target-to-source" view="outline" />,
    );
    const dependent = rendered.getByRole('button', { name: /Task 0/u }).closest('li');
    const prerequisite = rendered.getByRole('button', { name: /Task 1/u }).closest('li');
    expect(dependent?.textContent).toContain('depends on T-0001');
    expect(prerequisite?.textContent).not.toContain('depends on T-0000');
  });

  it('lays out the five-thousand-node depth tier without recursive stack overflow or full DOM admission', () => {
    const nodes = Array.from({ length: 5000 }, (_, index) => node(index));
    const edges = nodes
      .slice(1)
      .map((item, index) => ({ from: required(nodes[index]).id, to: item.id }));
    const rendered = render(<DependencyGraph nodes={nodes} edges={edges} />);
    expect(rendered.container.querySelectorAll('.pc-graph-node').length).toBeLessThan(20);
    expect(rendered.container.querySelectorAll('.pc-graph__edge').length).toBeLessThan(20);
  });
});
