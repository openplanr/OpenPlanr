import {
  Absent,
  ArtifactRowCopy,
  ArtifactRowMeta,
  ArtifactStatus,
  ArtifactTag,
  type CommandHintProps,
  type DataTableColumn,
  PriorityChip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import {
  type PlanningModelEdge,
  type PlanningModelNode,
  planningContinuation,
  planningDisplayId,
} from './planning-model.js';

import { authoredTimestamp, planningLabels } from './presentation-view.js';

/* Column recipes shared by the planning tables. Every cell renders a real field or Absent. */

export function frontmatterString(node: PlanningModelNode, key: string): string | null {
  const value = node.frontmatter[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function sprintOf(node: PlanningModelNode): string | null {
  return frontmatterString(node, 'sprintId') ?? frontmatterString(node, 'sprint');
}

export function refOf(node: PlanningModelNode): string | null {
  if (node.githubIssue !== undefined) return `#${node.githubIssue}`;
  return node.linearIssueIdentifier ?? null;
}

export function dependsOnOf(node: PlanningModelNode): readonly string[] {
  const raw = node.frontmatter.dependsOn;
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Build outgoing dependency counts once so table rendering remains O(nodes + edges). */
export function outgoingDependencyCounts(
  edges: readonly PlanningModelEdge[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind === 'depends_on') counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
  }
  return counts;
}

type Column = DataTableColumn<PlanningModelNode>;

export const ITEM_COLUMN: Column = Object.freeze({
  key: 'item',
  label: 'Item',
  render: (node: PlanningModelNode) => (
    <WorkItemChip
      type={node.type}
      id={planningDisplayId(node)}
      title={node.title}
      blocked={node.status === 'blocked'}
      interactive
    />
  ),
});

export const STATUS_COLUMN: Column = Object.freeze({
  key: 'status',
  label: 'Status',
  width: 132,
  render: (node: PlanningModelNode) => <ArtifactStatus status={node.status} size="sm" />,
});

export const SPRINT_COLUMN: Column = Object.freeze({
  key: 'sprint',
  label: 'Sprint',
  width: 92,
  mono: true,
  render: (node: PlanningModelNode) => sprintOf(node) ?? <Absent />,
});

export const UPDATED_COLUMN: Column = Object.freeze({
  key: 'updated',
  label: 'Updated',
  width: 96,
  mono: true,
  align: 'right',
  render: (node: PlanningModelNode) => frontmatterString(node, 'updated') ?? <Absent />,
});

export const REF_COLUMN: Column = Object.freeze({
  key: 'ref',
  label: 'Ref',
  width: 96,
  mono: true,
  align: 'right',
  render: (node: PlanningModelNode) => refOf(node) ?? <Absent />,
});

export function dependencyCountColumn(
  edgesOrCounts: readonly PlanningModelEdge[] | ReadonlyMap<string, number>,
): Column {
  const counts =
    typeof (edgesOrCounts as ReadonlyMap<string, number>).get === 'function'
      ? (edgesOrCounts as ReadonlyMap<string, number>)
      : outgoingDependencyCounts(edgesOrCounts as readonly PlanningModelEdge[]);
  return Object.freeze({
    key: 'deps',
    label: 'Deps',
    width: 56,
    mono: true,
    align: 'right',
    render: (node: PlanningModelNode) => {
      const count = counts.get(node.id) ?? 0;
      return count > 0 ? String(count) : <Absent />;
    },
  });
}

const TAG_TYPES = {
  spec: 'spec',
  story: 'us',
  task: 't',
  backlog: 'bl',
  adr: 'adr',
  epic: 'epic',
  feature: 'epic',
  sprint: 'sprint',
  quick: 'qt',
} as const;

export const LIST_COLUMNS: readonly Column[] = [
  {
    key: 'id',
    label: 'ID',
    width: 'calc(var(--id-col) + 26px)',
    sortable: true,
    render: (node) => (
      <ArtifactTag type={TAG_TYPES[node.type]}>{planningDisplayId(node)}</ArtifactTag>
    ),
  },
  {
    key: 'title',
    label: 'Title',
    sortable: true,
    render: (node) => (
      <span className="pc-list__title" title={node.title}>
        {node.title}
      </span>
    ),
  },
  { ...STATUS_COLUMN, sortable: true },
  {
    key: 'priority',
    label: 'Priority',
    width: 106,
    sortable: true,
    render: (node) => <PriorityChip priority={frontmatterString(node, 'priority') ?? undefined} />,
  },
  {
    key: 'labels',
    label: 'Labels',
    width: 150,
    render: (node) => (
      <span className="pc-list__labels" title={planningLabels(node).join(', ')}>
        {planningLabels(node).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </span>
    ),
  },
  {
    ...UPDATED_COLUMN,
    sortable: true,
    render: (node) => {
      const timestamp = authoredTimestamp(node.frontmatter.updated);
      if (timestamp === null) return 'Unknown';
      const date = new Date(timestamp);
      return (
        <ArtifactRowMeta label={`Updated ${date.toISOString().slice(0, 10)}`}>
          {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
        </ArtifactRowMeta>
      );
    },
  },
];

export function listCommandColumn(
  onCopy: CommandHintProps['onCopy'],
  shortcutsEnabled: boolean,
): Column {
  return {
    key: 'command',
    label: '',
    width: 54,
    render: (node) => (
      <ArtifactRowCopy
        id={planningDisplayId(node)}
        command={planningContinuation(node)}
        onCopy={onCopy}
        shortcutsEnabled={shortcutsEnabled}
      />
    ),
  };
}
