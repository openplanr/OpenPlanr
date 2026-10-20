import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  CardHeader as ArtifactCardHeader,
  ArtifactRowCopy,
  ArtifactRowMeta,
  ArtifactRowTitle,
  ArtifactStatus,
  artifactRowStyle,
  Card,
  CommandHint,
  EmptyState,
  PcIcon,
  PriorityChip,
  Skeleton,
  StatePanel,
  Tooltip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import {
  type PlanningAttentionFilter,
  serializePlanningViewHref,
} from '../../lib/routing/planning-view-codec.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
} from './planning-inspector.js';
import { listPreset } from './planning-list-filter.js';
import {
  type PlanningModelNode,
  planningAttentionIds,
  planningAttentionView,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
  planningSprintMembersOf,
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

type AttentionProjection = ReturnType<typeof selectPlanningAttention>;

const PREVIEW_LIMIT = 5;

function LastVisit({ projectId, successful }: { projectId: string; successful: boolean }) {
  const recorded = useRef(false);
  const [visit, setVisit] = useState<{ at: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!successful || recorded.current) return;
    recorded.current = true;
    const now = new Date().toISOString();
    try {
      const key = `op-home-seen:v1:${projectId}`;
      const previous = window.localStorage.getItem(key);
      const valid =
        previous !== null &&
        /^\d{4}-\d{2}-\d{2}T/u.test(previous) &&
        Number.isFinite(Date.parse(previous)) &&
        Date.parse(previous) <= Date.parse(now);
      window.localStorage.setItem(key, now);
      setVisit({ at: valid ? previous : null, failed: false });
    } catch {
      setVisit({ at: null, failed: true });
    }
  }, [projectId, successful]);
  return (
    <p className="pc-home__visit" role="status">
      {visit?.failed ? (
        'Since your last visit is unavailable: browser storage could not be accessed.'
      ) : visit?.at ? (
        <>
          Since your last visit:{' '}
          <time dateTime={visit.at}>
            {new Date(visit.at).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
          </time>
          . Stored only in this browser.
        </>
      ) : visit ? (
        'First visit in this browser. Your next visit will show this timestamp.'
      ) : (
        'Since your last visit will be available after a successful read.'
      )}
    </p>
  );
}

function NodeLink({
  node,
  children,
  keyboard = false,
  selected = false,
  className,
  describedBy,
  ...linkProps
}: {
  node: PlanningModelNode;
  children: ReactNode;
  keyboard?: boolean;
  selected?: boolean;
  className?: string;
  describedBy?: string;
} & Omit<ComponentProps<'a'>, 'children'>) {
  return (
    <a
      {...linkProps}
      className={className}
      aria-describedby={describedBy}
      data-keyboard-item={keyboard ? node.id : undefined}
      data-selected={selected || undefined}
      href={planningDetailHref(node) ?? undefined}
      onClick={(event) => {
        linkProps.onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        inspectPlanningNode(node);
      }}
      onFocus={(event) => {
        linkProps.onFocus?.(event);
        inspectPlanningNode(node, false);
      }}
    >
      {children}
    </a>
  );
}

function HomeRow({
  node,
  reason,
  commandNode,
  dependencies = [],
  selected,
  layout,
}: {
  node: PlanningModelNode;
  reason?: ReactNode;
  commandNode?: PlanningModelNode;
  dependencies?: readonly PlanningModelNode[];
  selected: boolean;
  layout?: 'stacked';
}) {
  const command = planningContinuation(commandNode ?? node);
  const onCopy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const dependencyDescriptionId = useId();
  const dependencyLabel = `Waits on unfinished dependencies: ${dependencies.map(planningDisplayId).join(', ')}`;
  return (
    <li
      className="pc-home__row pc-artifact-row"
      data-selected={selected || undefined}
      data-layout={layout}
      data-mobile-layout="stacked"
    >
      <NodeLink node={node} keyboard selected={selected} className="pc-artifact-row__link">
        <span className="pc-artifact-row__id">
          <WorkItemChip type={node.type} id={planningDisplayId(node)} />
        </span>
        <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
      </NodeLink>
      <span className="pc-artifact-row__meta-group">
        {reason}
        {dependencies.length ? (
          <span className="pc-home__dependencies">
            {dependencies.length === 1 ? (
              <Tooltip content={dependencyLabel}>
                <NodeLink
                  node={dependencies[0]}
                  className="pc-artifact-row__meta"
                  describedBy={dependencyDescriptionId}
                >
                  <PcIcon name="git-pull-request" size={13} />
                  <span className="pc-artifact-row__meta-value">1</span>
                  <span id={dependencyDescriptionId} className="pc-visually-hidden">
                    {dependencyLabel}
                  </span>
                </NodeLink>
              </Tooltip>
            ) : (
              <ArtifactRowMeta icon="git-pull-request" label={dependencyLabel}>
                {dependencies.length}
              </ArtifactRowMeta>
            )}
          </span>
        ) : null}
      </span>
      <ArtifactRowCopy
        id={planningDisplayId(node)}
        command={command}
        onCopy={onCopy}
        shortcutsEnabled={shortcutsEnabled}
      />
    </li>
  );
}

