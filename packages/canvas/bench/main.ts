import {
  type Camera,
  type CanvasController,
  type CanvasNode,
  createCanvas,
} from '../src/index.mts';
import { generateLayeredGraph, generateSvgDiagram } from '../src/testing/index.mts';
import '../src/styles.css';
import { type HitTestProbe, measureHitTests } from './hit-test';
import { observeTransformWrites } from './transform-writes';

export type Scenario = 'pan-100' | 'pan-40' | 'pan-fit' | 'zoom-sweep';
export type WriteFrame = { frame: number; world: number; overlay: number };
export type ScenarioOverviewMetrics = ReturnType<CanvasController['getOverviewMetrics']> &
  Readonly<{ peakCachePixelBytes: number }>;
export type ScenarioResult = {
  intervals: number[];
  writes: WriteFrame[];
  longTasks: number[] | null;
  domNodes: number;
  fitCamera: Camera;
  startCamera: Camera;
  endCamera: Camera;
  minimumZoom: number;
  gpuRenderer: string;
  hitTestP95Ms: number;
  hitTestProbe: HitTestProbe;
  overview: ScenarioOverviewMetrics;
};
export type RemountResult = Pick<
  ScenarioResult,
  'intervals' | 'longTasks' | 'domNodes' | 'gpuRenderer' | 'hitTestP95Ms' | 'hitTestProbe' | 'overview'
> & { mountCounts: number[] };
export interface Bench {
  ready: Promise<void>;
  firstFrameMs: number;
  transformWrites: WriteFrame[];
  fixture: string;
  world: 'html' | 'svg';
  setNodes(nodes: readonly CanvasNode[]): void;
  run(scenario: Scenario): Promise<ScenarioResult>;
  remount(): Promise<RemountResult>;
}

declare global {
  interface Window {
    canvas: CanvasController;
    bench: Bench;
    benchError?: string;
  }
}

const params = new URLSearchParams(location.search);
const fixtureName = params.get('fixture') ?? '708-997';
const validFixtures = ['708-477', '708-997', '5000-8499', '5000-7312', 'svg-708', 'svg-5000', 'stress-50000'];
if (!validFixtures.includes(fixtureName)) throw new TypeError(`fixture: ${fixtureName}`);
const fixture = fixtureName === 'stress-50000'
  ? {
      nodes: Array.from({ length: 50_000 }, (_, index) => ({
        id: `node-${index + 1}`, title: `Stress ${index + 1}`, rank: Math.floor(index / 250),
        bounds: { x: Math.floor(index / 250) * 294, y: (index % 250) * 94, width: 230, height: 66 },
      })),
      edges: [],
      bounds: { x: 0, y: 0, width: 199 * 294 + 230, height: 249 * 94 + 66 },
    }
  : fixtureName.startsWith('svg-')
  ? generateSvgDiagram(fixtureName === 'svg-708' ? 708 : 5000)
  : generateLayeredGraph(
      fixtureName.startsWith('708-') ? 708 : 5000,
      Number(fixtureName.split('-')[1]),
    );
const worldType = params.get('world') ?? 'html';
if (worldType !== 'html' && worldType !== 'svg') throw new TypeError(`world: ${worldType}`);
const overviewRenderer = params.get('overviewRenderer') ?? 'canvas';
if (overviewRenderer !== 'canvas' && overviewRenderer !== 'worker')
  throw new TypeError(`overviewRenderer: ${overviewRenderer}`);
const pointerMode = params.get('pointerMode') ?? 'pan';
if (pointerMode !== 'pan' && pointerMode !== 'none')
  throw new TypeError(`pointerMode: ${pointerMode}`);
const stage = document.getElementById('stage');
if (!(stage instanceof HTMLElement)) throw new Error('Bench stage is missing');
const svgNamespace = 'http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

const world = document.createElement('div');
world.classList.add('canvas-world');
world.dataset.world = '';
const overlay = document.createElement('div');
overlay.classList.add('canvas-world');
overlay.dataset.overlay = '';
overlay.style.pointerEvents = 'none';
const edgeSvg = svgElement('svg', { class: 'edges', 'aria-hidden': 'true' });
world.append(edgeSvg);
const contentSvg = svgElement('svg', {
  class: 'svg-content',
  viewBox: `${fixture.bounds.x} ${fixture.bounds.y} ${fixture.bounds.width} ${fixture.bounds.height}`,
  width: String(fixture.bounds.width),
  height: String(fixture.bounds.height),
});
Object.assign(contentSvg.style, {
  left: `${fixture.bounds.x}px`,
  top: `${fixture.bounds.y}px`,
});
if (worldType === 'svg') world.append(contentSvg);
const overlaySvg = contentSvg.cloneNode(false);
if (overlaySvg instanceof Element) overlaySvg.setAttribute('aria-hidden', 'true');
overlay.append(overlaySvg);
stage.append(world, overlay);
const count = document.createElement('output');
count.id = 'mounted-count';
count.setAttribute('aria-label', 'Mounted nodes');
document.body.append(count);

