import { useEffect, useMemo, useState } from 'react';
import {
  ArtifactStatus,
  Button,
  DependencyGraph,
  EmptyState,
  type GraphNode,
  InlineAlert,
  SectionHeader,
  Switch,
  Tabs,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import {
  type GraphLens,
  graphBlockerReason,
  graphFocusIndex,
  initialGraphFocus,
  initialGraphLens,
  retainGraphRevision,
  selectFocusedGraph,
} from './graph-focus-model.js';
import {
  inspectPlanningNode,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import { type PlanningArtifactType, planningArtifactTypeLabel } from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import './planning.css';

export type GraphPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;
const TYPES: readonly PlanningArtifactType[] = [
  'spec',
  'story',
  'task',
  'backlog',
  'adr',
  'epic',
  'feature',
  'quick',
  'sprint',
];
const LENSES = [
  { id: 'lineage', label: 'Lineage' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'project', label: 'Whole project' },
] as const;
const dimmedNodes = new WeakMap<readonly GraphNode[], readonly GraphNode[]>();
function donePresentation(nodes: readonly GraphNode[], dim: boolean): readonly GraphNode[] {
  if (!dim) return nodes;
  let result = dimmedNodes.get(nodes);
  if (!result) {
    result = nodes.map((node) => ({ ...node, dimmed: node.status === 'done' }));
    dimmedNodes.set(nodes, result);
  }
  return result;
}
const VIEWS = [
  { id: 'graph', label: 'Graph' },
  { id: 'outline', label: 'Outline' },
] as const;

function FocusedWorkspace({
  model,
  presentation,
}: {
  model: PlanningWorkspaceModel;
  presentation: PlanningView | null;
}) {
  const inspector = useInspectorStore();
  const [lens, setLens] = useState<GraphLens>(() => initialGraphLens(model.graph));
  const [focusId, setFocus] = useState<string | null>(
    () =>
      presentation?.focusId ??
      initialGraphFocus(
        model.graph,
        inspector.selection?.kind === 'node' ? inspector.selection.id : null,
      ),
  );
  const [types, setTypes] = useState(TYPES);
  const [contains, setContains] = useState(true);
  const [dependencies, setDependencies] = useState(true);
  const [unresolved, setUnresolved] = useState(true);
  const [dimDone, setDimDone] = useState(true);
  const [view, setView] = useState<'graph' | 'outline'>('graph');
  const missingFocus = usePlanningViewFocus(presentation, model.graph.nodes);
  const projection = selectFocusedGraph(model.graph, {
    lens,
    focusId,
    types,
    contains,
    dependencies,
    presentation,
  });
  const index = graphFocusIndex(model.graph);
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : focusId;
  const visible = useMemo(
    () => model.graph.nodes.filter((node) => projection.ids.has(node.id)),
    [model.graph.nodes, projection.ids],
  );
  const { rootRef, removalNotice } = useLiveListSelection(
    model.graph.nodes,
    visible,
    selectedId ?? undefined,
  );
  const nodes = donePresentation(projection.nodes, dimDone);
  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const focused = focusId ? index.byId.get(focusId) : undefined;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const focus = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      if (index.byId.has(id)) {
        setFocus(id);
        setLens('lineage');
      }
    };
    const clear = () => {
      setFocus(null);
      setLens('project');
    };
    root.addEventListener('graph-focus', focus);
    root.addEventListener('graph-clear-focus', clear);
    return () => {
      root.removeEventListener('graph-focus', focus);
      root.removeEventListener('graph-clear-focus', clear);
    };
  }, [index, rootRef]);
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline op-focused-graph"
      data-route-kind="planning.graph"
      data-density={presentation?.density}
      data-graph-focus={lens !== 'project' ? (focusId ?? undefined) : undefined}
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        title="Graph"
        count={`${projection.nodes.length} of ${model.graph.nodes.length} nodes`}
        description="Explore lineage and dependencies. Select a node to inspect its record."
      />
      <div className="op-focused-graph__toolbar">
        <fieldset className="op-focused-graph__lenses" aria-label="Graph lens">
          {LENSES.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              aria-pressed={lens === item.id}
              onClick={() => setLens(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </fieldset>
        <Tabs
          label="Graph view"
          value={view}
          onChange={(id) => setView(id === 'outline' ? 'outline' : 'graph')}
          tabs={VIEWS}
        />
      </div>
      <div className="op-focused-graph__workspace">
        <aside className="op-focused-graph__sidebar" aria-label="Graph controls">
          <h2>Focus</h2>
          <label>
            Focus spec
            <select
              aria-label="Focus spec"
              value={lens === 'project' ? '' : (focusId ?? '')}
              onChange={(event) => {
                setFocus(event.target.value || null);
                setLens(event.target.value ? 'lineage' : 'project');
              }}
            >
              <option value="">Whole project</option>
              {focused && focused.type !== 'spec' ? (
                <option value={focused.id}>{focused.id}</option>
              ) : null}
              {model.graph.nodes
                .filter((node) => node.type === 'spec')
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.id}: {node.title}
                  </option>
                ))}
            </select>
          </label>
          <p>{lens === 'project' ? 'Whole project' : (focused?.title ?? 'Whole project')}</p>
          <p role="status">
            {projection.nodes.length} nodes shown of {model.graph.nodes.length}. Everything outside
            the focus is hidden, not deleted.
          </p>
          {focusId && !focused ? (
            <InlineAlert tone="warn" title="Focus unavailable">
              {focusId} was removed. Choose another spec or Whole project.
            </InlineAlert>
          ) : null}
          <h2>Show</h2>
          {TYPES.filter((type) => model.graph.nodes.some((node) => node.type === type)).map(
            (type) => (
              <Switch
                key={type}
                label={planningArtifactTypeLabel(type)}
                checked={types.includes(type)}
                onChange={(checked) =>
                  setTypes((prior) =>
                    checked ? [...prior, type] : prior.filter((item) => item !== type),
                  )
                }
              />
            ),
          )}
          <Switch label="Dim done items" checked={dimDone} onChange={setDimDone} />
          <h2>Edges</h2>
          <Switch
            label={`contains · ${projection.edges.filter((edge) => edge.kind === 'contains').length}`}
            checked={contains}
            onChange={setContains}
          />
          <Switch
            label={`depends_on · ${projection.edges.filter((edge) => edge.kind === 'depends_on').length}`}
            checked={dependencies}
            onChange={setDependencies}
          />
          <Switch
            label={`Unresolved references · ${projection.unresolved.length}`}
            checked={unresolved}
            onChange={setUnresolved}
          />
          <p className="pc-graph-legend">
            <span className="pc-graph-legend__line" /> contains{' '}
            <span className="pc-graph-legend__line" data-kind="depends_on" /> depends on
          </p>
          <p>
            Arrows move to connected neighbours. Enter opens the inspector. F focuses selection.
            Escape clears focus after closing overlays.
          </p>
        </aside>
        <div className="op-focused-graph__surface">
          {model.graph.nodes.length === 0 ? (
            <EmptyState
              icon="workflow"
              title="Nothing to draw"
              description="This plan has no artifacts yet."
            />
          ) : projection.nodes.length === 0 ? (
            <EmptyState
              icon="workflow"
              title="No matching nodes"
              description="Clear the type filters to see the focused lineage."
              action={<Button onClick={() => setTypes(TYPES)}>Clear filters</Button>}
            />
          ) : (
            <DependencyGraph
              nodes={nodes}
              edges={projection.edges}
              focusedIds={lens === 'project' ? undefined : projection.ids}
              view={view}
              flow={lens === 'dependencies' ? 'target-to-source' : 'source-to-target'}
              selectedId={selectedId}
              onSelect={(id) => {
                const node = index.byId.get(id);
                if (node) inspectPlanningNode(node);
              }}
              onFocusSelect={(id) => {
                const node = index.byId.get(id);
                if (node && (inspector.selection?.kind !== 'node' || inspector.selection.id !== id))
                  inspectPlanningNode(node, false);
              }}
              height={600}
            />
          )}
          <section className="op-focused-graph__preview" aria-label="Graph selection preview">
            {selected ? (
              <>
                <strong>
                  {selected.id}: {selected.title}
                </strong>
                <ArtifactStatus status={selected.status} />
                <p>{graphBlockerReason(model.graph, selected.id)}</p>
                <Button variant="ghost" onClick={() => inspectPlanningNode(selected)}>
                  Open inspector
                </Button>
              </>
            ) : (
              <p>Select a node to preview its dependencies.</p>
            )}
          </section>
          {projection.cycle ? (
            <InlineAlert tone="warn" title="Cycle in visible relationships">
              Some relationships return to an earlier node. The structural outline lists each node
              without recursive nesting.
            </InlineAlert>
          ) : null}
          {unresolved && projection.unresolved.length ? (
            <InlineAlert tone="warn" title="Unresolved references">
              <ul>
                {projection.unresolved.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}
          {missingFocus ? <p role="status">{missingFocus}</p> : null}
          {removalNotice ? <p role="status">{removalNotice}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function GraphPage({ currentBinding, current }: GraphPageProps) {
  const token = usePlanningView();
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model)
    return <PlanningRefusal routeKind="planning.graph" title="Planning cannot be trusted" />;
  const scope = [
    currentBinding.actorId,
    currentBinding.projectId,
    currentBinding.scopeId,
    currentBinding.domainId,
    currentBinding.domainVersion,
    currentBinding.generation,
  ].join(':');
  return (
    <FocusedWorkspace
      key={scope}
      model={{ ...model, graph: retainGraphRevision(model.graph, model.binding) }}
      presentation={token?.route === 'graph' ? token : null}
    />
  );
}
