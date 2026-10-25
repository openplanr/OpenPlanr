// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOverviewLayer,
  drawCameraOverview,
  drawMinimap,
  minimapToWorld,
} from '../src/overview.mjs';
import type { CanvasNode } from '../src/types.mjs';

function drawingContext() {
  const canvas = document.createElement('canvas');
  const operations: unknown[][] = [];
  const context = {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(function (this: { fillStyle: string }, ...args: number[]) {
      operations.push(['fill', this.fillStyle, ...args]);
    }),
    strokeRect: vi.fn(function (
      this: { strokeStyle: string; lineWidth: number },
      ...args: number[]
    ) {
      operations.push(['stroke', this.strokeStyle, this.lineWidth, ...args]);
    }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, context: context as unknown as CanvasRenderingContext2D, operations };
}

const style = () => ({ fill: 'red', stroke: 'blue' });
const nodes: CanvasNode[] = [
  { id: 'a', bounds: { x: 100, y: -50, width: 200, height: 100 } },
  { id: 'b', bounds: { x: 400, y: -50, width: 100, height: 100 } },
];

afterEach(() => vi.restoreAllMocks());

describe('overview drawing', () => {
  it('uses the off-centre camera, DPR, product colours, selection and focus', () => {
    const { context, operations } = drawingContext();
    drawCameraOverview(
      context,
      {
        nodes,
        edges: [{ id: 'ab', from: 'a', to: 'b', style: 'normal' }],
        camera: { x: 80, y: -70, zoom: 0.37 },
        selection: ['a'],
        focus: 'b',
        style,
      },
      { width: 800, height: 600, devicePixelRatio: 2 },
    );
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(operations[0]).toEqual(['fill', 'red', 7.399999999999999, 7.399999999999999, 74, 37]);
    expect(operations.filter((entry) => entry[0] === 'stroke' && entry[2] === 2)).toHaveLength(1);
    expect(operations.filter((entry) => entry[0] === 'stroke' && entry[2] === 3)).toHaveLength(1);
    expect(context.moveTo).toHaveBeenCalledWith(44.4, 25.9);
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it('uses system colours in forced-colours mode', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const { context, operations } = drawingContext();
    drawCameraOverview(
      context,
      { nodes, edges: [], camera: { x: 0, y: 0, zoom: 1 }, selection: ['a'], focus: 'b', style },
      { width: 800, height: 600, devicePixelRatio: 1 },
    );
    expect(operations[0]?.[1]).toBe('CanvasText');
    expect(operations.filter((entry) => entry[1] === 'Highlight')).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it.each([
    [nodes, { scale: 0.5, offsetX: -50, offsetY: 100 }],
    [
      [{ id: 'tall', bounds: { x: -40, y: 100, width: 100, height: 400 } }],
      { scale: 0.5, offsetX: 95, offsetY: -50 },
    ],
  ] as const)(
    'fits and letterboxes wide and tall worlds and inverts clicks',
    (inputNodes, expected) => {
      const { context } = drawingContext();
      const transform = drawMinimap(
        context,
        {
          nodes: inputNodes,
          edges: [],
          viewport: { x: 20, y: 30, width: 40, height: 50 },
          selection: [],
          style,
        },
        { width: 200, height: 200, devicePixelRatio: 2 },
      );
      expect(transform).toEqual(expected);
      for (const world of [
        { x: -50, y: 120 },
        { x: 463.25, y: -19.75 },
      ]) {
        const inverse = minimapToWorld(transform, {
          x: world.x * transform.scale + transform.offsetX,
          y: world.y * transform.scale + transform.offsetY,
        });
        expect(Math.abs(inverse.x - world.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(inverse.y - world.y)).toBeLessThanOrEqual(0.5);
      }
      expect(context.strokeRect).toHaveBeenLastCalledWith(
        20 * expected.scale + expected.offsetX,
        30 * expected.scale + expected.offsetY,
        40 * expected.scale,
        50 * expected.scale,
      );
    },
  );

  it('returns an invertible transform for empty and zero-area worlds', () => {
    const { context } = drawingContext();
    for (const inputNodes of [
      [],
      [{ id: 'point', bounds: { x: 30, y: 40, width: 0, height: 0 } }],
    ]) {
      const transform = drawMinimap(
        context,
        {
          nodes: inputNodes,
          edges: [],
          viewport: { x: 0, y: 0, width: 1, height: 1 },
          selection: [],
          style,
        },
        { width: 200, height: 100, devicePixelRatio: 1 },
      );
      expect(Number.isFinite(transform.scale)).toBe(true);
      expect(minimapToWorld(transform, { x: transform.offsetX, y: transform.offsetY })).toEqual({
        x: 0,
        y: 0,
      });
    }
  });

  it.each([NaN, Infinity, -1])(
    'rejects malformed node bounds in both public renderers (%s)',
    (width) => {
      const { context } = drawingContext();
      const malformed = [{ id: 'invalid', bounds: { x: 0, y: 0, width, height: 20 } }];
      const input = { nodes: malformed, edges: [], selection: [], style };
      const target = { width: 200, height: 100, devicePixelRatio: 1 };
      expect(() =>
        drawCameraOverview(
          context,
          { ...input, camera: { x: 0, y: 0, zoom: 1 }, focus: null },
          target,
        ),
      ).toThrow(new RegExp(`node.invalid.bounds.width.*${String(width)}`, 'u'));
      expect(() =>
        drawMinimap(context, { ...input, viewport: { x: 0, y: 0, width: 20, height: 20 } }, target),
      ).toThrow(new RegExp(`node.invalid.bounds.width.*${String(width)}`, 'u'));
    },
  );

  it('rejects invalid transforms and targets with their field values', () => {
    const { context } = drawingContext();
    expect(() => minimapToWorld({ scale: 0, offsetX: 0, offsetY: 0 }, { x: 0, y: 0 })).toThrow(
      /transform.scale.*0/u,
    );
    expect(() =>
      drawCameraOverview(
        context,
        { nodes, edges: [], camera: { x: 0, y: 0, zoom: 1 }, selection: [], focus: null, style },
        { width: 20, height: 20, devicePixelRatio: NaN },
      ),
    ).toThrow(/target.devicePixelRatio.*NaN/u);
  });
});

describe('overview bitmap cache', () => {
  it('moves the compositor without redrawing until the viewport exits the cache', () => {
    const { canvas, context } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    const queryNodes = vi.fn(() => nodes);
    const input = {
      nodes,
      edges: [],
      camera: { x: 80, y: -70, zoom: 0.36 },
      selection: [],
      focus: null,
      pinned: new Set<string>(),
      frame: 1,
      width: 800,
      height: 600,
      devicePixelRatio: 2,
      queryNodes,
    };
    expect(layer.update(input)).toBe(true);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_194_304);
    expect(layer.metrics().cachePixelBytes).toBe(canvas.width * canvas.height * 4);
    layer.update({ ...input, frame: 2, camera: { ...input.camera, x: 90 } });
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(queryNodes).toHaveBeenCalledOnce();
    expect(canvas.style.transform).toContain('translate(');
    layer.update({ ...input, frame: 3, camera: { ...input.camera, x: 5000 } });
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    layer.update({ ...input, frame: 4, nodes: [...nodes] });
    expect(context.clearRect).toHaveBeenCalledTimes(3);
    layer.update({ ...input, frame: 5, camera: { ...input.camera, zoom: 0.2 } });
    expect(context.clearRect).toHaveBeenCalledTimes(4);
    expect(layer.metrics().presentedCameraFrame).toBe(5);
    layer.dispose();
    expect(layer.metrics().cachePixelBytes).toBe(0);
    expect(() => layer.update(input)).toThrow(/disposed/u);
  });

  const cacheInput = {
    nodes,
    edges: [],
    camera: { x: 80, y: -70, zoom: 0.36 },
    selection: [],
    focus: null,
    pinned: [],
    frame: 1,
    width: 800,
    height: 600,
    devicePixelRatio: 1,
  };

  function centeredCamera(zoom: number) {
    return {
      x:
        cacheInput.camera.x +
        cacheInput.width / (2 * cacheInput.camera.zoom) -
        cacheInput.width / (2 * zoom),
      y:
        cacheInput.camera.y +
        cacheInput.height / (2 * cacheInput.camera.zoom) -
        cacheInput.height / (2 * zoom),
      zoom,
    };
  }

  it('reuses the cached zoom band during active frames and redraws once on settling', () => {
    const { canvas, context } = drawingContext();
    const widthWrites = vi.spyOn(canvas, 'width', 'set');
    const heightWrites = vi.spyOn(canvas, 'height', 'set');
    const layer = createOverviewLayer(canvas, style);
    layer.update({ ...cacheInput, zooming: true });
    for (let frame = 2; frame <= 21; frame += 1) {
      const zoom = 0.36 + (frame - 1) * 0.012;
      layer.update({ ...cacheInput, frame, zooming: true, camera: centeredCamera(zoom) });
    }
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(widthWrites).toHaveBeenCalledOnce();
    expect(heightWrites).toHaveBeenCalledOnce();
    const settled = { ...cacheInput, frame: 22, zooming: false, camera: centeredCamera(0.6) };
    layer.update(settled);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    layer.update({ ...settled, frame: 23 });
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    expect(widthWrites).toHaveBeenCalledOnce();
    expect(heightWrites).toHaveBeenCalledOnce();
    layer.update({ ...cacheInput, frame: 24, zooming: true, camera: centeredCamera(1.21) });
    expect(context.clearRect).toHaveBeenCalledTimes(3);
    layer.dispose();
  });

  it('redraws on a relative zoom-band exit even while the viewport remains inside the cache', () => {
    const { canvas, context } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    layer.update({ ...cacheInput, zooming: true });
    layer.update({ ...cacheInput, frame: 2, zooming: true, camera: centeredCamera(0.72) });
    expect(context.clearRect).toHaveBeenCalledOnce();
    layer.update({ ...cacheInput, frame: 3, zooming: true, camera: centeredCamera(0.721) });
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    layer.dispose();
  });

  it.each([
    [800, 600, 1],
    [800, 600, 2],
    [1440, 900, 1],
    [1440, 900, 2],
    [4000, 3000, 1],
    [4000, 3000, 2],
    [10000000, 1, 2],
  ])('caps backing pixels for a %sx%s viewport at DPR %s', (width, height, devicePixelRatio) => {
    const { canvas } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    layer.update({ ...cacheInput, width, height, devicePixelRatio });
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_194_304);
    expect(layer.metrics().cachePixelBytes).toBe(canvas.width * canvas.height * 4);
    const cssWidth = Number.parseFloat(canvas.style.width);
    const cssHeight = Number.parseFloat(canvas.style.height);
    expect(cssWidth).toBeGreaterThanOrEqual(width);
    expect(cssHeight).toBeGreaterThanOrEqual(height);
    expect(cssWidth).toBeLessThanOrEqual(width * 2);
    expect(cssHeight).toBeLessThanOrEqual(height * 2);
    if (width * height <= 4_194_304) {
      expect(canvas.width / cssWidth).toBeGreaterThanOrEqual(1);
      expect(canvas.height / cssHeight).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(canvas.width / cssWidth)).toBe(true);
      expect(Number.isInteger(canvas.height / cssHeight)).toBe(true);
    }
    if (width === 800 && height === 600 && devicePixelRatio === 1) {
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
    }
    layer.dispose();
  });

  it('keeps capped backing and compositor geometry aligned at both overview thresholds', () => {
    const { canvas, context, operations } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    const input = {
      ...cacheInput,
      width: 1440,
      height: 900,
      devicePixelRatio: 2,
      camera: { x: 80, y: -70, zoom: 0.37 },
      zooming: true,
    };
    layer.update(input);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_194_304);
    const cssWidth = Number.parseFloat(canvas.style.width);
    const cssHeight = Number.parseFloat(canvas.style.height);
    expect(canvas.width / cssWidth).toBeGreaterThanOrEqual(1);
    expect(canvas.height / cssHeight).toBeGreaterThanOrEqual(1);
    for (const zoom of [0.37, 0.43]) {
      const camera = {
        x: input.camera.x + input.width / (2 * input.camera.zoom) - input.width / (2 * zoom),
        y: input.camera.y + input.height / (2 * input.camera.zoom) - input.height / (2 * zoom),
        zoom,
      };
      layer.update({ ...input, camera });
      const transform = canvas.style.transform.match(
        /translate\(([^p]+)px, ([^p]+)px\) scale\(([^)]+)\)/u,
      );
      if (!transform)
        throw new Error(`Missing overview affine transform: ${canvas.style.transform}`);
      const translateX = Number(transform[1]);
      const translateY = Number(transform[2]);
      const scale = Number(transform[3]);
      const fills = operations.filter((entry) => entry[0] === 'fill');
      nodes.forEach((node, index) => {
        const fill = fills[index];
        if (!fill) throw new Error(`Missing rectangle for ${node.id}`);
        const left = Number(fill[2]) * scale + translateX;
        const top = Number(fill[3]) * scale + translateY;
        expect(Math.abs(left - (node.bounds.x - camera.x) * zoom)).toBeLessThanOrEqual(1);
        expect(Math.abs(top - (node.bounds.y - camera.y) * zoom)).toBeLessThanOrEqual(1);
        expect(Math.abs(Number(fill[4]) * scale - node.bounds.width * zoom)).toBeLessThanOrEqual(1);
        expect(Math.abs(Number(fill[5]) * scale - node.bounds.height * zoom)).toBeLessThanOrEqual(
          1,
        );
      });
    }
    expect(context.clearRect).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it('preserves a pan margin when the viewport itself exceeds the backing pixel cap', () => {
    const { canvas, context } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    const input = { ...cacheInput, width: 3840, height: 2160 };
    layer.update(input);
    for (let frame = 2; frame <= 11; frame += 1)
      layer.update({
        ...input,
        frame,
        camera: { ...input.camera, x: input.camera.x + frame * 10 },
      });
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(Number.parseFloat(canvas.style.width)).toBeGreaterThan(input.width);
    expect(Number.parseFloat(canvas.style.height)).toBeGreaterThan(input.height);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_194_304);
    layer.dispose();
  });

  it('invalidates selection, focus and forced colours without reallocating unchanged dimensions', () => {
    let forced = false;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: forced })),
    );
    const { canvas, context } = drawingContext();
    const widthWrites = vi.spyOn(canvas, 'width', 'set');
    const heightWrites = vi.spyOn(canvas, 'height', 'set');
    const layer = createOverviewLayer(canvas, style);
    layer.update(cacheInput);
    const selected = { ...cacheInput, selection: ['a'] };
    layer.update(selected);
    const focused = { ...selected, focus: 'b' };
    layer.update(focused);
    forced = true;
    layer.update(focused);
    expect(context.clearRect).toHaveBeenCalledTimes(4);
    expect(widthWrites).toHaveBeenCalledOnce();
    expect(heightWrites).toHaveBeenCalledOnce();
    layer.dispose();
    vi.unstubAllGlobals();
  });

  it('keeps long edges whose endpoints are outside the cached viewport', () => {
    const { canvas, context } = drawingContext();
    const layer = createOverviewLayer(canvas, style);
    layer.update({
      nodes,
      edges: [{ id: 'ab', from: 'a', to: 'b', style: 'normal' }],
      camera: { x: 250, y: -10, zoom: 0.36 },
      selection: [],
      focus: null,
      pinned: new Set(),
      frame: 1,
      width: 20,
      height: 20,
      devicePixelRatio: 1,
      queryNodes: () => [],
    });
    expect(context.moveTo).toHaveBeenCalledOnce();
    expect(context.lineTo).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it('surfaces unsupported worker rendering', () => {
    const { canvas } = drawingContext();
    expect(() => createOverviewLayer(canvas, style, 'worker')).toThrow(
      /Worker and OffscreenCanvas/u,
    );
  });
});

