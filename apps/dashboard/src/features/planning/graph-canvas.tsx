import type {
  CanvasController,
  CanvasEdge,
  CanvasLevel,
  CanvasNode,
  Direction,
} from '@openplanr/canvas';
import {
  CanvasProvider,
  type CanvasProviderProps,
  CanvasStage,
  OutlinePanel,
  WorldNodes,
} from '@openplanr/canvas/react';
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  GRAPH_COL_W,
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
  GraphNodeContent,
  graphLayout,
  graphNodeDescription,
} from '../../design-system/components/index.js';
import { registerCanvasKeys } from '../shell/keyboard-coordinator.js';
import { type RouteTool, usePublishCanvasRoute, useRouteSlot } from '../shell/route-tools.js';
import { RouteSlotLayout } from '../shell/shell-navigation.js';
import { GraphMinimap, useGraphColors } from './graph-minimap.js';
import { GraphPhoneTools } from './graph-phone-tools.js';

export type { CanvasController } from '@openplanr/canvas';
export { type RouteTool, usePublishRouteTools } from '../shell/route-tools.js';

/** The Graph keeps its whole-project fit for long dependency chains. */
const GRAPH_ZOOM = Object.freeze({ min: 0.0001, max: 2 });
const EDGE_SAMPLES = 8;
// Stage labels are not culled; long chains keep the first stages so the stage stays within its
// DOM budget (the 5,000-node fixture has thousands of stages).
const MAX_RANK_LABELS = 64;

export type GraphCanvasModel = Readonly<{
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  items: ReadonlyMap<string, GraphItem>;
  order: ReadonlyMap<string, number>;
}>;
type GraphItem = Readonly<{ node: GraphNode; selected: boolean; related: boolean }>;

/** Engine style name for an edge: contains solid, depends dashed, blocked and traced variants. */
export function graphEdgeStyle(edge: GraphEdge): string {
  const kind = edge.blocked ? 'blocked' : edge.kind === 'contains' ? 'contains' : 'depends';
  return `pc-graph-edge-${kind}${edge.active ? '-active' : ''}`;
}

function edgePoints(from: Readonly<{ x: number; y: number }>, to: typeof from) {
  const x1 = from.x + GRAPH_NODE_W;
  const y1 = from.y + GRAPH_NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + GRAPH_NODE_H / 2;
  const midX = (x1 + x2) / 2;
  // Samples the cubic the scroll graph drew, since the engine draws polylines.
  return Array.from({ length: EDGE_SAMPLES + 1 }, (_, index) => {
    const t = index / EDGE_SAMPLES;
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * midX + 3 * u * t * t * midX + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
    };
  });
}

const models = new WeakMap<GraphLayout, GraphCanvasModel>();

/** Engine nodes, edges and card items for a layout; identity is stable per layout. */
export function graphCanvasModel(layout: GraphLayout): GraphCanvasModel {
  const cached = models.get(layout);
  if (cached) return cached;
  const nodes: CanvasNode[] = [];
  const items = new Map<string, GraphItem>();
  const order = new Map<string, number>();
  for (const node of layout.byId.values()) {
    const point = layout.position.get(node.id);
    if (!point) continue;
    order.set(node.id, order.size);
    nodes.push({
      id: node.id,
      kind: node.type,
      bounds: { x: point.x, y: point.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H },
    });
    items.set(node.id, { node, selected: false, related: layout.tracedIds.has(node.id) });
  }
  const edges: CanvasEdge[] = [];
  for (const edge of layout.edges) {
    const from = layout.position.get(edge.from);
    const to = layout.position.get(edge.to);
    if (!from || !to) continue;
    edges.push({
      id: `${edge.kind ?? ''}:${edge.from}>${edge.to}`,
      from: edge.from,
      to: edge.to,
      style: graphEdgeStyle(edge),
      points: edgePoints(from, to),
    });
  }
  const model = { nodes, edges, items, order };
  models.set(layout, model);
  return model;
}

function canonical(layout: GraphLayout, id: string): string {
  return layout.byId.get(id)?.canonicalId ?? id;
}

/**
 * Arrow navigation between connected nodes: Left and Right take the nearest neighbour in that
 * direction, Up and Down step through the neighbours in vertical order; ties use canonical IDs.
 */
export function graphNavigate(
  layout: GraphLayout,
  from: string,
  direction: Direction,
): string | null {
  const origin = layout.position.get(from);
  if (!origin) return null;
  const neighbours = (layout.neighbours.get(from) ?? []).filter((id) => layout.position.has(id));
  const at = (id: string) => layout.position.get(id) ?? origin;
  const byId = (left: string, right: string) =>
    canonical(layout, left).localeCompare(canonical(layout, right));
  if (direction === 'left' || direction === 'right') {
    const sign = direction === 'left' ? -1 : 1;
    return (
      neighbours
        .filter((id) => (at(id).x - origin.x) * sign > 0)
        .sort(
          (left, right) =>
            Math.hypot(at(left).x - origin.x, at(left).y - origin.y) -
              Math.hypot(at(right).x - origin.x, at(right).y - origin.y) || byId(left, right),
        )[0] ?? null
    );
  }
  const ordered = [...neighbours, from].sort(
    (left, right) => at(left).y - at(right).y || byId(left, right),
  );
  return ordered[ordered.indexOf(from) + (direction === 'up' ? -1 : 1)] ?? null;
}

