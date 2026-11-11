import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readLocalOperateReview } from '../../lib/dashboard/operate-local-review-reader.mjs';

const skill = readFileSync(
  new URL('../../../../skills/planr-operate/SKILL.md', import.meta.url),
  'utf8',
);
const LENSES = ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'Challenger', 'Chair'];

/** The board-report template of the default single-pass mode, with each coverage row filled in. */
function defaultModeReport() {
  const template = /```markdown\n([\s\S]*?)```/u.exec(skill)?.[1];
  assert.ok(template, 'SKILL.md has no board-report template');
  const named = /Name each Review coverage row ((?:`[A-Za-z]+`(?:, | or )?)+);/u.exec(
    skill.replace(/\s+/gu, ' '),
  );
  assert.ok(named, 'SKILL.md does not name the coverage rows');
  const names = [...named[1].matchAll(/`([A-Za-z]+)`/gu)].map(([, name]) => name);
  assert.deepEqual(names, LENSES);
  const rows = names.map((name) => `| ${name} | reported | — | watch |`).join('\n');
  return template.replace(/^\| CEO \|.*$/mu, rows);
}

test('a default-mode board report is read with every lens reported', () => {
  const planrDir = mkdtempSync(join(tmpdir(), 'operate-default-'));
  try {
    const cycle = join(planrDir, 'operate', '2026-11-09-launch');
    mkdirSync(cycle, { recursive: true });
    writeFileSync(join(cycle, 'board-report.md'), defaultModeReport());
    const read = readLocalOperateReview(planrDir, '2026-11-09-launch');
    assert.ok(read, 'the reader rejected the cycle');
    assert.deepEqual(
      read.item.lenses.map(({ name, outcome }) => [name, outcome]),
      LENSES.map((name) => [name, 'reported']),
    );
  } finally {
    rmSync(planrDir, { recursive: true, force: true });
  }
});
