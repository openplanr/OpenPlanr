import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArtifactStatus,
  Button,
  EmptyState,
  type GraphNode,
  InlineAlert,
  SectionHeader,
  Select,
  Switch,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  type CanvasController,
  GraphCanvas,
  GraphFocusPanel,
  type RouteTool,
  usePublishRouteTools,
} from './graph-canvas.js';
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
  useInspectorStore,
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
const TYPE_GLYPH: Readonly<Record<PlanningArtifactType, string>> = {
  spec: 'SPEC',
  story: 'US',
  task: 'T',
  backlog: 'BL',
  adr: 'ADR',
  epic: 'EPIC',
  feature: 'FEAT',
  quick: 'QT',
  sprint: 'SPR',
};
const LENSES = [
  { id: 'lineage', label: 'Lineage' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'project', label: 'Whole project' },
] as const;
const FIT_SHORTCUT = Object.freeze({ code: 'KeyF', key: 'f' });
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
  const canvas = useRef<CanvasController | null>(null);
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
  const present = TYPES.filter((type) => model.graph.nodes.some((node) => node.type === type));
  const drawn = model.graph.nodes.length > 0 && projection.nodes.length > 0;
  const tools: readonly RouteTool[] = drawn
    ? [
        ...LENSES.map((item) => ({
          id: `graph.lens.${item.id}`,
          label: item.label,
          group: 'lens',
          groupLabel: 'Lens',
          active: lens === item.id,
          run: () => setLens(item.id),
        })),
        ...present.map((type) => ({
          id: `graph.type.${type}`,
          label: planningArtifactTypeLabel(type),
          glyph: TYPE_GLYPH[type],
          active: types.includes(type),
          run: () =>
            setTypes((prior) =>
              prior.includes(type) ? prior.filter((item) => item !== type) : [...prior, type],
            ),
        })),
        {
          id: 'graph.done',
          label: 'Dim done items',
          icon: 'check',
          active: dimDone,
          run: () => setDimDone((dim) => !dim),
        },
        {
          id: 'graph.fit',
          label: 'Fit selection',
          icon: 'target',
          shortcut: FIT_SHORTCUT,
          run: () => canvas.current?.fit('selection', { maxZoom: 1 }),
        },
      ]
    : [];
  usePublishRouteTools(tools);
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
  const counts = `${projection.nodes.length} of ${model.graph.nodes.length} nodes`;
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline op-focused-graph"
      data-route-kind="planning.graph"
      data-density={presentation?.density}
      data-graph-focus={lens !== 'project' ? (focusId ?? undefined) : undefined}
    >
      <PlanningNotice presentation={model.presentation} />
      <div className={drawn ? 'pc-visually-hidden' : undefined}>
        <SectionHeader
          headingLevel={1}
          title="Graph"
          count={counts}
          description="Explore lineage and dependencies. Select a node to inspect its record."
        />
      </div>
      <GraphFocusPanel tools={tools}>
        <section className="op-focused-graph__panel" aria-label="Graph focus">
          <h2>Focus</h2>
          <Select
            ariaLabel="Focus spec"
            value={lens === 'project' ? '' : (focusId ?? '')}
            clearValue=""
            active={false}
            onChange={(value) => {
              setFocus(value || null);
              setLens(value ? 'lineage' : 'project');
            }}
            options={[
              { value: '', label: 'Whole project' },
              ...(focused && focused.type !== 'spec'
                ? [{ value: focused.id, label: `${focused.id}: ${focused.title}` }]
                : []),
              ...model.graph.nodes
                .filter((node) => node.type === 'spec')
                .map((node) => ({ value: node.id, label: `${node.id}: ${node.title}` })),
            ]}
            trigger={
              lens !== 'project' && focused ? (
                <>
                  <WorkItemChip type={focused.type} id={focused.id} />
                  <span className="pc-chip__title">{focused.title}</span>
                </>
              ) : undefined
            }
          />
          <p role="status">
            {projection.nodes.length} nodes shown of {model.graph.nodes.length}. Everything outside
            the focus is hidden, not deleted.
          </p>
          {selected && (lens !== 'lineage' || selected.id !== focusId) ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFocus(selected.id);
                setLens('lineage');
              }}
            >
              {`Focus on ${selected.id}`}
            </Button>
          ) : null}
          {focusId && !focused ? (
            <InlineAlert tone="warn" title="Focus unavailable">
              {focusId} was removed. Choose another spec or Whole project.
            </InlineAlert>
          ) : null}
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
            Arrows move to connected neighbours. Enter opens the inspector. F fits the selection.
            Escape clears focus after closing overlays.
          </p>
          {projection.cycle ? (
            <InlineAlert tone="warn" title="Cycle in visible relationships">
              Some relationships return to an earlier node. The Outline lists each node once.
            </InlineAlert>
          ) : null}
          {missingFocus ? <p role="status">{missingFocus}</p> : null}
          {removalNotice ? <p role="status">{removalNotice}</p> : null}
          {unresolved && projection.unresolved.length ? (
            <InlineAlert tone="warn" title="Unresolved references">
              <ul>
                {projection.unresolved.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}
        </section>
      </GraphFocusPanel>
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
        <GraphCanvas
          nodes={nodes}
          edges={projection.edges}
          flow={lens === 'dependencies' ? 'target-to-source' : 'source-to-target'}
          scope={JSON.stringify([lens, focusId, types])}
          selectedId={selectedId}
          onController={(controller) => {
            canvas.current = controller;
          }}
          onSelect={(id, inspect) => {
            const node = index.byId.get(id);
            if (node) inspectPlanningNode(node, inspect);
          }}
          onFocusSelect={(id) => {
            const node = index.byId.get(id);
            if (node && (inspector.selection?.kind !== 'node' || inspector.selection.id !== id))
              inspectPlanningNode(node, false);
          }}
          preview={
            selected ? (
              <section className="op-focused-graph__preview" aria-label="Graph selection preview">
                <strong>
                  {selected.id}: {selected.title}
                </strong>
                <ArtifactStatus status={selected.status} />
                <p>{graphBlockerReason(model.graph, selected.id)}</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // The preview hides once the inspector opens, so focus moves to its node first.
                    Array.from(
                      rootRef.current?.querySelectorAll<HTMLElement>('.pc-graph-node') ?? [],
                    )
                      .find((node) => node.dataset.canonicalId === selected.id)
                      ?.focus({ preventScroll: true });
                    inspectPlanningNode(selected);
                  }}
                >
                  Open inspector
                </Button>
              </section>
            ) : undefined
          }
        />
      )}
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