const subscribeHeight = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};

function GraphOutline({
  layout,
  onActivate,
}: Readonly<{ layout: GraphLayout; onActivate: (id: string) => Promise<void> }>) {
  const slot = useRouteSlot('outline');
  // Sidebar body: the window less the 64 px panel insets and the tab header.
  const height = useSyncExternalStore(
    subscribeHeight,
    () => Math.max(160, window.innerHeight - 200),
    () => 600,
  );
  if (!slot) return null;
  return createPortal(
    <OutlinePanel
      label="Graph nodes"
      rowHeight={64}
      height={height}
      onActivate={onActivate}
      renderRow={(id) => {
        const node = layout.byId.get(id);
        return (
          <span className="pc-graph-outline__row">
            <span className="pc-graph-outline__id">{id}</span>
            <span className="pc-graph-outline__label">{node?.label ?? id}</span>
            {layout.relationships.has(id) ? (
              <span className="pc-graph-outline__id">
                {layout.relationships.get(id)?.join('; ')}
              </span>
            ) : null}
          </span>
        );
      }}
    />,
    slot,
  );
}

/** Renders into the chrome's left panel, the phone tool bar's More, or in place without a shell. */
export function GraphFocusPanel({
  tools,
  canvas,
  children,
}: Readonly<{
  tools: readonly RouteTool[];
  canvas: RefObject<CanvasController | null>;
  children: ReactNode;
}>) {
  const slot = useRouteSlot('panel');
  const phone = useContext(RouteSlotLayout) === 'phone';
  if (slot) return createPortal(children, slot);
  return phone ? (
    <GraphPhoneTools tools={tools} canvas={canvas}>
      {children}
    </GraphPhoneTools>
  ) : (
    children
  );
}

function nodeAttributes(id: string, item: GraphItem | undefined, level: CanvasLevel) {
  if (!item) return {};
  const { node, selected } = item;
  const identity = node.canonicalId ?? id;
  return {
    role: 'button',
    title: `${id}: ${node.label}`,
    'aria-label': level === 'compact' ? `${id} ${node.label}` : undefined,
    'aria-pressed': String(selected),
    'aria-description': graphNodeDescription(node),
    'data-keyboard-item': identity,
    'data-canonical-id': identity,
    'data-selected': selected ? 'true' : undefined,
    'data-related': item.related ? 'true' : undefined,
    'data-blocked': node.blocked ? 'true' : undefined,
    'data-dimmed': node.dimmed ? 'true' : undefined,
    'data-level': level,
  };
}

function renderNode(_id: string, item: GraphItem | undefined, level: CanvasLevel): ReactNode {
  if (!item) return null;
  if (level === 'compact' && !item.selected)
    return <span className="pc-graph-node__label">{item.node.label}</span>;
  return <GraphNodeContent node={item.node} />;
}

export type GraphCanvasProps = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  flow: 'source-to-target' | 'target-to-source';
  /** Changing the scope fits the new layout into the safe area; live patches keep the camera. */
  scope: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocusSelect: (id: string) => void;
  /** Receives the live controller for route tools such as Fit, then null on unmount. */
  onController?: (controller: CanvasController | null) => void;
  /** Shown under the selected card, in world space so it pans without React work. */
  preview?: ReactNode;
}>;

