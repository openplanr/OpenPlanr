import { useSyncExternalStore } from 'react';
import { artifactTagType } from '../../design-system/components/artifact-recipes.js';
import type { SelectionBarItem } from '../../design-system/components/selection-bar.js';
import { serializePlanningViewHref } from '../../lib/routing/planning-view-codec.js';
import { boardSelectionItems } from './planning-board-view.js';
import { listPreset } from './planning-list-filter.js';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningContinuation,
  planningDisplayId,
  planningSprintMembersOf,
  type selectPlanningAttention,
} from './planning-model.js';
import { projectSprints } from './planning-sprints.js';

export type HomeAttention = ReturnType<typeof selectPlanningAttention>;
export type HomeMeta = Readonly<{ text: string; sentence: string }>;
export type HomeChangedGroup = Readonly<{
  key: string;
  spec: PlanningModelNode | null;
  tags: readonly PlanningModelNode[];
  more: number;
  summary: string;
  title: string;
}>;

const PHONE_QUERY = '(max-width: 599px)';

function phoneWidth() {
  return window.matchMedia?.(PHONE_QUERY).matches ?? false;
}

function subscribePhoneWidth(onChange: () => void) {
  const query = window.matchMedia?.(PHONE_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** True at the width where Home stacks rows onto two lines. */
export function useHomePhoneWidth() {
  return useSyncExternalStore(subscribePhoneWidth, phoneWidth, () => false);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Short day and month in UTC, or null when the authored value is not a date. */
export function homeDate(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function homeSummary(attention: HomeAttention) {
  const needYou = new Set([
    ...attention.waiting.map((item) => item.id),
    ...attention.stale.map((item) => item.id),
    ...attention.highPriorityNotStarted,
  ]).size;
  const specs = attention.changedToday.groups.filter((group) => group.specId !== null).length;
  return `${plural(needYou, 'item needs', 'items need')} you. ${plural(specs, 'spec', 'specs')} changed today.`;
}

export function waitingMeta(
  attention: HomeAttention,
  node: PlanningModelNode,
  dependencies: readonly PlanningModelNode[],
): HomeMeta {
  const item = attention.byId[node.id];
  const ids = dependencies.map(planningDisplayId);
  const unknown =
    item.readiness === 'unknown' ? ' Readiness unknown: unresolved dependencies.' : '';
  return {
    text: `${item.downstreamUnblockCount} downstream`,
    sentence: `${plural(item.downstreamUnblockCount, 'open task waits', 'open tasks wait')} on this.${ids.length ? ` It waits on ${ids.join(', ')}.` : ''}${unknown}`,
  };
}

export function quietMeta(attention: HomeAttention, node: PlanningModelNode): HomeMeta {
  const stale = attention.stale.find((entry) => entry.id === node.id);
  if (!stale) return { text: '', sentence: 'Authored activity unknown.' };
  const days = Math.floor(stale.ageDays);
  return {
    text: `${days}d`,
    sentence: `In progress with no authored update for ${plural(days, 'day', 'days')}, since ${stale.authoredAt.slice(0, 10)}.`,
  };
}

export function highMeta(node: PlanningModelNode): HomeMeta {
  const priority = String(node.frontmatter.priority).toLowerCase();
  const filed = homeDate(node.frontmatter.created);
  return {
    text: filed ? `${priority} · ${filed}` : priority,
    sentence: `Priority ${priority}${filed ? `, filed ${filed}` : ''}.`,
  };
}

function createdOn(node: PlanningModelNode, date: string) {
  const created = node.frontmatter.created;
  return typeof created === 'string' && created.slice(0, 10) === date;
}

export function changedTodayGroups(
  attention: HomeAttention,
  byId: ReadonlyMap<string, PlanningModelNode>,
): HomeChangedGroup[] {
  const { date, groups } = attention.changedToday;
  return groups.flatMap((group): HomeChangedGroup[] => {
    const nodes = group.ids.flatMap((id) => {
      const node = byId.get(id);
      return node ? [node] : [];
    });
    if (group.specId !== null) {
      const spec = byId.get(group.specId);
      if (!spec) return [];
      const stories = nodes.filter((node) => node.type === 'story').length;
      const tasks = nodes.filter((node) => node.type === 'task').length;
      return [
        {
          key: group.specId,
          spec,
          tags: [spec],
          more: 0,
          summary:
            stories || tasks
              ? `+ ${plural(stories, 'story', 'stories')}, ${plural(tasks, 'task', 'tasks')}`
              : '',
          title: spec.title,
        },
      ];
    }
    if (!nodes.length) return [];
    const backlog = nodes.every((node) => node.type === 'backlog');
    const verb = nodes.every((node) => createdOn(node, date)) ? 'filed' : 'changed';
    return [
      {
        key: 'outside-spec',
        spec: null,
        tags: nodes.slice(0, 2),
        more: Math.max(0, nodes.length - 2),
        summary: '',
        title: backlog
          ? `${plural(nodes.length, 'backlog item', 'backlog items')} ${verb}`
          : `${plural(nodes.length, 'item', 'items')} outside a spec ${verb}`,
      },
    ];
  });
}

/** Selection bar entry; a waiting row copies its first open dependency's continuation. */
export function homeSelectionItems(
  node: PlanningModelNode | undefined,
  dependency: PlanningModelNode | undefined,
): SelectionBarItem[] {
  if (!node || !dependency) return boardSelectionItems(node);
  const command = planningContinuation(dependency);
  if (!command) return boardSelectionItems(node);
  const type = artifactTagType(node.type) ?? 't';
  return [{ id: planningDisplayId(node), title: node.title, type, command }];
}

export type HomeSprint = Readonly<{
  node: PlanningModelNode;
  done: number;
  total: number;
  ends: string | null;
}>;

/** The first sprint that is not done or addressed, with its member progress. */
export function homeSprint(graph: PlanningModelGraph): HomeSprint | null {
  const node = graph.nodes.find(
    (entry) => entry.type === 'sprint' && entry.status !== 'done' && entry.status !== 'addressed',
  );
  if (!node) return null;
  const members = planningSprintMembersOf(graph, node);
  const record = projectSprints(graph).find((sprint) => sprint.node.id === node.id);
  return {
    node,
    done: members.filter((member) => member.status === 'done' || member.status === 'addressed')
      .length,
    total: members.length,
    ends: homeDate(record?.end.raw ?? undefined),
  };
}

export function homeSpecsHref() {
  const open = listPreset('open');
  return serializePlanningViewHref({ ...open, filters: { ...open.filters, type: ['spec'] } });
}
