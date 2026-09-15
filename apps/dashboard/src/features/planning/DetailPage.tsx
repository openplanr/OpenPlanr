import { useState } from 'react';
import {
  Absent,
  ArtifactStatus,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Field,
  InlineAlert,
  SectionHeader,
  Tabs,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { PlanningOperatingOriginSection } from './PlanningOperatingOriginSection.js';
import {
  dependsOnOf,
  frontmatterString,
  ITEM_COLUMN,
  refOf,
  STATUS_COLUMN,
  sprintOf,
  UPDATED_COLUMN,
} from './planning-columns.js';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningDetailHref,
  planningDisplayId,
  planningNodeIdFromRouteSubject,
  selectPlanningDetail,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './detail.css';

export type DetailPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

type DownstreamRow = PlanningModelNode &
  Readonly<{ depth: number; via: 'depends_on' | 'contains' }>;

/** Frontmatter keys rendered as fixed rows; every other key still shows, after them. */
const FIXED_FIELDS: ReadonlySet<string> = new Set([
  'created',
  'updated',
  'sprintId',
  'sprint',
  'owner',
  'dependsOn',
]);
const RELATION_COLUMNS = Object.freeze([ITEM_COLUMN, STATUS_COLUMN, UPDATED_COLUMN]);

function goToList(): void {
  if (typeof window !== 'undefined') window.location.hash = '#/list';
}

function openNode(node: PlanningModelNode): void {
  const href = planningDetailHref(node);
  if (href && typeof window !== 'undefined') window.location.hash = href;
}

/*
 * A SPEC trace is the transitive closure of what waits on the spec, plus what those artifacts
 * contain. Both edge kinds are real; nothing else is needed to walk it.
 */
function downstreamOf(graph: PlanningModelGraph, rootId: string): readonly DownstreamRow[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const out: DownstreamRow[] = [];
  const walk = (id: string, depth: number): void => {
    for (const edge of graph.edges) {
      const via = edge.kind;
      const next =
        via === 'depends_on' && edge.to === id
          ? edge.from
          : via === 'contains' && edge.from === id
            ? edge.to
            : null;
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      const node = byId.get(next);
      if (!node) continue;
      out.push({ ...node, depth, via });
      walk(next, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

function RelationCard({
  title,
  rows,
}: Readonly<{ title: string; rows: readonly PlanningModelNode[] }>) {
  return (
    <Card title={title} meta={String(rows.length)} padding={0}>
      {rows.length > 0 ? (
        <DataTable
          compact
          rows={rows}
          onRowClick={openNode}
          caption={title}
          columns={RELATION_COLUMNS}
        />
      ) : (
        <div className="pc-detail__none">none</div>
      )}
    </Card>
  );
}

export function DetailPage({ currentBinding, current }: DetailPageProps) {
  const specRoute = currentBinding.route.startsWith('#/plan/specs/');
  const routeKind = specRoute ? 'planning.spec' : 'planning.detail';
  const [tab, setTab] = useState(specRoute ? 'downstream' : 'fields');

  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind={routeKind} title="Planning cannot be trusted" />;
  }

  const nodeId =
    currentBinding.subjectId === null
      ? null
      : planningNodeIdFromRouteSubject(currentBinding.subjectId);
  const node = nodeId === null ? undefined : model.graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return (
      <div className="op-workspace op-planning pc-pipeline pc-detail" data-route-kind={routeKind}>
        <Card padding={0}>
          <EmptyState
            icon="circle-alert"
            title={`No artifact ${currentBinding.subjectId ?? ''}`.trim()}
            description="This id is not in the current graph snapshot."
            action={
              <Button size="sm" icon="chevron-left" onClick={goToList}>
                Back to List
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const { graph } = model;
  const byId = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const deps = dependsOnOf(node)
    .map((id) => byId.get(id))
    .filter((entry): entry is PlanningModelNode => entry !== undefined);
  const dependants = graph.edges
    .filter((edge) => edge.kind === 'depends_on' && edge.to === node.id)
    .map((edge) => byId.get(edge.from))
    .filter((entry): entry is PlanningModelNode => entry !== undefined);
  const children = graph.edges
    .filter((edge) => edge.kind === 'contains' && edge.from === node.id)
    .map((edge) => byId.get(edge.to))
    .filter((entry): entry is PlanningModelNode => entry !== undefined);
  const parent = graph.edges.find((edge) => edge.kind === 'contains' && edge.to === node.id);
  const downstream = specRoute ? downstreamOf(graph, node.id) : [];
  const detail = selectPlanningDetail(node);
  const extraFields = Object.entries(detail.meta).filter(([key]) => !FIXED_FIELDS.has(key));
  const sprint = sprintOf(node);
  const ref = refOf(node);
  const displayId = planningDisplayId(node);
  const tabs = specRoute
    ? [
        { id: 'downstream', label: 'Downstream', count: downstream.length },
        { id: 'fields', label: 'Fields' },
        { id: 'body', label: 'Body' },
      ]
    : [
        { id: 'fields', label: 'Fields' },
        {
          id: 'relations',
          label: 'Relations',
          count: deps.length + dependants.length + children.length,
        },
        { id: 'body', label: 'Body' },
      ];

  const downstreamColumns: readonly DataTableColumn<DownstreamRow>[] = [
    {
      key: 'item',
      label: 'Item',
      render: (row) => (
        <span className="pc-detail__indent" style={{ paddingLeft: row.depth * 16 }}>
          <WorkItemChip
            type={row.type}
            id={planningDisplayId(row)}
            title={row.title}
            blocked={row.status === 'blocked'}
            interactive
          />
        </span>
      ),
    },
    { key: 'via', label: 'Via', width: 116, mono: true, render: (row) => row.via },
    {
      key: 'status',
      label: 'Status',
      width: 132,
      render: (row) => <ArtifactStatus status={row.status} size="sm" />,
    },
    {
      key: 'updated',
      label: 'Updated',
      width: 96,
      mono: true,
      align: 'right',
      render: (row) => frontmatterString(row, 'updated') ?? <Absent />,
    },
  ];

  return (
    <div className="op-workspace op-planning pc-pipeline pc-detail" data-route-kind={routeKind}>
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow={specRoute ? 'planr-spec · trace' : `planr-plan · ${node.type}`}
        title={node.title}
        count={displayId}
        description={
          specRoute ? 'SPEC trace: everything downstream of this specification.' : undefined
        }
        actions={
          <Button variant="ghost" size="sm" icon="chevron-left" onClick={goToList}>
            List
          </Button>
        }
      />
      <div className="pc-detail__identity">
        <WorkItemChip type={node.type} id={displayId} />
        <ArtifactStatus status={node.status} />
        {sprint ? <span className="pc-detail__mono">{sprint}</span> : null}
        {ref ? <span className="pc-detail__mono">{ref}</span> : null}
      </div>
      {node.type === 'spec' ? (
        <PlanningOperatingOriginSection specId={node.id} binding={currentBinding} />
      ) : null}
      <Tabs label="Artifact sections" value={tab} onChange={setTab} tabs={tabs} />
      <div className="pc-detail__stack">
        {tab === 'downstream' ? (
          <Card title="Downstream of this spec" meta={String(downstream.length)} padding={0}>
            {downstream.length > 0 ? (
              <DataTable
                compact
                rows={downstream}
                onRowClick={openNode}
                caption="Downstream artifacts"
                columns={downstreamColumns}
              />
            ) : (
              <div className="pc-detail__empty">
                <EmptyState
                  icon="list-tree"
                  title="Nothing waits on this spec"
                  description="No artifact carries a depends_on edge to it."
                />
              </div>
            )}
          </Card>
        ) : tab === 'fields' ? (
          <Card title="Frontmatter" meta={`${displayId}.md`} padding={14}>
            <div className="pc-detail__fields">
              <Field label="id" mono>
                {node.id}
              </Field>
              <Field label="type" mono>
                {node.type}
              </Field>
              <Field label="status" mono>
                {node.status}
              </Field>
              <Field label="created" mono>
                {frontmatterString(node, 'created') ?? <Absent />}
              </Field>
              <Field label="updated" mono>
                {frontmatterString(node, 'updated') ?? <Absent />}
              </Field>
              <Field label="sprintId" mono>
                {sprint ?? <Absent />}
              </Field>
              <Field label="owner" mono>
                {frontmatterString(node, 'owner') ?? <Absent>not recorded</Absent>}
              </Field>
              <Field label="dependsOn" mono>
                {dependsOnOf(node).length > 0 ? dependsOnOf(node).join(', ') : <Absent />}
              </Field>
              <Field label="githubIssue" mono>
                {node.githubIssue !== undefined ? `#${node.githubIssue}` : <Absent />}
              </Field>
              <Field label="linearIssue" mono>
                {node.linearIssueIdentifier ?? <Absent />}
              </Field>
              <Field label="parent" mono>
                {parent ? (
                  planningDisplayId(byId.get(parent.from) ?? parent.from)
                ) : (
                  <Absent>root</Absent>
                )}
              </Field>
              {extraFields.map(([key, value]) => (
                <Field key={key} label={key} mono>
                  {value}
                </Field>
              ))}
            </div>
          </Card>
        ) : tab === 'relations' ? (
          <>
            <RelationCard title="Depends on" rows={deps} />
            <RelationCard title="Depended on by" rows={dependants} />
            <RelationCard title="Contains" rows={children} />
          </>
        ) : (
          <Card title="Body" meta="markdown" padding={14}>
            {detail.criteria.length === 0 && detail.subtasks.length === 0 && !node.body ? (
              <InlineAlert tone="info" title="No body in this snapshot">
                The artifact file has frontmatter only, or the body was not read into the graph.
              </InlineAlert>
            ) : (
              <div className="pc-detail__body">
                {detail.criteria.length > 0 ? (
                  <section className="pc-detail__section" aria-label="Acceptance criteria">
                    <h3 className="pc-detail__label">
                      acceptance criteria · {detail.criteria.length}
                    </h3>
                    <ol className="pc-detail__criteria">
                      {detail.criteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                {detail.subtasks.length > 0 ? (
                  <section className="pc-detail__section" aria-label="Subtasks">
                    <h3 className="pc-detail__label">subtasks · {detail.subtasks.length}</h3>
                    <ul className="pc-detail__subtasks">
                      {detail.subtasks.map((subtask) => (
                        <li key={subtask.text} className="pc-detail__subtask">
                          <ArtifactStatus
                            status={subtask.done ? 'done' : 'outstanding'}
                            size="sm"
                            showLabel={false}
                          />
                          <span>{subtask.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {node.body ? <pre className="pc-detail__markdown">{node.body}</pre> : null}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
