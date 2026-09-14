import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import {
  advanceShip,
  assertShipClosure,
  finalizeShipClosure,
  getShipClosure,
  preparePlan,
  prepareShip,
  reopenShip,
  runShipGates,
  startShip,
  verifyShipCompatibilityProjection,
} from '../../lib/pipeline/index.mjs';
import {
  createShipClosure,
  finalizeStoredShipClosure,
} from '../../lib/pipeline/ship-closure.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliPath = join(repositoryRoot, 'bin', 'planr-pipeline.mjs');
const pipelineModuleUrl = pathToFileURL(join(repositoryRoot, 'lib', 'pipeline', 'index.mjs')).href;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function repositoryPath(path, repositoryKey = 'project') {
  return { repositoryKey, path };
}

function taskMarkdown({ id, storyId = 'US-001', dependsOn = [], preserve = [] }) {
  const preserveYaml = preserve.length === 0
    ? ['preserve: []']
    : ['preserve:', ...preserve.flatMap(({ repositoryKey, path }) => [
      `  - repositoryKey: ${JSON.stringify(repositoryKey)}`,
      `    path: ${JSON.stringify(path)}`,
    ])];
  return [
    '---',
    `id: ${JSON.stringify(id)}`,
    `storyId: ${JSON.stringify(storyId)}`,
    'status: "pending"',
    'updated: "2026-08-21"',
    `dependsOn: [${dependsOn.map((value) => JSON.stringify(value)).join(', ')}]`,
    ...preserveYaml,
    '---',
    '',
    '## Definition of done',
    '- [ ] complete',
    '',
  ].join('\n');
}

function project(slug = 'hostile', { tasks = [{ id: 'T-001' }], commit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-closure-hostile-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, '.planr', 'config.json'), JSON.stringify({ idPrefix: { spec: 'SPEC' } }, null, 2));
  writeFileSync(join(root, 'input', 'tech', 'stack.md'), [
    '# Stack',
    'BuildCommand: "node --check src/app.js"',
    'TestCommand: "node --test tests/smoke.test.mjs"',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 0;\n');
  writeFileSync(join(root, 'tests', 'smoke.test.mjs'), "import test from 'node:test'; test('ok', () => {});\n");
  writeFileSync(join(root, 'baseline.txt'), 'baseline\n');
  const prepared = preparePlan({ projectRoot: root, feature: slug, scaffold: true });
  mkdirSync(join(prepared.specDir, 'stories'), { recursive: true });
  mkdirSync(join(prepared.specDir, 'tasks'), { recursive: true });
  writeFileSync(join(prepared.specDir, 'stories', 'US-001-hostile.md'), [
    '---',
    'id: "US-001"',
    'status: "pending"',
    'updated: "2026-08-21"',
    '---',
    '',
  ].join('\n'));
  for (const task of tasks) {
    writeFileSync(join(prepared.specDir, 'tasks', `${task.id}-hostile.md`), taskMarkdown(task));
  }
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  if (commit) {
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'baseline');
  }
  return { root, prepared };
}

function addFeature(root, slug, { taskId = 'T-001' } = {}) {
  const prepared = preparePlan({ projectRoot: root, feature: slug, scaffold: true });
  mkdirSync(join(prepared.specDir, 'stories'), { recursive: true });
  mkdirSync(join(prepared.specDir, 'tasks'), { recursive: true });
  writeFileSync(join(prepared.specDir, 'stories', 'US-001-hostile.md'), [
    '---',
    'id: "US-001"',
    'status: "pending"',
    'updated: "2026-08-21"',
    '---',
    '',
  ].join('\n'));
  writeFileSync(join(prepared.specDir, 'tasks', `${taskId}-hostile.md`), taskMarkdown({ id: taskId }));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', `plan ${slug}`);
  return prepared;
}

function taskCompleted(generation, taskId = 'T-001', {
  filesWritten = [],
  filesModified = [repositoryPath('src/app.js')],
} = {}) {
  return {
    type: 'task.completed',
    expectedGeneration: generation,
    taskId,
    agent: 'backend-agent',
    filesWritten,
    filesModified,
  };
}

function taskBlocked(generation, taskId = 'T-001') {
  return {
    type: 'task.blocked',
    expectedGeneration: generation,
    taskId,
    agent: 'backend-agent',
    reason: 'The task cannot safely complete.',
    filesWritten: [],
    filesModified: [],
  };
}

function reviewOpened(generation) {
  return { type: 'review.opened', expectedGeneration: generation };
}

function finding({
  id = null,
  severity = 'P1',
  disposition = 'open',
  title = 'Candidate violates acceptance',
  evidence = 'The exact candidate bytes do not satisfy the reviewed acceptance behavior.',
  paths = [repositoryPath('src/app.js')],
  taskIds = ['T-001'],
} = {}) {
  return {
    id,
    severity,
    basis: 'correctness',
    title,
    evidence,
    taskIds,
    paths,
    acceptanceRefs: ['US-001:AC-1'],
    disposition,
  };
}

function reviewClosed(state, { phase, findings = [], reviewedFindingIds = [], reviewerIds, contributions } = {}) {
  const candidate = state.candidateRevisions.at(-1);
  const reviewers = reviewerIds ?? [...state.reviewerRoster];
  return {
    type: 'review.closed',
    expectedGeneration: state.generation,
    phase,
    candidateRevision: candidate.revision,
    candidateDigest: candidate.digest,
    reviewerIds: reviewers,
    contributions: contributions ?? state.reviewerRoster.map((reviewerId) => ({
      reviewerId,
      summary: `${reviewerId} completed the consolidated ${phase} review.`,
      evidenceDigest: sha256Jcs({ reviewerId, phase, candidateDigest: candidate.digest }),
    })),
    findings,
    reviewedFindingIds,
    summary: `${phase} consolidated review`,
    rosterDigest: state.rosterDigest,
    gateSetDigest: state.gateSetDigest,
  };
}

function advance(projectRoot, feature, runId, event) {
  return advanceShip({ projectRoot, feature, runId, event });
}

function completeAndOpen(root, slug, runId, taskIds = ['T-001']) {
  let summary = getShipClosure({ projectRoot: root, feature: slug, runId });
  for (const taskId of taskIds) {
    summary = advance(root, slug, runId, taskCompleted(summary.generation, taskId));
  }
  return advance(root, slug, runId, reviewOpened(summary.generation));
}

function closeCleanInitial(root, slug, runId) {
  runShipGates({ projectRoot: root, feature: slug, runId, phase: 'initial' });
  const state = getShipClosure({ projectRoot: root, feature: slug, runId });
  return advance(root, slug, runId, reviewClosed(state, { phase: 'initial' }));
}

function passRun(root, slug, { taskId, reviewerRoster, gates } = {}) {
  const started = startShip({
    projectRoot: root,
    feature: slug,
    humanReviewConfirmed: true,
    runtime: 'codex',
    taskId,
    reviewerRoster,
    gates,
  });
  completeAndOpen(root, slug, started.runId, taskId ? [taskId] : undefined);
  closeCleanInitial(root, slug, started.runId);
  runShipGates({ projectRoot: root, feature: slug, runId: started.runId, phase: 'final' });
  return finalizeShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
}

function blockRun(root, slug, { taskId = 'T-001' } = {}) {
  const started = startShip({
    projectRoot: root,
    feature: slug,
    humanReviewConfirmed: true,
    runtime: 'codex',
    taskId,
  });
  advance(root, slug, started.runId, taskBlocked(0, taskId));
  return finalizeShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
}

function rehashReceipt(receipt) {
  const clone = structuredClone(receipt);
  clone.receiptHash = sha256Jcs({ ...clone, receiptHash: null });
  return clone;
}

function rebindSingleCandidate(receipt, mutateInventory) {
  const value = structuredClone(receipt);
  const candidate = value.candidateRevisions[0];
  const oldDigest = candidate.digest;
  mutateInventory(candidate.inventory);
  for (const repository of candidate.repositories) {
    repository.inventoryDigest = sha256Jcs(candidate.inventory.filter(({ repositoryKey }) => repositoryKey === repository.repositoryKey));
  }
  candidate.digest = sha256Jcs({ repositories: candidate.repositories, inventory: candidate.inventory });
  for (const review of value.reviews) if (review.candidateDigest === oldDigest) review.candidateDigest = candidate.digest;
  for (const evidence of value.gateEvidence) if (evidence.candidateDigest === oldDigest) evidence.candidateDigest = candidate.digest;
  if (value.terminal.candidateDigest === oldDigest) value.terminal.candidateDigest = candidate.digest;
  value.terminal.gateEvidenceDigest = sha256Jcs(value.gateEvidence);
  return rehashReceipt(value);
}

function correctedReceipt(root, slug) {
  const started = startShip({ projectRoot: root, feature: slug, humanReviewConfirmed: true, runtime: 'codex' });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, slug, started.runId);
  runShipGates({ projectRoot: root, feature: slug, runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
  let summary = advance(root, slug, started.runId, reviewClosed(state, { phase: 'initial', findings: [finding()] }));
  state = getShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  summary = advance(root, slug, started.runId, {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: {
      summary: 'Correct the bounded source.',
      findingIds: [original.id],
      paths: [repositoryPath('src/app.js')],
      affectedGateIds: ['build-1', 'test-1'],
    },
  });
  advance(root, slug, started.runId, reviewOpened(summary.generation));
  runShipGates({ projectRoot: root, feature: slug, runId: started.runId, phase: 'targeted' });
  state = getShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
  advance(root, slug, started.runId, reviewClosed(state, {
    phase: 'targeted',
    reviewedFindingIds: [original.id],
    findings: [finding({ id: original.id, disposition: 'resolved' })],
  }));
  runShipGates({ projectRoot: root, feature: slug, runId: started.runId, phase: 'final' });
  const summaryReceipt = finalizeShipClosure({ projectRoot: root, feature: slug, runId: started.runId });
  return JSON.parse(readFileSync(summaryReceipt.receiptPath, 'utf8'));
}

function errorCode(fn, expected) {
  assert.throws(fn, (error) => error?.code === expected, `expected ${expected}`);
}

function cli(root, args, { input, expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
  });
  if (!expectFailure) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, result.stdout);
  return JSON.parse((expectFailure ? result.stderr : result.stdout).trim());
}