function AttentionCard({
  title,
  description,
  filter,
  attention,
  byId,
  selectedId,
  reason,
}: {
  title: string;
  description: string;
  filter: PlanningAttentionFilter;
  attention: AttentionProjection;
  byId: ReadonlyMap<string, PlanningModelNode>;
  selectedId?: string;
  reason: (node: PlanningModelNode) => ReactNode;
}) {
  const headingId = useId();
  const ids = planningAttentionIds(attention, filter);
  const previous = useRef<readonly string[]>([]);
  const nodes = ids.flatMap((id) => {
    const node = byId.get(id);
    return node ? [node] : [];
  });
  // Keep the inspected row mounted when a live patch resolves its attention reason.
  if (selectedId && previous.current.includes(selectedId) && !ids.includes(selectedId)) {
    const selected = byId.get(selectedId);
    if (selected)
      nodes.splice(Math.min(previous.current.indexOf(selectedId), nodes.length), 0, selected);
  }
  const ordered = useLiveListOrder(nodes, filter);
  const preview = ordered.slice(0, PREVIEW_LIMIT);
  useEffect(() => {
    previous.current = preview.map((node) => node.id);
  }, [preview]);
  return (
    <section className="pc-home__card" aria-labelledby={headingId} data-attention={filter}>
      <ArtifactCardHeader
        id={headingId}
        title={title}
        glyph={
          filter === 'changed-today' ? (
            <span className="pc-card__glyph" data-live="true" />
          ) : (
            <ArtifactStatus
              status={
                filter === 'waiting' ? 'blocked' : filter === 'stale' ? 'quiet' : 'outstanding'
              }
              variant="glyph"
            />
          )
        }
        count={ids.length}
        description={description}
        href={serializePlanningViewHref(planningAttentionView(filter))}
      />
      {preview.length ? (
        <ul
          className="pc-home__rows pc-artifact-rows"
          data-layout={filter === 'changed-today' ? 'stacked' : undefined}
        >
          {preview.map((node) => {
            const item = attention.byId[node.id];
            const dependencies =
              filter === 'waiting'
                ? item.openDependencyIds.flatMap((id) => {
                    const dependency = byId.get(id);
                    return dependency ? [dependency] : [];
                  })
                : [];
            return (
              <HomeRow
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                layout={filter === 'changed-today' ? 'stacked' : undefined}
                reason={
                  ids.includes(node.id) ? reason(node) : 'No longer matches this attention list.'
                }
                dependencies={dependencies}
                commandNode={dependencies[0]}
              />
            );
          })}
        </ul>
      ) : (
        <p className="pc-home__empty">Nothing needs attention here.</p>
      )}
    </section>
  );
}

