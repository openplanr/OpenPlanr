import { useMemo, useState } from 'react';

import {
  artifactRowStyle,
  Card,
  CardHeader,
  CommandHint,
  EmptyState,
  SelectionBar,
  Skeleton,
  StatePanel,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { clearInspector, useInspectorStore } from '../shell/inspector-selection.js';
import {
  AttentionCard,
  ChangedTodayCard,
  HomeHeader,
  PREVIEW_LIMIT,
  SpecsCard,
  SprintCard,
} from './HomeParts.js';
import {
  changedTodayGroups,
  type HomeAttention,
  highMeta,
  homeSelectionItems,
  homeSpecsHref,
  homeSprint,
  homeSummary,
  quietMeta,
  useHomePhoneWidth,
  waitingMeta,
} from './planning-home-view.js';
import { inspectPlanningNode, useLiveListSelection } from './planning-inspector.js';
import {
  planningAttentionIds,
  planningDisplayId,
  selectPlanningAttention,
} from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import './overview.css';

export type OverviewPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function HomeContent({
  model,
  attention,
}: {
  model: PlanningWorkspaceModel;
  attention: HomeAttention;
}) {
  const { graph, presentation } = model;
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const phone = useHomePhoneWidth();
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const groups = useMemo(() => changedTodayGroups(attention, byId), [attention, byId]);
  const sprint = useMemo(() => homeSprint(graph), [graph]);
  const activeSpecs = attention.perSpec.filter((spec) => {
    const node = byId.get(spec.id);
    return node && node.status !== 'done' && node.status !== 'addressed';
  });
  const attentionIds = (['waiting', 'stale', 'high-not-started'] as const).flatMap((filter) =>
    planningAttentionIds(attention, filter).slice(0, PREVIEW_LIMIT),
  );
  const visibleIds = [
    ...new Set([
      ...attentionIds,
      ...groups.slice(0, PREVIEW_LIMIT).flatMap((group) => (group.spec ? [group.spec.id] : [])),
      ...activeSpecs.slice(0, PREVIEW_LIMIT).map((spec) => spec.id),
      ...(sprint ? [sprint.node.id] : []),
    ]),
  ];
  const visibleNodes = visibleIds.flatMap((id) => {
    const node = byId.get(id);
    return node ? [node] : [];
  });
  const { rootRef, removalNotice } = useLiveListSelection(graph.nodes, visibleNodes, selectedId);
  const unknownReadiness = Object.values(attention.byId).filter(
    (item) => item.readiness === 'unknown',
  ).length;
  const nodesOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const node = byId.get(id);
      return node ? [node] : [];
    });
  const rowIds = [...attentionIds, ...(selectedId ? [selectedId] : [])]
    .filter((id) => byId.has(id))
    .map((id) => planningDisplayId(byId.get(id)));
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const waiting = selectedId && attention.waiting.some((item) => item.id === selectedId);
  const dependency = waiting
    ? byId.get(attention.byId[selectedId].openDependencyIds[0] ?? '')
    : undefined;
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline pc-overview"
      style={artifactRowStyle(rowIds)}
      data-route-kind="planning.overview"
    >
      <PlanningNotice presentation={presentation} />
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
      <HomeHeader attention={attention} summary={homeSummary(attention)} phone={phone} />
      {graph.nodes.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon="list"
            title="No planning files yet"
            description="Shape intent into a spec, then plan its stories and tasks."
            action={<CommandHint command="/planr:spec" size="sm" />}
          />
        </Card>
      ) : null}
      <div className="pc-home__columns">
        <div className="pc-home__attention">
          <AttentionCard
            title="Waiting on a dependency"
            description="Sorted by downstream tasks unblocked, then priority and ID."
            filter="waiting"
            tone="danger"
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            empty="Nothing is waiting on a dependency."
            meta={(node) => {
              const dependencies = nodesOf(attention.byId[node.id].openDependencyIds);
              return { ...waitingMeta(attention, node, dependencies), dependencies };
            }}
          />
          {unknownReadiness ? (
            <p className="pc-home__evidence">
              {unknownReadiness} items have unknown dependency readiness.{' '}
              <a href="#/diagnostics">Inspect data health</a>.
            </p>
          ) : null}
          {attention.dependencyCycleIds.length || attention.containmentCycleIds.length ? (
            <p className="pc-home__evidence">
              Dependency or containment cycles need review.{' '}
              <a href="#/diagnostics">Inspect data health</a>.
            </p>
          ) : null}
          <AttentionCard
            title={phone ? 'Gone quiet' : 'In progress, gone quiet'}
            description={`In progress with no authored update for ${attention.quietDays} days or more. Based on the authored date in the file.`}
            filter="stale"
            tone="warning"
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            empty="Nothing in progress has gone quiet."
            meta={(node) => quietMeta(attention, node)}
          />
          {attention.unknownStaleIds.length ? (
            <p className="pc-home__evidence">
              {attention.unknownStaleIds.length} in-progress items have unknown authored activity
              and are excluded from gone quiet.
            </p>
          ) : null}
          <AttentionCard
            title="High priority, not started"
            description="P0, P1, critical or high priority with outstanding status."
            filter="high-not-started"
            tone="info"
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            empty="No high-priority work is waiting to start."
            meta={highMeta}
          />
        </div>
        <div className="pc-home__context">
          <ChangedTodayCard groups={groups} selectedId={selectedId} />
          <SpecsCard
            specs={activeSpecs}
            byId={byId}
            href={homeSpecsHref()}
            selectedId={selectedId}
          />
          <SprintCard sprint={sprint} selectedId={selectedId} />
        </div>
      </div>
      <SelectionBar
        items={homeSelectionItems(selected, dependency)}
        onCopy={copy}
        shortcutsEnabled={shortcutsEnabled}
        onClear={clearInspector}
        onOpen={() => {
          if (selected) inspectPlanningNode(selected);
        }}
      />
    </div>
  );
}