test('feature-wide start serialization permits exactly one concurrent active run', async () => {
  const { root } = project('start-race');
  const signal = new SharedArrayBuffer(4);
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { startShip } = await import(workerData.moduleUrl);
      parentPort.postMessage({ ready: true });
      Atomics.wait(new Int32Array(workerData.signal), 0, 0);
      try {
        const value = startShip({ projectRoot: workerData.root, feature: 'start-race', humanReviewConfirmed: true, runtime: 'codex', runId: workerData.runId });
        parentPort.postMessage({ ok: true, runId: value.runId });
      } catch (error) {
        parentPort.postMessage({ ok: false, code: error.code, problem: error.message });
      }
    })();
  `;
  const ids = [`ship_${'1'.repeat(32)}`, `ship_${'2'.repeat(32)}`];
  const workers = ids.map((runId) => new Worker(workerCode, {
    eval: true,
    workerData: { moduleUrl: pipelineModuleUrl, root, runId, signal },
  }));
  const receive = (worker) => new Promise((resolve, reject) => {
    const messages = [];
    worker.on('message', (message) => {
      messages.push(message);
      if (message.ok !== undefined) resolve(message);
    });
    worker.on('error', reject);
  });
  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const results = workers.map(receive);
  Atomics.store(new Int32Array(signal), 0, 1);
  Atomics.notify(new Int32Array(signal), 0, workers.length);
  const settled = await Promise.all(results);
  assert.equal(settled.filter(({ ok }) => ok).length, 1);
  const loser = settled.find(({ ok }) => !ok);
  assert.ok(['E_SHIP_ACTIVE', 'E_SHIP_LOCKED'].includes(loser.code), `unexpected untyped concurrent-start failure: ${loser.code}`);
  await Promise.all(workers.map((worker) => worker.terminate()));
});

test('active event replay is exact-only and illegal/backward transitions are rejected', () => {
  const { root } = project('illegal');
  const started = startShip({ projectRoot: root, feature: 'illegal', humanReviewConfirmed: true, runtime: 'codex' });
  errorCode(() => advance(root, 'illegal', started.runId, reviewOpened(0)), 'E_SHIP_TASKS_INCOMPLETE');
  const initial = getShipClosure({ projectRoot: root, feature: 'illegal', runId: started.runId });
  errorCode(() => advance(root, 'illegal', started.runId, reviewClosed({
    ...initial,
    candidateRevisions: [{ revision: 1, digest: `sha256:${'0'.repeat(64)}` }],
  }, { phase: 'initial' })), 'E_SHIP_STATE_TRANSITION_INVALID');
  const completion = taskCompleted(0);
  const completed = advance(root, 'illegal', started.runId, completion);
  assert.equal(advance(root, 'illegal', started.runId, completion).replayed, true);
  const eventId = getShipClosure({ projectRoot: root, feature: 'illegal', runId: started.runId }).events[0].eventId;
  errorCode(() => advance(root, 'illegal', started.runId, {
    ...completion,
    eventId,
    filesModified: [repositoryPath('src/other.js')],
  }), 'E_SHIP_EVENT_INVALID');
  const opened = advance(root, 'illegal', started.runId, reviewOpened(completed.generation));
  errorCode(() => advance(root, 'illegal', started.runId, taskCompleted(opened.generation)), 'E_SHIP_STATE_TRANSITION_INVALID');
  let state = getShipClosure({ projectRoot: root, feature: 'illegal', runId: started.runId });
  errorCode(() => advance(root, 'illegal', started.runId, reviewClosed(state, { phase: 'targeted' })), 'E_SHIP_STATE_TRANSITION_INVALID');
  errorCode(() => advance(root, 'illegal', started.runId, reviewOpened(state.generation)), 'E_SHIP_STATE_TRANSITION_INVALID');
});

test('review close requires exact roster membership and one contribution per declared reviewer', () => {
  const { root } = project('roster');
  const started = startShip({
    projectRoot: root,
    feature: 'roster',
    humanReviewConfirmed: true,
    reviewerRoster: ['qa-agent', 'security-agent'],
  });
  completeAndOpen(root, 'roster', started.runId);
  runShipGates({ projectRoot: root, feature: 'roster', runId: started.runId, phase: 'initial' });
  const state = getShipClosure({ projectRoot: root, feature: 'roster', runId: started.runId });
  const valid = reviewClosed(state, { phase: 'initial' });
  errorCode(() => advance(root, 'roster', started.runId, { ...valid, reviewerIds: ['qa-agent'] }), 'E_SHIP_REVIEWER_UNDECLARED');
  errorCode(() => advance(root, 'roster', started.runId, { ...valid, contributions: valid.contributions.slice(0, 1) }), 'E_SHIP_REVIEWER_UNDECLARED');
  errorCode(() => advance(root, 'roster', started.runId, {
    ...valid,
    contributions: [valid.contributions[0], { ...valid.contributions[1], reviewerId: 'qa-agent' }],
  }), 'E_SHIP_REVIEWER_UNDECLARED');
  errorCode(() => advance(root, 'roster', started.runId, {
    ...valid,
    contributions: [valid.contributions[0], { ...valid.contributions[1], reviewerId: 'foreign-agent' }],
  }), 'E_SHIP_REVIEWER_UNDECLARED');
  assert.equal(advance(root, 'roster', started.runId, valid).state, 'ready_for_final');
});

test('cyclic task and gate DAGs are rejected before custody is written', () => {
  const taskCycle = project('task-cycle', {
    tasks: [
      { id: 'T-001', dependsOn: ['T-002'] },
      { id: 'T-002', dependsOn: ['T-001'] },
    ],
  });
  errorCode(() => startShip({ projectRoot: taskCycle.root, feature: 'task-cycle', humanReviewConfirmed: true }), 'E_SHIP_TASK_DEPENDENCY');
  assert.equal(existsSync(join(taskCycle.prepared.specDir, '.ship', 'active')), false);

  const gateCycle = project('gate-cycle');
  const gates = [
    { id: 'a', repositoryKey: 'project', argv: ['node', '--version'], inputs: [repositoryPath('src/app.js')], dependsOn: ['b'], finalRelevantSuite: true },
    { id: 'b', repositoryKey: 'project', argv: ['node', '--version'], inputs: [repositoryPath('tests/smoke.test.mjs')], dependsOn: ['a'], finalRelevantSuite: false },
  ];
  errorCode(() => startShip({ projectRoot: gateCycle.root, feature: 'gate-cycle', humanReviewConfirmed: true, gates }), 'E_SHIP_GATE_INVALID');

  const foreignInput = project('foreign-gate-input');
  errorCode(() => startShip({
    projectRoot: foreignInput.root,
    feature: 'foreign-gate-input',
    humanReviewConfirmed: true,
    gates: [{
      id: 'foreign-input', repositoryKey: 'project', argv: ['node', '--version'],
      inputs: [repositoryPath('src/app.js', 'undeclared')], dependsOn: [], finalRelevantSuite: true,
    }],
  }), 'E_SHIP_GATE_INVALID');
  assert.equal(existsSync(join(foreignInput.prepared.specDir, '.ship', 'active')), false);
});

test('one correction is the hard revision ceiling and arbitrary late review events cannot reopen it', () => {
  const { root } = project('finite');
  const started = startShip({ projectRoot: root, feature: 'finite', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, 'finite', started.runId);
  runShipGates({ projectRoot: root, feature: 'finite', runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: 'finite', runId: started.runId });
  let summary = advance(root, 'finite', started.runId, reviewClosed(state, { phase: 'initial', findings: [finding()] }));
  state = getShipClosure({ projectRoot: root, feature: 'finite', runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  const correction = {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: {
      summary: 'Change the exact affected source.',
      findingIds: [original.id],
      paths: [repositoryPath('src/app.js')],
      affectedGateIds: ['build-1', 'test-1'],
    },
  };
  summary = advance(root, 'finite', started.runId, correction);
  errorCode(() => advance(root, 'finite', started.runId, { ...correction, expectedGeneration: summary.generation }), 'E_SHIP_STATE_TRANSITION_INVALID');
  summary = advance(root, 'finite', started.runId, reviewOpened(summary.generation));
  runShipGates({ projectRoot: root, feature: 'finite', runId: started.runId, phase: 'targeted' });
  state = getShipClosure({ projectRoot: root, feature: 'finite', runId: started.runId });
  const terminal = advance(root, 'finite', started.runId, reviewClosed(state, {
    phase: 'targeted',
    reviewedFindingIds: [original.id],
    findings: [finding({ id: original.id, disposition: 'remains' })],
  }));
  assert.equal(terminal.recordType, 'receipt');
  assert.equal(terminal.state, 'blocked');
  for (let index = 0; index < 64; index += 1) {
    errorCode(
      () => advance(root, 'finite', started.runId, reviewOpened(terminal.generation + index)),
      'E_SHIP_TERMINAL',
    );
  }
  const receipt = getShipClosure({ projectRoot: root, feature: 'finite', runId: started.runId });
  assert.equal(receipt.candidateRevisions.length, 2);
  assert.equal(receipt.reviews.length, 2);
});

test('a sealed correction successor must receive its targeted review before finalization', () => {
  const { root } = project('targeted-required');
  const started = startShip({ projectRoot: root, feature: 'targeted-required', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, 'targeted-required', started.runId);
  runShipGates({ projectRoot: root, feature: 'targeted-required', runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: 'targeted-required', runId: started.runId });
  let summary = advance(root, 'targeted-required', started.runId, reviewClosed(state, { phase: 'initial', findings: [finding()] }));
  state = getShipClosure({ projectRoot: root, feature: 'targeted-required', runId: started.runId });
  const findingId = state.reviews[0].findings[0].id;
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  summary = advance(root, 'targeted-required', started.runId, {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: {
      summary: 'Seal the sole successor.',
      findingIds: [findingId],
      paths: [repositoryPath('src/app.js')],
      affectedGateIds: ['build-1', 'test-1'],
    },
  });
  assert.equal(summary.candidateRevision, 2);
  errorCode(
    () => finalizeShipClosure({ projectRoot: root, feature: 'targeted-required', runId: started.runId }),
    'E_SHIP_STATE_TRANSITION_INVALID',
  );
  assert.equal(getShipClosure({ projectRoot: root, feature: 'targeted-required', runId: started.runId }).recordType, 'active');
});

test('a newly exposed targeted P0/P1 finding is terminal blocking and cannot self-resolve', () => {
  const { root } = project('new-blocker');
  const started = startShip({ projectRoot: root, feature: 'new-blocker', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, 'new-blocker', started.runId);
  runShipGates({ projectRoot: root, feature: 'new-blocker', runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: 'new-blocker', runId: started.runId });
  let summary = advance(root, 'new-blocker', started.runId, reviewClosed(state, { phase: 'initial', findings: [finding()] }));
  state = getShipClosure({ projectRoot: root, feature: 'new-blocker', runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  summary = advance(root, 'new-blocker', started.runId, {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: { summary: 'Fix.', findingIds: [original.id], paths: [repositoryPath('src/app.js')], affectedGateIds: ['build-1', 'test-1'] },
  });
  summary = advance(root, 'new-blocker', started.runId, reviewOpened(summary.generation));
  runShipGates({ projectRoot: root, feature: 'new-blocker', runId: started.runId, phase: 'targeted' });
  state = getShipClosure({ projectRoot: root, feature: 'new-blocker', runId: started.runId });
  const originalResolved = finding({ id: original.id, disposition: 'resolved' });
  errorCode(() => advance(root, 'new-blocker', started.runId, reviewClosed(state, {
    phase: 'targeted',
    reviewedFindingIds: [original.id],
    findings: [originalResolved, finding({ disposition: 'resolved', title: 'New blocker' })],
  })), 'E_SHIP_REVIEW_INVALID');
  const terminal = advance(root, 'new-blocker', started.runId, reviewClosed(state, {
    phase: 'targeted',
    reviewedFindingIds: [original.id],
    findings: [originalResolved, finding({ disposition: 'open', title: 'New blocker' })],
  }));
  assert.equal(terminal.state, 'blocked');
  assert.equal(terminal.recordType, 'receipt');
});

test('semantic validation rejects rehashed receipt tampering rather than trusting self hash', () => {
  const { root } = project('semantic');
  const receiptSummary = passRun(root, 'semantic');
  const receipt = JSON.parse(readFileSync(receiptSummary.receiptPath, 'utf8'));
  const tampered = [
    [() => {
      const value = structuredClone(receipt);
      value.approvedScope.digest = `sha256:${'a'.repeat(64)}`;
      return rehashReceipt(value);
    }, 'E_SHIP_CLOSURE_INVALID'],
    [() => {
      const value = structuredClone(receipt);
      value.tasks[0].path.repositoryKey = 'foreign';
      return rehashReceipt(value);
    }, 'E_SHIP_CLOSURE_INVALID'],
    [() => {
      const value = structuredClone(receipt);
      value.terminal.candidateDigest = `sha256:${'b'.repeat(64)}`;
      return rehashReceipt(value);
    }, 'E_SHIP_CLOSURE_INVALID'],
    [() => {
      const value = structuredClone(receipt);
      value.events[0].generation = 99;
      return rehashReceipt(value);
    }, 'E_SHIP_CLOSURE_INVALID'],
    [() => {
      const value = structuredClone(receipt);
      value.reviews[0].contributions[0].reviewerId = 'foreign-agent';
      return rehashReceipt(value);
    }, 'E_SHIP_REVIEWER_UNDECLARED'],
    [() => {
      const value = structuredClone(receipt);
      value.gates[0].dependsOn = [value.gates.at(-1).id];
      value.gateSetDigest = sha256Jcs(value.gates);
      return rehashReceipt(value);
    }, 'E_SHIP_CLOSURE_INVALID'],
  ];
  for (const [mutate, expected] of tampered) errorCode(() => assertShipClosure(mutate()), expected);
});

test('self-consistent receipt forgery cannot remove qa-agent or detach reopen reason from parent hash', () => {
  const { root } = project('semantic-roster');
  const summary = passRun(root, 'semantic-roster');
  const receipt = JSON.parse(readFileSync(summary.receiptPath, 'utf8'));

  const noQa = structuredClone(receipt);
  noQa.reviewerRoster = ['security-agent'];
  noQa.rosterDigest = sha256Jcs(noQa.reviewerRoster);
  noQa.reviews[0].reviewerIds = ['security-agent'];
  noQa.reviews[0].rosterDigest = noQa.rosterDigest;
  noQa.reviews[0].contributions[0].reviewerId = 'security-agent';
  errorCode(() => assertShipClosure(rehashReceipt(noQa)), 'E_SHIP_CLOSURE_INVALID');

  const orphan = structuredClone(receipt);
  orphan.startedFromReceiptHash = `sha256:${'d'.repeat(64)}`;
  orphan.reopenReason = null;
  errorCode(() => assertShipClosure(rehashReceipt(orphan)), 'E_SHIP_CLOSURE_INVALID');
});

test('candidate inventory rejects traversal even when every dependent digest is recomputed', () => {
  const { root } = project('semantic-inventory');
  writeFileSync(join(root, 'src', 'app.js'), 'export const changed = true;\n');
  const summary = passRun(root, 'semantic-inventory');
  const receipt = JSON.parse(readFileSync(summary.receiptPath, 'utf8'));
  assert.ok(receipt.candidateRevisions[0].inventory.length > 0);
  const forged = rebindSingleCandidate(receipt, (inventory) => {
    inventory[0].path = '../escape';
  });
  errorCode(() => assertShipClosure(forged), 'E_SHIP_CLOSURE_INVALID');
});

test('receipt validation binds initial review to revision one and correction impact to exact delta/gates', () => {
  const { root } = project('semantic-correction');
  const receipt = correctedReceipt(root, 'semantic-correction');

  const wrongRevision = structuredClone(receipt);
  wrongRevision.reviews[0].candidateRevision = 2;
  wrongRevision.reviews[0].candidateDigest = wrongRevision.candidateRevisions[1].digest;
  errorCode(() => assertShipClosure(rehashReceipt(wrongRevision)), 'E_SHIP_CLOSURE_INVALID');

  const unrelatedImpact = structuredClone(receipt);
  unrelatedImpact.correctionImpact.paths = [repositoryPath('tests/smoke.test.mjs')];
  unrelatedImpact.correctionImpact.affectedGateIds = ['test-1'];
  errorCode(() => assertShipClosure(rehashReceipt(unrelatedImpact)), 'E_SHIP_CLOSURE_INVALID');
});

test('receipt validation rejects circular or future final gate evidence reuse', () => {
  const { root } = project('semantic-reuse');
  const summary = passRun(root, 'semantic-reuse');
  const receipt = JSON.parse(readFileSync(summary.receiptPath, 'utf8'));
  const reusable = receipt.gateEvidence.find(({ phase, status }) => phase === 'final' && status === 'reused');
  assert.ok(reusable, 'fixture needs one non-final reused gate');
  reusable.reusedFromPhase = 'final';
  receipt.terminal.gateEvidenceDigest = sha256Jcs(receipt.gateEvidence);
  errorCode(() => assertShipClosure(rehashReceipt(receipt)), 'E_SHIP_CLOSURE_INVALID');
});

test('storage rejects symlink custody, reclaims provably stale locks, and preserves live locks', () => {
  const unsafe = project('unsafe-store');
  const target = mkdtempSync(join(tmpdir(), 'openplanr-closure-store-target-'));
  symlinkSync(target, join(unsafe.prepared.specDir, '.ship'));
  errorCode(() => startShip({ projectRoot: unsafe.root, feature: 'unsafe-store', humanReviewConfirmed: true }), 'E_SHIP_STORAGE_UNSAFE');

  const stale = project('stale-lock');
  const locks = join(stale.prepared.specDir, '.ship', 'locks');
  mkdirSync(join(stale.prepared.specDir, '.ship', 'active'), { recursive: true });
  mkdirSync(join(stale.prepared.specDir, '.ship', 'receipts'), { recursive: true });
  mkdirSync(locks, { recursive: true });
  const featureLock = join(locks, 'feature-start.lock');
  writeFileSync(featureLock, `${JSON.stringify({ pid: 2147483647, host: hostname(), processStart: 'not-running', createdAt: new Date().toISOString() })}\n`);
  assert.equal(startShip({ projectRoot: stale.root, feature: 'stale-lock', humanReviewConfirmed: true }).state, 'implementing');
  assert.equal(existsSync(featureLock), false);

  const live = project('live-lock');
  const liveLocks = join(live.prepared.specDir, '.ship', 'locks');
  mkdirSync(join(live.prepared.specDir, '.ship', 'active'), { recursive: true });
  mkdirSync(join(live.prepared.specDir, '.ship', 'receipts'), { recursive: true });
  mkdirSync(liveLocks, { recursive: true });
  // This is exactly the metadata shape acquired when process inspection is
  // unavailable: ownership is unprovable, so fail closed rather than reclaim.
  writeFileSync(join(liveLocks, 'feature-start.lock'), `${JSON.stringify({ pid: process.pid, host: hostname(), processStart: null, createdAt: new Date().toISOString() })}\n`);
  errorCode(() => startShip({ projectRoot: live.root, feature: 'live-lock', humanReviewConfirmed: true }), 'E_SHIP_ACTIVE');

  const unsafeLockDir = project('unsafe-lock-dir');
  mkdirSync(join(unsafeLockDir.prepared.specDir, '.ship'), { recursive: true });
  symlinkSync(target, join(unsafeLockDir.prepared.specDir, '.ship', 'locks'));
  errorCode(() => startShip({ projectRoot: unsafeLockDir.root, feature: 'unsafe-lock-dir', humanReviewConfirmed: true }), 'E_SHIP_STORAGE_UNSAFE');

  const malformed = project('malformed-lock');
  const malformedLocks = join(malformed.prepared.specDir, '.ship', 'locks');
  mkdirSync(join(malformed.prepared.specDir, '.ship', 'active'), { recursive: true });
  mkdirSync(join(malformed.prepared.specDir, '.ship', 'receipts'), { recursive: true });
  mkdirSync(malformedLocks, { recursive: true });
  writeFileSync(join(malformedLocks, 'feature-start.lock'), '{not-json\n');
  errorCode(() => startShip({ projectRoot: malformed.root, feature: 'malformed-lock', humanReviewConfirmed: true }), 'E_SHIP_ACTIVE');

  const custodyLink = project('custody-link');
  const shipRoot = join(custodyLink.prepared.specDir, '.ship');
  mkdirSync(join(shipRoot, 'active'), { recursive: true });
  mkdirSync(join(shipRoot, 'receipts'), { recursive: true });
  mkdirSync(join(shipRoot, 'locks'), { recursive: true });
  const linkedRunId = `ship_${'e'.repeat(32)}`;
  const linkedTarget = join(mkdtempSync(join(tmpdir(), 'openplanr-linked-custody-')), 'record.json');
  writeFileSync(linkedTarget, '{}\n');
  symlinkSync(linkedTarget, join(shipRoot, 'active', `${linkedRunId}.json`));
  errorCode(() => startShip({
    projectRoot: custodyLink.root,
    feature: 'custody-link',
    humanReviewConfirmed: true,
    runId: linkedRunId,
  }), 'E_SHIP_CLOSURE_INVALID');
});

test('structured Preserve covers file bytes, modes, directory trees, rename/deletion, and broken symlink targets', () => {
  const { root, prepared } = project('preserve-hostile', { commit: false });
  mkdirSync(join(root, 'protected-tree'), { recursive: true });
  writeFileSync(join(root, 'protected-file'), 'original\n');
  writeFileSync(join(root, 'protected-tree', 'child'), 'child\n');
  symlinkSync('missing-a', join(root, 'broken-link'));
  const taskPath = join(prepared.specDir, 'tasks', 'T-001-hostile.md');
  writeFileSync(taskPath, taskMarkdown({
    id: 'T-001',
    preserve: [repositoryPath('protected-file'), repositoryPath('protected-tree'), repositoryPath('broken-link')],
  }));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline with preserve');
  const started = startShip({ projectRoot: root, feature: 'preserve-hostile', humanReviewConfirmed: true });
  const complete = advance(root, 'preserve-hostile', started.runId, taskCompleted(0));
  const expectViolation = (mutate, restore, expectedPath) => {
    mutate();
    assert.throws(
      () => advance(root, 'preserve-hostile', started.runId, reviewOpened(complete.generation)),
      (error) => error?.code === 'E_PRESERVE_VIOLATION'
        && error.details.changed.some(({ path }) => path === expectedPath),
    );
    restore();
  };
  expectViolation(
    () => writeFileSync(join(root, 'protected-file'), 'changed\n'),
    () => writeFileSync(join(root, 'protected-file'), 'original\n'),
    'protected-file',
  );
  expectViolation(
    () => chmodSync(join(root, 'protected-file'), 0o755),
    () => chmodSync(join(root, 'protected-file'), 0o644),
    'protected-file',
  );
  expectViolation(
    () => writeFileSync(join(root, 'protected-tree', 'added'), 'new\n'),
    () => unlinkSync(join(root, 'protected-tree', 'added')),
    'protected-tree',
  );
  expectViolation(
    () => unlinkSync(join(root, 'protected-tree', 'child')),
    () => writeFileSync(join(root, 'protected-tree', 'child'), 'child\n'),
    'protected-tree',
  );
  expectViolation(
    () => renameSync(join(root, 'protected-tree', 'child'), join(root, 'protected-tree', 'renamed')),
    () => renameSync(join(root, 'protected-tree', 'renamed'), join(root, 'protected-tree', 'child')),
    'protected-tree',
  );
  expectViolation(
    () => { unlinkSync(join(root, 'broken-link')); symlinkSync('missing-b', join(root, 'broken-link')); },
    () => { unlinkSync(join(root, 'broken-link')); symlinkSync('missing-a', join(root, 'broken-link')); },
    'broken-link',
  );
  assert.equal(readlinkSync(join(root, 'broken-link')), 'missing-a');
  assert.equal(advance(root, 'preserve-hostile', started.runId, reviewOpened(complete.generation)).state, 'reviewing_initial');
});

test('candidate identity binds dirty baseline plus add/delete/rename/symlink/mode surfaces', () => {
  const { root } = project('inventory');
  writeFileSync(join(root, 'baseline.txt'), 'dirty before start\n');
  const started = startShip({ projectRoot: root, feature: 'inventory', humanReviewConfirmed: true });
  const baseline = getShipClosure({ projectRoot: root, feature: 'inventory', runId: started.runId }).repositories[0].baselineDigest;
  assert.match(baseline, /^sha256:/);
  git(root, 'mv', 'src/app.js', 'src/renamed.js');
  chmodSync(join(root, 'input', 'tech', 'stack.md'), 0o755);
  unlinkSync(join(root, 'tests', 'smoke.test.mjs'));
  writeFileSync(join(root, 'added.txt'), 'added\n');
  symlinkSync('missing-target', join(root, 'new-link'));
  const completed = advance(root, 'inventory', started.runId, taskCompleted(0, 'T-001', {
    filesWritten: [repositoryPath('added.txt'), repositoryPath('new-link')],
    filesModified: [repositoryPath('src/renamed.js'), repositoryPath('tests/smoke.test.mjs'), repositoryPath('input/tech/stack.md')],
  }));
  advance(root, 'inventory', started.runId, reviewOpened(completed.generation));
  const candidate = getShipClosure({ projectRoot: root, feature: 'inventory', runId: started.runId }).candidateRevisions[0];
  const inventory = new Map(candidate.inventory.map((entry) => [entry.path, entry]));
  assert.equal(inventory.get('src/renamed.js').changeType, 'renamed');
  assert.equal(inventory.get('src/renamed.js').originalPath, 'src/app.js');
  assert.equal(inventory.get('tests/smoke.test.mjs').changeType, 'deleted');
  assert.equal(inventory.get('added.txt').changeType, 'added');
  assert.equal(inventory.get('new-link').kind, 'symlink');
  assert.equal(inventory.get('new-link').symlinkTarget, 'missing-target');
  assert.equal(inventory.get('input/tech/stack.md').mode & 0o111, 0o111);
  assert.equal(candidate.digest, sha256Jcs({ repositories: candidate.repositories, inventory: candidate.inventory }));
});

test('gate reuse includes dependency evidence and mandatory final suite always executes', () => {
  const { root } = project('gate-custody');
  const counterRoot = mkdtempSync(join(tmpdir(), 'openplanr-gate-counter-'));
  const counterA = join(counterRoot, 'a');
  const counterB = join(counterRoot, 'b');
  const append = (path) => `require('node:fs').appendFileSync(${JSON.stringify(path)}, 'x')`;
  const gates = [
    {
      id: 'gate-a', repositoryKey: 'project', argv: [process.execPath, '-e', append(counterA)],
      inputs: [repositoryPath('src/app.js')], dependsOn: [], finalRelevantSuite: false,
    },
    {
      id: 'gate-b', repositoryKey: 'project', argv: [process.execPath, '-e', append(counterB)],
      inputs: [repositoryPath('tests/smoke.test.mjs')], dependsOn: ['gate-a'], finalRelevantSuite: true,
    },
  ];
  const started = startShip({ projectRoot: root, feature: 'gate-custody', humanReviewConfirmed: true, gates });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, 'gate-custody', started.runId);
  const initialEvidence = runShipGates({ projectRoot: root, feature: 'gate-custody', runId: started.runId, phase: 'initial' }).evidence;
  let state = getShipClosure({ projectRoot: root, feature: 'gate-custody', runId: started.runId });
  let summary = advance(root, 'gate-custody', started.runId, reviewClosed(state, { phase: 'initial', findings: [finding()] }));
  state = getShipClosure({ projectRoot: root, feature: 'gate-custody', runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  summary = advance(root, 'gate-custody', started.runId, {
    type: 'correction.registered', expectedGeneration: summary.generation,
    impact: { summary: 'Fix source.', findingIds: [original.id], paths: [repositoryPath('src/app.js')], affectedGateIds: ['gate-a'] },
  });
  summary = advance(root, 'gate-custody', started.runId, reviewOpened(summary.generation));
  const targetedEvidence = runShipGates({ projectRoot: root, feature: 'gate-custody', runId: started.runId, phase: 'targeted' }).evidence;
  assert.notEqual(targetedEvidence.find(({ gateId }) => gateId === 'gate-b').inputDigest, initialEvidence.find(({ gateId }) => gateId === 'gate-b').inputDigest);
  state = getShipClosure({ projectRoot: root, feature: 'gate-custody', runId: started.runId });
  summary = advance(root, 'gate-custody', started.runId, reviewClosed(state, {
    phase: 'targeted', reviewedFindingIds: [original.id], findings: [finding({ id: original.id, disposition: 'resolved' })],
  }));
  assert.equal(summary.state, 'ready_for_final');
  const finalEvidence = runShipGates({ projectRoot: root, feature: 'gate-custody', runId: started.runId, phase: 'final' }).evidence;
  assert.equal(finalEvidence.find(({ gateId }) => gateId === 'gate-a').status, 'reused');
  assert.equal(finalEvidence.find(({ gateId }) => gateId === 'gate-b').status, 'passed');
  assert.equal(readFileSync(counterA, 'utf8').length, 2);
  assert.equal(readFileSync(counterB, 'utf8').length, 3);
});

test('a cross-repository bounded input invalidates reusable evidence when only that repository changes', () => {
  const { root } = project('cross-repository-gate-input');
  const secondary = mkdtempSync(join(tmpdir(), 'openplanr-cross-gate-input-'));
  mkdirSync(join(secondary, 'src'), { recursive: true });
  writeFileSync(join(secondary, 'src', 'index.js'), 'export const secondary = true;\n');
  git(secondary, 'init', '-q');
  git(secondary, 'config', 'user.email', 'test@example.com');
  git(secondary, 'config', 'user.name', 'Test');
  git(secondary, 'add', '.');
  git(secondary, 'commit', '-qm', 'baseline');
  const counterRoot = mkdtempSync(join(tmpdir(), 'openplanr-cross-gate-counter-'));
  const artifactCounter = join(counterRoot, 'artifact');
  const finalCounter = join(counterRoot, 'final');
  const append = (path) => `require('node:fs').appendFileSync(${JSON.stringify(path)}, 'x')`;
  const repositories = [
    { repositoryKey: 'project', root },
    { repositoryKey: 'secondary', root: secondary },
  ];
  const gates = [
    {
      id: 'secondary-artifact', repositoryKey: 'secondary', argv: [process.execPath, '-e', append(artifactCounter)],
      inputs: [repositoryPath('src/index.js', 'secondary'), repositoryPath('src/app.js')],
      dependsOn: [], finalRelevantSuite: false,
    },
    {
      id: 'project-final', repositoryKey: 'project', argv: [process.execPath, '-e', append(finalCounter)],
      inputs: [repositoryPath('tests/smoke.test.mjs')], dependsOn: ['secondary-artifact'], finalRelevantSuite: true,
    },
  ];
  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = {
    repositories: repositories.map(({ repositoryKey, root: repositoryRoot }) => ({
      repositoryKey,
      path: relative(root, repositoryRoot).split('\\').join('/') || '.',
    })),
    gates,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const started = startShip({ projectRoot: root, feature: 'cross-repository-gate-input', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  completeAndOpen(root, 'cross-repository-gate-input', started.runId);
  const initial = runShipGates({
    projectRoot: root, feature: 'cross-repository-gate-input', runId: started.runId, phase: 'initial',
  }).evidence;
  let state = getShipClosure({ projectRoot: root, feature: 'cross-repository-gate-input', runId: started.runId });
  let summary = advance(root, 'cross-repository-gate-input', started.runId, reviewClosed(state, {
    phase: 'initial', findings: [finding({ paths: [repositoryPath('src/app.js')] })],
  }));
  state = getShipClosure({ projectRoot: root, feature: 'cross-repository-gate-input', runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  summary = advance(root, 'cross-repository-gate-input', started.runId, {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: {
      summary: 'Repair the pipeline bytes consumed by the secondary artifact gate.',
      findingIds: [original.id],
      paths: [repositoryPath('src/app.js')],
      affectedGateIds: ['secondary-artifact'],
    },
  });
  summary = advance(root, 'cross-repository-gate-input', started.runId, reviewOpened(summary.generation));
  const targeted = runShipGates({
    projectRoot: root, feature: 'cross-repository-gate-input', runId: started.runId, phase: 'targeted',
  }).evidence;
  const initialArtifact = initial.find(({ gateId }) => gateId === 'secondary-artifact');
  const targetedArtifact = targeted.find(({ gateId }) => gateId === 'secondary-artifact');
  assert.notEqual(targetedArtifact.inputDigest, initialArtifact.inputDigest);
  assert.equal(targetedArtifact.status, 'passed');
  assert.equal(readFileSync(artifactCounter, 'utf8').length, 2);
  assert.equal(readFileSync(finalCounter, 'utf8').length, 2);
});

test('gate runner issues exact sealed repository roots and strips spoofed capabilities', () => {
  const { root } = project('gate-root-capabilities');
  const secondary = mkdtempSync(join(tmpdir(), 'openplanr-gate-root-secondary-'));
  writeFileSync(join(secondary, 'secondary.txt'), 'secondary\n');
  git(secondary, 'init', '-q');
  git(secondary, 'config', 'user.email', 'test@example.com');
  git(secondary, 'config', 'user.name', 'Test');
  git(secondary, 'add', '.');
  git(secondary, 'commit', '-qm', 'baseline');
  const unrelated = mkdtempSync(join(tmpdir(), 'openplanr-gate-root-unrelated-'));
  writeFileSync(join(unrelated, 'unrelated.txt'), 'unrelated\n');
  git(unrelated, 'init', '-q');
  git(unrelated, 'config', 'user.email', 'test@example.com');
  git(unrelated, 'config', 'user.name', 'Test');
  git(unrelated, 'add', '.');
  git(unrelated, 'commit', '-qm', 'baseline');
  const observedPath = join(mkdtempSync(join(tmpdir(), 'openplanr-gate-root-observed-')), 'env.json');
  const observeEnvironment = [
    "const { writeFileSync } = require('node:fs');",
    `writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({`,
    '  project: process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT,',
    '  secondary: process.env.PLANR_SHIP_REPOSITORY_SECONDARY_ROOT,',
    '  unrelated: process.env.PLANR_SHIP_REPOSITORY_UNRELATED_ROOT ?? null,',
    '  undeclared: process.env.PLANR_SHIP_REPOSITORY_UNDECLARED_ROOT ?? null,',
    '  candidate: process.env.PLANR_SHIP_CANDIDATE_DIGEST,',
    '  gate: process.env.PLANR_SHIP_GATE_ID,',
    '}));',
    'process.stdout.write(`${process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT}\\n${process.env.PLANR_SHIP_REPOSITORY_SECONDARY_ROOT}\\n`);',
  ].join('\n');
  const gates = [
    {
      id: 'project-authority',
      repositoryKey: 'project',
      argv: [process.execPath, '-e', 'void 0'],
      inputs: [repositoryPath('src/app.js')],
      dependsOn: [],
      finalRelevantSuite: false,
    },
    {
      id: 'root-probe',
      repositoryKey: 'secondary',
      argv: [process.execPath, '-e', observeEnvironment],
      inputs: [repositoryPath('secondary.txt', 'secondary')],
      dependsOn: ['project-authority'],
      finalRelevantSuite: true,
    },
  ];
  const repositories = [
    { repositoryKey: 'project', root },
    { repositoryKey: 'secondary', root: secondary },
    { repositoryKey: 'unrelated', root: unrelated },
  ];
  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = {
    repositories: repositories.map(({ repositoryKey, root: repositoryRoot }) => ({
      repositoryKey,
      path: relative(root, repositoryRoot).split('\\').join('/') || '.',
    })),
    gates,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const started = startShip({
    projectRoot: root,
    feature: 'gate-root-capabilities',
    humanReviewConfirmed: true,
  });
  completeAndOpen(root, 'gate-root-capabilities', started.runId);
  const priorProject = process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT;
  const priorUndeclared = process.env.PLANR_SHIP_REPOSITORY_UNDECLARED_ROOT;
  const priorUnrelated = process.env.PLANR_SHIP_REPOSITORY_UNRELATED_ROOT;
  process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT = '/spoofed/project';
  process.env.PLANR_SHIP_REPOSITORY_UNDECLARED_ROOT = '/spoofed/undeclared';
  process.env.PLANR_SHIP_REPOSITORY_UNRELATED_ROOT = '/spoofed/unrelated';
  try {
    const result = runShipGates({
      projectRoot: root,
      feature: 'gate-root-capabilities',
      runId: started.runId,
      phase: 'initial',
    });
    const observed = JSON.parse(readFileSync(observedPath, 'utf8'));
    assert.deepEqual(observed, {
      project: realpathSync(root),
      secondary: realpathSync(secondary),
      unrelated: null,
      undeclared: null,
      candidate: result.candidate.digest,
      gate: 'root-probe',
    });
    const evidence = result.evidence.find(({ gateId }) => gateId === 'root-probe');
    assert.equal(evidence.stdoutExcerpt.includes(root), false);
    assert.equal(evidence.stdoutExcerpt.includes(secondary), false);
    assert.equal(evidence.stdoutExcerpt, '<repo:project>\n<repo:secondary>\n');
  } finally {
    if (priorProject === undefined) delete process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT;
    else process.env.PLANR_SHIP_REPOSITORY_PROJECT_ROOT = priorProject;
    if (priorUndeclared === undefined) delete process.env.PLANR_SHIP_REPOSITORY_UNDECLARED_ROOT;
    else process.env.PLANR_SHIP_REPOSITORY_UNDECLARED_ROOT = priorUndeclared;
    if (priorUnrelated === undefined) delete process.env.PLANR_SHIP_REPOSITORY_UNRELATED_ROOT;
    else process.env.PLANR_SHIP_REPOSITORY_UNRELATED_ROOT = priorUnrelated;
  }
});

test('gate reuse is invalidated by sealed candidate changes outside bounded inputs', () => {
  const { root } = project('gate-candidate-wide-custody');
  const counter = join(mkdtempSync(join(tmpdir(), 'openplanr-gate-candidate-counter-')), 'runs');
  const append = `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x')`;
  const gates = [{
    id: 'candidate-safe',
    repositoryKey: 'project',
    argv: [process.execPath, '-e', append],
    inputs: [repositoryPath('src/app.js')],
    dependsOn: [],
    finalRelevantSuite: true,
  }];
  const started = startShip({
    projectRoot: root,
    feature: 'gate-candidate-wide-custody',
    humanReviewConfirmed: true,
    gates,
  });
  completeAndOpen(root, 'gate-candidate-wide-custody', started.runId);
  const initial = runShipGates({
    projectRoot: root,
    feature: 'gate-candidate-wide-custody',
    runId: started.runId,
    phase: 'initial',
  }).evidence[0];
  let state = getShipClosure({ projectRoot: root, feature: 'gate-candidate-wide-custody', runId: started.runId });
  let summary = advance(root, 'gate-candidate-wide-custody', started.runId, reviewClosed(state, {
    phase: 'initial',
    findings: [finding({ paths: [repositoryPath('baseline.txt')] })],
  }));
  state = getShipClosure({ projectRoot: root, feature: 'gate-candidate-wide-custody', runId: started.runId });
  const original = state.reviews[0].findings[0];
  writeFileSync(join(root, 'baseline.txt'), 'corrected outside the bounded gate input\n');
  summary = advance(root, 'gate-candidate-wide-custody', started.runId, {
    type: 'correction.registered',
    expectedGeneration: summary.generation,
    impact: {
      summary: 'Correct a candidate-owned file outside the gate input.',
      findingIds: [original.id],
      paths: [repositoryPath('baseline.txt')],
      affectedGateIds: [],
    },
  });
  summary = advance(root, 'gate-candidate-wide-custody', started.runId, reviewOpened(summary.generation));
  const targeted = runShipGates({
    projectRoot: root,
    feature: 'gate-candidate-wide-custody',
    runId: started.runId,
    phase: 'targeted',
  }).evidence[0];
  assert.equal(targeted.status, 'passed');
  assert.notEqual(targeted.inputDigest, initial.inputDigest);
  assert.equal(readFileSync(counter, 'utf8'), 'xx');
});

