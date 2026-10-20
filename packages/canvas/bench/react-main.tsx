import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { CanvasController, CanvasNode, CanvasLevel, NodeId } from '../src/index.mts';
import {
  CanvasProvider, CanvasStage, ChromeProvider, OutlinePanel, useCanvas, WorldNodes,
} from '../src/react/index.mts';
import '../src/styles.css';
import { readBenchFixture } from './fixture';
import { createBench } from './harness';

declare global {
  interface Window { reactCommits: number }
}

const params = new URLSearchParams(location.search);
const { fixtureName, fixture, worldType, overviewRenderer, pointerMode, nodes } = readBenchFixture(params);
const fixtureById = new Map(fixture.nodes.map((node) => [node.id, node]));
const options = {
  pointerMode, motion: 'auto', overviewRenderer,
  breakpoints: [{ name: 'mobile', minWidth: 0 }, { name: 'tablet', minWidth: 768 }, { name: 'desktop', minWidth: 1280 }],
  shortcutsEnabled: () => params.get('shortcuts') !== 'off',
  zoom: { min: 0.0001, max: 4 },
} as const;

type CardData = { title: string; rank: number; frame: boolean };
const Card = memo(function Card({ id, item, level }: { id: NodeId; item: CardData; level: CanvasLevel }) {
  const full = level === 'dom' || item.frame;
  if (item.frame) return <iframe title={id === 'preview-frame' ? 'Preview frame' : id}
    srcDoc={'<label>Frame field <input id="frame-field"></label>'} style={{ width: '100%', height: '100%', border: 0 }} />;
  if (worldType === 'svg' && full) return <svg width="100%" height="100%" viewBox="0 0 220 76">
    <text x="0" y="14" fontSize="13">{item.title}</text>
    <text x="0" y="36" fontSize="11" fill="#536171"> {id} · Layer {item.rank}</text>
  </svg>;
  return <><strong>{item.title}</strong>{full && <span> {id} · Layer {item.rank}</span>}</>;
});
const renderNode = (id: NodeId, item: CardData | undefined, level: CanvasLevel) => {
  if (!item) throw new Error(`React card ${id} has no data`);
  return <Card id={id} item={item} level={level} />;
};

const nodeAttributes = (id: NodeId, item: CardData | undefined, level: CanvasLevel) => {
  if (!item) throw new Error(`React card ${id} has no data`);
  const full = level === 'dom' || item.frame;
  return {
    role: 'button',
    'data-card-level': full ? 'dom' : 'compact',
    'aria-label': full && !item.frame
      ? `${item.title} ${id} · Layer ${item.rank}` : `${item.title}, ${id}`,
    className: item.frame ? 'frame-card' : undefined,
  };
};

async function waitForReactNodes(controller: CanvasController, stage: HTMLElement): Promise<void> {
  const started = performance.now();
  let previous = '';
  let stableFrames = 0;
  while (performance.now() - started < 5000) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (window.benchError) throw new Error(`React bench failed: ${window.benchError}`);
    const ids = [...controller.getMountedIds()].sort();
    const rendered = [...stage.querySelectorAll<HTMLElement>('[data-canvas-node-id]')]
      .map((element) => element.dataset.canvasNodeId).sort();
    const level = controller.getLevel();
    const signature = JSON.stringify([level, ids]);
    const ready = (level === 'overview' || ids.length > 0) && JSON.stringify(ids) === JSON.stringify(rendered);
    stableFrames = ready && signature === previous ? stableFrames + 1 : 0;
    if (stableFrames >= 2) return;
    previous = signature;
  }
  throw new Error(`React bench fixture ${fixtureName} did not render stable ${controller.getLevel()} nodes within 5000 ms`);
}

function BenchConnection({ setNodes, count }: { setNodes: (nodes: readonly CanvasNode[]) => void; count: number }) {
  const controller = useCanvas();
  const initialized = useRef<CanvasController | null>(null);
  useEffect(() => {
    if (!controller || initialized.current === controller) return;
    initialized.current = controller;
    const stage = document.querySelector('.canvas-stage');
    const world = stage?.querySelector('.canvas-world');
    if (!(stage instanceof HTMLElement) || !(world instanceof HTMLElement))
      throw new Error('React bench stage or world is missing');
    stage.id = 'stage';
    world.dataset.world = '';
    window.canvas = controller;
    controller.setCamera({ x: 0, y: 0, zoom: Number(params.get('zoom') ?? 1) });
    createBench({
      controller, stage, world, fixtureName, worldType, setNodes,
      waitUntilReady: () => waitForReactNodes(controller, stage),
      getReactCommits: () => window.reactCommits,
    });
  }, [controller, setNodes]);
  useEffect(() => {
    if (!controller) return;
    const output = document.getElementById('mounted-count');
    const update = () => {
      if (output) output.textContent = `${controller.getMountedIds().size} mounted / ${count} nodes`;
    };
    update();
    return controller.on('mount', update);
  }, [controller, count]);
  return null;
}

function App() {
  const [currentNodes, updateNodes] = useState<readonly CanvasNode[]>(() => nodes.map((node) => ({
    ...node, bounds: { ...node.bounds, width: node.frame ? node.bounds.width : 220, height: node.frame ? node.bounds.height : 76 },
  })));
  const [edges, updateEdges] = useState(fixture.edges.map((edge) => ({ ...edge, style: 'dependency' as const })));
  const data = useMemo(() => new Map(currentNodes.map((node) => [node.id, {
    title: fixtureById.get(node.id)?.title ?? node.id,
    rank: fixtureById.get(node.id)?.rank ?? 0,
    frame: node.frame === true,
  }])), [currentNodes]);
  const setNodes = useRef((next: readonly CanvasNode[]) => {
    flushSync(() => { updateEdges([]); updateNodes(next); });
  }).current;
  return <ChromeProvider><CanvasProvider label="React canvas engine bench" options={options} nodes={currentNodes} edges={edges}>
    <CanvasStage><WorldNodes data={data} renderNode={renderNode} nodeAttributes={nodeAttributes} className="card" /></CanvasStage>
    <BenchConnection setNodes={setNodes} count={currentNodes.length} />
    {params.get('outline') === '1' && <div className="bench-outline"><OutlinePanel label="Canvas outline" rowHeight={28} height={600}
      renderRow={(id: NodeId) => `${id}, ${fixtureById.get(id)?.title ?? id}`} /></div>}
  </CanvasProvider></ChromeProvider>;
}
const root = document.getElementById('root');
if (!root) throw new Error('React bench root is missing');
createRoot(root, {
  onUncaughtError(error) {
    window.benchError = error instanceof Error ? error.message : String(error);
    reportError(error);
  },
}).render(<App />);
