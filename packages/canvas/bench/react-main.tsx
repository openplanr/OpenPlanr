import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { CanvasController, CanvasNode, CanvasLevel, NodeId } from '../src/index.mts';
import {
  ActionPill, CanvasProvider, CanvasStage, ChromeProvider, ChromeRoot, defaultChromeKeymap,
  FloatingToolbar, HelpButton, HistoryPill, Menu, MenuItem, MenuPill, NavigationPanel,
  OutlinePanel, PrimaryAction, Sidebar, SidebarToggle, ToolbarHint, ToolbarItem, ToolbarMore,
  useCanvas, useChrome, WelcomeHints, WorldNodes, ZoomPill,
} from '../src/react/index.mts';
import type { ChromeKeymap, ChromeShortcut, ChromeState, ChromeStorage } from '../src/react/index.mts';
import '../src/styles.css';
import { readBenchFixture } from './fixture';
import { createBench } from './harness';

declare global {
  interface Window {
    reactCommits: number;
    chromeBench?: {
      setKeymap(keymap: ChromeKeymap): void;
      getState(): ChromeState;
      addNode(): void;
      setToolShortcut(tool: Tool, binding: ChromeShortcut): void;
      setStorageFailure(failing: boolean): void;
      storageErrors: string[];
    };
  }
}

const params = new URLSearchParams(location.search);
const chromeEnabled = params.get('chrome') === '1';
const emptyCanvas = chromeEnabled && params.get('empty') === '1';
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
    const ready = (level === 'overview' || ids.length > 0 || emptyCanvas) && JSON.stringify(ids) === JSON.stringify(rendered);
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

type Tool = 'select' | 'hand' | 'rectangle' | 'text';
const initialToolBindings: Readonly<Record<Tool, ChromeShortcut>> = {
  select: { code: 'KeyV' }, hand: { code: 'KeyH' }, rectangle: { code: 'KeyR' }, text: { code: 'KeyT' },
};
const creationBindings: Readonly<Record<'rectangle' | 'text', ChromeShortcut>> = {
  rectangle: { code: 'KeyR', shiftKey: true }, text: { code: 'KeyT', shiftKey: true },
};
function matchesShortcut(event: KeyboardEvent, binding: ChromeShortcut): boolean {
  return event.code === binding.code && event.altKey === Boolean(binding.altKey) &&
    event.ctrlKey === Boolean(binding.ctrlKey) && event.metaKey === Boolean(binding.metaKey) &&
    event.shiftKey === Boolean(binding.shiftKey);
}
const storageErrors: string[] = [];
let storageFailure = params.get('storageError') === '1';
const storage: ChromeStorage = {
  get(key) {
    if (storageFailure) throw new Error(`Bench storage get failed for ${key}`);
    const value = localStorage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  },
  set(key, value) {
    if (storageFailure) throw new Error(`Bench storage set failed for ${key}`);
    localStorage.setItem(key, JSON.stringify(value));
  },
};

