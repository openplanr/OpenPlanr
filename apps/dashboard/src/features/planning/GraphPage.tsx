import { useState } from 'react';
import {
  Card,
  CommandHint,
  DependencyGraph,
  EmptyState,
  type GraphEdge,
  type GraphNode,
  InlineAlert,
  SectionHeader,
  Select,
  Tabs,
  Toolbar,
  ToolbarDivider,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  type PlanningModelEdge,
  type PlanningModelGraph,
  type PlanningModelNode,
  planningDisplayId,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';

export type GraphPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

type EdgeKind = PlanningModelEdge['kind'];
type GraphView = 'graph' | 'outline';

type GraphIndex = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  byGraphId: ReadonlyMap<string, PlanningModelNode>;
  graphIdOf: ReadonlyMap<string, string>;
}>;

const EDGE_KINDS: readonly EdgeKind[] = Object.freeze(['depends_on', 'contains']);
const VIEW_TABS = Object.freeze([
  { id: 'graph', label: 'Graph', icon: 'workflow' },
  { id: 'outline', label: 'Outline', icon: 'list-tree' },
] as const);
const GRAPH_HEIGHT = 460;
const MONO_SM = Object.freeze({ font: 'var(--pc-type-mono-sm)' });
const MONO_NOTE = Object.freeze({
  font: 'var(--pc-type-mono-sm)',
  color: 'var(--pc-text-tertiary)',
});

function isEdgeKind(value: string): value is EdgeKind {
  return value === 'depends_on' || value === 'contains';
}

/**
 * Nodes touched by one edge kind, keyed by display id so the node code reads as authored.
 * A display id shared by two canonical ids falls back to the canonical id so edges stay exact.
 */
function selectGraphIndex(graph: PlanningModelGraph, kind: EdgeKind): GraphIndex {
  const kindEdges = graph.edges.filter((edge) => edge.kind === kind);
  const touched = new Set(kindEdges.flatMap((edge) => [edge.from, edge.to]));
  const displayCount = new Map<string, number>();
  for (const node of graph.nodes) {
    const display = planningDisplayId(node);
    displayCount.set(display, (displayCount.get(display) ?? 0) + 1);
  }

  const graphIdOf = new Map<string, string>();
  const byGraphId = new Map<string, PlanningModelNode>();
  const nodes: GraphNode[] = [];
  for (const node of graph.nodes) {
    if (!touched.has(node.id)) continue;
    const display = planningDisplayId(node);
    const graphId = displayCount.get(display) === 1 ? display : node.id;
    graphIdOf.set(node.id, graphId);
    byGraphId.set(graphId, node);
    nodes.push({
      id: graphId,
      type: node.type,
      label: node.title,
      blocked: node.status === 'blocked',
    });
  }

  const edges: GraphEdge[] = [];
  for (const edge of kindEdges) {
    const from = graphIdOf.get(edge.from);
    const to = graphIdOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const targetBlocked = kind === 'depends_on' && byGraphId.get(to)?.status === 'blocked';
    edges.push(targetBlocked ? { from, to, blocked: true } : { from, to });
  }
  return { nodes, edges, byGraphId, graphIdOf };
}

/** Edges that close a cycle. The outline nests parent to child, so it can only draw a DAG. */
function cycleClosingEdges(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ReadonlySet<GraphEdge> {
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }
  const mark = new Map<string, 'open' | 'closed'>();
  const closing = new Set<GraphEdge>();
  const visit = (id: string): void => {
    mark.set(id, 'open');
    for (const edge of outgoing.get(id) ?? []) {
      const seen = mark.get(edge.to);
      if (seen === 'open') closing.add(edge);
      else if (seen === undefined) visit(edge.to);
    }
    mark.set(id, 'closed');
  };
  for (const node of nodes) {
    if (!mark.has(node.id)) visit(node.id);
  }
  return closing;
}