let nodes: readonly CanvasNode[] = fixture.nodes.map(({ id, bounds }) => ({ id, bounds }));
const frameCount = Number(params.get('frames') ?? (params.get('frame') === '1' ? 1 : 0));
if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > 15)
  throw new TypeError(`frames: ${frameCount}`);
if (frameCount > 0) {
  if (worldType !== 'html') throw new TypeError('frames: requires html world');
  nodes = [
    ...nodes,
    ...Array.from({ length: frameCount }, (_, index) => ({
      id: index === 0 ? 'preview-frame' : `preview-frame-${index + 1}`,
      bounds: {
        x: 80 + (index % 5) * 240,
        y: 80 + Math.floor(index / 5) * 240,
        width: frameCount === 1 ? 320 : 220,
        height: 200,
      },
      frame: true,
    })),
  ];
}
let nodeById = new Map(nodes.map((node) => [node.id, node]));
const fixtureById = new Map(fixture.nodes.map((node) => [node.id, node]));
const rendered = new Map<string, Element>();
function positionNode(element: Element, node: CanvasNode): void {
  const { x, y, width, height } = node.bounds;
  if (element instanceof HTMLElement || element instanceof SVGSVGElement) {
    Object.assign(element.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    if (element instanceof SVGSVGElement) {
      element.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const shape = element.querySelector('rect');
      shape?.setAttribute('width', String(width));
      shape?.setAttribute('height', String(height));
    }
  }
}
function syncNodeContent(element: Element, node: CanvasNode): void {
  const level = controller.getLevel(node.id) === 'dom' || node.frame ? 'dom' : 'compact';
  if (element.getAttribute('data-card-level') === level) return;
  element.setAttribute('data-card-level', level);
  const fixtureNode = fixtureById.get(node.id);
  const titleText = fixtureNode?.title ?? node.id;
  element.setAttribute('aria-label', titleText);
  if (element instanceof SVGElement) {
    const title = svgElement('text', { x: '10', y: '24', 'font-size': '13' });
    title.textContent = titleText;
    if (level === 'compact') element.replaceChildren(title);
    else {
      const shape = svgElement('rect', {
        width: String(node.bounds.width), height: String(node.bounds.height), rx: '6',
        fill: 'white', stroke: '#b7bfca',
      });
      const detail = svgElement('text', { x: '10', y: '45', 'font-size': '11', fill: '#536171' });
      detail.textContent = node.id;
      element.replaceChildren(shape, title, detail);
    }
  } else if (node.frame) {
    const frame = document.createElement('iframe');
    frame.title = node.id === 'preview-frame' ? 'Preview frame' : node.id;
    frame.srcdoc = '<label>Frame field <input id="frame-field"></label>';
    Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
    element.classList.add('frame-card');
    element.replaceChildren(frame);
  } else {
    const title = document.createElement('strong');
    title.textContent = titleText;
    element.replaceChildren(title);
    if (level === 'dom') {
      const detail = document.createElement('span');
      detail.textContent = `${node.id} · Layer ${fixtureNode?.rank ?? 0}`;
      element.append(detail);
    }
  }
}
function syncContent(): void {
  for (const [id, element] of rendered) {
    const node = nodeById.get(id);
    if (node) syncNodeContent(element, node);
  }
}
function renderNode(node: CanvasNode): void {
  let element: HTMLElement | SVGSVGElement;
  if (worldType === 'svg') {
    element = svgElement('svg', { class: 'card svg-card', 'data-canvas-node-id': node.id, tabindex: '-1', role: 'group' });
    world.append(element);
  } else {
    element = document.createElement('article');
    element.className = 'card';
    element.dataset.canvasNodeId = node.id;
    element.tabIndex = -1;
    world.append(element);
  }
  syncNodeContent(element, node);
  positionNode(element, node);
  rendered.set(node.id, element);
  controller.registerNodeElement(node.id, element);
}
function syncMounted(ids: ReadonlySet<string>): void {
  for (const [id, element] of rendered) {
    if (ids.has(id)) continue;
    controller.registerNodeElement(id, null);
    element.remove();
    rendered.delete(id);
  }
  for (const id of ids) {
    if (rendered.has(id)) continue;
    const node = nodeById.get(id);
    if (!node) throw new Error(`Mounted node ${id} has no bench geometry`);
    renderNode(node);
  }
  count.value = `${ids.size} mounted / ${nodes.length} nodes`;
}
function gpuRenderer(): string {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) return 'WebGL unavailable';
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}
const renderer = gpuRenderer();

