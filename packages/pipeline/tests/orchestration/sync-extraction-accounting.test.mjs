import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// SPEC-007 T-002 / DoD line 1 — the extraction of commands/sync.md's inline procedure into
// procedures/sync-workflow.md is a PURE MOVE. This is the byte-accounting proof the task
// requires ("not just 'the new file exists'"): every non-frontmatter line that existed in
// the pre-task commands/sync.md must survive in (thin router ∪ procedure).

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/gu, '\n');

// Frozen snapshot of commands/sync.md's non-frontmatter body BEFORE T-002 extracted it.
// It is a test oracle, never a workflow surface. If the sync procedure is ever deliberately
// reworded, update this snapshot in the same change so the accounting stays honest.
const preExtractionBody = readFileSync(
  join(here, 'fixtures/sync-command-pre-extraction.md'),
  'utf8',
).replace(/\r\n/gu, '\n');

const meaningfulLines = (text) =>
  text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

function nonFrontmatterBody(text) {
  const fm = text.match(/^---\n[\s\S]*?\n---\n/u);
  return fm ? text.slice(fm[0].length) : text;
}

test('sync extraction is lossless: every pre-task line survives in (router ∪ procedure)', () => {
  const routerBody = nonFrontmatterBody(read('commands/sync.md'));
  const procedure = read('procedures/sync-workflow.md');
  const survived = new Set([...meaningfulLines(routerBody), ...meaningfulLines(procedure)]);
  const dropped = meaningfulLines(preExtractionBody).filter((line) => !survived.has(line));
  assert.deepEqual(
    dropped,
    [],
    `extraction dropped ${dropped.length} line(s) from commands/sync.md:\n${dropped.join('\n')}`,
  );
});

test('the extracted procedure keeps the guardrails that protect against unreviewed writes/pushes', () => {
  const procedure = read('procedures/sync-workflow.md');
  // Atomicity risk named in T-002: a partial extraction could silently lose the HARD RULES
  // (branch resolution, outward-action gate). Assert the load-bearing guardrails moved intact.
  assert.match(procedure, /Operate on the canonical branch/);
  assert.match(procedure, /Outward-action gate/);
  assert.match(procedure, /"Done" is evidenced, never assumed/);
  assert.match(procedure, /## HARD RULES/);
  assert.match(procedure, /## Steps/);
  assert.match(procedure, /## Termination/);
});

test('the thin sync router no longer carries the inline HARD RULES / Steps procedure', () => {
  const router = read('commands/sync.md');
  assert.doesNotMatch(router, /## HARD RULES/);
  assert.doesNotMatch(router, /## Steps/);
  // But it must still point at the one procedure both the command and the skill read.
  assert.match(router, /procedures\/sync-workflow\.md/);
});