function BenchChrome({ currentNodes, setNodes, setKeymap }: {
  currentNodes: readonly CanvasNode[];
  setNodes: (nodes: readonly CanvasNode[]) => void;
  setKeymap: (keymap: ChromeKeymap) => void;
}) {
  const controller = useCanvas();
  const chrome = useChrome();
  const [selection, setSelection] = useState<readonly NodeId[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [bindings, setBindings] = useState(initialToolBindings);
  const [past, setPast] = useState<readonly (readonly CanvasNode[])[]>([]);
  const [future, setFuture] = useState<readonly (readonly CanvasNode[])[]>([]);
  const [dialog, setDialog] = useState<'share' | 'help' | null>(null);
  const sequence = useRef(0);
  const skipLink = useRef<HTMLAnchorElement>(null);
  const latest = useRef({ currentNodes, chrome, bindings, tool });
  latest.current = { currentNodes, chrome, bindings, tool };
  useEffect(() => {
    if (skipLink.current) return chrome.registerRegion('skip-link', skipLink.current);
  }, [chrome.registerRegion]);
  useEffect(() => {
    if (!controller) return;
    controller.setPointerMode('none');
    setSelection(controller.getSelection());
    return controller.on('selection', setSelection);
  }, [controller]);
  const chooseTool = (next: Tool) => {
    setTool(next);
    controller?.setPointerMode(next === 'hand' ? 'pan' : 'none');
  };
  const addNode = (kind: 'rectangle' | 'text' = 'rectangle') => {
    if (!controller) return;
    const area = latest.current.chrome.safeArea;
    const position = controller.screenToWorld({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
    const id = `${kind}-${++sequence.current}`;
    const next = [...latest.current.currentNodes, { id, bounds: { x: position.x - 110, y: position.y - 38, width: 220, height: 76 } }];
    setPast((previous) => [...previous, latest.current.currentNodes]);
    setFuture([]);
    setNodes(next);
    controller.setSelection([id]);
  };
  const actions = useRef({ addNode, chooseTool });
  actions.current = { addNode, chooseTool };
  useEffect(() => {
    if (!controller) return;
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.canvas-stage')) return;
      const node = event.target.closest<HTMLElement>('[data-canvas-node-id]');
      if (node?.dataset.canvasNodeId) controller.setSelection([node.dataset.canvasNodeId]);
      else if (latest.current.tool === 'rectangle' || latest.current.tool === 'text')
        actions.current.addNode(latest.current.tool);
      else controller.setSelection([]);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const creation = (Object.entries(creationBindings) as ['rectangle' | 'text', ChromeShortcut][])
        .find(([, binding]) => matchesShortcut(event, binding));
      if (creation) { actions.current.addNode(creation[0]); event.preventDefault(); return; }
      const entry = (Object.entries(latest.current.bindings) as [Tool, ChromeShortcut][])
        .find(([, binding]) => matchesShortcut(event, binding));
      if (entry) { actions.current.chooseTool(entry[0]); event.preventDefault(); }
    };
    document.addEventListener('click', click);
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', keydown); };
  }, [controller]);
  useEffect(() => {
    window.chromeBench = {
      setKeymap,
      getState: () => latest.current.chrome,
      addNode: () => actions.current.addNode(),
      setToolShortcut: (name, binding) => setBindings((previous) => ({ ...previous, [name]: binding })),
      setStorageFailure: (failing) => { storageFailure = failing; },
      storageErrors,
    };
    return () => { delete window.chromeBench; };
  }, [setKeymap]);
  const inspect = () => chrome.setPanelOpen('sidebar', true);
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((next) => [...next, currentNodes]);
    setPast(past.slice(0, -1));
    setNodes(previous);
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    setPast((previous) => [...previous, currentNodes]);
    setFuture(future.slice(0, -1));
    setNodes(next);
  };
  return <ChromeRoot>
    <a ref={skipLink} className="canvas-skip-link" href="#stage" onClick={(event) => {
      event.preventDefault();
      document.getElementById('stage')?.focus({ preventScroll: true });
    }}>Skip to canvas</a>
    <MenuPill viewPicker={<span>Canvas</span>}><Menu>
      <MenuItem label="Add rectangle" icon="▭" shortcut={creationBindings.rectangle} onClick={() => addNode('rectangle')} />
      <MenuItem label="Add text" icon="T" shortcut={creationBindings.text} onClick={() => addNode('text')} />
      <MenuItem label="Toggle sidebar" icon="ⓘ" shortcut="sidebar" onClick={() => chrome.togglePanel('sidebar')} />
      <MenuItem label="Navigation" icon="☷" onClick={() => chrome.togglePanel('navigation')} />
      <MenuItem label="Hide chrome" shortcut="hideChrome" onClick={() => chrome.setChromeHidden(!chrome.chromeHidden)} />
    </Menu></MenuPill>
    <FloatingToolbar>
      <ToolbarItem label="Select" icon="↖" shortcut={bindings.select} active={tool === 'select'} onClick={() => chooseTool('select')} />
      <ToolbarItem label="Hand" icon="✋" shortcut={bindings.hand} active={tool === 'hand'} onClick={() => chooseTool('hand')} />
      <ToolbarItem label="Rectangle" icon="▭" shortcut={bindings.rectangle} active={tool === 'rectangle'} onClick={() => chooseTool('rectangle')} />
      <ToolbarItem label="Text" icon="T" shortcut={bindings.text} active={tool === 'text'} onClick={() => chooseTool('text')} />
      <ToolbarMore>
        <MenuItem label="Inspect selection" icon="ⓘ" shortcut={{ code: 'Enter' }} onClick={inspect} />
        <MenuItem label="Fit all" icon="⤢" shortcut={{ code: 'Digit1', shiftKey: true }} onClick={() => controller?.fit('all')} />
      </ToolbarMore>
    </FloatingToolbar>
    <ToolbarHint id="bench-tools">Choose a tool, then click the canvas</ToolbarHint>
    <ActionPill><PrimaryAction onClick={() => setDialog('share')}>Share</PrimaryAction><SidebarToggle /></ActionPill>
    <Sidebar inspector={selection.length ? <div className="bench-inspector"><h2>Selected node</h2>
      {selection.map((id) => <p key={id}>{id}</p>)}</div> : <div className="bench-inspector"><p>Select a node to inspect it</p>
      <button type="button" onClick={() => addNode()}>Add rectangle</button></div>}
      outline={<OutlinePanel label="Canvas outline" rowHeight={28} height={400}
        renderRow={(id: NodeId) => `${id}, ${fixtureById.get(id)?.title ?? id}`} />} />
    <NavigationPanel><nav aria-label="Canvas views"><button type="button" onClick={() => controller?.fit('all')}>All nodes</button></nav></NavigationPanel>
    <ZoomPill />
    <HistoryPill onUndo={undo} onRedo={redo} canUndo={past.length > 0} canRedo={future.length > 0} />
    <HelpButton onClick={() => setDialog('help')} />
    <WelcomeHints actions={[
      { label: 'Add rectangle', shortcut: creationBindings.rectangle, onClick: () => addNode('rectangle') },
      { label: 'Add text', shortcut: creationBindings.text, onClick: () => addNode('text') },
    ]} />
    {dialog && <dialog open className="bench-dialog" aria-label={dialog === 'share' ? 'Share canvas' : 'Canvas help'}>
      <h2>{dialog === 'share' ? 'Share canvas' : 'Canvas help'}</h2>
      {dialog === 'share' ? <label>Canvas link<input readOnly value={location.href} /></label>
        : <p>Use the toolbar to select, pan or add nodes. Open the sidebar to inspect the selection.</p>}
      <button type="button" onClick={() => setDialog(null)}>Close</button>
    </dialog>}
  </ChromeRoot>;
}

function App() {
  const [keymap, setKeymap] = useState<ChromeKeymap>(defaultChromeKeymap);
  const [currentNodes, updateNodes] = useState<readonly CanvasNode[]>(() => (emptyCanvas ? [] : nodes).map((node) => ({
    ...node, bounds: { ...node.bounds, width: node.frame ? node.bounds.width : 220, height: node.frame ? node.bounds.height : 76 },
  })));
  const [edges, updateEdges] = useState((emptyCanvas ? [] : fixture.edges).map((edge) => ({ ...edge, style: 'dependency' as const })));
  const data = useMemo(() => new Map(currentNodes.map((node) => [node.id, {
    title: fixtureById.get(node.id)?.title ?? node.id,
    rank: fixtureById.get(node.id)?.rank ?? 0,
    frame: node.frame === true,
  }])), [currentNodes]);
  const setNodes = useRef((next: readonly CanvasNode[]) => {
    flushSync(() => { updateEdges([]); updateNodes(next); });
  }).current;
  return <ChromeProvider keymap={keymap} onePanelBreakpoint={chromeEnabled ? 1100 : undefined}
    storage={chromeEnabled ? storage : undefined} onStorageError={(error) => storageErrors.push(error instanceof Error ? error.message : String(error))}><CanvasProvider label="React canvas engine bench" options={options} nodes={currentNodes} edges={edges}>
    <CanvasStage><WorldNodes data={data} renderNode={renderNode} nodeAttributes={nodeAttributes} className="card" /></CanvasStage>
    <BenchConnection setNodes={setNodes} count={currentNodes.length} />
    {chromeEnabled && <BenchChrome currentNodes={currentNodes} setNodes={setNodes} setKeymap={setKeymap} />}
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