test('cached gate replay first revalidates byte-identical candidate custody', () => {
  const { root } = project('gate-stale');
  const started = startShip({ projectRoot: root, feature: 'gate-stale', humanReviewConfirmed: true });
  completeAndOpen(root, 'gate-stale', started.runId);
  runShipGates({ projectRoot: root, feature: 'gate-stale', runId: started.runId, phase: 'initial' });
  writeFileSync(join(root, 'src', 'app.js'), 'export const stale = true;\n');
  errorCode(() => runShipGates({ projectRoot: root, feature: 'gate-stale', runId: started.runId, phase: 'initial' }), 'E_SHIP_CANDIDATE_STALE');
});

test('projection crash repairs from receipt and never duplicates manifest or provenance truth', () => {
  const { root, prepared } = project('projection-repair');
  const started = startShip({ projectRoot: root, feature: 'projection-repair', humanReviewConfirmed: true });
  completeAndOpen(root, 'projection-repair', started.runId);
  closeCleanInitial(root, 'projection-repair', started.runId);
  runShipGates({ projectRoot: root, feature: 'projection-repair', runId: started.runId, phase: 'final' });
  const preparedForFinalization = prepareShip({ projectRoot: root, feature: 'projection-repair', humanReviewConfirmed: true });
  const hostileTarget = join(mkdtempSync(join(tmpdir(), 'openplanr-projection-target-')), 'hostile-target');
  writeFileSync(hostileTarget, 'do not overwrite\n');
  const qaReport = join(prepared.specDir, 'qa-report.md');
  symlinkSync(hostileTarget, qaReport);
  errorCode(() => finalizeStoredShipClosure({
    projectRoot: root,
    prepared: preparedForFinalization,
    runId: started.runId,
  }), 'E_SHIP_PROJECTION_UNSAFE');
  assert.equal(existsSync(join(prepared.specDir, '.ship', 'receipts', `${started.runId}.json`)), true);
  unlinkSync(qaReport);
  const repaired = finalizeShipClosure({ projectRoot: root, feature: 'projection-repair', runId: started.runId });
  assert.equal(repaired.replayed, true);
  finalizeShipClosure({ projectRoot: root, feature: 'projection-repair', runId: started.runId });
  const rows = readFileSync(join(prepared.specDir, '.run-manifest.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(({ stage }) => stage === `ship.closure:${started.runId}`).length, 1);
  const provenance = readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(provenance.filter(({ run_id: runId }) => runId === started.runId).length, 1);
  assert.equal(readFileSync(hostileTarget, 'utf8'), 'do not overwrite\n');
});

test('dual active/receipt crash recovery accepts only an exact active prefix', () => {
  const { root, prepared } = project('dual-custody');
  const started = startShip({ projectRoot: root, feature: 'dual-custody', humanReviewConfirmed: true, runtime: 'codex' });
  completeAndOpen(root, 'dual-custody', started.runId);
  closeCleanInitial(root, 'dual-custody', started.runId);
  runShipGates({ projectRoot: root, feature: 'dual-custody', runId: started.runId, phase: 'final' });
  const activePrefix = getShipClosure({ projectRoot: root, feature: 'dual-custody', runId: started.runId });
  finalizeShipClosure({ projectRoot: root, feature: 'dual-custody', runId: started.runId });
  const activePath = join(prepared.specDir, '.ship', 'active', `${started.runId}.json`);
  writeFileSync(activePath, `${JSON.stringify(activePrefix, null, 2)}\n`);
  assert.equal(getShipClosure({ projectRoot: root, feature: 'dual-custody', runId: started.runId }).recordType, 'receipt');
  assert.equal(existsSync(activePath), false);

  writeFileSync(activePath, `${JSON.stringify({ ...activePrefix, runtime: 'cursor' }, null, 2)}\n`);
  errorCode(() => getShipClosure({ projectRoot: root, feature: 'dual-custody', runId: started.runId }), 'E_SHIP_CLOSURE_DIVERGED');
  assert.equal(existsSync(activePath), true, 'divergent custody remains available for forensic recovery');
});

test('replaying a superseded receipt cannot overwrite the latest leaf projections', () => {
  const { root, prepared } = project('projection-leaf');
  const first = passRun(root, 'projection-leaf');
  const reopened = reopenShip({
    projectRoot: root,
    feature: 'projection-leaf',
    receiptHash: first.receiptHash,
    reason: 'Owner authorizes one successor.',
    ownerConfirmed: true,
    runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const successor = true;\n');
  completeAndOpen(root, 'projection-leaf', reopened.runId);
  closeCleanInitial(root, 'projection-leaf', reopened.runId);
  runShipGates({ projectRoot: root, feature: 'projection-leaf', runId: reopened.runId, phase: 'final' });
  const second = finalizeShipClosure({ projectRoot: root, feature: 'projection-leaf', runId: reopened.runId });
  const markerPath = join(prepared.specDir, '.pipeline-shipped');
  const qaPath = join(prepared.specDir, 'qa-report.md');
  const latestMarker = readFileSync(markerPath, 'utf8');
  const latestQa = readFileSync(qaPath, 'utf8');
  assert.match(latestMarker, new RegExp(second.receiptHash.replace(':', '\\:')));
  try {
    const replay = finalizeShipClosure({ projectRoot: root, feature: 'projection-leaf', runId: first.runId });
    assert.equal(replay.replayed, true);
  } catch (error) {
    assert.equal(error?.code, 'E_SHIP_CANDIDATE_STALE');
  }
  assert.equal(readFileSync(markerPath, 'utf8'), latestMarker);
  assert.equal(readFileSync(qaPath, 'utf8'), latestQa);
});

test('terminal projection repair refuses to re-certify source bytes changed after receipt', () => {
  const { root, prepared } = project('projection-stale');
  const receipt = passRun(root, 'projection-stale');
  unlinkSync(join(prepared.specDir, '.pipeline-shipped'));
  writeFileSync(join(root, 'src', 'app.js'), 'export const changedAfterReceipt = true;\n');
  errorCode(() => finalizeShipClosure({ projectRoot: root, feature: 'projection-stale', runId: receipt.runId }), 'E_SHIP_CANDIDATE_STALE');
  assert.equal(existsSync(join(prepared.specDir, '.pipeline-shipped')), false);
});

test('read custody rejects a symlinked active-directory ancestor', () => {
  const { root, prepared } = project('read-symlink');
  const started = startShip({ projectRoot: root, feature: 'read-symlink', humanReviewConfirmed: true });
  const active = join(prepared.specDir, '.ship', 'active');
  const realActive = join(prepared.specDir, '.ship', 'active-real');
  renameSync(active, realActive);
  symlinkSync('active-real', active);
  errorCode(() => getShipClosure({ projectRoot: root, feature: 'read-symlink', runId: started.runId }), 'E_SHIP_STORAGE_UNSAFE');
});

test('disjoint explicit task runs retain mixed terminal projection without recertifying completed scope', () => {
  const { root, prepared } = project('disjoint', { tasks: [{ id: 'T-001' }, { id: 'T-002' }] });
  const first = passRun(root, 'disjoint', { taskId: 'T-001' });
  assert.equal(first.state, 'passed');
  errorCode(() => startShip({ projectRoot: root, feature: 'disjoint', humanReviewConfirmed: true, taskId: 'T-001' }), 'E_TASK_ALREADY_DONE');
  const second = startShip({ projectRoot: root, feature: 'disjoint', humanReviewConfirmed: true, taskId: 'T-002' });
  advance(root, 'disjoint', second.runId, taskBlocked(0, 'T-002'));
  const blocked = finalizeShipClosure({ projectRoot: root, feature: 'disjoint', runId: second.runId });
  assert.equal(blocked.state, 'blocked');
  assert.match(readFileSync(join(prepared.specDir, 'tasks', 'T-001-hostile.md'), 'utf8'), /status: "done"/);
  assert.match(readFileSync(join(prepared.specDir, 'tasks', 'T-002-hostile.md'), 'utf8'), /status: "blocked"/);
  assert.match(readFileSync(join(prepared.specDir, 'stories', 'US-001-hostile.md'), 'utf8'), /status: "blocked"/);
});

test('owner reopen permits only cross-repository input expansion and forms one linear chain', () => {
  const { root } = project('multi-reopen');
  const second = mkdtempSync(join(tmpdir(), 'openplanr-closure-secondary-'));
  mkdirSync(join(second, 'input', 'tech'), { recursive: true });
  mkdirSync(join(second, 'src'), { recursive: true });
  mkdirSync(join(second, 'tests'), { recursive: true });
  writeFileSync(join(second, 'input', 'tech', 'stack.md'), 'BuildCommand: "node --check src/secondary.js"\nTestCommand: "node --test tests/secondary.test.mjs"\n');
  writeFileSync(join(second, 'src', 'secondary.js'), 'export const secondary = true;\n');
  writeFileSync(join(second, 'tests', 'secondary.test.mjs'), "import test from 'node:test'; test('secondary', () => {});\n");
  git(second, 'init', '-q');
  git(second, 'config', 'user.email', 'test@example.com');
  git(second, 'config', 'user.name', 'Test');
  git(second, 'add', '.');
  git(second, 'commit', '-qm', 'baseline');
  writeFileSync(join(root, '.planr', 'config.json'), JSON.stringify({
    idPrefix: { spec: 'SPEC' },
    shipClosure: {
      repositories: [
        { repositoryKey: 'project', path: '.' },
        { repositoryKey: 'secondary', path: relative(root, second) },
      ],
    },
  }, null, 2));
  const started = startShip({ projectRoot: root, feature: 'multi-reopen', humanReviewConfirmed: true });
  const active = getShipClosure({ projectRoot: root, feature: 'multi-reopen', runId: started.runId });
  assert.deepEqual(active.repositories.map(({ repositoryKey }) => repositoryKey), ['project', 'secondary']);
  assert.ok(active.gates.some(({ repositoryKey }) => repositoryKey === 'secondary'));
  advance(root, 'multi-reopen', started.runId, taskBlocked(0));
  const receipt = finalizeShipClosure({ projectRoot: root, feature: 'multi-reopen', runId: started.runId });
  errorCode(() => startShip({ projectRoot: root, feature: 'multi-reopen', humanReviewConfirmed: true }), 'E_SHIP_REOPEN_REQUIRED');
  errorCode(() => reopenShip({ projectRoot: root, feature: 'multi-reopen', receiptHash: receipt.receiptHash, reason: 'Owner correction.' }), 'E_SHIP_OWNER_REQUIRED');
  const rejectGateMutation = (mutate) => {
    const gates = structuredClone(receipt.gates);
    mutate(gates);
    errorCode(() => reopenShip({
      projectRoot: root,
      feature: 'multi-reopen',
      receiptHash: receipt.receiptHash,
      reason: 'Owner authorizes a bounded repair.',
      ownerConfirmed: true,
      runtime: 'codex',
      gates,
    }), 'E_SHIP_REOPEN_CUSTODY_INVALID');
  };
  rejectGateMutation((gates) => { gates[0].inputs = [repositoryPath('src/app.js')]; });
  rejectGateMutation((gates) => { gates[0].argv = ['node', '--version']; });
  rejectGateMutation((gates) => { gates[0].repositoryKey = 'secondary'; });
  rejectGateMutation((gates) => { gates[1].dependsOn = []; });
  rejectGateMutation((gates) => {
    const priorFinal = gates.find(({ finalRelevantSuite }) => finalRelevantSuite);
    const successorFinal = gates.find(({ finalRelevantSuite }) => !finalRelevantSuite);
    priorFinal.finalRelevantSuite = false;
    successorFinal.finalRelevantSuite = true;
  });
  rejectGateMutation((gates) => { gates.reverse(); });
  rejectGateMutation((gates) => {
    gates.push({
      id: 'extra-proof', repositoryKey: 'project', argv: ['node', '--version'],
      inputs: [repositoryPath('.')], dependsOn: [], finalRelevantSuite: false,
    });
  });
  rejectGateMutation((gates) => { gates.pop(); });

  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure.gates = structuredClone(receipt.gates);
  config.shipClosure.gates[0].inputs.push(repositoryPath('src/secondary.js', 'secondary'));
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const priorReceiptBytes = readFileSync(receipt.receiptPath, 'utf8');
  const reopened = reopenShip({
    projectRoot: root,
    feature: 'multi-reopen',
    receiptHash: receipt.receiptHash,
    reason: 'Owner authorizes a bounded repair.',
    ownerConfirmed: true,
    runtime: 'codex',
  });
  const successor = getShipClosure({ projectRoot: root, feature: 'multi-reopen', runId: reopened.runId });
  assert.equal(successor.startedFromReceiptHash, receipt.receiptHash);
  assert.deepEqual(successor.repositories.map(({ repositoryKey }) => repositoryKey), ['project', 'secondary']);
  assert.deepEqual(successor.gates[0].inputs, config.shipClosure.gates[0].inputs);
  assert.notEqual(successor.gateSetDigest, receipt.gateSetDigest);
  assert.equal(readFileSync(receipt.receiptPath, 'utf8'), priorReceiptBytes);
  advance(root, 'multi-reopen', reopened.runId, taskBlocked(0));
  finalizeShipClosure({ projectRoot: root, feature: 'multi-reopen', runId: reopened.runId });
  errorCode(() => reopenShip({
    projectRoot: root,
    feature: 'multi-reopen',
    receiptHash: receipt.receiptHash,
    reason: 'Attempt a branch.',
    ownerConfirmed: true,
  }), 'E_SHIP_REOPENED');
});

test('terminal start replay is exact-only and ordinary overlap cannot mint a new run', () => {
  const { root, prepared } = project('terminal-replay', { commit: false });
  const storyPath = join(prepared.specDir, 'stories', 'US-001-hostile.md');
  const taskPath = join(prepared.specDir, 'tasks', 'T-001-hostile.md');
  const specPath = join(prepared.specDir, `${basename(prepared.specDir)}.md`);
  writeFileSync(taskPath, taskMarkdown({
    id: 'T-001',
    preserve: [storyPath, taskPath, specPath].map((absolute) => repositoryPath(relative(root, absolute).split('\\').join('/'))),
  }));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'protected planning baseline');
  const preview = prepareShip({ projectRoot: root, feature: 'terminal-replay', humanReviewConfirmed: true });
  const runId = `ship_${'a'.repeat(32)}`;
  const started = createShipClosure({ projectRoot: root, prepared: preview, runtime: 'codex', runId });
  advance(root, 'terminal-replay', runId, taskBlocked(0));
  const terminal = finalizeShipClosure({ projectRoot: root, feature: 'terminal-replay', runId });
  assert.equal(terminal.state, 'blocked');
  const replay = createShipClosure({ projectRoot: root, prepared: preview, runtime: 'codex', runId });
  assert.equal(replay.replayed, true);
  errorCode(() => createShipClosure({ projectRoot: root, prepared: preview, runtime: 'cursor', runId }), 'E_SHIP_RUN_ID_CONFLICT');
  errorCode(() => startShip({ projectRoot: root, feature: 'terminal-replay', humanReviewConfirmed: true }), 'E_SHIP_REOPEN_REQUIRED');
});

test('CLI exposes resumable compact custody and rejects caller-authored truth/hidden authority', () => {
  const { root } = project('cli-resume');
  const started = cli(root, ['start-ship', 'cli-resume', '--reviewed', '--runtime', 'codex', '--json']);
  assert.match(started.runId, /^ship_/);
  const completed = cli(root, ['advance-ship', 'cli-resume', '--run-id', started.runId, '--event-file', '-', '--json'], {
    input: JSON.stringify(taskCompleted(0)),
  });
  assert.equal(completed.generation, 1);
  const preview = cli(root, ['prepare-ship', 'cli-resume', '--json']);
  const active = preview.closure.active.find(({ runId }) => runId === started.runId);
  assert.equal(active.generation, 1);
  assert.equal(active.tasks[0].status, 'completed');
  assert.deepEqual(active.reviewerRoster, ['qa-agent']);
  assert.ok(active.gates.some(({ finalRelevantSuite }) => finalRelevantSuite));
  assert.equal(cli(root, ['finalize-ship', 'cli-resume', '--run-id', started.runId, '--qa', 'passed', '--json'], { expectFailure: true }).code, 'E_SHIP_LEGACY_TRUTH_FORBIDDEN');
  assert.equal(cli(root, ['start-ship', 'cli-resume', '--reviewed', '--run-id', `ship_${'f'.repeat(32)}`, '--json'], { expectFailure: true }).code, 'E_SHIP_OWNER_CONFIG_FORBIDDEN');
});

test('owner reopen CLI has a closed grammar for missing, unknown, duplicate, and positional inputs', () => {
  const { root } = project('cli-reopen-closed');
  const hash = `sha256:${'a'.repeat(64)}`;
  const invalidArgv = [
    ['reopen-ship', 'cli-reopen-closed', '--receipt-hash', hash, '--reason', '--json'],
    ['reopen-ship', 'cli-reopen-closed', '--receipt-hash', hash, '--reason', 'because', '--unknown', '--json'],
    ['reopen-ship', 'cli-reopen-closed', '--receipt-hash', hash, '--reason', 'one', '--reason', 'two', '--json'],
    ['reopen-ship', 'cli-reopen-closed', 'extra', '--receipt-hash', hash, '--reason', 'because', '--json'],
  ];
  for (const args of invalidArgv) {
    assert.equal(cli(root, args, { expectFailure: true }).code, 'E_CLI_ARGUMENT_INVALID');
  }
});

test('active custody remains resumable after stack configuration becomes invalid', () => {
  const { root } = project('stack-drift');
  const started = startShip({ projectRoot: root, feature: 'stack-drift', humanReviewConfirmed: true, runtime: 'codex' });
  writeFileSync(join(root, 'input', 'tech', 'stack.md'), 'BuildCommand: TODO\nTestCommand: TODO\n');
  const preview = prepareShip({ projectRoot: root, feature: 'stack-drift', humanReviewConfirmed: true });
  assert.equal(preview.closure.active[0].runId, started.runId);
  assert.ok(preview.gateDescriptors.every(({ argv }) => argv.length > 0));
  completeAndOpen(root, 'stack-drift', started.runId);
  closeCleanInitial(root, 'stack-drift', started.runId);
  runShipGates({ projectRoot: root, feature: 'stack-drift', runId: started.runId, phase: 'final' });
  assert.equal(finalizeShipClosure({ projectRoot: root, feature: 'stack-drift', runId: started.runId }).state, 'passed');
});

test('aggregate projections stay BLOCKED for disjoint task receipts in either terminal order', () => {
  for (const order of ['blocked-then-passed', 'passed-then-blocked']) {
    const slug = `aggregate-${order}`;
    const { root, prepared } = project(slug, { tasks: [{ id: 'T-001' }, { id: 'T-002' }] });
    if (order === 'blocked-then-passed') {
      blockRun(root, slug, { taskId: 'T-001' });
      passRun(root, slug, { taskId: 'T-002' });
    } else {
      passRun(root, slug, { taskId: 'T-001' });
      blockRun(root, slug, { taskId: 'T-002' });
    }
    assert.match(readFileSync(join(prepared.specDir, '.pipeline-shipped'), 'utf8'), /delivery_status: "blocked"/);
    assert.match(readFileSync(join(prepared.specDir, 'qa-report.md'), 'utf8'), /Status: BLOCKED/);
  }
});

test('terminal summaries mark compatibility projections unverified after source or task-status tamper', () => {
  const source = project('projection-verify-source');
  const sourceReceipt = passRun(source.root, 'projection-verify-source');
  let preview = prepareShip({ projectRoot: source.root, feature: 'projection-verify-source', humanReviewConfirmed: true });
  assert.equal(preview.closure.terminal.find(({ runId }) => runId === sourceReceipt.runId).projectionVerified, true);
  writeFileSync(join(source.root, 'src', 'app.js'), 'export const postReceiptTamper = true;\n');
  preview = prepareShip({ projectRoot: source.root, feature: 'projection-verify-source', humanReviewConfirmed: true });
  assert.equal(preview.closure.terminal.find(({ runId }) => runId === sourceReceipt.runId).projectionVerified, false);

  const task = project('projection-verify-task');
  const taskReceipt = passRun(task.root, 'projection-verify-task');
  const taskFile = join(task.prepared.specDir, 'tasks', 'T-001-hostile.md');
  writeFileSync(taskFile, readFileSync(taskFile, 'utf8').replace('status: "done"', 'status: "blocked"'));
  preview = prepareShip({ projectRoot: task.root, feature: 'projection-verify-task', humanReviewConfirmed: true });
  assert.equal(preview.closure.terminal.find(({ runId }) => runId === taskReceipt.runId).projectionVerified, false);
});

test('a foreign valid receipt copied beneath a sibling feature is rejected by storage context', () => {
  const first = project('receipt-owner');
  const firstReceipt = blockRun(first.root, 'receipt-owner');
  const sibling = addFeature(first.root, 'receipt-sibling', { taskId: 'T-002' });
  const siblingReceipts = join(sibling.specDir, '.ship', 'receipts');
  mkdirSync(siblingReceipts, { recursive: true });
  const sourcePath = join(first.prepared.specDir, '.ship', 'receipts', `${firstReceipt.runId}.json`);
  writeFileSync(join(siblingReceipts, `${firstReceipt.runId}.json`), readFileSync(sourcePath));
  errorCode(
    () => prepareShip({ projectRoot: first.root, feature: 'receipt-sibling', humanReviewConfirmed: true }),
    'E_SHIP_STORAGE_CONTEXT_INVALID',
  );
});

test('task receipts remain a bijection with task state and respect frozen DAG chronology', () => {
  const { root } = project('event-bijection', {
    tasks: [{ id: 'T-001' }, { id: 'T-002', dependsOn: ['T-001'] }],
  });
  const started = startShip({ projectRoot: root, feature: 'event-bijection', humanReviewConfirmed: true });
  let summary = advance(root, 'event-bijection', started.runId, taskCompleted(0, 'T-001'));
  advance(root, 'event-bijection', started.runId, taskCompleted(summary.generation, 'T-002'));
  const state = getShipClosure({ projectRoot: root, feature: 'event-bijection', runId: started.runId });

  const wrongTaskBytes = structuredClone(state);
  wrongTaskBytes.tasks[0].agent = 'frontend-agent';
  errorCode(() => assertShipClosure(wrongTaskBytes), 'E_SHIP_CLOSURE_INVALID');

  const reversed = structuredClone(state);
  [reversed.events[0], reversed.events[1]] = [reversed.events[1], reversed.events[0]];
  reversed.events[0].generation = 1;
  reversed.events[1].generation = 2;
  reversed.events[0].at = state.events[0].at;
  reversed.events[1].at = state.events[1].at;
  errorCode(() => assertShipClosure(reversed), 'E_SHIP_CLOSURE_INVALID');
});

test('mandatory final relevant suite executes even when a dependency fails', () => {
  const { root } = project('final-after-failure');
  writeFileSync(join(root, '.gitignore'), '.gate-state\n.gate-final-count\n');
  writeFileSync(join(root, '.gate-state'), 'pass\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-qm', 'ignore gate controls');
  const counter = join(root, '.gate-final-count');
  const gates = [
    {
      id: 'dependency',
      repositoryKey: 'project',
      argv: [process.execPath, '-e', `const fs=require('node:fs');process.exit(fs.readFileSync(${JSON.stringify(join(root, '.gate-state'))},'utf8').trim()==='pass'?0:1)`],
      inputs: [repositoryPath('.gate-state')],
      dependsOn: [],
      finalRelevantSuite: false,
    },
    {
      id: 'final-suite',
      repositoryKey: 'project',
      argv: [process.execPath, '-e', `require('node:fs').appendFileSync(${JSON.stringify(counter)},'x')`],
      inputs: [repositoryPath('.gate-final-count')],
      dependsOn: ['dependency'],
      finalRelevantSuite: true,
    },
  ];
  const started = startShip({ projectRoot: root, feature: 'final-after-failure', humanReviewConfirmed: true, gates });
  completeAndOpen(root, 'final-after-failure', started.runId);
  closeCleanInitial(root, 'final-after-failure', started.runId);
  assert.equal(readFileSync(counter, 'utf8'), 'x');
  writeFileSync(join(root, '.gate-state'), 'fail\n');
  const evidence = runShipGates({ projectRoot: root, feature: 'final-after-failure', runId: started.runId, phase: 'final' }).evidence;
  assert.equal(evidence.find(({ gateId }) => gateId === 'dependency').status, 'failed');
  assert.notEqual(evidence.find(({ gateId }) => gateId === 'final-suite').status, 'skipped');
  assert.equal(readFileSync(counter, 'utf8'), 'xx');
  assert.equal(finalizeShipClosure({ projectRoot: root, feature: 'final-after-failure', runId: started.runId }).state, 'blocked');
});

test('projecting a second feature preserves the first feature provenance event', () => {
  const first = project('provenance-a');
  const firstReceipt = passRun(first.root, 'provenance-a');
  addFeature(first.root, 'provenance-b', { taskId: 'T-002' });
  const secondReceipt = passRun(first.root, 'provenance-b', { taskId: 'T-002' });
  finalizeShipClosure({ projectRoot: first.root, feature: 'provenance-b', runId: secondReceipt.runId });
  const events = readFileSync(join(first.root, '.planr', 'provenance.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(({ run_id: runId }) => runId === firstReceipt.runId).length, 1);
  assert.equal(events.filter(({ run_id: runId }) => runId === secondReceipt.runId).length, 1);
});

test('planning and closure reads reject intermediate specs symlinks and copied storage contexts', () => {
  const symlinked = project('specs-symlink');
  const specs = join(symlinked.root, '.planr', 'specs');
  const realSpecs = join(symlinked.root, '.planr', 'specs-real');
  renameSync(specs, realSpecs);
  symlinkSync('specs-real', specs);
  errorCode(
    () => prepareShip({ projectRoot: symlinked.root, feature: 'specs-symlink', humanReviewConfirmed: true }),
    'E_SHIP_STORAGE_UNSAFE',
  );

  const owner = project('storage-owner');
  const ownerRun = startShip({ projectRoot: owner.root, feature: 'storage-owner', humanReviewConfirmed: true });
  const sibling = addFeature(owner.root, 'storage-copy', { taskId: 'T-002' });
  const sourceShip = join(owner.prepared.specDir, '.ship');
  const copiedShip = join(sibling.specDir, '.ship');
  mkdirSync(join(copiedShip, 'active'), { recursive: true });
  mkdirSync(join(copiedShip, 'receipts'), { recursive: true });
  mkdirSync(join(copiedShip, 'locks'), { recursive: true });
  writeFileSync(
    join(copiedShip, 'active', `${ownerRun.runId}.json`),
    readFileSync(join(sourceShip, 'active', `${ownerRun.runId}.json`)),
  );
  errorCode(
    () => prepareShip({ projectRoot: owner.root, feature: 'storage-copy', humanReviewConfirmed: true }),
    'E_SHIP_STORAGE_CONTEXT_INVALID',
  );
});

test('terminal summaries use one latest-owner verification result when successor bytes become stale', () => {
  const { root } = project('global-projection-verification');
  const first = passRun(root, 'global-projection-verification');
  const reopened = reopenShip({
    projectRoot: root,
    feature: 'global-projection-verification',
    receiptHash: first.receiptHash,
    reason: 'Owner authorizes one bounded successor.',
    ownerConfirmed: true,
    runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const successor = true;\n');
  completeAndOpen(root, 'global-projection-verification', reopened.runId);
  closeCleanInitial(root, 'global-projection-verification', reopened.runId);
  runShipGates({ projectRoot: root, feature: 'global-projection-verification', runId: reopened.runId, phase: 'final' });
  finalizeShipClosure({ projectRoot: root, feature: 'global-projection-verification', runId: reopened.runId });
  writeFileSync(join(root, 'src', 'app.js'), 'export const staleAfterSuccessor = true;\n');
  const preview = prepareShip({ projectRoot: root, feature: 'global-projection-verification', humanReviewConfirmed: true });
  assert.equal(preview.closure.terminal.length, 2);
  assert.ok(preview.closure.terminal.every(({ projectionVerified }) => projectionVerified === false));
});

test('projection verification requires exact ordered current repository membership', () => {
  const { root, prepared } = project('projection-repository-membership');
  const summary = passRun(root, 'projection-repository-membership');
  const receipt = JSON.parse(readFileSync(summary.receiptPath, 'utf8'));
  const exact = [{ repositoryKey: 'project', root }];
  assert.equal(verifyShipCompatibilityProjection(receipt, {
    projectRoot: root,
    prepared: { root: prepared.specDir, closureRepositories: exact },
  }), true);
  assert.equal(verifyShipCompatibilityProjection(receipt, {
    projectRoot: root,
    prepared: {
      root: prepared.specDir,
      closureRepositories: [...exact, { repositoryKey: 'secondary', root }],
    },
  }), false);
});

test('aggregate PASS never trusts an unreceipted planning task already marked done', () => {
  const { root, prepared } = project('unreceipted-done', { tasks: [{ id: 'T-001' }, { id: 'T-002' }] });
  const firstTask = join(prepared.specDir, 'tasks', 'T-001-hostile.md');
  writeFileSync(firstTask, readFileSync(firstTask, 'utf8').replace('status: "pending"', 'status: "done"'));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'legacy completed task without closure custody');
  const started = startShip({ projectRoot: root, feature: 'unreceipted-done', humanReviewConfirmed: true, runtime: 'codex' });
  assert.deepEqual(started.approvedScope.taskIds, ['T-002']);
  completeAndOpen(root, 'unreceipted-done', started.runId, ['T-002']);
  closeCleanInitial(root, 'unreceipted-done', started.runId);
  runShipGates({ projectRoot: root, feature: 'unreceipted-done', runId: started.runId, phase: 'final' });
  finalizeShipClosure({ projectRoot: root, feature: 'unreceipted-done', runId: started.runId });
  assert.match(readFileSync(join(prepared.specDir, '.pipeline-shipped'), 'utf8'), /delivery_status: "blocked"/);
  assert.match(readFileSync(join(prepared.specDir, 'qa-report.md'), 'utf8'), /Status: BLOCKED/);
  assert.match(readFileSync(join(prepared.specDir, basename(prepared.specDir) + '.md'), 'utf8'), /status: "in-pipeline"/);
});

test('frozen runs ignore null or empty mutable gate configuration while resuming', () => {
  for (const [suffix, gates] of [['null', null], ['empty', []]]) {
    const slug = `resume-gates-${suffix}`;
    const { root } = project(slug);
    const started = startShip({ projectRoot: root, feature: slug, humanReviewConfirmed: true, runtime: 'codex' });
    const configPath = join(root, '.planr', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.shipClosure = { gates };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    assert.equal(getShipClosure({ projectRoot: root, feature: slug, runId: started.runId }).runId, started.runId);
    completeAndOpen(root, slug, started.runId);
    closeCleanInitial(root, slug, started.runId);
    runShipGates({ projectRoot: root, feature: slug, runId: started.runId, phase: 'final' });
    assert.equal(finalizeShipClosure({ projectRoot: root, feature: slug, runId: started.runId }).state, 'passed');
  }
});

test('a no-review blocked receipt binds candidate sealing to closure finalization time', () => {
  const { root } = project('blocked-sealed-at');
  const summary = blockRun(root, 'blocked-sealed-at');
  const receipt = JSON.parse(readFileSync(summary.receiptPath, 'utf8'));
  receipt.candidateRevisions[0].sealedAt = new Date(Date.parse(receipt.terminal.at) - 1).toISOString();
  const forged = rehashReceipt(receipt);
  errorCode(() => assertShipClosure(forged), 'E_SHIP_CLOSURE_INVALID');
});
