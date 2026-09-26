import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';

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
} from '../../lib/pipeline/index.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function project(slug = 'closure') {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-closure-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(
    join(root, '.planr', 'config.json'),
    JSON.stringify({ idPrefix: { spec: 'SPEC' } }),
  );
  writeFileSync(
    join(root, 'input', 'tech', 'stack.md'),
    [
      '# Stack',
      'BuildCommand: "node --check src/app.js"',
      'TestCommand: "node --test tests/smoke.test.mjs"',
      'LintCommand: ""',
    ].join('\n'),
  );
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 0;\n');
  writeFileSync(
    join(root, 'tests', 'smoke.test.mjs'),
    "import test from 'node:test'; test('ok', () => {});\n",
  );
  const prepared = preparePlan({ projectRoot: root, feature: slug, scaffold: true });
  writeFileSync(
    join(prepared.specDir, 'stories', 'US-001-close.md'),
    '---\nid: "US-001"\nstatus: "pending"\nupdated: "2026-08-21"\n---\n',
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-001-core.md'),
    [
      '---',
      'id: "T-001"',
      'storyId: "US-001"',
      'status: "pending"',
      'updated: "2026-08-21"',
      'dependsOn: []',
      'preserve: []',
      '---',
      '',
      '## Preserve',
      '- Human rationale remains readable.',
      '',
      '## Definition of done',
      '- [ ] complete',
    ].join('\n'),
  );
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return { root, prepared };
}

function path(value) {
  return { repositoryKey: 'project', path: value };
}

function taskCompleted(generation, taskId = 'T-001') {
  return {
    type: 'task.completed',
    expectedGeneration: generation,
    taskId,
    agent: 'backend-agent',
    filesWritten: [],
    filesModified: [path('src/app.js')],
  };
}

function openReview(generation) {
  return { type: 'review.opened', expectedGeneration: generation };
}

function finding({
  id = null,
  disposition = 'open',
  evidence = 'The current value does not satisfy the reviewed acceptance behavior.',
} = {}) {
  return {
    id,
    severity: 'P1',
    basis: 'correctness',
    title: 'Value is incorrect',
    evidence,
    taskIds: ['T-001'],
    paths: [path('src/app.js')],
    acceptanceRefs: ['US-001:AC-1'],
    disposition,
  };
}

function closeReview(state, { phase, findings, reviewedFindingIds = [] }) {
  return {
    type: 'review.closed',
    expectedGeneration: state.generation,
    phase,
    candidateRevision: state.candidateRevisions.at(-1).revision,
    candidateDigest: state.candidateRevisions.at(-1).digest,
    reviewerIds: [...state.reviewerRoster],
    contributions: state.reviewerRoster.map((reviewerId) => ({
      reviewerId,
      summary: `${reviewerId} completed the ${phase} review contribution.`,
      evidenceDigest: sha256Jcs({
        reviewerId,
        phase,
        candidateDigest: state.candidateRevisions.at(-1).digest,
      }),
    })),
    findings,
    reviewedFindingIds,
    summary: `${phase} consolidated review`,
    rosterDigest: state.rosterDigest,
    gateSetDigest: state.gateSetDigest,
  };
}

function passWithoutCorrection(
  root,
  feature,
  started,
  { taskId = 'T-001', sourceChange = true } = {},
) {
  if (sourceChange)
    writeFileSync(join(root, 'src', 'app.js'), `export const value = ${Date.now()};\n`);
  let result = advanceShip({
    projectRoot: root,
    feature,
    runId: started.runId,
    event: taskCompleted(0, taskId),
  });
  result = advanceShip({
    projectRoot: root,
    feature,
    runId: started.runId,
    event: openReview(result.generation),
  });
  runShipGates({ projectRoot: root, feature, runId: started.runId, phase: 'initial' });
  const state = getShipClosure({ projectRoot: root, feature, runId: started.runId });
  const close = closeReview(state, { phase: 'initial', findings: [] });
  result = advanceShip({ projectRoot: root, feature, runId: started.runId, event: close });
  runShipGates({ projectRoot: root, feature, runId: started.runId, phase: 'final' });
  return {
    finalized: finalizeShipClosure({ projectRoot: root, feature, runId: started.runId }),
    close,
  };
}

