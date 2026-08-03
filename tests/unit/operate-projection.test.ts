import { describe, expect, it } from 'vitest';
import {
  OPERATING_BOARD_ROLES,
  renderOperatingBoardReport,
  renderOperatingBrief,
  renderOperatingEvidenceIndex,
  selectCycleState,
} from '../../src/services/operate/projection.js';
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

  it('never reports an advising cycle quiet, even before any finding surfaces (SPEC-005 FR5)', () => {
    // Mid-advising: lenses are recording or still running, so no finding has been
    // consolidated yet and the findings-derived `quiet` flag reads true. The honest
    // "no material action is recommended" verdict is reserved for a finalized,
    // genuinely empty cycle — an active advising cycle must never be called quiet,
    // which is exactly the false negative the production run surfaced (`status`
    // said the board was quiet while a cycle was mid-advising).
    const advising = renderOperatingBrief(
      state({ cycles: [{ id: 'CYCLE-001', state: 'advising' }] }),
    );
    expect(advising).not.toContain('is quiet.');
    expect(advising).not.toContain('No material action is recommended');
    expect(advising).toContain('# OpenPlanr Operating Brief');
    expect(advising).toContain('Cycle: CYCLE-001');

    // The identical quiet summary on a reviewable (finalized) cycle still renders
    // the honest three-line quiet verdict — the guard is scoped to active cycles.
    const reviewable = renderOperatingBrief(
      state({ cycles: [{ id: 'CYCLE-001', state: 'reviewable' }] }),
    );
    expect(reviewable).toContain('Cycle CYCLE-001 is quiet.');
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

describe('FR5 readable-tree board and evidence-index renderers', () => {
  it('covers the whole advisory board in a stable order', () => {
    expect(OPERATING_BOARD_ROLES.map((role) => role.id)).toEqual([
      'strategy-finance',
      'technology-risk',
      'product-activation',
      'growth-market',
      'operations-customer',
      'chair',
    ]);
  });

  it('renders a role with a persisted advisor-result as evaluated, using the real report hint', () => {
    const report = renderOperatingBoardReport(
      state({
        cycles: [{ id: 'CYCLE-001', state: 'reviewable', enabledRoles: ['technology-risk'] }],
        dataGaps: [
          {
            id: 'GAP-001',
            cycleId: 'CYCLE-001',
            status: 'open',
            question: 'What is the incident response budget?',
            owner: 'cto',
            affectedRoles: ['technology-risk'],
            evidenceRefs: [],
          },
        ],
      }),
      'CYCLE-001',
      { id: 'technology-risk', label: 'Technology & Risk (CTO)' },
      // Evaluation status derives from the advisor-result set, not enabledRoles.
      new Set(['technology-risk']),
    );

    expect(report).toContain('# Technology & Risk (CTO) — CYCLE-001');
    expect(report).toContain('Status: evaluated');
    expect(report).toContain('## Evidence gaps');
    expect(report).toContain('**GAP-001:** What is the incident response budget?');
    // The hint must use the real `report [cycleId]` positional syntax matching
    // the CLI's `operate report` command — never the non-existent `--cycle` flag.
    expect(report).toContain('planr operate report CYCLE-001 --lens technology-risk');
    expect(report).not.toContain('--cycle');
  });

  it('renders an enabled-but-unevaluated role as not_evaluated (Status ignores enabledRoles)', () => {
    const report = renderOperatingBoardReport(
      state({
        // The cycle enabled technology-risk, but no advisor-result record exists
        // for it, so its board must read `not_evaluated`, not "evaluated".
        cycles: [{ id: 'CYCLE-001', state: 'reviewable', enabledRoles: ['technology-risk'] }],
      }),
      'CYCLE-001',
      { id: 'technology-risk', label: 'Technology & Risk (CTO)' },
      new Set(),
    );

    expect(report).toContain('Status: not_evaluated');
    expect(report).toContain('produced no advisor-result record for CYCLE-001');
    expect(report).not.toContain('## Evidence gaps');
  });

  it('renders a deterministic canonical evidence index sorted by source id', () => {
    const index = renderOperatingEvidenceIndex(
      state({
        evidenceSources: [
          { id: 'repository', freshness: 'fresh', status: 'collected' },
          { id: 'git', freshness: 'stale', status: 'collected' },
        ],
      }),
    );

    expect(index.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(index) as {
      kind: string;
      sources: Array<{ id: string }>;
    };
    expect(parsed.kind).toBe('operating-evidence-index');
    expect(parsed.sources.map((source) => source.id)).toEqual(['git', 'repository']);

    // Canonical bytes are stable regardless of input ordering.
    const reordered = renderOperatingEvidenceIndex(
      state({
        evidenceSources: [
          { id: 'git', freshness: 'stale', status: 'collected' },
          { id: 'repository', freshness: 'fresh', status: 'collected' },
        ],
      }),
    );
    expect(reordered).toBe(index);
  });
});