let frameNumber = 0;
let writes: WriteFrame[] = [];
function recordWrite(target: 'world' | 'overlay'): void {
  let frame = writes.at(-1);
  if (!frame || frame.frame !== frameNumber) {
    frame = { frame: frameNumber, world: 0, overlay: 0 };
    writes.push(frame);
  }
  frame[target] += 1;
}
const transformObservers = [
  observeTransformWrites(world, () => recordWrite('world')),
  observeTransformWrites(overlay, () => recordWrite('overlay')),
];
function markFrame(): void {
  frameNumber += 1;
  performance.mark('canvas-frame');
  requestAnimationFrame(markFrame);
}
requestAnimationFrame(markFrame);
const controller = createCanvas({
  label: 'Canvas engine bench',
  pointerMode,
  motion: 'auto',
  overviewRenderer,
  breakpoints: [{ name: 'mobile', minWidth: 0 }, { name: 'tablet', minWidth: 768 }, { name: 'desktop', minWidth: 1280 }],
  shortcutsEnabled: () => params.get('shortcuts') !== 'off',
  zoom: { min: 0.0001, max: 4 },
});
window.canvas = controller;
controller.on('mount', syncMounted);
controller.on('level', syncContent);
controller.on('focus', syncContent);
controller.on('selection', syncContent);
controller.on('geometry', (ids) => {
  for (const id of ids) {
    const element = rendered.get(id);
    const node = nodeById.get(id);
    if (element && node) {
      syncNodeContent(element, node);
      positionNode(element, node);
    }
  }
});
controller.setNodes(nodes);
controller.setEdges(fixture.edges.map((edge) => ({ ...edge, style: 'dependency' })));
controller.attach({ stage, world, overlays: [overlay], edges: edgeSvg });
syncMounted(new Set(controller.getMountedIds()));
controller.setCamera({ x: 0, y: 0, zoom: Number(params.get('zoom') ?? 1) });
const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
let longTasks: PerformanceEntry[] = [];
const observer =
  typeof PerformanceObserver !== 'undefined' &&
  PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries());
      })
    : null;