export function GraphPage({ currentBinding, current }: GraphPageProps) {
  const [view, setView] = useState<GraphView>('graph');
  const [kind, setKind] = useState<EdgeKind>('depends_on');
  const inspector = useInspectorStore();

  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.graph" title="Planning cannot be trusted" />;
  }

  const index = selectGraphIndex(model.graph, kind);
  const closing = view === 'outline' ? cycleClosingEdges(index.nodes, index.edges) : null;
  const drawnEdges =
    closing && closing.size > 0 ? index.edges.filter((edge) => !closing.has(edge)) : index.edges;
  const selectedId =
    inspector.selection?.kind === 'node'
      ? (index.graphIdOf.get(inspector.selection.id) ?? null)
      : null;
  const visibleEdges = drawnEdges.map((edge) =>
    selectedId !== null && (edge.from === selectedId || edge.to === selectedId)
      ? { ...edge, active: true }
      : edge,
  );
  const openNode = (graphId: string) => {
    const node = index.byGraphId.get(graphId);
    if (node) inspectPlanningNode(node);
  };

  return (
    <div className="op-workspace op-planning pc-pipeline" data-route-kind="planning.graph">
      <PlanningNotice presentation={model.presentation} />
      <div>
        <SectionHeader
          headingLevel={1}
          eyebrow="planr-diagram · graph"
          title="Graph"
          count={`${index.nodes.length} nodes · ${index.edges.length} edges`}
          description={
            kind === 'depends_on'
              ? 'A dependency map ordered from prerequisites to dependent work. Select a node to trace its relationships and inspect its record.'
              : 'A containment map ordered from parent artifacts to their children. Select a node to inspect its record.'
          }
        />
        {model.graph.nodes.length === 0 ? (
          <Card padding={0}>
            <EmptyState
              icon="workflow"
              title="Nothing to draw"
              description="This plan has no artifacts yet, so there are no edges to show."
              action={<CommandHint command="/planr-plan" label="create the graph" size="sm" />}
            />
          </Card>
        ) : (
          <>
            <Toolbar
              right={
                <Tabs
                  size="sm"
                  label="Graph view"
                  value={view}
                  onChange={(id) => setView(id === 'outline' ? 'outline' : 'graph')}
                  tabs={VIEW_TABS}
                />
              }
            >
              <Select
                size="sm"
                width={132}
                ariaLabel="Edge kind"
                value={kind}
                onChange={(value) => {
                  if (isEdgeKind(value)) setKind(value);
                }}
                options={EDGE_KINDS}
              />
              <ToolbarDivider />
              <span style={MONO_NOTE}>edge kind</span>
            </Toolbar>
            {index.edges.length === 0 ? (
              <Card padding={0}>
                <EmptyState
                  icon="workflow"
                  title={`No ${kind} edges in this plan`}
                  description="Both views draw edges only; an artifact without an edge of this kind is not shown."
                />
              </Card>
            ) : (
              <div style={{ marginTop: 6 }}>
                <DependencyGraph
                  nodes={index.nodes}
                  edges={visibleEdges}
                  view={view}
                  flow={kind === 'depends_on' ? 'target-to-source' : 'source-to-target'}
                  selectedId={selectedId}
                  onSelect={openNode}
                  height={GRAPH_HEIGHT}
                />
              </div>
            )}
            {closing && closing.size > 0 ? (
              <div style={{ marginTop: 12 }}>
                <InlineAlert
                  tone="warn"
                  title={`${closing.size} ${closing.size === 1 ? 'edge closes' : 'edges close'} a cycle`}
                >
                  The outline nests parent to child and cannot draw a cycle, so these edges are left
                  out of it. The graph view draws every edge.
                </InlineAlert>
              </div>
            ) : null}
            {kind === 'depends_on' && index.edges.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <InlineAlert tone="info" title="Edges carry no satisfaction state">
                  An edge means <code style={MONO_SM}>depends_on</code>, nothing more. The model
                  does not say whether a dependency is met, so a satisfied edge and an unsatisfied
                  one draw identically; an edge dashes only when the artifact it points at is itself
                  blocked.
                </InlineAlert>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