test('one correction closes through one targeted review and immutable receipt', () => {
  const { root, prepared } = project();
  const preview = prepareShip({
    projectRoot: root,
    feature: 'closure',
    humanReviewConfirmed: true,
  });
  assert.deepEqual(
    Object.keys(preview).includes('tasks'),
    false,
    'public JSON projection omits internal task paths',
  );
  const started = startShip({
    projectRoot: root,
    feature: 'closure',
    humanReviewConfirmed: true,
    runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: taskCompleted(0),
  });
  result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: openReview(result.generation),
  });
  assert.equal(result.candidateRevision, 1);
  runShipGates({ projectRoot: root, feature: 'closure', runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: 'closure', runId: started.runId });
  result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: closeReview(state, {
      phase: 'initial',
      findings: [
        finding(),
        finding({
          evidence: 'A second acceptance failure is part of the same consolidated review batch.',
        }),
      ],
    }),
  });
  assert.equal(result.state, 'correction_required');
  state = getShipClosure({ projectRoot: root, feature: 'closure', runId: started.runId });
  const findingIds = state.reviews[0].findings.map(({ id }) => id);
  assert.equal(findingIds.length, 2);
  findingIds.forEach((findingId) => assert.match(findingId, /^fnd_[a-f0-9]{32}$/));

  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: {
      type: 'correction.registered',
      expectedGeneration: result.generation,
      impact: {
        summary: 'Correct the value.',
        findingIds: [...findingIds].reverse(),
        paths: [path('src/app.js')],
        affectedGateIds: ['test-1', 'build-1'],
      },
    },
  });
  assert.equal(result.candidateRevision, 2);
  result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: openReview(result.generation),
  });
  runShipGates({ projectRoot: root, feature: 'closure', runId: started.runId, phase: 'targeted' });
  state = getShipClosure({ projectRoot: root, feature: 'closure', runId: started.runId });
  result = advanceShip({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    event: closeReview(state, {
      phase: 'targeted',
      reviewedFindingIds: [...findingIds],
      findings: findingIds.map((findingId) =>
        finding({
          id: findingId,
          disposition: 'resolved',
          evidence: 'The corrected value now satisfies the exact acceptance behavior.',
        }),
      ),
    }),
  });
  assert.equal(result.state, 'ready_for_final');
  const finalGates = runShipGates({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
    phase: 'final',
  });
  assert.equal(
    finalGates.evidence.find(({ gateId }) => gateId === 'test-1').status,
    'passed',
    'final relevant suite never reuses evidence',
  );
  const finalized = finalizeShipClosure({
    projectRoot: root,
    feature: 'closure',
    runId: started.runId,
  });
  assert.equal(finalized.state, 'passed');
  assert.equal(finalized.candidateRevision, 2);
  const receipt = JSON.parse(readFileSync(finalized.receiptPath, 'utf8'));
  assertShipClosure(receipt);
  assert.equal(receipt.receiptHash, sha256Jcs({ ...receipt, receiptHash: null }));
  assert.ok(receipt.repositories.every(({ root: repositoryRoot }) => repositoryRoot === null));
  assert.equal(existsSync(join(prepared.specDir, '.corrections.json')), false);
  assert.equal(existsSync(join(prepared.specDir, '.snapshot-pending')), false);
  assert.match(
    readFileSync(join(prepared.specDir, '.pipeline-shipped'), 'utf8'),
    /closure_receipt_hash:/,
  );
  assert.match(readFileSync(join(prepared.specDir, 'qa-report.md'), 'utf8'), /Status: PASS/);
  assert.match(
    readFileSync(join(prepared.specDir, 'tasks', 'T-001-core.md'), 'utf8'),
    /status: "done"/,
  );
  assert.equal(
    finalizeShipClosure({ projectRoot: root, feature: 'closure', runId: started.runId }).replayed,
    true,
  );
  assert.throws(
    () =>
      advanceShip({
        projectRoot: root,
        feature: 'closure',
        runId: started.runId,
        event: openReview(receipt.generation),
      }),
    (error) => error.code === 'E_SHIP_TERMINAL',
  );
});

