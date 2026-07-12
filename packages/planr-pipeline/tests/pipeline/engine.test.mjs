import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  completePlan,
  nextShipBatch,
  preparePlan,
  prepareShip,
  recordTaskResult,
} from '../../lib/pipeline/index.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-engine-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  writeFileSync(join(root, '.planr', 'config.json'), JSON.stringify({ idPrefix: { spec: 'SPEC' } }));
  return root;
}

function decompose(root, slug = 'auth') {
  const prepared = preparePlan({ projectRoot: root, feature: slug, scaffold: true });
  writeFileSync(join(prepared.specDir, 'stories', 'US-001-login.md'), '---\nid: "US-001"\nstatus: "pending"\n---\n');
  writeFileSync(join(prepared.specDir, 'tasks', 'T-001-api.md'), '---\nid: "T-001"\nstatus: "pending"\ndependsOn: []\n---\n\n## Preserve\n- `README.md`\n');
  writeFileSync(join(prepared.specDir, 'tasks', 'T-002-ui.md'), '---\nid: "T-002"\nstatus: "pending"\ndependsOn: [T-001]\n---\n');
  return prepared;
}

test('preparePlan scaffolds once and preserves the R1 boundary', () => {
  const root = project();
  const first = preparePlan({ projectRoot: root, feature: 'Auth', scaffold: true });
  const second = preparePlan({ projectRoot: root, feature: 'auth', scaffold: true });
  assert.equal(first.scaffolded, true);
  assert.equal(second.scaffolded, false);
  assert.equal(first.requiresHumanReviewBeforeShip, true);
  assert.equal(first.specDir, second.specDir);
});

test('completePlan requires stories and tasks then appends provenance', () => {
  const root = project();
  decompose(root);
  const result = completePlan({ projectRoot: root, feature: 'auth', runtime: 'codex', runId: 'run-1' });
  assert.equal(result.stories, 1);
  assert.equal(result.tasks, 2);
  assert.match(readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8'), /"operation":"decomposed"/);
});

test('prepareShip enforces explicit review and calculates the ready DAG batch', () => {
  const root = project();
  decompose(root);
  assert.throws(() => prepareShip({ projectRoot: root, feature: 'auth' }), /explicit human review/);
  const prepared = prepareShip({ projectRoot: root, feature: 'auth', humanReviewConfirmed: true });
  const batch = nextShipBatch(prepared.tasks);
  assert.deepEqual(batch.ready.map((task) => task.id), ['T-001']);
  assert.equal(batch.deadlocked, false);
});

test('recordTaskResult updates status, appends a valid manifest, and keeps Preserve intact', () => {
  const root = project();
  writeFileSync(join(root, 'README.md'), 'preserve me\n');
  const planned = decompose(root);
  const prepared = prepareShip({ projectRoot: root, feature: 'auth', humanReviewConfirmed: true });
  const task = prepared.tasks.find((entry) => entry.id === 'T-001');
  recordTaskResult({
    projectRoot: root,
    featureRoot: planned.specDir,
    task,
    result: { status: 'done', agent: 'backend-agent', filesWritten: ['src/auth.js'] },
    startedAt: '2026-07-12T10:00:00Z',
    endedAt: '2026-07-12T10:00:01Z',
  });
  assert.match(readFileSync(task.path, 'utf8'), /status: "done"/);
  assert.equal(existsSync(join(planned.specDir, '.run-manifest.jsonl')), true);
});

test('recordTaskResult deterministically blocks a task after three correction attempts', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-corrections-'));
  const featureRoot = join(root, 'output', 'feats', 'feat-retry');
  mkdirSync(join(featureRoot, 'us-1', 'tasks'), { recursive: true });
  const taskPath = join(featureRoot, 'us-1', 'tasks', 'task-1.md');
  writeFileSync(taskPath, '---\nid: "T-001"\nstatus: "pending"\ndependsOn: []\n---\n\n# Retry\n');
  const task = { id: 'T-001', path: taskPath, preserveHashes: {} };
  const attempts = [1, 2, 3].map(() => recordTaskResult({
    projectRoot: root,
    featureRoot,
    task,
    result: { status: 'retry', errorSummary: 'test failed' },
  }));
  assert.equal(attempts[0].canRetry, true);
  assert.equal(attempts[1].canRetry, true);
  assert.equal(attempts[2].status, 'blocked');
  assert.equal(attempts[2].correctionCount, 3);
  assert.match(readFileSync(taskPath, 'utf8'), /status: "blocked"/);
  assert.equal(existsSync(join(dirname(taskPath), 'T-001-error-report.md')), true);
});
