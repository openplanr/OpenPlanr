import { finite, invalid, point, positive, rect, validateCamera } from './camera.mjs';
import { intersects } from './spatial-grid.mjs';
import type {
  Camera,
  CanvasEdge,
  CanvasNode,
  MinimapTransform,
  NodeId,
  OverviewStyle,
  Point,
  Rect,
} from './types.mjs';

type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Target = Readonly<{ width: number; height: number; devicePixelRatio: number }>;
type Drawing = Readonly<{
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  selection: readonly NodeId[];
  style: OverviewStyle;
}>;

function validateTarget(target: Target): void {
  positive('target.width', target.width);
  positive('target.height', target.height);
  positive('target.devicePixelRatio', target.devicePixelRatio);
}

function forcedColors(context: DrawContext): boolean {
  return (
    'ownerDocument' in context.canvas &&
    context.canvas.ownerDocument.defaultView?.matchMedia?.('(forced-colors: active)').matches ===
      true
  );
}

function drawEdges(
  context: DrawContext,
  input: Drawing,
  transform: MinimapTransform,
  forced: boolean,
): void {
  const { scale, offsetX, offsetY } = transform;
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  context.lineWidth = 1;
  context.strokeStyle = forced ? 'CanvasText' : '#6b7280';
  context.beginPath();
  for (const edge of input.edges) {
    const from = byId.get(edge.from)?.bounds;
    const to = byId.get(edge.to)?.bounds;
    const points =
      edge.points ??
      (from && to
        ? [
            { x: from.x + from.width / 2, y: from.y + from.height / 2 },
            { x: to.x + to.width / 2, y: to.y + to.height / 2 },
          ]
        : []);
    points.forEach((value, index) => {
      const x = value.x * scale + offsetX;
      const y = value.y * scale + offsetY;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
  }
  context.stroke();
}

function draw(
  context: DrawContext,
  input: Drawing,
  transform: MinimapTransform,
  focus: NodeId | null,
  forced: boolean,
): void {
  const { scale, offsetX, offsetY } = transform;
  drawEdges(context, input, transform, forced);
  const selection = new Set(input.selection);
  for (const node of input.nodes) {
    rect(`node.${node.id}.bounds`, node.bounds);
    const style = input.style(node);
    const { x, y, width, height } = node.bounds;
    const left = x * scale + offsetX;
    const top = y * scale + offsetY;
    const w = width * scale;
    const h = height * scale;
    context.fillStyle = forced ? 'CanvasText' : style.fill;
    context.strokeStyle = forced ? 'CanvasText' : style.stroke;
    context.lineWidth = 1;
    context.fillRect(left, top, w, h);
    if (w >= 1 && h >= 1) context.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
    if (selection.has(node.id) || focus === node.id) {
      context.strokeStyle = forced ? 'Highlight' : style.stroke;
      context.lineWidth = focus === node.id ? 3 : 2;
      context.strokeRect(left - 2, top - 2, w + 4, h + 4);
    }
  }
}

export function drawCameraOverview(
  context: CanvasRenderingContext2D,
  input: Drawing & Readonly<{ camera: Camera; focus: NodeId | null }>,
  target: Target,
): void {
  validateTarget(target);
  validateCamera(input.camera);
  paintCameraOverview(context, input, target, target.devicePixelRatio, target.devicePixelRatio);
}

function paintCameraOverview(
  context: CanvasRenderingContext2D,
  input: Drawing & Readonly<{ camera: Camera; focus: NodeId | null }>,
  target: Target,
  scaleX: number,
  scaleY: number,
): void {
  context.save();
  try {
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    const { zoom, x, y } = input.camera;
    draw(
      context,
      input,
      { scale: zoom, offsetX: -x * zoom, offsetY: -y * zoom },
      input.focus,
      forcedColors(context),
    );
  } finally {
    context.restore();
  }
}

export function drawMinimap(
  context: CanvasRenderingContext2D,
  input: Drawing & Readonly<{ viewport: Rect }>,
  target: Target,
): MinimapTransform {
  validateTarget(target);
  rect('viewport', input.viewport);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of input.nodes) {
    left = Math.min(left, node.bounds.x);
    top = Math.min(top, node.bounds.y);
    right = Math.max(right, node.bounds.x + node.bounds.width);
    bottom = Math.max(bottom, node.bounds.y + node.bounds.height);
  }
  if (!input.nodes.length) left = top = right = bottom = 0;
  const width = right - left;
  const height = bottom - top;
  const scale =
    width || height
      ? Math.min(
          width ? target.width / width : Infinity,
          height ? target.height / height : Infinity,
        )
      : 1;
  const transform = {
    scale,
    offsetX: (target.width - width * scale) / 2 - left * scale,
    offsetY: (target.height - height * scale) / 2 - top * scale,
  };
  context.save();
  try {
    context.setTransform(target.devicePixelRatio, 0, 0, target.devicePixelRatio, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    const forced = forcedColors(context);
    draw(context, input, transform, null, forced);
    context.strokeStyle = forced ? 'Highlight' : '#2563eb';
    context.lineWidth = 1;
    context.strokeRect(
      input.viewport.x * scale + transform.offsetX,
      input.viewport.y * scale + transform.offsetY,
      input.viewport.width * scale,
      input.viewport.height * scale,
    );
  } finally {
    context.restore();
  }
  return transform;
}

export function minimapToWorld(transform: MinimapTransform, value: Point): Point {
  positive('transform.scale', transform.scale);
  finite('transform.offsetX', transform.offsetX);
  finite('transform.offsetY', transform.offsetY);
  point('point', value);
  return {
    x: (value.x - transform.offsetX) / transform.scale,
    y: (value.y - transform.offsetY) / transform.scale,
  };
}

type LayerInput = Target &
  Readonly<{
    camera: Camera;
    nodes: readonly CanvasNode[];
    edges: readonly CanvasEdge[];
    selection: readonly NodeId[];
    focus: NodeId | null;
    pinned: ReadonlySet<NodeId> | readonly NodeId[];
    frame: number;
    zooming?: boolean;
    queryNodes?: (region: Rect) => readonly CanvasNode[];
  }>;

type Cache = Readonly<{
  input: LayerInput;
  camera: Camera;
  region: Rect;
  forced: boolean;
}>;

function reusable(cache: Cache, input: LayerInput, forced: boolean, viewport: Rect): boolean {
  return (
    cache.input.nodes === input.nodes &&
    cache.input.edges === input.edges &&
    cache.input.selection.join('\0') === input.selection.join('\0') &&
    cache.input.focus === input.focus &&
    cache.input.width === input.width &&
    cache.input.height === input.height &&
    cache.input.devicePixelRatio === input.devicePixelRatio &&
    input.camera.zoom / cache.camera.zoom >= 0.5 &&
    input.camera.zoom / cache.camera.zoom <= 2 &&
    cache.forced === forced &&
    viewport.x >= cache.region.x &&
    viewport.y >= cache.region.y &&
    viewport.x + viewport.width <= cache.region.x + cache.region.width &&
    viewport.y + viewport.height <= cache.region.y + cache.region.height
  );
}

const MAX_CACHE_PIXELS = 4_194_304;

function cacheTarget(input: Target): Target {
  const viewportPixels = input.width * input.height;
  const factor =
    viewportPixels > MAX_CACHE_PIXELS
      ? 2
      : Math.min(2, Math.sqrt(MAX_CACHE_PIXELS / viewportPixels));
  return {
    width: input.width + 2 * Math.floor((input.width * (factor - 1)) / 2),
    height: input.height + 2 * Math.floor((input.height * (factor - 1)) / 2),
    devicePixelRatio: input.devicePixelRatio,
  };
}

export type WorkerDrawing = Readonly<{
  id: number;
  nodes: readonly Readonly<{ node: CanvasNode; fill: string; stroke: string }>[];
  edges: readonly CanvasEdge[];
  selection: readonly NodeId[];
  focus: NodeId | null;
  camera: Camera;
  target: Target;
  forced: boolean;
}>;

export function drawWorkerOverview(context: DrawContext, input: WorkerDrawing): void {
  context.setTransform(input.target.devicePixelRatio, 0, 0, input.target.devicePixelRatio, 0, 0);
  context.clearRect(0, 0, input.target.width, input.target.height);
  const styles = new Map(input.nodes.map((entry) => [entry.node.id, entry]));
  draw(
    context,
    {
      nodes: input.nodes.map((entry) => entry.node),
      edges: input.edges,
      selection: input.selection,
      style(node) {
        const style = styles.get(node.id);
        if (!style) throw new Error(`Overview style missing for node ${node.id}`);
        return style;
      },
    },
    {
      scale: input.camera.zoom,
      offsetX: -input.camera.x * input.camera.zoom,
      offsetY: -input.camera.y * input.camera.zoom,
    },
    input.focus,
    input.forced,
  );
}

export function createOverviewLayer(
  canvas: HTMLCanvasElement,
  style: OverviewStyle = () => ({ fill: '#e5e7eb', stroke: '#6b7280' }),
  renderer: 'canvas' | 'worker' = 'canvas',
  onPresent?: () => void,
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Overview canvas 2D context is unavailable');
  const ownerView = canvas.ownerDocument.defaultView;
  if (!ownerView) throw new Error('Overview canvas requires a window');
  const view = ownerView;
  if (renderer !== 'canvas' && renderer !== 'worker') invalid('overviewRenderer', renderer);
  const originalStyle = canvas.getAttribute('style');
  Object.assign(canvas.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    willChange: 'transform',
  });
  let worker: Worker | undefined;
  if (renderer === 'worker') {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function')
      throw new Error('Overview worker renderer requires Worker and OffscreenCanvas');
    worker = new Worker(new URL('./overview-worker.mjs', import.meta.url), { type: 'module' });
  }
  let cache: Cache | undefined;
  let zoomWasActive = false;
  type WorkerJob = Readonly<{ drawing: WorkerDrawing; frame: number; sourceTick: number }>;
  let pending: WorkerJob | undefined;
  let queued: WorkerJob | undefined;
  let awaitingPresentation: WorkerJob | undefined;
  let lastWorkerScene: Readonly<{ input: LayerInput; forced: boolean }> | undefined;
  let workerReady = false;
  let requestId = 0;
  let frameClock = 0;
  let clockRequest = 0;
  let presentationRequest = 0;
  let waitingBitmap: ImageBitmap | undefined;
  let disposed = false;
  let redraws = 0;
  let cameraFrame = 0;
  let presentedCameraFrame = 0;
  let cachePixelBytes = 0;
  const presentationLagFrames: number[] = [];
  let workerError: Error | undefined;

  function position(current: Cache, input: LayerInput) {
    const scale = input.camera.zoom / current.camera.zoom;
    canvas.style.transform = `translate(${(current.camera.x - input.camera.x) * input.camera.zoom}px, ${(current.camera.y - input.camera.y) * input.camera.zoom}px) scale(${scale})`;
  }
  function size(target: Target, capped: boolean) {
    const { width, height, devicePixelRatio } = target;
    let pixelWidth = Math.ceil(width * devicePixelRatio);
    let pixelHeight = Math.ceil(height * devicePixelRatio);
    if (capped && pixelWidth * pixelHeight > MAX_CACHE_PIXELS) {
      const availableDensity = Math.min(
        devicePixelRatio,
        Math.sqrt(MAX_CACHE_PIXELS / (width * height)),
      );
      // Whole CSS-pixel density avoids resampling a fresh bitmap at the layer handoff.
      const density = availableDensity >= 1 ? Math.floor(availableDensity) : availableDensity;
      pixelWidth = Math.min(MAX_CACHE_PIXELS, Math.max(1, Math.floor(width * density)));
      pixelHeight = Math.min(
        Math.floor(MAX_CACHE_PIXELS / pixelWidth),
        Math.max(1, Math.floor(height * density)),
      );
    }
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    cachePixelBytes = canvas.width * canvas.height * 4;
    return { scaleX: pixelWidth / width, scaleY: pixelHeight / height };
  }
  function scene(input: LayerInput, region: Rect) {
    const nodes =
      input.queryNodes?.(region) ?? input.nodes.filter((node) => intersects(node.bounds, region));
    const byId = new Map(input.nodes.map((node) => [node.id, node.bounds]));
    const edges = input.edges.flatMap((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return [];
      return [
        {
          ...edge,
          points: edge.points ?? [
            { x: from.x + from.width / 2, y: from.y + from.height / 2 },
            { x: to.x + to.width / 2, y: to.y + to.height / 2 },
          ],
        },
      ];
    });
    return { nodes, edges };
  }
  function tick() {
    frameClock += 1;
    clockRequest = pending || awaitingPresentation ? view.requestAnimationFrame(tick) : 0;
  }
  function recordPresentation(job: WorkerJob) {
    presentedCameraFrame = job.frame;
    presentationLagFrames.push(frameClock - job.sourceTick);
  }
  function dispatch(job: WorkerJob) {
    if (!worker) throw new Error('Overview worker is unavailable');
    pending = job;
    redraws += 1;
    worker.postMessage(job.drawing);
    if (!clockRequest) clockRequest = view.requestAnimationFrame(tick);
  }
  function updateWorker(input: LayerInput, forced: boolean): boolean {
    const previous = lastWorkerScene;
    const unchanged =
      previous &&
      previous.forced === forced &&
      previous.input.nodes === input.nodes &&
      previous.input.edges === input.edges &&
      previous.input.selection.join('\0') === input.selection.join('\0') &&
      previous.input.focus === input.focus &&
      previous.input.width === input.width &&
      previous.input.height === input.height &&
      previous.input.devicePixelRatio === input.devicePixelRatio &&
      previous.input.camera.x === input.camera.x &&
      previous.input.camera.y === input.camera.y &&
      previous.input.camera.zoom === input.camera.zoom;
    if (unchanged) return workerReady;
    const snapshot = { ...input, camera: { ...input.camera }, selection: [...input.selection] };
    lastWorkerScene = { input: snapshot, forced };
    const { nodes, edges } = scene(snapshot, {
      x: input.camera.x,
      y: input.camera.y,
      width: input.width / input.camera.zoom,
      height: input.height / input.camera.zoom,
    });
    requestId += 1;
    const job: WorkerJob = {
      frame: input.frame,
      sourceTick: frameClock,
      drawing: {
        id: requestId,
        nodes: nodes.map((node) => ({ node, ...style(node) })),
        edges,
        selection: snapshot.selection,
        focus: input.focus,
        camera: snapshot.camera,
        target: {
          width: input.width,
          height: input.height,
          devicePixelRatio: input.devicePixelRatio,
        },
        forced,
      },
    };
    if (pending) queued = job;
    else dispatch(job);
    return workerReady;
  }
  if (worker) {
    canvas.style.transform = 'none';
    worker.onerror = (event) => {
      workerError = new Error(`Overview worker failed: ${event.message}`);
      pending = undefined;
      queued = undefined;
      awaitingPresentation = undefined;
      onPresent?.();
    };
    worker.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
      const { id, bitmap } = event.data;
      if (disposed || id !== pending?.drawing.id) {
        bitmap.close();
        return;
      }
      const completed = pending;
      if (presentationRequest) view.cancelAnimationFrame(presentationRequest);
      waitingBitmap?.close();
      waitingBitmap = bitmap;
      presentationRequest = view.requestAnimationFrame(() => {
        presentationRequest = 0;
        waitingBitmap = undefined;
        if (disposed) {
          bitmap.close();
          return;
        }
        size(completed.drawing.target, false);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        workerReady = true;
        pending = undefined;
        if (canvas.style.visibility === 'hidden') awaitingPresentation = completed;
        else {
          awaitingPresentation = undefined;
          recordPresentation(completed);
        }
        const next = queued;
        queued = undefined;
        if (next) dispatch(next);
        onPresent?.();
      });
    };
  }
  return {
    update(input: LayerInput): boolean {
      if (disposed) throw new Error('Overview layer is disposed');
      if (workerError) throw workerError;
      validateTarget(input);
      validateCamera(input.camera);
      cameraFrame = input.frame;
      const forced = forcedColors(context);
      if (worker) return updateWorker(input, forced);
      const settled = zoomWasActive && input.zooming !== true;
      zoomWasActive = input.zooming === true;
      const viewport = {
        x: input.camera.x,
        y: input.camera.y,
        width: input.width / input.camera.zoom,
        height: input.height / input.camera.zoom,
      };
      const candidate = cache;
      const same = candidate && !settled && reusable(candidate, input, forced, viewport);
      if (cache) {
        position(cache, input);
        presentedCameraFrame = input.frame;
      }
      if (same) return cache !== undefined;
      const target = cacheTarget(input);
      const camera = {
        x: viewport.x - (target.width - input.width) / (2 * input.camera.zoom),
        y: viewport.y - (target.height - input.height) / (2 * input.camera.zoom),
        zoom: input.camera.zoom,
      };
      const region = {
        x: camera.x,
        y: camera.y,
        width: target.width / input.camera.zoom,
        height: target.height / input.camera.zoom,
      };
      const next = { input, camera, region, forced };
      const { nodes, edges } = scene(input, region);
      redraws += 1;
      const { scaleX, scaleY } = size(target, true);
      paintCameraOverview(
        context,
        { nodes, edges, camera, selection: input.selection, focus: input.focus, style },
        target,
        scaleX,
        scaleY,
      );
      cache = next;
      position(next, input);
      presentedCameraFrame = input.frame;
      return cache !== undefined;
    },
    present() {
      if (disposed) throw new Error('Overview layer is disposed');
      if (awaitingPresentation) {
        recordPresentation(awaitingPresentation);
        awaitingPresentation = undefined;
      }
    },
    metrics() {
      return {
        cachePixelBytes,
        redraws,
        cameraFrame,
        presentedCameraFrame,
        presentationLagFrames: [...presentationLagFrames],
      };
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      if (clockRequest) view.cancelAnimationFrame(clockRequest);
      if (presentationRequest) view.cancelAnimationFrame(presentationRequest);
      waitingBitmap?.close();
      waitingBitmap = undefined;
      if (originalStyle === null) canvas.removeAttribute('style');
      else canvas.setAttribute('style', originalStyle);
      cachePixelBytes = 0;
    },
  };
}