test('targeted blocking findings terminate and arbitrary late reviews cannot mint revisions', () => {
  const { root } = project('blocked');
  const started = startShip({
    projectRoot: root,
    feature: 'blocked',
    humanReviewConfirmed: true,
    runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: taskCompleted(0),
  });
  result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: openReview(result.generation),
  });
  runShipGates({ projectRoot: root, feature: 'blocked', runId: started.runId, phase: 'initial' });
  let state = getShipClosure({ projectRoot: root, feature: 'blocked', runId: started.runId });
  result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: closeReview(state, { phase: 'initial', findings: [finding()] }),
  });
  state = getShipClosure({ projectRoot: root, feature: 'blocked', runId: started.runId });
  const findingId = state.reviews[0].findings[0].id;
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 2;\n');
  result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: {
      type: 'correction.registered',
      expectedGeneration: result.generation,
      impact: {
        summary: 'Attempt fix.',
        findingIds: [findingId],
        paths: [path('src/app.js')],
        affectedGateIds: ['build-1', 'test-1'],
      },
    },
  });
  result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: openReview(result.generation),
  });
  runShipGates({ projectRoot: root, feature: 'blocked', runId: started.runId, phase: 'targeted' });
  state = getShipClosure({ projectRoot: root, feature: 'blocked', runId: started.runId });
  result = advanceShip({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
    event: closeReview(state, {
      phase: 'targeted',
      reviewedFindingIds: [findingId],
      findings: [finding({ id: findingId, disposition: 'remains' })],
    }),
  });
  assert.equal(result.state, 'blocked');
  const finalized = finalizeShipClosure({
    projectRoot: root,
    feature: 'blocked',
    runId: started.runId,
  });
  assert.equal(finalized.state, 'blocked');
  for (let index = 0; index < 25; index += 1) {
    assert.throws(
      () =>
        advanceShip({
          projectRoot: root,
          feature: 'blocked',
          runId: started.runId,
          event: openReview(finalized.generation),
        }),
      (error) => error.code === 'E_SHIP_TERMINAL',
    );
  }
  assert.equal(
    JSON.parse(readFileSync(finalized.receiptPath, 'utf8')).candidateRevisions.length,
    2,
  );
});

