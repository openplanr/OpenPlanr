import {
  type Camera,
  type CanvasController,
  type CanvasNode,
  createCanvas,
} from '../src/index.mts';
import { generateLayeredGraph, generateSvgDiagram } from '../src/testing/index.mts';
import '../src/styles.css';
import { observeTransformWrites } from './transform-writes';

export type Scenario = 'pan-100' | 'pan-40' | 'pan-fit' | 'zoom-sweep';
export type WriteFrame = { frame: number; world: number; overlay: number };
export type ScenarioResult = {
  intervals: number[];
  writes: WriteFrame[];
  longTasks: number[] | null;
  domNodes: number;
  fitCamera: Camera;
  startCamera: Camera;
  endCamera: Camera;
  minimumZoom: number;
};
export interface Bench {
  ready: Promise<void>;
  firstFrameMs: number;
  transformWrites: WriteFrame[];
  fixture: string;
  world: 'html' | 'svg';
  run(scenario: Scenario): Promise<ScenarioResult>;
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
const validFixtures = ['708-477', '708-997', '5000-8499', '5000-7312', 'svg-708', 'svg-5000'];
if (!validFixtures.includes(fixtureName)) throw new TypeError(`fixture: ${fixtureName}`);
const fixture = fixtureName.startsWith('svg-')
  ? generateSvgDiagram(fixtureName === 'svg-708' ? 708 : 5000)
  : generateLayeredGraph(
      fixtureName.startsWith('708-') ? 708 : 5000,
      Number(fixtureName.split('-')[1]),
    );
const worldType = params.get('world') ?? 'html';
if (worldType !== 'html' && worldType !== 'svg') throw new TypeError(`world: ${worldType}`);
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

const world =
  worldType === 'svg' ? svgElement('g', { 'data-world': '' }) : document.createElement('div');
const overlay = svgElement('g', { 'data-overlay': '' });
world.classList.add('canvas-world');
const rootSvg = svgElement('svg', { class: 'svg-stage', 'aria-hidden': 'true' });
if (worldType === 'svg') {
  rootSvg.append(world, overlay);
  stage.append(rootSvg);
} else {
  rootSvg.append(overlay);
  stage.append(world, rootSvg);
  rootSvg.style.pointerEvents = 'none';
}
const edges = svgElement('path', {
  d: fixture.edges
    .map((edge) =>
      edge.points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
        .join(' '),
    )
    .join(' '),
  fill: 'none',
  stroke: '#aeb9c7',
  'stroke-width': '1',
});
if (worldType === 'svg') world.append(edges);
else {
  const edgeSvg = svgElement('svg', { class: 'edges' });
  edgeSvg.append(edges);
  world.append(edgeSvg);
}
for (const node of fixture.nodes) {
  const { x, y, width, height } = node.bounds;
  if (worldType === 'svg') {
    const group = svgElement('g', {
      'data-canvas-node-id': node.id,
      transform: `translate(${x} ${y})`,
    });
    group.append(
      svgElement('rect', {
        width: String(width),
        height: String(height),
        rx: '6',
        fill: 'white',
        stroke: '#b7bfca',
      }),
    );
    const title = svgElement('text', { x: '10', y: '24', 'font-size': '13' });
    title.textContent = node.title;
    const detail = svgElement('text', { x: '10', y: '45', 'font-size': '11', fill: '#536171' });
    detail.textContent = `${node.id} · Layer ${node.rank}`;
    group.append(title, detail);
    world.append(group);
  } else {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.canvasNodeId = node.id;
    Object.assign(card.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    const title = document.createElement('strong');
    title.textContent = node.title;
    const detail = document.createElement('span');
    detail.textContent = `${node.id} · Layer ${node.rank}`;
    card.append(title, detail);
    world.append(card);
  }
}
const nodes: CanvasNode[] = fixture.nodes.map(({ id, bounds }) => ({ id, bounds }));
if (params.get('frame') === '1') {
  if (!(world instanceof HTMLElement)) throw new TypeError('frame: requires html world');
  const bounds = { x: 80, y: 80, width: 320, height: 200 };
  nodes.push({ id: 'preview-frame', bounds, frame: true });
  const frame = document.createElement('iframe');
  frame.title = 'Preview frame';
  frame.dataset.canvasNodeId = 'preview-frame';
  frame.srcdoc = '<label>Frame field <input id="frame-field"></label>';
  Object.assign(frame.style, {
    position: 'absolute',
    left: '80px',
    top: '80px',
    width: '320px',
    height: '200px',
    background: 'white',
  });
  world.append(frame);
}

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
  shortcutsEnabled: () => params.get('shortcuts') !== 'off',
  zoom: { min: 0.0001, max: 4 },
});
window.canvas = controller;
controller.setNodes(nodes);
controller.attach({ stage, world, overlays: [overlay] });
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
  async run(scenario) {
    controller.fit('all', { padding: 32, maxZoom: 1 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
    await nextFrame();
    const fitCamera = controller.getCamera();
    controller.setCamera(fitCamera);
    if (scenario !== 'pan-fit')
      controller.setCamera({ x: 0, y: 0, zoom: scenario === 'pan-40' ? 0.4 : 1 });
    await nextFrame();
    await nextFrame();
    for (const observer of transformObservers) observer.flush();
    writes = [];
    longTasks = [];
    performance.clearMarks('canvas-interaction-start');
    performance.clearMarks('canvas-interaction-end');
    const intervals: number[] = [];
    const startCamera = controller.getCamera();
    let minimumZoom = startCamera.zoom;
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
      const now = await nextFrame();
      intervals.push(now - previous);
      previous = now;
    }
    performance.mark('canvas-interaction-end');
    const end = performance.now();
    await nextFrame();
    for (const observer of transformObservers) observer.flush();
    longTasks.push(...(observer?.takeRecords() ?? []));
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
      domNodes: stage.querySelectorAll('*').length,
    };
  },
};
window.bench = bench;
