import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { isCanonicalPlanningId } from '../../lib/routing/planning-view-codec.js';
import type { PlanningArtifactStatus, PlanningModelNode } from './planning-model.js';

let pending: PlanningArtifactStatus | null = null;

export function requestListStatus(status: PlanningArtifactStatus): void {
  pending = status;
}

export function takeListStatus(): PlanningArtifactStatus | null {
  const status = pending;
  pending = null;
  return status;
}

export const LIST_PRESETS = [
  ['all', 'All'],
  ['open', 'Open, by spec'],
  ['priority', 'High priority'],
  ['blocked', 'Blocked'],
  ['adrs', 'ADRs'],
  ['today', 'Filed today'],
  ['yesterday', 'Filed since yesterday'],
] as const;
export type ListPreset = (typeof LIST_PRESETS)[number][0];

export function listPreset(preset: ListPreset): PlanningView {
  return {
    schemaVersion: '1.0.0',
    route: 'list',
    filters: {
      type:
        preset === 'adrs' ? ['adr'] : ['today', 'yesterday'].includes(preset) ? ['backlog'] : [],
      status:
        preset === 'open' || preset === 'priority'
          ? ['outstanding', 'in-progress', 'blocked']
          : preset === 'blocked'
            ? ['blocked']
            : [],
      priority: preset === 'priority' ? ['P0', 'P1', 'critical', 'high'] : [],
      label: [],
      query: '',
      createdWithinDays: preset === 'today' ? 1 : preset === 'yesterday' ? 2 : null,
      updatedWithinDays: null,
    },
    groupBy:
      preset === 'open' ? 'spec' : ['today', 'yesterday'].includes(preset) ? 'label' : 'none',
    sort: { field: 'updated', direction: 'desc' },
    density: 'comfortable',
    focusId: null,
  };
}

export const BACKLOG_STATUSES = ['outstanding', 'in-progress', 'done', 'addressed'] as const;

// Bulk status suggestions only use the existing backlog writer. Scoped task writers are unavailable.
export function bulkListCommands(nodes: readonly PlanningModelNode[], status: string) {
  const commands: string[] = [];
  const skipped: string[] = [];
  for (const node of nodes) {
    if (
      node.type === 'backlog' &&
      /^BL-\d{3,}$/u.test(node.id) &&
      isCanonicalPlanningId(node.id) &&
      (BACKLOG_STATUSES as readonly string[]).includes(status)
    ) {
      commands.push(`openplanr backlog update ${node.id} --status ${status}`);
    } else skipped.push(`${node.id}: no verified status writer for this item`);
  }
  return { commands, skipped };
}
