import { describe, expect, it } from 'vitest';
import type { RefinementDocument } from '../../src/models/sprint-refinement-schema.js';
import {
  diffRefinements,
  parseRefinementDocument,
  parseSprintCheckboxes,
  replaceSection,
  SprintRefinementError,
  upsertFrontmatter,
} from '../../src/services/sprint-refinement-service.js';

function document(overrides: Partial<RefinementDocument> = {}): RefinementDocument {
  return {
    schemaVersion: 1,
    sprintId: 'SPRINT-004',
    refinedAt: '2026-09-17',
    inputs: { capacityDays: 6, releaseCut: '2026-09-25', sources: ['backlog'], defaulted: [] },
    items: [
      {
        id: 'BL-345',
        title: 'CRM callback silent',
        evidenceDate: '2026-09-10',
        stale: false,
        blockedBy: [],
        effort: 'hours',
        score: 9,
        bucket: 'inProgress',
        reason: '39 applications stuck',
      },
      {
        id: 'BL-295',
        title: 'Old importer bug',
        evidenceDate: '2026-05-01',
        stale: true,
        blockedBy: [],
        effort: 'days',
        score: 1,
        bucket: 'closeOrDemote',
        reason: 'delivered by #569',
        targetStatus: 'closed',
      },
    ],
    buckets: { inProgress: ['BL-345'], planNext: [], blocked: [], closeOrDemote: ['BL-295'] },
    batches: [{ title: 'PR 1', effortDays: 0.5, itemIds: ['BL-345'] }],
    refuted: [],
    ...overrides,
  };
}

describe('parseSprintCheckboxes', () => {
  it('reads bold and plain artifact ids with their done state and ignores N.M task lines', () => {
    const lines = parseSprintCheckboxes(
      [
        '## Tasks',
        '- [x] **BL-345** CRM callback · hours · [view](../backlog/BL-345-crm.md)',
        '- [ ] QT-194',
        '- [ ] **1.0** not a sprint line',
        '  - [ ] **BL-001** indented still counts',
      ].join('\n'),
    );
    expect(lines.map((line) => [line.id, line.done])).toEqual([
      ['BL-345', true],
      ['QT-194', false],
      ['BL-001', false],
    ]);
    expect(lines[0].title).toBe('CRM callback · hours · [view](../backlog/BL-345-crm.md)');
    expect(lines[0].lineIndex).toBe(1);
  });
});

