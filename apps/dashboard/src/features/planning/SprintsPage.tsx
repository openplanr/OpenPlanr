import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArtifactRowCopy,
  ArtifactRowTitle,
  ArtifactStatus,
  artifactRowStyle,
  Card,
  CardHeader,
  CommandHint,
  EmptyState,
  Skeleton,
  Tooltip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
} from './planning-inspector.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
} from './planning-model.js';
import {
  projectSprints,
  type SprintDate,
  type SprintRecord,
  sprintTimelineBounds,
} from './planning-sprints.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import './planning.css';
import './sprints.css';

export type SprintsPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

type OperateAction = Readonly<{
  id: string;
  priority: string;
  action: string;
  owner: string;
  firstStep: string;
  successMeasure: string;
}>;

type OperatePulse = Readonly<{
  cycleId: string;
  title: string;
  signal: string;
  updatedAt: string;
  counts: Readonly<{ actions: number; gaps: number }>;
  actions: readonly OperateAction[];
}>;

type OperatePulseState =
  | Readonly<{ status: 'loading'; pulse: null }>
  | Readonly<{ status: 'ready'; pulse: OperatePulse }>
  | Readonly<{ status: 'empty' | 'failed'; pulse: null }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOperatePulse(indexValue: unknown, detailValue: unknown): OperatePulse | null {
  if (!isRecord(indexValue) || !Array.isArray(indexValue.items) || !isRecord(indexValue.items[0])) {
    return null;
  }
  const summary = indexValue.items[0];
  const item = isRecord(detailValue) && isRecord(detailValue.item) ? detailValue.item : null;
  if (
    !item ||
    typeof summary.cycleId !== 'string' ||
    typeof summary.title !== 'string' ||
    typeof summary.signal !== 'string' ||
    typeof summary.updatedAt !== 'string' ||
    !isRecord(summary.counts) ||
    !Array.isArray(item.actions)
  ) {
    return null;
  }
  const actions = item.actions.filter((entry): entry is OperateAction => {
    if (!isRecord(entry)) return false;
    return ['id', 'priority', 'action', 'owner', 'firstStep', 'successMeasure'].every(
      (field) => typeof entry[field] === 'string',
    );
  });
  return Object.freeze({
    cycleId: summary.cycleId,
    title: summary.title,
    signal: summary.signal,
    updatedAt: summary.updatedAt,
    counts: Object.freeze({
      actions: Number.isSafeInteger(summary.counts.actions) ? Number(summary.counts.actions) : 0,
      gaps: Number.isSafeInteger(summary.counts.gaps) ? Number(summary.counts.gaps) : 0,
    }),
    actions: Object.freeze(actions),
  });
}

function useOperatePulse(): OperatePulseState {
  const [state, setState] = useState<OperatePulseState>({ status: 'loading', pulse: null });
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const indexUrl = new URL(
          '/api/operate/local-reviews?page=1&pageSize=1',
          window.location.origin,
        );
        const indexResponse = await fetch(indexUrl, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!indexResponse.ok) {
          setState({ status: 'failed', pulse: null });
          return;
        }
        const index = (await indexResponse.json()) as unknown;
        const cycleId =
          isRecord(index) && Array.isArray(index.items) && isRecord(index.items[0])
            ? index.items[0].cycleId
            : null;
        if (typeof cycleId !== 'string') {
          setState({ status: 'empty', pulse: null });
          return;
        }
        const detailResponse = await fetch(
          new URL(
            `/api/operate/local-reviews/${encodeURIComponent(cycleId)}`,
            window.location.origin,
          ),
          { headers: { accept: 'application/json' }, signal: controller.signal },
        );
        if (!detailResponse.ok) {
          setState({ status: 'failed', pulse: null });
          return;
        }
        const pulse = parseOperatePulse(index, (await detailResponse.json()) as unknown);
        setState(pulse ? { status: 'ready', pulse } : { status: 'failed', pulse: null });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'failed', pulse: null });
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 5_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);
  return state;
}

