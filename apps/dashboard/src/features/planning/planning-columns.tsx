import {
  Absent,
  ArtifactStatus,
  type DataTableColumn,
  WorkItemChip,
} from '../../design-system/components/index.js';
import {
  type PlanningModelEdge,
  type PlanningModelNode,
  planningDisplayId,
} from './planning-model.js';

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

/** Outgoing depends_on count, derived from edges so it needs no field the model lacks. */
export function outgoingDependencyCount(edges: readonly PlanningModelEdge[], id: string): number {
  return edges.filter((edge) => edge.kind === 'depends_on' && edge.from === id).length;
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

export function dependencyCountColumn(edges: readonly PlanningModelEdge[]): Column {
  return Object.freeze({
    key: 'deps',
    label: 'Deps',
    width: 56,
    mono: true,
    align: 'right',
    render: (node: PlanningModelNode) => {
      const count = outgoingDependencyCount(edges, node.id);
      return count > 0 ? String(count) : <Absent />;
    },
  });
}