describe('upsertFrontmatter', () => {
  const raw = [
    '---',
    'id: "SPRINT-004"',
    'status: "active"',
    'taskIds:',
    '  - BL-1',
    '  - BL-2',
    'updated: "2026-01-01"',
    '---',
    '',
    '# body',
    '',
  ].join('\n');

  it('replaces scalars, rewrites block sequences in flow form, inserts new keys and bumps updated', () => {
    const next = upsertFrontmatter(raw, {
      status: 'closed',
      taskIds: ['BL-1', 'BL-3'],
      closedAt: '2026-09-25',
      capacityDays: 6,
      skipped: undefined,
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(next).toBe(
      [
        '---',
        'id: "SPRINT-004"',
        'status: "closed"',
        'taskIds: ["BL-1", "BL-3"]',
        `updated: "${today}"`,
        'closedAt: "2026-09-25"',
        'capacityDays: 6',
        '---',
        '',
        '# body',
        '',
      ].join('\n'),
    );
  });

  it('escapes quotes and backslashes in string values', () => {
    const next = upsertFrontmatter(raw, { name: 'Cut "25 Sep" \\ done' });
    expect(next).toContain('name: "Cut \\"25 Sep\\" \\\\ done"');
  });

  it('rejects content without frontmatter', () => {
    expect(() => upsertFrontmatter('# no frontmatter', { status: 'x' })).toThrow(
      /no valid frontmatter/u,
    );
  });
});

describe('replaceSection', () => {
  const body = [
    '# Title',
    '',
    '## Tasks',
    '',
    '- [ ] old',
    '',
    '## Retrospective',
    '_later_',
    '',
  ].join('\n');

  it('replaces the content under the heading up to the next level-2 heading', () => {
    expect(replaceSection(body, '## Tasks', '### Batch\n\n- [ ] **BL-1** new')).toBe(
      [
        '# Title',
        '',
        '## Tasks',
        '',
        '### Batch',
        '',
        '- [ ] **BL-1** new',
        '',
        '## Retrospective',
        '_later_',
        '',
      ].join('\n'),
    );
  });

  it('appends the section when the heading is absent', () => {
    expect(replaceSection('# Title\n', '## Tasks', '- [ ] **BL-1** new')).toBe(
      '# Title\n\n## Tasks\n\n- [ ] **BL-1** new\n',
    );
  });
});

describe('parseRefinementDocument', () => {
  it('accepts a consistent document and applies defaults', () => {
    const parsed = parseRefinementDocument(document(), 'SPRINT-004');
    expect(parsed.items[0].blockedBy).toEqual([]);
    expect(parsed.refuted).toEqual([]);
  });

  it('reports every inconsistency as a $-rooted diagnostic', () => {
    const invalid = document({
      buckets: { inProgress: ['BL-345', 'BL-999'], planNext: [], blocked: [], closeOrDemote: [] },
      batches: [{ title: 'PR 1', itemIds: ['BL-345', 'BL-345'] }],
    });
    let error: unknown;
    try {
      parseRefinementDocument(invalid, 'SPRINT-004');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SprintRefinementError);
    const failure = error as SprintRefinementError;
    expect(failure.code).toBe('E_SPRINT_REFINEMENT_INVALID');
    const rules = Object.fromEntries(
      (failure.details?.diagnostics ?? []).map((d) => [d.path, d.rule]),
    );
    expect(rules).toMatchObject({
      '$.buckets.inProgress[1]': 'refinement:unknown-item',
      '$.items[1].bucket': 'refinement:bucket-missing',
      '$.batches[0].itemIds[1]': 'refinement:batch-duplicate',
    });
  });

  it('rejects unknown fields, wrong effort classes and a mismatched sprint id', () => {
    expect(() =>
      parseRefinementDocument({ ...document(), unexpected: true }, 'SPRINT-004'),
    ).toThrow(SprintRefinementError);
    const wrongEffort = document();
    (wrongEffort.items[0] as { effort: string }).effort = 'forever';
    expect(() => parseRefinementDocument(wrongEffort, 'SPRINT-004')).toThrow(SprintRefinementError);
    let mismatch: unknown;
    try {
      parseRefinementDocument(document(), 'SPRINT-005');
    } catch (caught) {
      mismatch = caught;
    }
    expect((mismatch as SprintRefinementError).details?.diagnostics[0]).toMatchObject({
      path: '$.sprintId',
      rule: 'refinement:sprint-mismatch',
    });
  });
});

describe('diffRefinements', () => {
  it('lists moved, added and removed items sorted by id and counts the unchanged ones', () => {
    const before = document();
    const after = document({
      sprintId: 'SPRINT-005',
      refinedAt: '2026-10-01',
      items: [
        { ...before.items[0], bucket: 'planNext', score: 4 },
        {
          id: 'BL-400',
          title: 'New item',
          evidenceDate: null,
          stale: false,
          blockedBy: [],
          effort: 'day',
          score: 6,
          bucket: 'inProgress',
          reason: 'fresh',
        },
      ],
      buckets: { inProgress: ['BL-400'], planNext: ['BL-345'], blocked: [], closeOrDemote: [] },
      batches: [],
    });
    expect(diffRefinements(before, after)).toEqual({
      from: { sprintId: 'SPRINT-004', refinedAt: '2026-09-17' },
      to: { sprintId: 'SPRINT-005', refinedAt: '2026-10-01' },
      moved: [{ id: 'BL-345', from: 'inProgress', to: 'planNext', scoreFrom: 9, scoreTo: 4 }],
      added: [{ id: 'BL-400', bucket: 'inProgress' }],
      removed: [{ id: 'BL-295', bucket: 'closeOrDemote' }],
      unchanged: 0,
    });
  });
});
