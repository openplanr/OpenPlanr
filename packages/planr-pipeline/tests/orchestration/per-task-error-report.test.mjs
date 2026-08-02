import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { simulateDevLoopWithRetries } from '../../lib/devLoopSim.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const fixtureRoot = join(root, 'tests/fixtures/multi-task-failure-scenario');

function errorReportMdFiles(specDir) {
  const td = join(specDir, 'tasks');
  return readdirSync(td).filter((n) => /^T-\d{3}-error-report\.md$/i.test(n));
}

test('Per-task isolation: two failing tasks ⇒ two distinct T-*-error-report.md artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-per-task-'));
  try {
    cpSync(fixtureRoot, dir, { recursive: true });
    const specDir = join(dir, '.planr', 'specs', 'SPEC-001-fail-multi');
    simulateDevLoopWithRetries({
      specDir,
      taskIds: ['T-001', 'T-002'],
      maxIterations: 3,
      llmSucceedsOnIteration: () => false,
    });
    const reports = errorReportMdFiles(specDir);
    assert.deepEqual(reports.sort(), ['T-001-error-report.md', 'T-002-error-report.md']);
    assert.equal(existsSync(join(specDir, '.pipeline-shipped')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
