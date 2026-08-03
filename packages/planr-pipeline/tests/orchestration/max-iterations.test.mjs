import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { simulateDevLoopWithRetries } from '../../lib/devLoopSim.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const fixtureRoot = join(root, 'tests/fixtures/failing-task-scenario');

test('DEV cap: repeated LLM failures write T-{id}-error-report.md and skip .pipeline-shipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-max-it-'));
  try {
    cpSync(fixtureRoot, dir, { recursive: true });
    const specDir = join(dir, '.planr', 'specs', 'SPEC-001-fail-single');
    simulateDevLoopWithRetries({
      specDir,
      taskIds: ['T-001'],
      maxIterations: 3,
      llmSucceedsOnIteration: () => false,
    });
    const tasksDir = join(specDir, 'tasks');
    const names = new Set(readdirSync(tasksDir));
    assert.ok(names.has('T-001-error-report.md'));
    assert.equal(existsSync(join(specDir, '.pipeline-shipped')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
