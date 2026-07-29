import { describe, expect, it } from 'vitest';
import { renderOperatingBrief, selectCycleState } from '../../src/services/operate/projection.js';
import type { OperatingState } from '../../src/services/operate/types.js';

function state(overrides: Partial<OperatingState> = {}): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-07-28T00:00:00.000Z',
    eventHead: { sequence: 12, hash: `sha256:${'a'.repeat(64)}` },
    cycles: [{ id: 'CYCLE-001', state: 'reviewable' }],
    findings: [],
    decisions: [],
    dataGaps: [],
    routes: [],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [],
    summary: {
      currentCycleId: 'CYCLE-001',
      currentConstraint: null,
      quiet: true,
      evidenceFreshness: 'fresh',
      surfacedFindings: 0,
      parkedFindings: 0,
      openDecisions: 0,
      openGaps: 0,
      stalledItems: 0,
    },
    ...overrides,
  };
}

describe('concise cited Operating Board brief', () => {
  it('renders a quiet cycle in exactly three useful lines', () => {
    const brief = renderOperatingBrief(state());
    expect(brief.split('\n')).toEqual([
      '# OpenPlanr Operating Brief',
      'Cycle CYCLE-001 is quiet.',
      'No material action is recommended; evidence freshness is fresh.',
    ]);
  });

  it('surfaces bounded actions, decisions, gaps, outcomes, citations, and register handoffs', () => {
    const brief = renderOperatingBrief(
      state({
        findings: [
          {
            id: 'FND-001',
            cycleId: 'CYCLE-001',
            status: 'proposed',
            title: 'Instrument activation before expanding scope',
            problem: 'The activation funnel has no verified baseline.',
            proposal: 'Create one bounded instrumentation specification.',
            severity: 'high',
            sensitivity: 'internal',
            score: 60,
            lane: 'DEV',
            owner: 'product-engineering',
            parked: false,
            evidenceRefs: ['EVD-planr-spec', 'EVD-repository-events'],
          },
        ],
        decisions: [
          {
            id: 'DEC-001',
            cycleId: 'CYCLE-001',
            status: 'open',
            question: 'Which activation event is authoritative?',
            recommendation: 'Use the verified onboarding-completed event.',
            evidenceRefs: ['EVD-planr-spec'],
          },
        ],
        dataGaps: [
          {
            id: 'GAP-001',
            cycleId: 'CYCLE-001',
            status: 'open',
            question: 'What is the 30-day activation baseline?',
            owner: 'product',
            evidenceRefs: [],
          },
        ],
        outcomes: [
          {
            id: 'OUT-001',
            status: 'pending',
            metric: 'activation rate',
            evidenceRefs: ['EVD-planr-spec'],
          },
        ],
        summary: {
          currentCycleId: 'CYCLE-001',
          currentConstraint: 'The activation funnel has no verified baseline.',
          quiet: false,
          evidenceFreshness: 'fresh',
          surfacedFindings: 1,
          parkedFindings: 0,
          openDecisions: 1,
          openGaps: 1,
          stalledItems: 0,
        },
      }),
    );

    expect(brief).toContain('## Recommended actions');
    expect(brief).toContain('**FND-001: Instrument activation before expanding scope**');
    expect(brief).toContain('`EVD-planr-spec`');
    expect(brief).toContain('## Owner decisions');
    expect(brief).toContain('## Evidence gaps');
    expect(brief).toContain('## Outcomes');
    expect(brief).toContain('planr operate routes list');
    expect(brief.split(/\s+/).length).toBeLessThanOrEqual(900);
  });

  it('recomputes cycle-local counts and the current constraint', () => {
    const selected = selectCycleState(
      state({
        cycles: [
          { id: 'CYCLE-001', state: 'closed' },
          { id: 'CYCLE-002', state: 'reviewable' },
        ],
        findings: [
          {
            id: 'FND-001',
            cycleId: 'CYCLE-001',
            status: 'done',
            title: 'Old',
            sensitivity: 'internal',
            parked: false,
          },
          {
            id: 'FND-002',
            cycleId: 'CYCLE-002',
            status: 'proposed',
            title: 'Current constraint',
            problem: 'Current evidence-backed constraint',
            severity: 'critical',
            sensitivity: 'internal',
            score: 100,
            parked: false,
          },
        ],
      }),
      'CYCLE-002',
    );

    expect(selected.cycles.map((cycle) => cycle.id)).toEqual(['CYCLE-002']);
    expect(selected.summary).toMatchObject({
      currentCycleId: 'CYCLE-002',
      currentConstraint: 'Current evidence-backed constraint',
      quiet: false,
      surfacedFindings: 1,
    });
  });
});
