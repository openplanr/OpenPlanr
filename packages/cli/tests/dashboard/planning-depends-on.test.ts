import { describe, expect, it } from 'vitest';
import { planningInspectorSnapshot } from '../../../../apps/dashboard/src/features/planning/planning-inspector.js';
import {
  type PlanningModelNode,
  selectPlanningDetail,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';

const node = (dependsOn: unknown): PlanningModelNode => ({
  id: 'BL-001',
  type: 'backlog',
  title: 'First',
  status: 'outstanding',
  frontmatter: { id: 'BL-001', dependsOn },
});

describe('authored dependsOn in Detail and the inspector', () => {
  it.each([
    ['BL-002', ['BL-002']],
    ['', []],
    [null, []],
    [
      ['BL-002', 'BL-003'],
      ['BL-002', 'BL-003'],
    ],
  ])('reads %j as %j', (value, expected) => {
    expect(planningInspectorSnapshot(node(value)).dependsOn).toEqual(expected);
    expect(selectPlanningDetail(node(value)).depIds).toEqual(expected);
  });
});
