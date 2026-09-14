import { describe, expect, it } from 'vitest';
import {
  assertPlanningFraming,
  buildPlanningDeliveryProgress,
} from '../../src/services/operate/planning-handoff-service.js';

const framing = Object.freeze({
  title: 'Reviewed title',
  slug: 'reviewed-title',
  problem: 'Problem',
  objective: 'Objective',
  users: ['Operators'],
  scope: ['One change'],
  nonScope: ['Automatic PLAN'],
  risks: ['Stale signal'],
  constraints: ['Restart-safe custody'],
  requirements: ['Requirement'],
  acceptanceOutcomes: ['Accepted outcome'],
});

describe('planning handoff transport helpers', () => {
  it('rejects hostile framing fields before preview or create', () => {
    expect(() =>
      assertPlanningFraming({
        ...framing,
        privateBody: 'no',
      } as Record<string, unknown>),
    ).toThrow(expect.objectContaining({ code: 'E_OPERATE_PLANNING_INVALID' }));
    expect(() =>
      assertPlanningFraming({
        ...framing,
        scope: ['safe', 1 as unknown as string],
      }),
    ).toThrow(expect.objectContaining({ code: 'E_OPERATE_PLANNING_INVALID' }));
  });

  it('builds callable delivery trace nodes with exact Planning detail hrefs', () => {
    const nodes = buildPlanningDeliveryProgress({
      decision: { id: 'dec_release_0001' },
      proposalId: 'oprop_planning_release_0001',
      spec: { specId: 'SPEC-042', status: 'shaping' },
    }).nodes as Array<Record<string, unknown>>;
    const specNode = nodes.find((node) => node.kind === 'spec');
    expect(specNode?.href).toBe('#/detail/SPEC-042');
    expect(specNode?.subjectId).toBe('SPEC-042');
    expect(nodes.some((node) => node.kind === 'plan' && node.state === 'not-started')).toBe(true);
  });
});
