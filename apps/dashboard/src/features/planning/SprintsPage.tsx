import { useEffect, useState } from 'react';
import {
  ARTIFACT_STATUS_ORDER,
  ArtifactStatus,
  Badge,
  Card,
  CommandHint,
  DataTable,
  EmptyState,
  PcIcon,
  SectionHeader,
  SprintProgress,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import {
  dependencyCountColumn,
  ITEM_COLUMN,
  STATUS_COLUMN,
  sprintOf,
  UPDATED_COLUMN,
} from './planning-columns.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  type PlanningModelEdge,
  type PlanningModelNode,
  planningDisplayId,
  tallyPlanningStatuses,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './sprints.css';

export type SprintsPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

type SprintScope = Readonly<{
  members: readonly PlanningModelNode[];
  missing: readonly string[];
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

const SPRINT_ID_FIELDS = Object.freeze(['taskIds', 'storyIds', 'itemIds', 'artifactIds']);

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

function sprintCommitment(sprint: PlanningModelNode): readonly string[] {
  return Object.freeze([
    ...new Set(SPRINT_ID_FIELDS.flatMap((field) => strings(sprint.frontmatter[field]))),
  ]);
}

/** Membership supports both authored forms: sprint-owned commitment ids and item-owned sprintId. */
export function sprintScope(
  nodes: readonly PlanningModelNode[],
  sprint: PlanningModelNode,
): SprintScope {
  const display = planningDisplayId(sprint);
  const declared = sprintCommitment(sprint);
  const byReference = new Map<string, PlanningModelNode[]>();
  for (const node of nodes) {
    if (node.type === 'sprint') continue;
    for (const key of new Set([node.id, planningDisplayId(node)])) {
      byReference.set(key, [...(byReference.get(key) ?? []), node]);
    }
  }
  const selected = new Map<string, PlanningModelNode>();
  for (const ref of declared) {
    for (const node of byReference.get(ref) ?? []) selected.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.type === 'sprint') continue;
    const ref = sprintOf(node);
    if (ref === sprint.id || ref === display) selected.set(node.id, node);
  }
  const missing = declared.filter((ref) => !(byReference.get(ref)?.length ?? 0));
  return Object.freeze({
    members: Object.freeze([...selected.values()].sort((a, b) => a.id.localeCompare(b.id))),
    missing: Object.freeze(missing),
  });
}

function frontmatterText(node: PlanningModelNode, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = node.frontmatter[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function sprintTitle(sprint: PlanningModelNode): string {
  return frontmatterText(sprint, 'title', 'name') ?? sprint.title;
}

function sprintStatus(sprint: PlanningModelNode): string {
  const authored = frontmatterText(sprint, 'status')?.toLowerCase().replaceAll('_', '-');
  if (authored === 'active' || authored === 'in progress') return 'in-progress';
  return authored ?? sprint.status;
}

function sprintDates(
  sprint: PlanningModelNode,
): Readonly<{ start: string | null; end: string | null }> {
  return Object.freeze({
    start: frontmatterText(sprint, 'startDate', 'startsAt', 'start'),
    end: frontmatterText(sprint, 'endDate', 'endsAt', 'end'),
  });
}

function sprintHealth(
  sprint: PlanningModelNode,
  scope: SprintScope,
): Readonly<{ label: string; tone: 'success' | 'warn' | 'danger' | 'info' }> {
  const tally = tallyPlanningStatuses(scope.members);
  if (scope.missing.length > 0) return Object.freeze({ label: 'scope mismatch', tone: 'warn' });
  if (tally.blocked > 0) return Object.freeze({ label: 'blocked work', tone: 'danger' });
  if (scope.members.length > 0 && tally.done === scope.members.length) {
    const status = sprintStatus(sprint);
    const recordClosed = status === 'done' || status === 'addressed';
    return Object.freeze(
      recordClosed
        ? { label: 'complete', tone: 'success' }
        : { label: 'ready to close', tone: 'warn' },
    );
  }
  const { end } = sprintDates(sprint);
  if (end && /^\d{4}-\d{2}-\d{2}$/u.test(end) && end < new Date().toISOString().slice(0, 10)) {
    return Object.freeze({ label: 'past end date', tone: 'warn' });
  }
  return Object.freeze({ label: 'in flight', tone: 'info' });
}

function externalDependencies(
  members: readonly PlanningModelNode[],
  nodes: readonly PlanningModelNode[],
  edges: readonly PlanningModelEdge[],
): readonly PlanningModelNode[] {
  const memberIds = new Set(members.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const external = new Map<string, PlanningModelNode>();
  for (const edge of edges) {
    if (edge.kind !== 'depends_on' || !memberIds.has(edge.from) || memberIds.has(edge.to)) continue;
    const target = byId.get(edge.to);
    if (target && target.status !== 'done' && target.status !== 'addressed') {
      external.set(target.id, target);
    }
  }
  return Object.freeze([...external.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

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
          setState({ status: 'empty', pulse: null });
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

export function SprintsPage({ currentBinding, current }: SprintsPageProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const operate = useOperatePulse();
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.sprints" title="Planning cannot be trusted" />;
  }

  const { nodes, edges } = model.graph;
  const sprints = nodes
    .filter((node) => node.type === 'sprint')
    .sort((a, b) => b.id.localeCompare(a.id));
  const active =
    sprints.find((sprint) => sprint.id === picked) ??
    sprints.find((sprint) => sprintStatus(sprint) !== 'done') ??
    sprints[0] ??
    null;
  const scope = active
    ? sprintScope(nodes, active)
    : Object.freeze({ members: Object.freeze([]), missing: Object.freeze([]) });
  const tally = tallyPlanningStatuses(scope.members);
  const completion =
    scope.members.length === 0 ? 0 : Math.round((tally.done / scope.members.length) * 100);
  const external = active ? externalDependencies(scope.members, nodes, edges) : [];
  const scopeIds = new Set(
    active
      ? [
          planningDisplayId(active),
          ...scope.members.flatMap((node) => [node.id, planningDisplayId(node)]),
        ]
      : [],
  );
  const relatedActions =
    operate.status === 'ready'
      ? operate.pulse.actions.filter((action) => actionMentionsScope(action, scopeIds))
      : [];

  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-sprints"
      data-route-kind="planning.sprints"
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-status · sprints"
        title="Sprints"
        count={`${sprints.length} ${sprints.length === 1 ? 'sprint' : 'sprints'}`}
        description="Commitment, delivery health, dependencies, and operating context from the records already in this workspace."
      />
      {sprints.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon="calendar-range"
            title="No sprints yet"
            description="No artifact of type sprint is in the graph."
            action={<CommandHint command="/planr-plan" label="plan the next sprint" size="sm" />}
          />
        </Card>
      ) : (
        <>
          <section className="pc-sprints__grid" aria-label="Sprint timeline">
            {sprints.map((sprint) => {
              const candidate = sprintScope(nodes, sprint);
              const segments = ARTIFACT_STATUS_ORDER.map((status) => ({
                state: status,
                count: candidate.members.filter((node) => node.status === status).length,
              })).filter((segment) => segment.count > 0);
              const dates = sprintDates(sprint);
              const health = sprintHealth(sprint, candidate);
              const isActive = active?.id === sprint.id;
              return (
                <button
                  key={sprint.id}
                  type="button"
                  className="pc-sprints__card"
                  data-active={isActive || undefined}
                  aria-pressed={isActive}
                  onClick={() => setPicked(sprint.id)}
                >
                  <span className="pc-sprints__head">
                    <WorkItemChip type="sprint" id={planningDisplayId(sprint)} />
                    <Badge tone={health.tone} variant="outline">
                      {health.label}
                    </Badge>
                  </span>
                  <SprintProgress name={sprintTitle(sprint)} segments={segments} />
                  <span className="pc-sprints__dates">
                    <PcIcon name="calendar-range" size={12} />
                    {dates.start && dates.end
                      ? `${dates.start} → ${dates.end}`
                      : 'Dates not recorded'}
                  </span>
                </button>
              );
            })}
          </section>
          {active ? (
            <section
              className="pc-sprints__workspace"
              aria-label={`${planningDisplayId(active)} delivery workspace`}
            >
              <div className="pc-sprints__summary">
                <div className="pc-sprints__summary-copy">
                  <span className="pc-sprints__eyebrow">Current commitment</span>
                  <h2>{sprintTitle(active)}</h2>
                  <p>
                    {frontmatterText(active, 'goal', 'sprintGoal') ?? 'No sprint goal is recorded.'}
                  </p>
                </div>
                <ArtifactStatus status={sprintStatus(active)} size="sm" />
              </div>
              <dl className="pc-sprints__metrics">
                <div>
                  <dt>Complete</dt>
                  <dd>{completion}%</dd>
                </div>
                <div>
                  <dt>Committed</dt>
                  <dd>{scope.members.length}</dd>
                </div>
                <div data-attention={tally.blocked > 0 || undefined}>
                  <dt>Blocked</dt>
                  <dd>{tally.blocked}</dd>
                </div>
                <div data-attention={external.length > 0 || undefined}>
                  <dt>External deps</dt>
                  <dd>{external.length}</dd>
                </div>
              </dl>
              <div className="pc-sprints__body">
                <Card
                  title={`${planningDisplayId(active)} commitment`}
                  meta={`${scope.members.length} items`}
                  padding={0}
                >
                  {scope.members.length > 0 ? (
                    <DataTable
                      compact
                      rows={scope.members}
                      onRowClick={inspectPlanningNode}
                      caption={`Members of ${planningDisplayId(active)}`}
                      columns={[
                        ITEM_COLUMN,
                        STATUS_COLUMN,
                        dependencyCountColumn(edges),
                        UPDATED_COLUMN,
                      ]}
                    />
                  ) : (
                    <div className="pc-sprints__empty">
                      <EmptyState
                        icon="calendar-range"
                        title="No committed work"
                        description="This sprint has no taskIds and no item points back through sprintId."
                      />
                    </div>
                  )}
                </Card>
                <aside className="pc-sprints__intelligence" aria-label="Sprint intelligence">
                  <div className="pc-sprints__intelligence-section">
                    <span className="pc-sprints__eyebrow">Delivery health</span>
                    <strong>{sprintHealth(active, scope).label}</strong>
                    <p>
                      {tally.done} done · {tally.inProgress} in progress · {tally.outstanding}{' '}
                      outstanding
                    </p>
                  </div>
                  {scope.missing.length > 0 ? (
                    <div className="pc-sprints__intelligence-section" data-tone="warn">
                      <span className="pc-sprints__eyebrow">Scope gaps</span>
                      <strong>{scope.missing.length} committed IDs are missing</strong>
                      <p>{scope.missing.join(', ')}</p>
                    </div>
                  ) : null}
                  <div className="pc-sprints__intelligence-section">
                    <span className="pc-sprints__eyebrow">Open dependencies</span>
                    <strong>
                      {external.length === 0
                        ? 'No external blockers recorded'
                        : `${external.length} outside this sprint`}
                    </strong>
                    {external.length > 0 ? (
                      <ul>
                        {external.slice(0, 4).map((node) => (
                          <li key={node.id}>
                            <button type="button" onClick={() => inspectPlanningNode(node)}>
                              {planningDisplayId(node)} · {node.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {operate.status === 'ready' ? (
                    <div className="pc-sprints__intelligence-section" data-tone="operate">
                      <span className="pc-sprints__eyebrow">Latest operating review</span>
                      <strong>{operate.pulse.signal}</strong>
                      <p>
                        {operate.pulse.counts.actions} actions · {operate.pulse.counts.gaps} gaps ·{' '}
                        {relatedActions.length} reference this scope
                      </p>
                      {relatedActions.slice(0, 3).map((action) => (
                        <div className="pc-sprints__operate-action" key={action.id}>
                          <span>{action.priority}</span>
                          <p>{action.action}</p>
                          <small>Next: {action.firstStep}</small>
                          <small>Owner: {action.owner}</small>
                        </div>
                      ))}
                      <a href="#/operate/today">Open Operate today →</a>
                    </div>
                  ) : null}
                </aside>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
