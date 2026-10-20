import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  clearInspector,
  type InspectorNodeSnapshot,
  selectInspector,
} from '../shell/inspector-selection.js';
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

/** Live patches update values in place; only a user presentation change reorders survivors. */
export function useLiveListOrder<T extends Readonly<{ id: string }>>(
  nodes: readonly T[],
  presentationKey: string,
) {
  const previous = useRef<{ key: string; ids: readonly string[] } | null>(null);
  const ordered = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const retained = previous.current;
    return retained?.key === presentationKey
      ? [
          ...retained.ids.flatMap((id) => {
            const node = byId.get(id);
            byId.delete(id);
            return node ? [node] : [];
          }),
          ...byId.values(),
        ]
      : nodes;
  }, [nodes, presentationKey]);
  useLayoutEffect(() => {
    previous.current = { key: presentationKey, ids: ordered.map((node) => node.id) };
  });
  return ordered;
}

export function useLiveListSelection(
  nodes: readonly PlanningModelNode[],
  visible: readonly PlanningModelNode[],
  selectedId: string | undefined,
) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(visible.map((node) => node.id));
  const [notice, setNotice] = useState('');
  const selectedSignature = useRef('');
  useLayoutEffect(() => {
    const prior = previous.current;
    previous.current = visible.map((node) => node.id);
    if (!selectedId) return;
    const selected = nodes.find((node) => node.id === selectedId);
    if (selected) {
      // The inspector snapshot must follow the accepted node without reopening its panel.
      const signature = JSON.stringify(selected);
      if (selectedSignature.current !== signature) {
        selectedSignature.current = signature;
        inspectPlanningNode(selected, false);
      }
      return;
    }
    const index = Math.max(0, prior.indexOf(selectedId));
    const next = visible[Math.min(index, visible.length - 1)];
    setNotice(
      `${selectedId} was removed from the planning snapshot.${next ? ` Selected ${next.id}.` : ''}`,
    );
    if (next) inspectPlanningNode(next, false);
    else clearInspector();
    const active = document.activeElement;
    if (active !== document.body && active?.isConnected && !root.current?.contains(active)) return;
    const target = next
      ? Array.from(root.current?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? []).find(
          (element) =>
            element.dataset.keyboardItem === next.id || element.dataset.canonicalId === next.id,
        )
      : root.current?.querySelector<HTMLElement>('h1, h2');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }, [nodes, selectedId, visible]);
  return { rootRef: root, removalNotice: notice };
}