export function OverviewPage({ currentBinding, current }: OverviewPageProps) {
  const model = resolvePlanningWorkspace(current, currentBinding);
  const [now] = useState(() => new Date().toISOString());
  const graph = model?.graph;
  const result = useMemo(() => {
    if (!graph) return null;
    try {
      return { attention: selectPlanningAttention(graph, now), error: false };
    } catch {
      return { attention: null, error: true };
    }
  }, [graph, now]);
  if (model && result?.attention) return <HomeContent model={model} attention={result.attention} />;
  if (result?.error)
    return (
      <div className="op-workspace pc-overview">
        <StatePanel
          state="error"
          eyebrow="Home unavailable"
          title="Attention could not be derived"
          description="The planning snapshot contains conflicting identities or invalid dependencies. Inspect data health before continuing."
          actions={<a href="#/diagnostics">Open Diagnostics</a>}
        />
      </div>
    );
  if (current.kind === 'loading' || current.kind === 'booting')
    return (
      <div
        className="op-workspace op-planning pc-overview"
        data-route-kind="planning.overview"
        aria-busy="true"
      >
        <header className="pc-home__header">
          <h1>Needs attention</h1>
        </header>
        <p role="status">Reading .planr/</p>
        <div className="pc-home__columns">
          <div className="pc-home__attention">
            {[
              'Waiting on a dependency',
              'In progress, gone quiet',
              'High priority, not started',
            ].map((title) => (
              <section className="pc-home__card" key={title}>
                <CardHeader title={title} />
                <div className="pc-home__loading">
                  {[0, 1, 2, 3].map((row) => (
                    <Skeleton key={row} h={48} />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="pc-home__context">
            <Skeleton h={240} />
            <Skeleton h={240} />
            <Skeleton h={160} />
          </div>
        </div>
      </div>
    );
  return <PlanningRefusal routeKind="planning.overview" title="Planning cannot be trusted" />;
}
