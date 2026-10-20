// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, CanvasController } from '../../src/index.mjs';
import * as core from '../../src/index.mjs';
import { CanvasProvider, useCamera } from '../../src/react/provider.mjs';
import { CanvasStage } from '../../src/react/stage.mjs';

let controller: CanvasController | undefined;
let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;

beforeEach(() => {
  controller = undefined;
  callbacks = new Map();
  sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
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
    controller = create(options);
    vi.spyOn(controller, 'on');
    return controller;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function live(): CanvasController {
  if (!controller) throw new Error('Camera test controller was not created');
  return controller;
}

async function frame(): Promise<void> {
  await act(async () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(performance.now());
    await Promise.resolve();
  });
}

describe('camera selector subscriptions', () => {
  it('keeps one subscription across ten inline-selector rerenders', () => {
    function Selected({ offset }: { offset: number }) {
      const value = useCamera((camera) => camera.zoom + offset);
      return <output aria-label="Selection">{value}</output>;
    }
    const view = (offset: number) => (
      <CanvasProvider label="Stable subscription">
        <Selected offset={offset} />
      </CanvasProvider>
    );
    const result = render(view(0));
    for (let offset = 1; offset <= 10; offset += 1) {
      result.rerender(view(offset));
      expect(screen.getByLabelText('Selection').textContent).toBe(String(offset + 1));
    }
    const subscriptions = vi.mocked(live().on).mock.calls.filter(([event]) => event === 'camera');
    expect(subscriptions).toHaveLength(1);
  });

  it('recomputes once when a selector changes without camera movement', () => {
    const first = vi.fn((camera: Camera) => camera.zoom);
    const second = vi.fn((camera: Camera) => camera.x + 7);
    function Selected({ selector }: { selector: (camera: Camera) => number }) {
      return <output aria-label="Selection">{useCamera(selector)}</output>;
    }
    const view = (selector: (camera: Camera) => number) => (
      <CanvasProvider label="Selector changes">
        <Selected selector={selector} />
      </CanvasProvider>
    );
    const result = render(view(first));
    result.rerender(view(second));
    expect(screen.getByLabelText('Selection').textContent).toBe('7');
    expect(second).toHaveBeenCalledTimes(1);
    expect(vi.mocked(live().on).mock.calls.filter(([event]) => event === 'camera')).toHaveLength(1);
  });

  it('uses the latest comparator and preserves equal object snapshots across pans', async () => {
    const commits = vi.fn();
    let compareX = false;
    function Selected({ revision }: { revision: number }) {
      const value = useCamera(
        (camera) => ({ zoom: camera.zoom, x: camera.x }),
        (left, right) => left.zoom === right.zoom && (!compareX || left.x === right.x),
      );
      return (
        <Profiler id="selection" onRender={commits}>
          <output aria-label="Selection" data-revision={revision}>
            {value.x}
          </output>
        </Profiler>
      );
    }
    const view = (revision: number) => (
      <CanvasProvider label="Comparator changes">
        <CanvasStage />
        <Selected revision={revision} />
      </CanvasProvider>
    );
    const result = render(view(0));
    await frame();
    const beforePan = commits.mock.calls.length;
    act(() => live().panBy(5, 0));
    await frame();
    expect(commits).toHaveBeenCalledTimes(beforePan);
    expect(screen.getByLabelText('Selection').textContent).toBe('0');
    compareX = true;
    result.rerender(view(1));
    expect(screen.getByLabelText('Selection').textContent).toBe('5');
    expect(vi.mocked(live().on).mock.calls.filter(([event]) => event === 'camera')).toHaveLength(1);
  });

  it('keeps object snapshots stable during server rendering', () => {
    const select = vi.fn((camera: Camera) => ({ zoom: camera.zoom }));
    function Selected() {
      const selected = useCamera(select);
      return <output>{selected.zoom}</output>;
    }
    expect(
      renderToString(
        <CanvasProvider label="Server camera">
          <Selected />
        </CanvasProvider>,
      ),
    ).toContain('<output>1</output>');
    expect(select).toHaveBeenCalledTimes(1);
    expect(controller).toBeUndefined();
  });
});