/** The full-window Graph canvas: engine camera, culling, overview, minimap and outline. */
export function GraphCanvas({
  nodes,
  edges,
  flow,
  scope,
  selectedId,
  onSelect,
  onFocusSelect,
  onController,
  preview,
}: GraphCanvasProps) {
  const layout = useMemo(() => graphLayout(nodes, edges, flow), [nodes, edges, flow]);
  const model = graphCanvasModel(layout);
  const selected = selectedId ? (layout.displayId.get(selectedId) ?? selectedId) : null;
  const [controller, setController] = useState<CanvasController | null>(null);
  const latest = useRef({ layout, model, selected, onSelect, onFocusSelect, onController });
  latest.current = { layout, model, selected, onSelect, onFocusSelect, onController };
  const pendingFit = useRef<readonly string[] | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const colors = useGraphColors(stage);
  usePublishCanvasRoute(true);
  // Options live as long as the controller, so they read the latest layout through the ref.
  const options = useMemo<CanvasProviderProps['options']>(
    () => ({
      zoom: GRAPH_ZOOM,
      overviewStyle: colors,
      navigate: (from, direction) => graphNavigate(latest.current.layout, from, direction),
      outlineOrder: (canvasNodes) => {
        const { order } = latest.current.model;
        return canvasNodes
          .map((node) => node.id)
          .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
      },
    }),
    [colors],
  );
  const items = useMemo(() => {
    const item = selected ? model.items.get(selected) : undefined;
    if (!selected || !item) return model.items;
    return new Map(model.items).set(selected, { ...item, selected: true });
  }, [model, selected]);

  useEffect(() => {
    if (!controller) return;
    latest.current.onController?.(controller);
    const unregister = registerCanvasKeys((event) => controller.handleKey(event));
    const selectionOff = controller.on('selection', (ids) => {
      const [id] = ids;
      if (id !== undefined && id !== latest.current.selected) latest.current.onSelect(id);
    });
    const focusOff = controller.on('focus', (id) => {
      if (id !== null && id !== latest.current.selected) latest.current.onFocusSelect(id);
    });
    return () => {
      latest.current.onController?.(null);
      unregister();
      selectionOff();
      focusOff();
    };
  }, [controller]);
  useEffect(() => {
    if (!controller) return;
    const current = controller.getSelection();
    const next = selected && layout.position.has(selected) ? [selected] : [];
    if (current.length !== next.length || current[0] !== next[0]) controller.setSelection(next);
  }, [controller, selected, layout]);
  // Runs after the provider's setNodes effect, so the fit measures the new scope.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a scope change refits.
  useEffect(() => {
    if (!controller) return;
    const target = pendingFit.current ?? 'all';
    pendingFit.current = null;
    const fit = () => {
      const area = controller.getSafeArea();
      if (area.width <= 0 || area.height <= 0) return false;
      controller.fit(target, { maxZoom: 1 });
      return true;
    };
    // A stage measured at zero size fits once it first has room.
    if (fit()) return;
    const off = controller.on('safe-area', () => {
      if (fit()) off();
    });
    return off;
  }, [controller, scope]);
  useEffect(() => {
    const element = stage.current;
    if (!element || !controller) return;
    // F focuses a node; once its lineage scope commits, the fit centres that node instead.
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string } | undefined>).detail;
      const id = detail?.id ? (latest.current.layout.displayId.get(detail.id) ?? detail.id) : null;
      if (!id) return;
      pendingFit.current = [id];
      requestAnimationFrame(() => {
        const target = pendingFit.current;
        pendingFit.current = null;
        if (target && target.every((node) => latest.current.layout.position.has(node)))
          controller.fit(target, { maxZoom: 1 });
      });
    };
    element.addEventListener('graph-focus', focus);
    return () => element.removeEventListener('graph-focus', focus);
  }, [controller]);
  const select = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const node =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-canvas-node-id]')
        : null;
    const id = node?.dataset.canvasNodeId;
    if (!node || !id) return;
    node.focus({ preventScroll: true });
    latest.current.onSelect(id);
  }, []);
  const activateOutline = useCallback(
    async (id: string) => {
      if (!controller) return;
      await controller.focusNode(id);
      latest.current.onFocusSelect(id);
    },
    [controller],
  );
  const anchor = selected ? layout.position.get(selected) : undefined;
  // The floating chrome owns the panel slot; without it (phone, bare tests) there is no minimap.
  const chrome = useRouteSlot('panel') !== null;
  const phoneMinimap = useRouteSlot('minimap');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: node wrappers are the engine's buttons; this delegates their clicks.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space reach nodes through the keyboard coordinator and engine.
    <div
      ref={stage}
      className="pc-graph-stage"
      data-tracing={layout.tracedIds.size > 0 || undefined}
      onClick={select}
    >
      <CanvasProvider
        label="Dependency graph"
        options={options}
        nodes={model.nodes}
        edges={model.edges}
        controllerRef={setController}
      >
        <CanvasStage className="pc-graph">
          <div className="pc-graph__ranks" aria-hidden="true" style={{ width: layout.width }}>
            {layout.columns.slice(0, MAX_RANK_LABELS).map((column, rank) => (
              <span
                key={column[0]?.id ?? 'empty'}
                className="pc-graph__rank"
                style={{ left: 48 + rank * GRAPH_COL_W + GRAPH_NODE_W / 2 }}
              >
                {rank === 0 ? 'foundation' : `stage ${rank + 1}`} · {column.length}
              </span>
            ))}
          </div>
          <WorldNodes
            data={items}
            className="pc-graph-node"
            renderNode={renderNode}
            nodeAttributes={nodeAttributes}
          />
          {preview && anchor ? (
            <div
              className="pc-graph-preview"
              style={{ transform: `translate(${anchor.x}px, ${anchor.y + GRAPH_NODE_H + 12}px)` }}
            >
              {preview}
            </div>
          ) : null}
        </CanvasStage>
        <GraphOutline layout={layout} onActivate={activateOutline} />
      </CanvasProvider>
      {controller && chrome ? (
        <GraphMinimap
          controller={controller}
          nodes={model.nodes}
          style={colors}
          selected={selected}
          stageRoot={stage}
        />
      ) : null}
      {controller && phoneMinimap
        ? createPortal(
            <GraphMinimap
              controller={controller}
              nodes={model.nodes}
              style={colors}
              selected={selected}
              stageRoot={stage}
              embedded
            />,
            phoneMinimap,
          )
        : null}
    </div>
  );
}