observer?.observe({ type: 'longtask', buffered: true });
const probeHitTests = () => measureHitTests((point) => controller.hitTest(point), stage.getBoundingClientRect());
const bench: Bench = {
  ready: nextFrame().then(() => {
    bench.firstFrameMs = performance.now();
    performance.mark('canvas-first-frame');
  }),
  firstFrameMs: 0,
  get transformWrites() {
    for (const observer of transformObservers) observer.flush();
    return writes;
  },
  fixture: fixtureName,
  world: worldType,
  setNodes(next) {
    nodes = next;
    nodeById = new Map(next.map((node) => [node.id, node]));
    controller.setEdges([]);
    controller.setNodes(next);
  },
  async remount() {
    bench.setNodes([]);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    await nextFrame();
    const nodes = Array.from({ length: 968 }, (_, index) => ({
      id: `remount-${index}`,
      bounds: { x: (index % 44) * 30, y: Math.floor(index / 44) * 30, width: 20, height: 20 },
    }));
    const mountCounts: number[] = [];
    let previousCount = 0;
    const off = controller.on('mount', (ids) => {
      mountCounts.push(ids.size - previousCount);
      previousCount = ids.size;
    });
    const intervals: number[] = [];
    longTasks = [];
    performance.clearMarks('canvas-remount-start');
    performance.clearMarks('canvas-remount-end');
    let previous = await nextFrame();
    const overviewStart = controller.getOverviewMetrics();
    let peakCachePixelBytes = overviewStart.cachePixelBytes;
    const start = performance.now();
    performance.mark('canvas-remount-start');
    bench.setNodes(nodes);
    for (let frame = 0; frame < 30 && controller.getMountedIds().size < nodes.length; frame += 1) {
      const time = await nextFrame();
      peakCachePixelBytes = Math.max(peakCachePixelBytes, controller.getOverviewMetrics().cachePixelBytes);
      intervals.push(time - previous);
      previous = time;
    }
    await nextFrame();
    performance.mark('canvas-remount-end');
    const end = performance.now();
    off();
    if (controller.getMountedIds().size !== nodes.length)
      throw new Error(`Remount admitted ${controller.getMountedIds().size} of ${nodes.length} nodes`);
    await nextFrame();
    longTasks.push(...(observer?.takeRecords() ?? []));
    const hitTestProbe = probeHitTests();
    const overview = controller.getOverviewMetrics();
    peakCachePixelBytes = Math.max(peakCachePixelBytes, overview.cachePixelBytes);
    return {
      intervals,
      mountCounts,
      longTasks: observer
        ? longTasks.filter((entry) => entry.startTime >= start && entry.startTime < end && entry.duration > 50).map((entry) => entry.duration)
        : null,
      domNodes: stage.querySelectorAll('*').length,
      gpuRenderer: renderer,
      hitTestP95Ms: hitTestProbe.p95Ms,
      hitTestProbe,
      overview: {
        ...overview,
        peakCachePixelBytes,
        redraws: overview.redraws - overviewStart.redraws,
        presentationLagFrames: overview.presentationLagFrames.slice(overviewStart.presentationLagFrames.length),
      },
    };
  },
  async run(scenario) {
    controller.fit('all', { padding: 32, maxZoom: 1 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
    await nextFrame();
    const fitCamera = controller.getCamera();
    controller.setCamera(fitCamera);
    if (scenario === 'pan-40') {
      controller.setCamera({ x: 0, y: 0, zoom: 1 });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      await nextFrame();
    }
    if (scenario !== 'pan-fit')
      controller.setCamera({ x: 0, y: 0, zoom: scenario === 'pan-40' ? 0.4 : 1 });
    if (scenario === 'pan-40') {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      await nextFrame();
      if (controller.getLevel() !== 'compact')
        throw new Error(`Compact pan benchmark entered ${controller.getLevel()} at zoom 0.4`);
    }
    await nextFrame();
    await nextFrame();
    for (const observer of transformObservers) observer.flush();
    writes = [];
    longTasks = [];
    performance.clearMarks('canvas-interaction-start');
    performance.clearMarks('canvas-interaction-end');
    const intervals: number[] = [];
    const overviewStart = controller.getOverviewMetrics();
    let peakCachePixelBytes = overviewStart.cachePixelBytes;
    const startCamera = controller.getCamera();
    let minimumZoom = startCamera.zoom;
    let domNodes = stage.querySelectorAll('*').length;
    let previous = await nextFrame();
    const start = performance.now();
    performance.mark('canvas-interaction-start');
    for (let index = 0; index < 180; index += 1) {
      if (scenario === 'zoom-sweep') {
        const fraction = index < 90 ? (index + 1) / 90 : (179 - index) / 90;
        const zoom = Math.exp(Math.log(fitCamera.zoom) * fraction);
        controller.zoomAt(zoom / controller.getCamera().zoom);
      } else {
        controller.panBy(2 + Math.sin(index / 20), 1 + Math.cos(index / 20));
        controller.panBy(1, 0.5);
      }
      minimumZoom = Math.min(minimumZoom, controller.getCamera().zoom);
      domNodes = Math.max(domNodes, stage.querySelectorAll('*').length);
      const now = await nextFrame();
      peakCachePixelBytes = Math.max(peakCachePixelBytes, controller.getOverviewMetrics().cachePixelBytes);
      intervals.push(now - previous);
      previous = now;
    }
    performance.mark('canvas-interaction-end');
    const end = performance.now();
    await nextFrame();
    for (const observer of transformObservers) observer.flush();
    longTasks.push(...(observer?.takeRecords() ?? []));
    const hitTestProbe = probeHitTests();
    const overview = controller.getOverviewMetrics();
    peakCachePixelBytes = Math.max(peakCachePixelBytes, overview.cachePixelBytes);
    return {
      intervals,
      writes: [...writes],
      fitCamera,
      startCamera,
      endCamera: controller.getCamera(),
      minimumZoom,
      longTasks: observer
        ? longTasks
            .filter(
              (entry) => entry.startTime >= start && entry.startTime < end && entry.duration > 50,
            )
            .map((entry) => entry.duration)
        : null,
      domNodes,
      gpuRenderer: renderer,
      hitTestP95Ms: hitTestProbe.p95Ms,
      hitTestProbe,
      overview: {
        ...overview,
        peakCachePixelBytes,
        redraws: overview.redraws - overviewStart.redraws,
        presentationLagFrames: overview.presentationLagFrames.slice(overviewStart.presentationLagFrames.length),
      },
    };
  },
};
window.bench = bench;
