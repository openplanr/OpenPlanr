import {
  type CanvasNode,
  createCanvas,
} from '../src/index.mts';
import { readBenchFixture } from './fixture';
import '../src/styles.css';
import { createBench } from './harness';
export type { Bench, RemountResult, Scenario, ScenarioOverviewMetrics, ScenarioResult, WriteFrame } from './harness';

const params = new URLSearchParams(location.search);
const { fixtureName, fixture, worldType, overviewRenderer, pointerMode, nodes: initialNodes } = readBenchFixture(params);
let nodes = initialNodes;
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
  const detailText = element instanceof SVGElement
    ? node.id : `${node.id} · Layer ${fixtureNode?.rank ?? 0}`;
  element.setAttribute('aria-label', level === 'dom' && !node.frame
    ? `${titleText} ${detailText}` : `${titleText}, ${node.id}`);
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
      detail.textContent = ` ${detailText}`;
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
      detail.textContent = ` ${detailText}`;
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
    element = svgElement('svg', { class: 'card svg-card', 'data-canvas-node-id': node.id, tabindex: '-1', role: 'button' });
    world.append(element);
  } else {
    element = document.createElement('article');
    element.className = 'card';
    element.dataset.canvasNodeId = node.id;
    element.tabIndex = -1;
    element.setAttribute('role', 'button');
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
const outline = params.get('outline') === '1' ? document.createElement('ul') : null;
if (outline) {
  outline.dataset.canvasOutline = '';
  outline.setAttribute('aria-label', 'Canvas outline');
  Object.assign(outline.style, {
    position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
    clipPath: 'inset(50%)', margin: '-1px', padding: '0',
  });
  document.body.append(outline);
}
function syncOutline(): void {
  if (!outline) return;
  outline.replaceChildren(...controller.getOutline().map((id) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = `${id}, ${fixtureById.get(id)?.title ?? id}`;
    button.addEventListener('click', () => {
      void controller.focusNode(id).then(() => controller.setSelection([id]));
    });
    item.append(button);
    return item;
  }));
}
syncOutline();
createBench({
  controller, stage, world, overlays: [overlay], fixtureName, worldType,
  setNodes(next) {
    nodes = next;
    nodeById = new Map(next.map((node) => [node.id, node]));
    controller.setEdges([]);
    controller.setNodes(next);
    syncOutline();
  },
});
