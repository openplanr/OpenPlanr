import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  readLocalOperateReview,
  readLocalOperateReviewIndex,
} from '../../lib/dashboard/operate-local-review-reader.mjs';

const ADVISOR_FILES = ['ceo.md', 'cto.md', 'cpo.md', 'cmo.md', 'coo.md'];

function coverageTable(rows) {
  return [
    '| Lens | Outcome | Note | Informed |',
    '|---|---|---|---|',
    ...rows.map(
      ([lens, outcome, note, informed]) => `| ${lens} | ${outcome} | ${note} | ${informed} |`,
    ),
  ].join('\n');
}

function boardReport(coverageRows) {
  return `# Operating board report — launch channels

> **Contract:** operate-review-quality-contract@2.0.0

## Scope
- **Subject:** launch channels
- **Window:** current snapshot
- **Requested decision:** periodic review
- **Custody:** local-only

## Executive summary
Overall signal: watch. One lens reported.

## Decision queue
No decision-ready proposal was established.

## Action plan
No proposed actions.

## Risks and dissent
None.

## Decision-changing gaps
None.

## Review coverage
${coverageTable(coverageRows)}

## Issues
None.
`;
}

function advisorNote(label, roleId) {
  return `# ${label} review — ${roleId}

> **Contract:** operate-review-quality-contract@2.0.0
> **Signal:** watch
> **Bottom line:** grounded.

## Findings

### F1 — One finding
- **Priority:** P2
- **Status:** observed
- **Sources:** \`README.md:1\`

## Recommended next move

- **Recommendation:** keep watching

## Decision-changing gaps

None.

## Sources consulted

- \`README.md\` — orientation
`;
}

function writeCycle(planrDir, cycleId, files) {
  const cycleDir = join(planrDir, 'operate', cycleId);
  mkdirSync(cycleDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(cycleDir, name), content);
}

function withPlanrDir(run) {
  const planrDir = mkdtempSync(join(tmpdir(), 'operate-local-review-'));
  try {
    return run(planrDir);
  } finally {
    rmSync(planrDir, { recursive: true, force: true });
  }
}

test('a full cycle with every note is complete', () => {
  withPlanrDir((planrDir) => {
    const rows = [
      ['CEO', 'reported', '`ceo.md`', 'D1'],
      ['CTO', 'reported', '`cto.md`', 'watch'],
      ['CPO', 'reported', '`cpo.md`', 'none'],
      ['CMO', 'reported', '`cmo.md`', 'none'],
      ['COO', 'reported', '`coo.md`', 'none'],
      ['Challenger', 'reported', '`challenger.md`', 'D1'],
      ['Chair', 'reported', '`chair.md`', 'D1'],
    ];
    const files = {
      'board-report.md': boardReport(rows),
      'cycle.md': '# Cycle\n',
      'brief.md': '# Brief\n',
      'challenger.md': '# Challenger review — independent-challenge\n> **Verdict:** holds\n',
      'chair.md': '# Chair synthesis — launch\n> **Overall signal:** watch\n',
    };
    for (const file of ADVISOR_FILES)
      files[file] = advisorNote(file.slice(0, 3).toUpperCase(), 'r');
    writeCycle(planrDir, '2026-10-06-launch-channels', files);

    const { item: review } = readLocalOperateReview(planrDir, '2026-10-06-launch-channels');
    assert.equal(review.recovery.complete, true);
    assert.deepEqual(review.recovery.missingFiles, []);
    assert.equal(review.lenses.filter((lens) => lens.present).length, 7);
  });
});

test('a single-lens cycle is complete when the board report omits the other lenses by scope', () => {
  withPlanrDir((planrDir) => {
    const rows = [
      ['CEO', 'omitted by scope', '—', 'none'],
      ['CTO', 'omitted by scope', '—', 'none'],
      ['CPO', 'omitted by scope', '—', 'none'],
      ['CMO', 'reported', '`cmo.md`', 'watch'],
      ['COO', 'omitted by scope', '—', 'none'],
      ['Challenger', 'omitted by scope', '—', 'none'],
      ['Chair', 'omitted by scope', '—', 'none'],
    ];
    writeCycle(planrDir, '2026-10-06-launch-channels', {
      'board-report.md': boardReport(rows),
      'cycle.md': '# Cycle\n\nRoster: growth-market\n',
      'brief.md': '# Brief\n',
      'cmo.md': advisorNote('CMO', 'growth-market'),
    });

    const { item: review } = readLocalOperateReview(planrDir, '2026-10-06-launch-channels');
    assert.equal(review.recovery.complete, true);
    assert.deepEqual(review.recovery.missingFiles, []);
    assert.deepEqual(review.recovery.presentFiles, [
      'board-report.md',
      'cycle.md',
      'brief.md',
      'cmo.md',
    ]);
    const cmo = review.lenses.find((lens) => lens.name === 'CMO');
    assert.equal(cmo.present, true);
    assert.equal(cmo.outcome, 'reported');
    const ceo = review.lenses.find((lens) => lens.name === 'CEO');
    assert.equal(ceo.present, false);
    assert.equal(ceo.outcome, 'omitted by scope');
    assert.equal(ceo.signal, 'omitted');

    const index = readLocalOperateReviewIndex(planrDir);
    assert.equal(index.items.length, 1);
    assert.equal(index.items[0].cycleId, '2026-10-06-launch-channels');
  });
});

test('a lens note the board report expects but the cycle lacks is still missing', () => {
  withPlanrDir((planrDir) => {
    const rows = [
      ['CEO', 'reported', '`ceo.md`', 'none'],
      ['CTO', 'omitted by scope', '—', 'none'],
      ['CPO', 'omitted by scope', '—', 'none'],
      ['CMO', 'reported', '`cmo.md`', 'watch'],
      ['COO', 'omitted by scope', '—', 'none'],
      ['Challenger', 'omitted by scope', '—', 'none'],
      ['Chair', 'omitted by scope', '—', 'none'],
    ];
    writeCycle(planrDir, '2026-10-06-launch-channels', {
      'board-report.md': boardReport(rows),
      'cycle.md': '# Cycle\n',
      'cmo.md': advisorNote('CMO', 'growth-market'),
    });

    const { item: review } = readLocalOperateReview(planrDir, '2026-10-06-launch-channels');
    assert.equal(review.recovery.complete, false);
    assert.deepEqual(review.recovery.missingFiles, ['ceo.md']);
  });
});

test('a cycle without a board report is not listed', () => {
  withPlanrDir((planrDir) => {
    writeCycle(planrDir, '2026-10-06-launch-channels', {
      'cmo.md': advisorNote('CMO', 'growth-market'),
    });
    assert.equal(readLocalOperateReview(planrDir, '2026-10-06-launch-channels'), null);
    assert.equal(readLocalOperateReviewIndex(planrDir).items.length, 0);
  });
});
