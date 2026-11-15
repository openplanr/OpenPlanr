import { type PlanningModelNode, planningArtifactTypeLabel, typePlural } from './planning-model.js';
import type { StructuralDetailModel } from './planning-structural-model.js';

export type DetailTraceStep =
  | Readonly<{
      kind: 'node';
      node: PlanningModelNode;
      role: string;
      current: boolean;
      blocked: boolean;
    }>
  | Readonly<{ kind: 'count'; type: string; role: string; count: number; summary: string }>;

const CLOSED = ['done', 'addressed'];
const COUNTED = ['story', 'task'];

/** Lineage, this item, direct dependents and child counts, in reading order. */
export function detailTraceSteps(detail: StructuralDetailModel): readonly DetailTraceStep[] {
  const steps: DetailTraceStep[] = [];
  const currentIndex = detail.trace.findIndex((entry) => entry.role === 'Current artifact');
  for (const entry of detail.trace.slice(0, currentIndex + 1)) {
    const current = entry.role === 'Current artifact';
    const type = planningArtifactTypeLabel(entry.node.type);
    steps.push({
      kind: 'node',
      node: entry.node,
      role: current ? `This ${type.toLowerCase()}` : entry.role === 'Origin' ? 'Origin' : type,
      current,
      blocked: entry.blockedBy > 0,
    });
  }
  const seen = new Set(steps.map((step) => (step.kind === 'node' ? step.node.id : '')));
  for (const ref of detail.dependents) {
    if (!ref.node || seen.has(ref.node.id)) continue;
    seen.add(ref.node.id);
    steps.push({
      kind: 'node',
      node: ref.node,
      role: 'Unblocks',
      current: false,
      blocked: detail.trace.some((entry) => entry.node.id === ref.node?.id && entry.blockedBy > 0),
    });
  }
  const children = detail.children.flatMap((ref) => (ref.node ? [ref.node] : []));
  for (const type of [...COUNTED, ...new Set(children.map((child) => child.type))]) {
    if (steps.some((step) => step.kind === 'count' && step.type === type)) continue;
    const rows = children.filter((child) => child.type === type);
    if (!rows.length) continue;
    const done = rows.filter((child) => CLOSED.includes(child.status)).length;
    const blocked = rows.filter(
      (child) =>
        child.status === 'blocked' ||
        detail.trace.some((entry) => entry.node.id === child.id && entry.blockedBy > 0),
    ).length;
    steps.push({
      kind: 'count',
      type,
      role: typePlural(type),
      count: rows.length,
      summary: blocked ? `${done} done · ${blocked} blocked` : `${done} done`,
    });
  }
  return steps;
}
