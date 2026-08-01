import { describe, expect, it } from 'vitest';
import {
  buildOperatingIntegritySummary,
  renderOperatingIntegrityDocument,
  renderOperatingIntegritySection,
} from '../../src/services/operate/integrity.js';
import type { OperatingState } from '../../src/services/operate/types.js';

/**
 * FR7 — cycle integrity as a first-class surface. The summary and its rendering
 * are derived directly from the cycle's governed data gaps (a rejected citation,
 * a boundary refusal, a not_evaluated role), never from any advisory lens's own
 * prose, so the operator sees every integrity signal even when every lens stays
 * silent about it.
 */

function stateWithGaps(gaps: Array<Record<string, unknown>>): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-08-01T00:00:00.000Z',
    eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
    cycles: [{ id: 'CYCLE-001', state: 'reviewable' }],
    findings: [],
    decisions: [],
    dataGaps: gaps as OperatingState['dataGaps'],
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
      openGaps: 3,
      stalledItems: 0,
    },
  } as OperatingState;
}

const CITATION_REJECTION = {
  id: 'GAP-reject',
  cycleId: 'CYCLE-001',
  category: 'unresolvable-citation',
  reason: 'unresolvable',
  question:
    'The cited content at "service.ts" could not be resolved to evidence at the pinned revision.',
  status: 'open',
  owner: 'chair',
  unblocks: [],
  evidenceRefs: [],
};

const BOUNDARY_REFUSAL = {
  id: 'GAP-boundary',
  cycleId: 'CYCLE-001',
  category: 'unresolvable-citation',
  reason: 'dirty-working-tree',
  question:
    'The repository path "service.ts" cites uncommitted working-tree content not present at the pinned revision.',
  status: 'open',
  owner: 'chair',
  unblocks: [],
  evidenceRefs: [],
};

const NOT_EVALUATED_ROLE = {
  id: 'GAP-role',
  cycleId: 'CYCLE-001',
  category: 'missing-evidence',
  reason:
    'Every citation technology-risk returned failed to resolve at the pinned revision, so the role grounded no evidence and is recorded not_evaluated.',
  question:
    'What evidence can technology-risk cite? Its response resolved zero citations to evidence.',
  affectedRoles: ['technology-risk'],
  status: 'open',
  owner: 'chair',
  unblocks: [],
  evidenceRefs: [],
};

describe('operating integrity summary (FR7)', () => {
  it('classifies a citation rejection, a boundary refusal, and a not_evaluated role from committed gaps', () => {
    const summary = buildOperatingIntegritySummary(
      stateWithGaps([CITATION_REJECTION, BOUNDARY_REFUSAL, NOT_EVALUATED_ROLE]),
      'CYCLE-001',
    );
    expect(summary.hasConcerns).toBe(true);
    expect(summary.citationRejections.map((entry) => entry.gapId)).toEqual(['GAP-reject']);
    expect(summary.boundaryRefusals.map((entry) => entry.gapId)).toEqual(['GAP-boundary']);
    expect(summary.notEvaluatedRoles).toEqual([
      expect.objectContaining({
        roleId: 'technology-risk',
        gapId: 'GAP-role',
        reason: expect.stringContaining('grounded no evidence'),
      }),
    ]);
  });

  it('renders a section naming each rejection, refusal, and not_evaluated role independent of lens prose', () => {
    const summary = buildOperatingIntegritySummary(
      stateWithGaps([CITATION_REJECTION, BOUNDARY_REFUSAL, NOT_EVALUATED_ROLE]),
      'CYCLE-001',
    );
    const section = renderOperatingIntegritySection(summary);
    expect(section).toContain('## Citation rejections');
    expect(section).toContain('GAP-reject');
    expect(section).toContain('## Boundary refusals');
    expect(section).toContain('GAP-boundary');
    expect(section).toContain('## Not-evaluated roles');
    expect(section).toContain('technology-risk');
    expect(section).toContain('grounded no evidence');

    const document = renderOperatingIntegrityDocument(summary);
    expect(document).toContain('# Cycle integrity — CYCLE-001');
    expect(document).toContain('GAP-reject');
    expect(document).toContain('GAP-boundary');
    expect(document).toContain('technology-risk');
  });

  it('states a clean cycle plainly rather than omitting the section', () => {
    const summary = buildOperatingIntegritySummary(stateWithGaps([]), 'CYCLE-001');
    expect(summary.hasConcerns).toBe(false);
    expect(renderOperatingIntegritySection(summary)).toContain(
      'No citation rejections, boundary refusals, or not_evaluated roles were recorded',
    );
  });
});