test('structured Preserve detects directory and symlink changes across repositories', () => {
  const { root, prepared } = project('preserve');
  const second = mkdtempSync(join(tmpdir(), 'openplanr-closure-second-'));
  mkdirSync(join(second, 'input', 'tech'), { recursive: true });
  mkdirSync(join(second, 'src'), { recursive: true });
  mkdirSync(join(second, 'tests'), { recursive: true });
  writeFileSync(
    join(second, 'input', 'tech', 'stack.md'),
    [
      '# Stack',
      'BuildCommand: "node --check src/external.js"',
      'TestCommand: "node --test tests/external.test.mjs"',
    ].join('\n'),
  );
  writeFileSync(join(second, 'src', 'external.js'), 'export const external = true;\n');
  writeFileSync(
    join(second, 'tests', 'external.test.mjs'),
    "import test from 'node:test'; test('external', () => {});\n",
  );
  mkdirSync(join(root, 'protected'), { recursive: true });
  writeFileSync(join(root, 'protected', 'value.txt'), 'original\n');
  writeFileSync(join(root, 'target-a.txt'), 'a\n');
  symlinkSync('target-a.txt', join(root, 'protected-link'));
  writeFileSync(join(second, 'external.txt'), 'external\n');
  git(second, 'init', '-q');
  git(second, 'config', 'user.email', 'test@example.com');
  git(second, 'config', 'user.name', 'Test');
  git(second, 'add', '.');
  git(second, 'commit', '-qm', 'baseline');
  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = {
    repositories: [
      { repositoryKey: 'project', path: '.' },
      { repositoryKey: 'secondary', path: relative(root, second).split('\\').join('/') },
    ],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const taskPath = join(prepared.specDir, 'tasks', 'T-001-core.md');
  writeFileSync(
    taskPath,
    readFileSync(taskPath, 'utf8').replace(
      'preserve: []',
      [
        'preserve:',
        '  - repositoryKey: "project"',
        '    path: "protected"',
        '  - repositoryKey: "project"',
        '    path: "protected-link"',
        '  - repositoryKey: "secondary"',
        '    path: "external.txt"',
      ].join('\n'),
    ),
  );
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'preserve boundaries');
  const started = startShip({ projectRoot: root, feature: 'preserve', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let result = advanceShip({
    projectRoot: root,
    feature: 'preserve',
    runId: started.runId,
    event: taskCompleted(0),
  });
  unlinkSync(join(root, 'protected-link'));
  symlinkSync('src/app.js', join(root, 'protected-link'));
  writeFileSync(join(second, 'external.txt'), 'changed\n');
  assert.notEqual(readlinkSync(join(root, 'protected-link')), 'target-a.txt');
  assert.throws(
    () =>
      advanceShip({
        projectRoot: root,
        feature: 'preserve',
        runId: started.runId,
        event: openReview(result.generation),
      }),
    (error) => error.code === 'E_PRESERVE_VIOLATION' && error.details.changed.length === 2,
  );
});

test('runtime-sealed multi-repository candidate uses the same canonical tuple order as closure validation', () => {
  const { root } = project('prefixed-repositories');
  const cli = mkdtempSync(join(tmpdir(), 'openplanr-cli-closure-'));
  const web = mkdtempSync(join(tmpdir(), 'openplanr-web-closure-'));
  mkdirSync(join(cli, 'src'), { recursive: true });
  mkdirSync(join(web, 'src'), { recursive: true });
  writeFileSync(join(cli, 'src', 'index.js'), 'export const cli = 0;\n');
  writeFileSync(join(web, 'src', 'index.js'), 'export const web = 0;\n');
  for (const repository of [cli, web]) {
    git(repository, 'init', '-q');
    git(repository, 'config', 'user.email', 'test@example.com');
    git(repository, 'config', 'user.name', 'Test');
    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'baseline');
  }

  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = {
    repositories: [
      { repositoryKey: 'project', path: '.' },
      { repositoryKey: 'openplanr', path: relative(root, cli).split('\\').join('/') },
      { repositoryKey: 'openplanr-web', path: relative(root, web).split('\\').join('/') },
    ],
    gates: [
      {
        id: 'openplanr-build',
        repositoryKey: 'openplanr',
        argv: ['node', '--check', 'src/index.js'],
        inputs: [{ repositoryKey: 'openplanr', path: '.' }],
        dependsOn: [],
        finalRelevantSuite: false,
      },
      {
        id: 'openplanr-web-test',
        repositoryKey: 'openplanr-web',
        argv: ['node', '--check', 'src/index.js'],
        inputs: [{ repositoryKey: 'openplanr-web', path: '.' }],
        dependsOn: ['openplanr-build'],
        finalRelevantSuite: false,
      },
      {
        id: 'project-test',
        repositoryKey: 'project',
        argv: ['node', '--test', 'tests/smoke.test.mjs'],
        inputs: [{ repositoryKey: 'project', path: '.' }],
        dependsOn: ['openplanr-web-test'],
        finalRelevantSuite: true,
      },
    ],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = startShip({
    projectRoot: root,
    feature: 'prefixed-repositories',
    humanReviewConfirmed: true,
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  writeFileSync(join(cli, 'src', 'index.js'), 'export const cli = 1;\n');
  writeFileSync(join(web, 'src', 'index.js'), 'export const web = 1;\n');
  const completed = advanceShip({
    projectRoot: root,
    feature: 'prefixed-repositories',
    runId: started.runId,
    event: {
      ...taskCompleted(0),
      filesModified: [
        { repositoryKey: 'project', path: 'src/app.js' },
        { repositoryKey: 'openplanr', path: 'src/index.js' },
        { repositoryKey: 'openplanr-web', path: 'src/index.js' },
      ],
    },
  });
  const opened = advanceShip({
    projectRoot: root,
    feature: 'prefixed-repositories',
    runId: started.runId,
    event: openReview(completed.generation),
  });
  const active = getShipClosure({
    projectRoot: root,
    feature: 'prefixed-repositories',
    runId: started.runId,
  });

  assert.equal(opened.state, 'reviewing_initial');
  assert.deepEqual(
    active.candidateRevisions[0].repositories.map(({ repositoryKey }) => repositoryKey),
    ['openplanr', 'openplanr-web', 'project'],
  );
  assert.deepEqual(
    [...new Set(active.candidateRevisions[0].inventory.map(({ repositoryKey }) => repositoryKey))],
    ['openplanr', 'openplanr-web', 'project'],
  );
  assertShipClosure(active);
});

test('receipt validation rejects a substituted self hash', () => {
  const { root } = project('hash');
  const started = startShip({ projectRoot: root, feature: 'hash', humanReviewConfirmed: true });
  const active = getShipClosure({ projectRoot: root, feature: 'hash', runId: started.runId });
  const forged = {
    ...active,
    recordType: 'receipt',
    state: 'blocked',
    repositories: active.repositories.map((repository) => ({ ...repository, root: null })),
    terminal: {
      status: 'blocked',
      at: new Date().toISOString(),
      reason: 'x',
      candidateDigest: `sha256:${'a'.repeat(64)}`,
      gateEvidenceDigest: `sha256:${'b'.repeat(64)}`,
    },
    receiptHash: `sha256:${'c'.repeat(64)}`,
  };
  assert.throws(
    () => assertShipClosure(forged),
    (error) => error.code === 'E_SHIP_CLOSURE_INVALID',
  );
});

test('public event replay is byte-identical before and after terminal closure', () => {
  const { root } = project('replay');
  const started = startShip({ projectRoot: root, feature: 'replay', humanReviewConfirmed: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 10;\n');
  const completion = taskCompleted(0);
  const first = advanceShip({
    projectRoot: root,
    feature: 'replay',
    runId: started.runId,
    event: completion,
  });
  const replay = advanceShip({
    projectRoot: root,
    feature: 'replay',
    runId: started.runId,
    event: completion,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.generation, first.generation);
  const opened = advanceShip({
    projectRoot: root,
    feature: 'replay',
    runId: started.runId,
    event: openReview(first.generation),
  });
  runShipGates({ projectRoot: root, feature: 'replay', runId: started.runId, phase: 'initial' });
  const state = getShipClosure({ projectRoot: root, feature: 'replay', runId: started.runId });
  const close = closeReview(state, { phase: 'initial', findings: [] });
  const ready = advanceShip({
    projectRoot: root,
    feature: 'replay',
    runId: started.runId,
    event: close,
  });
  runShipGates({ projectRoot: root, feature: 'replay', runId: started.runId, phase: 'final' });
  finalizeShipClosure({ projectRoot: root, feature: 'replay', runId: started.runId });
  const terminalReplay = advanceShip({
    projectRoot: root,
    feature: 'replay',
    runId: started.runId,
    event: close,
  });
  assert.equal(terminalReplay.replayed, true);
  assert.equal(terminalReplay.state, 'passed');
  assert.throws(
    () =>
      advanceShip({
        projectRoot: root,
        feature: 'replay',
        runId: started.runId,
        event: { ...close, summary: 'different bytes', eventId: state.events.at(-1)?.eventId },
      }),
    (error) => ['E_SHIP_EVENT_INVALID', 'E_SHIP_GENERATION_CONFLICT'].includes(error.code),
  );
  assert.equal(opened.state, 'reviewing_initial');
  assert.equal(ready.state, 'ready_for_final');
});

test('unchanged correction is rejected and correction-required can close BLOCKED', () => {
  const { root } = project('uncorrectable');
  const started = startShip({
    projectRoot: root,
    feature: 'uncorrectable',
    humanReviewConfirmed: true,
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 11;\n');
  let result = advanceShip({
    projectRoot: root,
    feature: 'uncorrectable',
    runId: started.runId,
    event: taskCompleted(0),
  });
  result = advanceShip({
    projectRoot: root,
    feature: 'uncorrectable',
    runId: started.runId,
    event: openReview(result.generation),
  });
  runShipGates({
    projectRoot: root,
    feature: 'uncorrectable',
    runId: started.runId,
    phase: 'initial',
  });
  let state = getShipClosure({ projectRoot: root, feature: 'uncorrectable', runId: started.runId });
  result = advanceShip({
    projectRoot: root,
    feature: 'uncorrectable',
    runId: started.runId,
    event: closeReview(state, { phase: 'initial', findings: [finding()] }),
  });
  state = getShipClosure({ projectRoot: root, feature: 'uncorrectable', runId: started.runId });
  const findingId = state.reviews[0].findings[0].id;
  assert.throws(
    () =>
      advanceShip({
        projectRoot: root,
        feature: 'uncorrectable',
        runId: started.runId,
        event: {
          type: 'correction.registered',
          expectedGeneration: result.generation,
          impact: {
            summary: 'No byte change.',
            findingIds: [findingId],
            paths: [],
            affectedGateIds: [],
          },
        },
      }),
    (error) => error.code === 'E_SHIP_CORRECTION_INVALID',
  );
  const terminal = finalizeShipClosure({
    projectRoot: root,
    feature: 'uncorrectable',
    runId: started.runId,
  });
  assert.equal(terminal.state, 'blocked');
  assert.match(terminal.terminal.reason, /could not produce/);
});

test('disjoint task receipts aggregate planning truth and reopen one exact prior scope', () => {
  const { root, prepared } = project('disjoint');
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-002-second.md'),
    [
      '---',
      'id: "T-002"',
      'storyId: "US-001"',
      'status: "pending"',
      'updated: "2026-08-21"',
      'dependsOn: []',
      'preserve: []',
      '---',
      '',
      '## Definition of done',
      '- [ ] complete',
    ].join('\n'),
  );
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'second task');
  const first = startShip({
    projectRoot: root,
    feature: 'disjoint',
    humanReviewConfirmed: true,
    taskId: 'T-001',
  });
  const firstPass = passWithoutCorrection(root, 'disjoint', first);
  assert.equal(
    existsSync(join(prepared.specDir, '.pipeline-shipped')),
    true,
    'every terminal receipt derives a scoped compatibility marker',
  );
  const specPath = join(prepared.specDir, `${prepared.specDir.split('/').at(-1)}.md`);
  assert.match(readFileSync(specPath, 'utf8'), /status: "in-pipeline"/);
  const second = startShip({ projectRoot: root, feature: 'disjoint', humanReviewConfirmed: true });
  assert.deepEqual(second.approvedScope.taskIds, ['T-002']);
  passWithoutCorrection(root, 'disjoint', second, { taskId: 'T-002', sourceChange: false });
  assert.match(readFileSync(specPath, 'utf8'), /status: "done"/);
  assert.equal(existsSync(join(prepared.specDir, '.pipeline-shipped')), true);
  assert.throws(
    () => startShip({ projectRoot: root, feature: 'disjoint', humanReviewConfirmed: true }),
    (error) => error.code === 'E_SHIP_SCOPE_COMPLETE',
  );
  const reopened = reopenShip({
    projectRoot: root,
    feature: 'disjoint',
    receiptHash: firstPass.finalized.receiptHash,
    reason: 'Recheck the first bounded task.',
    ownerConfirmed: true,
  });
  assert.deepEqual(reopened.approvedScope.taskIds, ['T-001']);
  assert.equal(reopened.tasks[0].status, 'pending');
  const exactReplay = reopenShip({
    projectRoot: root,
    feature: 'disjoint',
    receiptHash: firstPass.finalized.receiptHash,
    reason: 'Recheck the first bounded task.',
    ownerConfirmed: true,
  });
  assert.equal(exactReplay.replayed, true);
});

test('config-owned multi-repository gates round-trip through CLI start, block, finalize, and reopen', () => {
  const { root } = project('multi-cli');
  const secondary = mkdtempSync(join(tmpdir(), 'openplanr-multi-cli-'));
  mkdirSync(join(secondary, 'input', 'tech'), { recursive: true });
  mkdirSync(join(secondary, 'src'), { recursive: true });
  mkdirSync(join(secondary, 'tests'), { recursive: true });
  writeFileSync(
    join(secondary, 'input', 'tech', 'stack.md'),
    '# Stack\nBuildCommand: "node --check src/index.js"\nTestCommand: "node --test tests/index.test.mjs"\n',
  );
  writeFileSync(join(secondary, 'src', 'index.js'), 'export const ok = true;\n');
  writeFileSync(
    join(secondary, 'tests', 'index.test.mjs'),
    "import test from 'node:test'; test('ok', () => {});\n",
  );
  git(secondary, 'init', '-q');
  git(secondary, 'config', 'user.email', 'test@example.com');
  git(secondary, 'config', 'user.name', 'Test');
  git(secondary, 'add', '.');
  git(secondary, 'commit', '-qm', 'baseline');
  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = {
    repositories: [
      { repositoryKey: 'project', path: '.' },
      { repositoryKey: 'secondary', path: join('..', secondary.split('/').at(-1)) },
    ],
    gates: [
      {
        id: 'project-build',
        repositoryKey: 'project',
        argv: ['node', '--check', 'src/app.js'],
        inputs: [{ repositoryKey: 'project', path: '.' }],
        dependsOn: [],
        finalRelevantSuite: false,
      },
      {
        id: 'secondary-build',
        repositoryKey: 'secondary',
        argv: ['node', '--check', 'src/index.js'],
        inputs: [
          { repositoryKey: 'secondary', path: '.' },
          { repositoryKey: 'project', path: 'src/app.js' },
        ],
        dependsOn: ['project-build'],
        finalRelevantSuite: false,
      },
      {
        id: 'project-test',
        repositoryKey: 'project',
        argv: ['node', '--test', 'tests/smoke.test.mjs'],
        inputs: [{ repositoryKey: 'project', path: '.' }],
        dependsOn: ['secondary-build'],
        finalRelevantSuite: true,
      },
    ],
  };
  writeFileSync(configPath, JSON.stringify(config));
  const cli = join(process.cwd(), 'bin', 'planr-pipeline.mjs');
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args, '--json'], { cwd: root, encoding: 'utf8' }),
    );
  const preview = run('prepare-ship', 'multi-cli');
  assert.deepEqual(
    preview.gateDescriptors.map(({ id }) => id),
    ['project-build', 'secondary-build', 'project-test'],
  );
  const started = run('start-ship', 'multi-cli', '--reviewer', 'security-agent');
  assert.deepEqual(
    started.repositories.map(({ repositoryKey }) => repositoryKey),
    ['project', 'secondary'],
  );
  assert.deepEqual(started.reviewerRoster, ['qa-agent', 'security-agent']);
  assert.deepEqual(
    started.gates.map(({ id }) => id),
    ['project-build', 'secondary-build', 'project-test'],
  );
  const blocked = advanceShip({
    projectRoot: root,
    feature: 'multi-cli',
    runId: started.runId,
    event: {
      type: 'task.blocked',
      expectedGeneration: 0,
      taskId: 'T-001',
      agent: 'backend-agent',
      reason: 'Environment cannot complete.',
      filesWritten: [],
      filesModified: [],
    },
  });
  assert.equal(blocked.state, 'implementing');
  const finalized = run('finalize-ship', 'multi-cli', '--run-id', started.runId);
  assert.equal(finalized.state, 'blocked');
  const blockedReceiptBytes = readFileSync(finalized.receiptPath, 'utf8');
  config.shipClosure.gates[1].inputs.push({
    repositoryKey: 'project',
    path: 'tests/smoke.test.mjs',
  });
  writeFileSync(configPath, JSON.stringify(config));
  const reopened = run(
    'reopen-ship',
    'multi-cli',
    '--receipt-hash',
    finalized.receiptHash,
    '--reason',
    'Owner requests one bounded retry.',
  );
  assert.deepEqual(
    reopened.repositories.map(({ repositoryKey }) => repositoryKey),
    ['project', 'secondary'],
  );
  assert.deepEqual(reopened.gates[1].inputs, config.shipClosure.gates[1].inputs);
  assert.notEqual(reopened.gateSetDigest, finalized.gateSetDigest);
  assert.equal(readFileSync(finalized.receiptPath, 'utf8'), blockedReceiptBytes);
  assert.equal(reopened.tasks[0].status, 'pending');
  assert.equal(
    run(
      'reopen-ship',
      'multi-cli',
      '--receipt-hash',
      finalized.receiptHash,
      '--reason',
      'Owner requests one bounded retry.',
    ).replayed,
    true,
  );
});