function actionMentionsScope(action: OperateAction, ids: ReadonlySet<string>): boolean {
  const text = `${action.action} ${action.firstStep} ${action.successMeasure}`.toLowerCase();
  return [...ids].some((id) => text.includes(id.toLowerCase()));
}

function DateLabel({ value }: { value: SprintDate }) {
  return value.time !== null && value.raw ? (
    <time dateTime={value.raw}>{value.raw}</time>
  ) : (
    <span>{value.raw ? `Invalid date: ${value.raw}` : 'Unknown'}</span>
  );
}

function Timeline({ sprints }: { sprints: readonly SprintRecord[] }) {
  const bounds = sprintTimelineBounds(sprints);
  const position = (time: number) => (bounds ? ((time - bounds.start) / bounds.span) * 100 : 0);
  return (
    <section className="pc-sprints__timeline pc-sprints__panel" aria-label="Sprint timeline">
      <h2>Timeline</h2>
      {bounds ? (
        <div className="pc-sprints__axis" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((tick) => (
            <span key={tick} style={{ left: `${tick * 25}%` }}>
              {new Date(bounds.start + ((bounds.end - bounds.start) * tick) / 4)
                .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
                .replace('Sept', 'Sep')}
            </span>
          ))}
        </div>
      ) : (
        <p>Timeline unavailable: no valid authored dates.</p>
      )}
      <div className="pc-sprints__timeline-rows">
        {sprints.map((sprint) => {
          const details = [
            sprint.title,
            `Start: ${sprint.start.raw ?? 'Unknown'}`,
            `End: ${sprint.end.raw ?? 'Unknown'}`,
            `closedAt: ${sprint.close.raw ?? 'Unknown'}`,
            ...sprint.diagnostics,
          ].join(' · ');
          return (
            <div className="pc-sprints__timeline-row" key={sprint.node.id}>
              <div className="pc-sprints__timeline-label">
                <WorkItemChip type="sprint" id={planningDisplayId(sprint.node)} />
                <span title={sprint.title}>{sprint.title}</span>
              </div>
              <Tooltip content={details}>
                <button
                  type="button"
                  className="pc-sprints__track pc-touch-target"
                  aria-label={details}
                >
                  {sprint.start.time !== null &&
                  sprint.end.time !== null &&
                  sprint.end.time >= sprint.start.time ? (
                    <span
                      className="pc-sprints__window"
                      style={{
                        left: `${position(sprint.start.time)}%`,
                        width: `${Math.max(0.5, position(sprint.end.time) - position(sprint.start.time))}%`,
                      }}
                    />
                  ) : null}
                  {sprint.close.time !== null ? (
                    <span
                      className="pc-sprints__close"
                      data-invalid={
                        (sprint.start.time !== null && sprint.close.time < sprint.start.time) ||
                        undefined
                      }
                      style={{ left: `${position(sprint.close.time)}%` }}
                    />
                  ) : null}
                  <span className="pc-visually-hidden">
                    Start: <DateLabel value={sprint.start} /> · End:{' '}
                    <DateLabel value={sprint.end} /> · closedAt: <DateLabel value={sprint.close} />
                    {sprint.diagnostics.map((reason) => (
                      <span key={reason}> · {reason}</span>
                    ))}
                  </span>
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
      <p className="pc-sprints__legend">
        <span>Outlined bar: planned window</span>
        <span>Vertical marker: authored closedAt</span>
        <a href="#/diagnostics">Inspect data health</a>
      </p>
    </section>
  );
}

function SprintCarryOver({
  sprint,
  nodes,
  selectedId,
}: {
  sprint: SprintRecord;
  nodes: readonly PlanningModelNode[];
  selectedId: string | undefined;
}) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const previous = useRef<readonly string[]>([]);
  const visible = [...sprint.carryOver];
  // Keep the inspected row mounted when an accepted patch resolves its open status.
  if (
    selectedId &&
    previous.current.includes(selectedId) &&
    !visible.some((node) => node.id === selectedId)
  ) {
    const retained = nodes.find((node) => node.id === selectedId);
    if (retained)
      visible.splice(Math.min(previous.current.indexOf(selectedId), visible.length), 0, retained);
  }
  const ordered = useLiveListOrder(visible, sprint.node.id);
  useEffect(() => {
    previous.current = ordered.map((node) => node.id);
  }, [ordered]);
  if (!ordered.length) return null;
  return (
    <section
      className="pc-sprints__panel pc-sprints__carry"
      aria-label={`Carry-over from ${planningDisplayId(sprint.node)}`}
    >
      <CardHeader
        title={`Carry-over from ${planningDisplayId(sprint.node)}`}
        count={ordered.length}
        description="Still open after close · current status, regardless of later sprint membership."
        href={planningDetailHref(sprint.node) ?? undefined}
      />
      {ordered.length ? (
        <ul
          className="pc-sprints__item-list"
          style={artifactRowStyle(ordered.map(planningDisplayId))}
        >
          {ordered.map((node) => (
            <li
              key={node.id}
              className="pc-artifact-row"
              data-selected={selectedId === node.id || undefined}
            >
              <Tooltip content={node.title}>
                <a
                  className="pc-artifact-row__link"
                  href={planningDetailHref(node) ?? undefined}
                  data-keyboard-item={node.id}
                  data-selected={selectedId === node.id || undefined}
                  onFocus={() => inspectPlanningNode(node, false)}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                    event.preventDefault();
                    inspectPlanningNode(node);
                  }}
                >
                  <span className="pc-sprints__item-status">
                    <ArtifactStatus status={node.status} size="sm" variant="glyph" />
                  </span>
                  <span className="pc-artifact-row__id">
                    <WorkItemChip type={node.type} id={planningDisplayId(node)} />
                  </span>
                  <ArtifactRowTitle>
                    {`${node.title}${
                      !sprint.carryOver.some((item) => item.id === node.id)
                        ? ' · No longer open after close'
                        : ''
                    }`}
                  </ArtifactRowTitle>
                </a>
              </Tooltip>
              <ArtifactRowCopy
                onCopy={copy}
                shortcutsEnabled={shortcutsEnabled}
                id={planningDisplayId(node)}
                command={planningContinuation(node)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p>No items still open after close.</p>
      )}
      {sprint.addressed.length ? (
        <div>
          <h3>Addressed terminal items</h3>
          {sprint.addressed.map((node) => (
            <p key={node.id}>
              <WorkItemChip type={node.type} id={planningDisplayId(node)} /> {node.title} ·
              addressed
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SprintsContent({ model }: { model: PlanningWorkspaceModel }) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const records = useMemo(() => projectSprints(model.graph), [model.graph]);
  const byId = new Map(records.map((record) => [record.node.id, record]));
  const orderedNodes = useLiveListOrder(
    records.map((record) => record.node),
    model.binding.projectId,
  );
  const sprints = orderedNodes.flatMap((node) => {
    const record = byId.get(node.id);
    return record ? [record] : [];
  });
  const active = sprints.filter((sprint) => sprint.active);
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const visible = [
    ...new Map(sprints.flatMap((sprint) => sprint.members).map((node) => [node.id, node])).values(),
  ];
  const { rootRef, removalNotice } = useLiveListSelection(model.graph.nodes, visible, selectedId);
  const operate = useOperatePulse();
  const scopeIds = new Set(
    sprints.flatMap((sprint) => [
      sprint.node.id,
      ...sprint.members.flatMap((node) => [node.id, planningDisplayId(node)]),
    ]),
  );
  const relatedActions =
    operate.status === 'ready'
      ? operate.pulse.actions.filter((action) => actionMentionsScope(action, scopeIds))
      : [];
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline pc-sprints"
      data-route-kind="planning.sprints"
    >
      <PlanningNotice presentation={model.presentation} />
      <p className="pc-visually-hidden" role="status">
        {removalNotice}
      </p>
      <header className="pc-sprints__header">
        <div>
          <p className="op-eyebrow">
            {sprints.length} sprints · {active.length ? `${active.length} active` : 'none active'}
          </p>
          <h1>Sprints</h1>
          <p>
            Planned windows and current completion across every sprint item type. Closed records
            retain their original commitment.
          </p>
        </div>
        <Card padding={20}>
          <h2>{active.length ? 'Continue sprint planning' : 'No active sprint'}</h2>
          <p>
            {sprints.length
              ? 'Review the latest history and select what fits capacity and the authored release cut.'
              : 'No sprints yet. Plan the next sprint from your planning tools.'}
          </p>
          <CommandHint command="/planr:sprint" label="Plan the next sprint" size="sm" />
        </Card>
      </header>
      {sprints.length ? (
        <>
          <Timeline sprints={sprints} />
          <section className="pc-sprints__grid" aria-label="Sprint completion">
            {sprints.map((sprint) => (
              <article
                className="pc-sprints__panel pc-sprints__card"
                key={sprint.node.id}
                aria-label={`${planningDisplayId(sprint.node)}: ${sprint.title}`}
              >
                <div className="pc-sprints__head">
                  <WorkItemChip type="sprint" id={planningDisplayId(sprint.node)} />
                  <span>{sprint.active ? 'Active' : sprint.closed ? 'Closed' : 'Planned'}</span>
                </div>
                <h2>
                  <a href={planningDetailHref(sprint.node) ?? undefined}>{sprint.title}</a>
                </h2>
                <p className="pc-sprints__completion">
                  <span aria-hidden="true">
                    <strong>{sprint.done}</strong>
                    <span className="pc-sprints__denominator"> / {sprint.members.length}</span>
                    <span className="pc-sprints__done-label"> sprint items done</span>
                  </span>
                  <span className="pc-visually-hidden">
                    {sprint.done} of {sprint.members.length} sprint items done
                  </span>
                </p>
                <progress
                  aria-label={`${sprint.title}: sprint items done`}
                  value={sprint.done}
                  max={Math.max(1, sprint.members.length)}
                  data-complete={
                    (sprint.members.length > 0 && sprint.done === sprint.members.length) ||
                    undefined
                  }
                />
                {!sprint.members.length ? <p>No sprint items</p> : null}
                {sprint.unresolved.length ? (
                  <p>
                    {sprint.members.length} resolved items; {sprint.unresolved.length} unresolved
                    references excluded from completion.
                  </p>
                ) : null}
                {sprint.addressed.length ? (
                  <p>
                    {sprint.addressed.length} addressed terminal items, separate from done and open
                    work.
                  </p>
                ) : null}
                <p>
                  {typeof sprint.node.frontmatter.goal === 'string'
                    ? sprint.node.frontmatter.goal
                    : 'No sprint goal recorded.'}
                </p>
                <p>Release cut: {sprint.releaseCut ?? 'Unknown (not authored)'}</p>
              </article>
            ))}
          </section>
          {sprints
            .filter((sprint) => sprint.closed)
            .map((sprint) => (
              <SprintCarryOver
                key={sprint.node.id}
                sprint={sprint}
                nodes={model.graph.nodes}
                selectedId={selectedId}
              />
            ))}
          {sprints.some((sprint) => sprint.unresolved.length) ? (
            <section className="pc-sprints__panel" aria-label="Unresolved sprint items">
              <h2>Unresolved sprint items</h2>
              <p>These references are not counted as done or open sprint items.</p>
              <ul>
                {sprints.flatMap((sprint) =>
                  sprint.unresolved.map((ref) => (
                    <li key={`${sprint.node.id}:${ref.reference}`}>
                      <code>
                        {planningDisplayId(sprint.node)} / {ref.reference}
                      </code>
                      : {ref.reason}
                    </li>
                  )),
                )}
              </ul>
            </section>
          ) : null}
          {sprints.map((sprint) => (
            <section
              className="pc-sprints__panel"
              aria-label={`${planningDisplayId(sprint.node)} commitment`}
              key={sprint.node.id}
            >
              <CardHeader
                title={`${planningDisplayId(sprint.node)} commitment`}
                count={sprint.members.length}
                href={planningDetailHref(sprint.node) ?? undefined}
              />
              {sprint.members.length ? (
                <div
                  className="pc-sprints__members"
                  data-scroll-context={`sprint:${sprint.node.id}`}
                >
                  <ul
                    className="pc-sprints__member-list pc-sprints__item-list"
                    style={artifactRowStyle(sprint.members.map(planningDisplayId))}
                    aria-label={`Members of ${planningDisplayId(sprint.node)}`}
                  >
                    {sprint.members.map((node) => (
                      <li
                        key={node.id}
                        className="pc-artifact-row"
                        data-selected={selectedId === node.id || undefined}
                      >
                        <a
                          className="pc-artifact-row__link"
                          href={planningDetailHref(node) ?? undefined}
                          data-keyboard-item={node.id}
                          onFocus={() => inspectPlanningNode(node, false)}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
                              return;
                            event.preventDefault();
                            inspectPlanningNode(node);
                          }}
                        >
                          <span className="pc-sprints__item-status">
                            <ArtifactStatus status={node.status} size="sm" variant="glyph" />
                          </span>
                          <span className="pc-artifact-row__id">
                            <WorkItemChip type={node.type} id={planningDisplayId(node)} />
                          </span>
                          <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
                        </a>
                        <ArtifactRowCopy
                          onCopy={copy}
                          shortcutsEnabled={shortcutsEnabled}
                          id={planningDisplayId(node)}
                          command={planningContinuation(node)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyState
                  icon="calendar-range"
                  title="No committed work"
                  description="No resolved sprint items are recorded."
                />
              )}
            </section>
          ))}
        </>
      ) : null}
      <section className="pc-sprints__panel" aria-label="Operating context">
        <h2>Latest operating review</h2>
        {operate.status === 'ready' ? (
          <>
            <p>{operate.pulse.signal}</p>
            <p>
              {operate.pulse.counts.actions} actions · {operate.pulse.counts.gaps} gaps ·{' '}
              {relatedActions.length} reference this scope
            </p>
            {relatedActions.slice(0, 3).map((action) => (
              <div key={action.id}>
                <p>
                  {action.priority} · {action.action}
                </p>
                <p>Next: {action.firstStep}</p>
                <p>Owner: {action.owner}</p>
              </div>
            ))}
          </>
        ) : (
          <p>
            {operate.status === 'loading'
              ? 'Reading operating context.'
              : operate.status === 'failed'
                ? 'Operating context unavailable: the latest review could not be read.'
                : 'No operating reviews recorded.'}
          </p>
        )}
        <a className="op-inline-action" href="#/operate/today">
          Open Operate today
        </a>
      </section>
    </div>
  );
}

export function SprintsPage({ currentBinding, current }: SprintsPageProps) {
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (model)
    return (
      <SprintsContent
        key={JSON.stringify([
          model.binding.actorId,
          model.binding.projectId,
          model.binding.generation,
        ])}
        model={model}
      />
    );
  if (current.kind === 'loading' || current.kind === 'booting')
    return (
      <div
        className="op-workspace op-planning pc-sprints"
        data-route-kind="planning.sprints"
        aria-busy="true"
      >
        <header className="pc-sprints__header">
          <h1>Sprints</h1>
        </header>
        <p role="status">Reading .planr/</p>
        <Skeleton h={240} />
        <div className="pc-sprints__grid">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} h={240} />
          ))}
        </div>
      </div>
    );
  return <PlanningRefusal routeKind="planning.sprints" title="Planning cannot be trusted" />;
}