function HomeContent({
  model,
  attention,
}: {
  model: PlanningWorkspaceModel;
  attention: AttentionProjection;
}) {
  const { graph, presentation } = model;
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const visibleIds = [
    ...new Set(
      (['waiting', 'stale', 'high-not-started', 'changed-today'] as const).flatMap((filter) =>
        planningAttentionIds(attention, filter).slice(0, PREVIEW_LIMIT),
      ),
    ),
  ];
  const visibleNodes = visibleIds.flatMap((id) => {
    const node = graph.nodes.find((entry) => entry.id === id);
    return node ? [node] : [];
  });
  const { rootRef, removalNotice } = useLiveListSelection(graph.nodes, visibleNodes, selectedId);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const totals = attention.statusTotals;
  const unknownReadiness = Object.values(attention.byId).filter(
    (item) => item.readiness === 'unknown',
  ).length;
  const activeSpecs = attention.perSpec.filter((spec) => {
    const node = byId.get(spec.id);
    return node && node.status !== 'done' && node.status !== 'addressed';
  });
  const openView = listPreset('open');
  const specsHref = serializePlanningViewHref({
    ...openView,
    filters: { ...openView.filters, type: ['spec'] },
  });
  const activeSprint = graph.nodes.find(
    (node) => node.type === 'sprint' && node.status !== 'done' && node.status !== 'addressed',
  );
  const sprintItems = activeSprint ? planningSprintMembersOf(graph, activeSprint) : [];
  const doneSprintItems = sprintItems.filter(
    (node) => node.status === 'done' || node.status === 'addressed',
  ).length;
  const donePct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  const rowIds = [
    ...visibleNodes,
    ...activeSpecs.slice(0, PREVIEW_LIMIT).flatMap((spec) => {
      const node = byId.get(spec.id);
      return node ? [node] : [];
    }),
    ...(activeSprint ? [activeSprint] : []),
    ...graph.nodes.filter((node) => node.id === selectedId),
  ].map(planningDisplayId);
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
      <header className="pc-home__header">
        <div>
          <p className="op-eyebrow">
            <time dateTime={attention.changedToday.date}>
              {new Date(`${attention.changedToday.date}T00:00:00Z`).toLocaleDateString(undefined, {
                timeZone: 'UTC',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </time>
          </p>
          <h1>Needs attention</h1>
          <p>{attention.changedToday.ids.length} items changed today by authored date.</p>
          <LastVisit
            key={model.binding.projectId}
            projectId={model.binding.projectId}
            successful={presentation === 'ready' || presentation === 'read-only'}
          />
        </div>
        <section className="pc-home__summary" aria-label="Project status">
          <div className="pc-home__summary-heading">
            <span>
              {totals.total} {totals.total === 1 ? 'item' : 'items'}
            </span>
            <span>{donePct}% done</span>
          </div>
          <div className="pc-home__status-bar" aria-hidden="true">
            {(
              [
                ['done', totals.done],
                ['addressed', totals.addressed],
                ['in-progress', totals.inProgress],
                ['outstanding', totals.outstanding],
                ['unknown', totals.unknown],
              ] as const
            ).map(([status, count]) => (
              <span key={status} data-status={status} style={{ flexGrow: count }} />
            ))}
          </div>
          <div className="pc-home__legend">
            <ArtifactStatus
              variant="legend"
              status="outstanding"
              label={`${totals.outstanding} outstanding`}
            />
            <ArtifactStatus
              variant="legend"
              status="in-progress"
              label={`${totals.inProgress} in progress`}
            />
            <ArtifactStatus
              variant="legend"
              status="blocked"
              label={`${totals.blocked} open items blocked`}
            />
            <ArtifactStatus variant="legend" status="done" label={`${totals.done} done`} />
            <ArtifactStatus
              variant="legend"
              status="addressed"
              label={`${totals.addressed} addressed`}
            />
            {totals.unknown ? <span>{totals.unknown} unknown</span> : null}
          </div>
        </section>
      </header>
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
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            reason={(node) => (
              <ArtifactRowMeta
                icon="git-branch"
                label={`${attention.byId[node.id].downstreamUnblockCount} downstream open tasks${attention.byId[node.id].readiness === 'unknown' ? '; Readiness unknown: unresolved dependencies.' : ''}`}
              >
                {attention.byId[node.id].downstreamUnblockCount}
              </ArtifactRowMeta>
            )}
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
            title="In progress, gone quiet"
            description={`No authored update in ${attention.quietDays}+ days. Commit-aware detection is available in Phase 2.`}
            filter="stale"
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            reason={(node) => {
              const stale = attention.stale.find((entry) => entry.id === node.id);
              return stale ? (
                <ArtifactRowMeta
                  icon="clock"
                  label={`${Math.floor(stale.ageDays)} days since authored update (${stale.authoredAt.slice(0, 10)}). Git activity is unknown.`}
                >
                  {Math.floor(stale.ageDays)}d
                </ArtifactRowMeta>
              ) : (
                'Authored activity unknown.'
              );
            }}
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
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            reason={(node) => (
              <ArtifactRowMeta
                icon="flag"
                label={`Priority ${String(node.frontmatter.priority)}${attention.byId[node.id].readiness === 'unknown' ? '; readiness unknown.' : ''}`}
              >
                <PriorityChip priority={String(node.frontmatter.priority)} />
              </ArtifactRowMeta>
            )}
          />
        </div>
        <div className="pc-home__context">
          <AttentionCard
            title="Changed today"
            description="Authored updated date, falling back to created when absent. This is not a change history."
            filter="changed-today"
            attention={attention}
            byId={byId}
            selectedId={selectedId}
            reason={(node) => {
              const raw = String(node.frontmatter.updated ?? node.frontmatter.created);
              const date = new Date(raw);
              const changedIds =
                attention.changedToday.groups.find((group) => group.specId === node.id)?.ids ?? [];
              const stories = changedIds.filter((id) => byId.get(id)?.type === 'story').length;
              const tasks = changedIds.filter((id) => byId.get(id)?.type === 'task').length;
              return (
                <ArtifactRowMeta label={raw}>
                  {stories || tasks
                    ? `+ ${stories} ${stories === 1 ? 'story' : 'stories'}, ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`
                    : Number.isFinite(date.getTime())
                      ? date.toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        })
                      : 'Unknown'}
                </ArtifactRowMeta>
              );
            }}
          />
          <section className="pc-home__card" aria-label="Specs in flight">
            <ArtifactCardHeader
              title="Specs in flight"
              count={activeSpecs.length}
              description="Tasks done, counted once per spec."
              href={specsHref}
            />
            {activeSpecs.length ? (
              <ul className="pc-home__specs">
                {activeSpecs.slice(0, PREVIEW_LIMIT).map((spec) => {
                  const node = byId.get(spec.id);
                  if (!node) return null;
                  return (
                    <li key={spec.id} className="pc-artifact-row" data-mobile-layout="stacked">
                      <NodeLink node={node} className="pc-artifact-row__link">
                        <span className="pc-artifact-row__id">
                          <WorkItemChip type="spec" id={planningDisplayId(node)} />
                        </span>
                        <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
                      </NodeLink>
                      <span className="pc-artifact-row__meta-group">
                        <ArtifactRowMeta
                          icon="circle-check"
                          label={`${spec.done} of ${spec.total} tasks done`}
                        >
                          {spec.total ? `${spec.done}/${spec.total}` : 'No tasks'}
                        </ArtifactRowMeta>
                      </span>
                      <ArtifactRowCopy
                        onCopy={copy}
                        shortcutsEnabled={shortcutsEnabled}
                        id={planningDisplayId(node)}
                        command={planningContinuation(node)}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="pc-home__empty">No specs in flight.</p>
            )}
          </section>
          <section
            className="pc-home__card pc-home__sprint"
            aria-label={activeSprint ? 'Active sprint' : 'No active sprint'}
          >
            <ArtifactCardHeader
              title={activeSprint ? 'Active sprint' : 'No active sprint'}
              glyph={<PcIcon name="calendar-days" size={18} />}
              count={activeSprint ? 1 : 0}
              href="#/sprints"
            />
            {activeSprint ? (
              <>
                <ul className="pc-home__rows">
                  <HomeRow
                    node={activeSprint}
                    selected={selectedId === activeSprint.id}
                    reason={
                      <ArtifactRowMeta
                        icon="circle-check"
                        label={`${doneSprintItems} of ${sprintItems.length} sprint items done`}
                      >
                        {doneSprintItems}/{sprintItems.length}
                      </ArtifactRowMeta>
                    }
                  />
                </ul>
                <p>
                  {doneSprintItems} of {sprintItems.length} sprint items done.
                </p>
                <a href="#/sprints">View sprint</a>
              </>
            ) : (
              <p>Select the next sprint from your planning tools.</p>
            )}
            <CommandHint
              command="/planr:sprint"
              label={activeSprint ? 'Continue sprint planning' : 'Plan the next sprint'}
              size="sm"
            />
          </section>
        </div>
      </div>
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
                <ArtifactCardHeader title={title} />
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
