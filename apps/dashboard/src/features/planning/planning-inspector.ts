import { useEffect, useState } from 'react';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { type InspectorNodeSnapshot, selectInspector } from '../shell/inspector-selection.js';
import { type PlanningModelNode, planningDetailHref } from './planning-model.js';

function frontmatterString(
  frontmatter: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Snapshot the real node fields the inspector shows. Absent fields stay absent. */
export function planningInspectorSnapshot(node: PlanningModelNode): InspectorNodeSnapshot {
  const dependsOn = node.frontmatter.dependsOn;
  return Object.freeze({
    kind: 'node',
    id: node.id,
    type: node.type,
    title: node.title,
    status: node.status,
    sprintId:
      frontmatterString(node.frontmatter, 'sprintId') ??
      frontmatterString(node.frontmatter, 'sprint'),
    updated: frontmatterString(node.frontmatter, 'updated'),
    dependsOn: Array.isArray(dependsOn)
      ? Object.freeze(dependsOn.filter((entry): entry is string => typeof entry === 'string'))
      : Object.freeze([]),
    ref:
      node.githubIssue !== undefined
        ? `#${node.githubIssue}`
        : (node.linearIssueIdentifier ?? null),
    href: planningDetailHref(node),
  });
}

/** Select a planning node in the global inspector. */
export function inspectPlanningNode(node: PlanningModelNode, open = true): void {
  selectInspector(planningInspectorSnapshot(node), open);
}

export function usePlanningViewFocus(
  view: PlanningView | null,
  nodes: readonly PlanningModelNode[] | undefined,
): string | null {
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!view?.focusId || !nodes) {
      setMissing(null);
      return;
    }
    const selected = nodes.find((node) => node.id === view.focusId);
    if (selected) {
      inspectPlanningNode(selected, false);
      setMissing(null);
    } else setMissing(`The focused item ${view.focusId} is unavailable in this snapshot.`);
  }, [view, nodes]);
  return missing;
}