describe('worker presentation', () => {
  function workerHarness() {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal(
      'Worker',
      vi.fn(function workerConstructor(this: unknown) {
        return worker;
      }),
    );
    vi.stubGlobal('OffscreenCanvas', class {});
    function frame() {
      const scheduled = [...frames];
      frames.clear();
      for (const [, callback] of scheduled) callback(nextFrame * 16.7);
    }
    function bitmap(id: number) {
      const image = { close: vi.fn() };
      worker.onmessage?.({ data: { id, bitmap: image } } as MessageEvent);
      return image;
    }
    return { frame, bitmap, worker, frames };
  }
  const input = {
    nodes,
    edges: [],
    camera: { x: 80, y: -70, zoom: 0.36 },
    selection: [],
    focus: null,
    pinned: [],
    frame: 10,
    width: 800,
    height: 600,
    devicePixelRatio: 1,
  };

  it('counts actual presentation frames from the source camera and closes stale bitmaps', () => {
    const harness = workerHarness();
    const { canvas, context } = drawingContext();
    const onPresent = vi.fn();
    const layer = createOverviewLayer(canvas, style, 'worker', onPresent);
    expect(layer.update(input)).toBe(false);
    harness.frame();
    harness.frame();
    const stale = harness.bitmap(0);
    expect(stale.close).toHaveBeenCalledOnce();
    const image = harness.bitmap(1);
    expect(context.drawImage).not.toHaveBeenCalled();
    harness.frame();
    expect(image.close).toHaveBeenCalledOnce();
    expect(onPresent).toHaveBeenCalledOnce();
    expect(layer.metrics()).toMatchObject({
      cameraFrame: 10,
      presentedCameraFrame: 10,
      presentationLagFrames: [3],
    });
    expect(layer.update({ ...input, frame: 11, camera: { ...input.camera, x: 85 } })).toBe(true);
    expect(harness.worker.postMessage).toHaveBeenCalledTimes(2);
    expect(canvas.style.transform).toBe('none');
    layer.dispose();
    vi.unstubAllGlobals();
  });

  it('includes the first exposure frame when a completed bitmap is still hidden', () => {
    const harness = workerHarness();
    const { canvas, context } = drawingContext();
    canvas.style.visibility = 'hidden';
    const layer = createOverviewLayer(canvas, style, 'worker');
    layer.update(input);
    harness.frame();
    harness.frame();
    harness.bitmap(1);
    harness.frame();
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(layer.metrics()).toMatchObject({ presentedCameraFrame: 0, presentationLagFrames: [] });
    harness.frame();
    canvas.style.visibility = 'visible';
    layer.present();
    expect(layer.metrics()).toMatchObject({ presentedCameraFrame: 10, presentationLagFrames: [4] });
    layer.present();
    expect(layer.metrics().presentationLagFrames).toEqual([4]);
    layer.dispose();
    vi.unstubAllGlobals();
  });

  it('presents the completed source camera at the origin and coalesces queued camera writes', () => {
    const harness = workerHarness();
    const { canvas, context } = drawingContext();
    const widthWrites = vi.spyOn(canvas, 'width', 'set');
    const heightWrites = vi.spyOn(canvas, 'height', 'set');
    const layer = createOverviewLayer(canvas, style, 'worker');
    layer.update(input);
    harness.frame();
    layer.update({ ...input, frame: 11, camera: { ...input.camera, x: 85 } });
    harness.frame();
    layer.update({ ...input, frame: 12, camera: { ...input.camera, x: 90 } });
    expect(harness.worker.postMessage).toHaveBeenCalledOnce();
    const first = harness.bitmap(1);
    harness.frame();
    expect(first.close).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenLastCalledWith(first, 0, 0);
    expect(canvas.style.transform).toBe('none');
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(layer.metrics()).toMatchObject({
      cameraFrame: 12,
      presentedCameraFrame: 10,
      presentationLagFrames: [3],
      cachePixelBytes: 800 * 600 * 4,
    });
    expect(harness.worker.postMessage).toHaveBeenCalledTimes(2);
    expect(harness.worker.postMessage.mock.calls[0]?.[0]).toMatchObject({
      id: 1,
      camera: input.camera,
      target: { width: 800, height: 600 },
    });
    expect(harness.worker.postMessage.mock.calls[1]?.[0]).toMatchObject({
      id: 3,
      camera: { ...input.camera, x: 90 },
      target: { width: 800, height: 600 },
    });
    const stale = harness.bitmap(2);
    expect(stale.close).toHaveBeenCalledOnce();
    harness.bitmap(3);
    harness.frame();
    expect(layer.metrics()).toMatchObject({
      cameraFrame: 12,
      presentedCameraFrame: 12,
      presentationLagFrames: [3, 2],
    });
    expect(widthWrites).toHaveBeenCalledOnce();
    expect(heightWrites).toHaveBeenCalledOnce();
    layer.update({ ...input, frame: 13, camera: { ...input.camera, x: 90 } });
    expect(harness.worker.postMessage).toHaveBeenCalledTimes(2);
    expect(canvas.style.transform).toBe('none');
    layer.dispose();
    vi.unstubAllGlobals();
  });

  it('closes a bitmap awaiting presentation when disposed and surfaces worker errors', () => {
    const harness = workerHarness();
    const first = drawingContext();
    const layer = createOverviewLayer(first.canvas, style, 'worker');
    layer.update(input);
    const image = harness.bitmap(1);
    layer.dispose();
    expect(image.close).toHaveBeenCalledOnce();
    expect(harness.frames.size).toBe(0);
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
    const second = drawingContext();
    const failingLayer = createOverviewLayer(second.canvas, style, 'worker');
    failingLayer.update(input);
    harness.worker.onerror?.({ message: 'rasterization failed' });
    expect(() => failingLayer.update(input)).toThrow(
      'Overview worker failed: rasterization failed',
    );
    failingLayer.dispose();
    vi.unstubAllGlobals();
  });
});
