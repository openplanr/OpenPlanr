import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { promisify } from 'node:util';
import { createWorktreeCustody } from '../../skills/planr-delegate/scripts/custody.mjs';
import { snapshotHelper } from '../../skills/planr-delegate/scripts/helper-snapshot.mjs';
import {
  delegateIntegrationCommand,
  discoverDelegateChecks,
  integrateDelegateDelta,
  reviewDelegateDelta,
} from '../../skills/planr-delegate/scripts/integrate.mjs';
import { checkoutLock } from '../../skills/planr-delegate/scripts/integration-transaction.mjs';
import {
  handoffPresentation,
  implementationReport,
  preparationPresentation,
  reviewPresentation,
} from '../../skills/planr-delegate/scripts/presentation.mjs';
import {
  closeRunRecord,
  compactIntegrationState,
  createRunRecord,
  processIdentity,
  readRunRecord,
  updateRunRecord,
  verifyIntegrationState,
} from '../../skills/planr-delegate/scripts/run-record.mjs';
import {
  delegateRunnerCommand,
  delegateRunStatus,
  resumeDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

const execFile = promisify(execFileCallback);
const roots = [];
async function git(cwd, ...args) {
  return execFile('git', args, { cwd });
}
async function fixture({ dirty = false, preservePaths = [], files = {} } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'planr-integrate-test-'));
  roots.push(base);
  const repositoryRoot = join(base, 'source');
  const worktreeParent = join(base, 'worktrees');
  await mkdir(repositoryRoot);
  await mkdir(worktreeParent);
  await git(repositoryRoot, 'init', '-q');
  await git(repositoryRoot, 'config', 'user.name', 'OpenPlanr Test');
  await git(repositoryRoot, 'config', 'user.email', 'test@openplanr.dev');
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'base\n');
  await writeFile(join(repositoryRoot, 'keep.txt'), 'preserve\n');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repositoryRoot, path)), { recursive: true });
    await writeFile(join(repositoryRoot, path), content);
  }
  await git(repositoryRoot, 'add', '.');
  await git(repositoryRoot, 'commit', '-qm', 'base');
  const selectedPaths = [];
  if (dirty) {
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'selected dirty\n');
    await writeFile(join(repositoryRoot, 'untracked.txt'), 'selected untracked\n');
    selectedPaths.push('tracked.txt', 'untracked.txt');
  }
  const capsule = {
    kind: 'openplanr-delegation-context-capsule',
    inventory: selectedPaths.map((path) => ({
      repositoryKey: 'project',
      path,
      roles: ['selected-source'],
    })),
    files: [],
  };
  const custody = await createWorktreeCustody({
    repositoryRoot,
    worktreeParent,
    capsule,
    selectedPaths,
    preservePaths,
  });
  return { base, repositoryRoot, custody, capsule };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const run = { status: 'completed', changedFiles: ['fabricated.txt'] };

test('presentation distinguishes delegate claims, observed changes, checks, and blocked integration', () => {
  const preview = preparationPresentation({
    selector: 'T-071',
    inventory: [{ path: 'source.txt' }],
    omissions: [],
    writableRepository: '/private/tmp/source',
    profile: 'claude-local',
    destination: { class: 'local', origin: 'http://127.0.0.1:1234' },
  });
  assert.equal(preview.phase, 'preview');
  assert.equal(preview.destination.origin, 'http://127.0.0.1:1234');
  assert.deepEqual(preview.credentialResolutions, []);
  const resolution = {
    id: 'cred_0123456789abcdef',
    contentDigest: `sha256:${'0'.repeat(64)}`,
    repositoryKey: 'project',
    path: 'source.txt',
    rule: 'credential-assignment',
    location: { path: 'source.txt', line: 2, column: 3 },
  };
  const resolved = preparationPresentation({
    selector: 'T-071',
    inventory: [{ path: 'source.txt' }],
    omissions: [],
    credentialResolutions: [resolution],
  });
  assert.deepEqual(resolved.credentialResolutions, [resolution]);
  assert.match(resolved.context, /1 accepted credential resolution/u);
  assert.match(handoffPresentation({ status: 'completed' }).headline, /still required/u);
  assert.equal(
    handoffPresentation({ status: 'question', result: { question: { text: 'Which API?' } } })
      .question.text,
    'Which API?',
  );
  assert.match(
    reviewPresentation({ ready: true, changedPaths: ['source.txt'], violations: [] }).headline,
    /nothing has been integrated/u,
  );
  const accepted = implementationReport(
    {
      status: 'completed',
      changedPaths: ['source.txt'],
      checks: [{ command: 'npm test', status: 'passed' }],
      violations: [],
    },
    'T-071',
  );
  assert.deepEqual(Object.keys(accepted), ['Outcome', 'Task', 'Changed', 'Checks', 'Issues']);
  assert.match(accepted.Outcome, /uncommitted local diff/u);
  assert.equal(accepted.Task, 'Task T-071');
  assert.match(accepted.Checks, /1\/1 independent/u);
  const blocked = implementationReport(
    {
      status: 'blocked',
      changedPaths: ['source.txt'],
      checks: [{ command: 'npm test', status: 'failed', exitCode: 1 }],
      violations: [{ code: 'E_INTEGRATION_PRESERVE', path: 'source.txt' }],
      code: 'E_INTEGRATION_CHECKS',
      rollbackErrors: [{ path: 'source.txt', code: 'E_ROLLBACK' }],
      nextAction: 'Send findings to the same delegate session.',
    },
    null,
  );
  assert.equal(blocked.Task, 'Direct request');
  assert.match(blocked.Changed, /not accepted/u);
  assert.match(blocked.Issues, /E_INTEGRATION_PRESERVE: source.txt/u);
  assert.match(blocked.Issues, /npm test failed \(exit 1\)/u);
  assert.match(blocked.Issues, /Recovery needed: source.txt \(E_ROLLBACK\)/u);
  const timedOut = implementationReport(
    {
      status: 'blocked',
      changedPaths: ['source.txt'],
      checks: [{ command: 'npm run test', status: 'timed-out', timeoutMs: 120000 }],
      code: 'E_INTEGRATION_CHECK_TIMEOUT',
      nextAction: 'Retry with a measured timeoutMs.',
    },
    null,
  );
  assert.match(timedOut.Issues, /timed out after 120000 ms/u);
  assert.doesNotMatch(timedOut.Issues, /fails before applying this delta/u);
  const unverified = implementationReport({ status: 'completed', changedPaths: [] }, null);
  assert.match(unverified.Checks, /No independent checks ran/u);
});

test('accepted-state inspection reports filesystem causes instead of hiding them as content drift', async () => {
  const { base, repositoryRoot } = await fixture();
  await mkdir(join(base, 'outside'));
  await writeFile(join(base, 'outside', 'private.txt'), 'private');
  await symlink(join(base, 'outside'), join(repositoryRoot, 'escape'));
  const result = await verifyIntegrationState({
    repositoryRoot,
    integration: {
      status: 'applied',
      states: { 'escape/private.txt': { kind: 'file', mode: 0o644, digest: 'missing' } },
    },
  });
  assert.deepEqual(result.driftPaths, ['escape/private.txt']);
  assert.deepEqual(result.inspectionFailures, [
    { path: 'escape/private.txt', code: 'E_CUSTODY_PATH', cause: 'E_CUSTODY_PATH' },
  ]);
});

test('observed patch excludes selected dirty baseline and ignores delegate claims', async () => {
  const { custody } = await fixture({ dirty: true });
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'selected dirty\ndelegate edit\n');
  await writeFile(
    join(custody.worktreePath, 'untracked.txt'),
    'selected untracked\ndelegate edit\n',
  );
  await writeFile(join(custody.worktreePath, 'new.txt'), 'new\n');
  const review = await reviewDelegateDelta({
    custody,
    run,
    scopePaths: ['tracked.txt', 'untracked.txt', 'new.txt'],
  });
  assert.equal(review.ready, true);
  assert.deepEqual(review.changedPaths, ['new.txt', 'tracked.txt', 'untracked.txt']);
  assert.equal(
    Buffer.from(
      review.changes.find((item) => item.path === 'tracked.txt').before.contentBase64,
      'base64',
    ).toString(),
    'selected dirty\n',
  );
  assert.equal(review.changedPaths.includes('fabricated.txt'), false);
});

test('preserve, scope, source drift, staged, and committed changes block without source writes', async () => {
  const cases = [
    {
      name: 'preserve',
      mutate: async ({ custody }) => writeFile(join(custody.worktreePath, 'keep.txt'), 'changed\n'),
      scopePaths: ['keep.txt'],
    },
    {
      name: 'scope',
      mutate: async ({ custody }) =>
        writeFile(join(custody.worktreePath, 'tracked.txt'), 'changed\n'),
      scopePaths: ['other.txt'],
    },
    {
      name: 'source drift',
      mutate: async ({ custody, repositoryRoot }) => {
        await writeFile(join(custody.worktreePath, 'tracked.txt'), 'changed\n');
        await writeFile(join(repositoryRoot, 'tracked.txt'), 'source moved\n');
      },
      scopePaths: ['tracked.txt'],
    },
    {
      name: 'staged',
      mutate: async ({ custody }) => {
        await writeFile(join(custody.worktreePath, 'tracked.txt'), 'changed\n');
        await git(custody.worktreePath, 'add', 'tracked.txt');
      },
      scopePaths: ['tracked.txt'],
    },
    {
      name: 'committed',
      mutate: async ({ custody }) => {
        await writeFile(join(custody.worktreePath, 'tracked.txt'), 'changed\n');
        await git(
          custody.worktreePath,
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          'commit',
          '-qam',
          'delegate committed',
        );
      },
      scopePaths: ['tracked.txt'],
    },
  ];
  for (const scenario of cases) {
    const input = await fixture({ preservePaths: ['keep.txt'] });
    await scenario.mutate(input);
    const expected = await readFile(join(input.repositoryRoot, 'tracked.txt'), 'utf8');
    const result = await integrateDelegateDelta({
      custody: input.custody,
      run,
      scopePaths: scenario.scopePaths,
      checks: [],
    });
    assert.equal(result.status, 'blocked', scenario.name);
    assert.equal(
      await readFile(join(input.repositoryRoot, 'tracked.txt'), 'utf8'),
      expected,
      scenario.name,
    );
  }
});

test('mid-apply failure rolls back all source paths and retains worktree', async () => {
  const { custody, repositoryRoot } = await fixture();
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'delegate\n');
  await mkdir(join(custody.worktreePath, 'nested'));
  await writeFile(join(custody.worktreePath, 'nested', 'new.txt'), 'new\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: ['tracked.txt', 'nested'],
    checks: [],
    onProgress: async (_path, phase) => {
      if (phase === 'after')
        throw Object.assign(new Error('Journal storage unavailable'), { code: 'E_JOURNAL_IO' });
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
  assert.equal(await readFile(join(custody.worktreePath, 'tracked.txt'), 'utf8'), 'delegate\n');
  await assert.rejects(lstat(join(repositoryRoot, 'nested')), { code: 'ENOENT' });
});

test('safe mode, deletion, and new-file delta applies as uncommitted diff after independent checks', async () => {
  const { custody, repositoryRoot } = await fixture({
    files: {
      'package.json': JSON.stringify({
        scripts: {
          'test:focused': 'node -e "process.exit(0)"',
          'check:boundaries': 'node -e "process.exit(0)"',
        },
      }),
    },
  });
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'delegate\n');
  await chmod(join(custody.worktreePath, 'tracked.txt'), 0o755);
  await rm(join(custody.worktreePath, 'keep.txt'));
  await writeFile(join(custody.worktreePath, 'new.txt'), 'new\n');
  const checks = await discoverDelegateChecks({ repositoryRoot, changedPaths: ['tracked.txt'] });
  assert.ok(checks.some((check) => check.kind === 'focused'));
  assert.ok(checks.some((check) => check.kind === 'regression'));
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: ['tracked.txt', 'keep.txt', 'new.txt'],
    checks,
  });
  assert.equal(result.status, 'completed', JSON.stringify(result.violations));
  assert.equal(
    result.checks.every((check) => check.status === 'passed'),
    true,
  );
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'delegate\n');
  const { stdout } = await git(repositoryRoot, 'status', '--short');
  assert.match(stdout, /tracked\.txt/u);
  assert.match(stdout, /new\.txt/u);
  assert.match(stdout, /keep\.txt/u);
});

test('failed check rolls back source and reports independent finding', async () => {
  const { custody, repositoryRoot } = await fixture({
    files: {
      'package.json': JSON.stringify({ scripts: { 'test:fail': 'node -e "process.exit(1)"' } }),
    },
  });
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: ['npm run test:fail'],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.checks[0].status, 'failed');
  assert.equal(result.checks[0].classification, 'baseline-failure');
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

test('timed-out check rolls back without labeling the patch a regression or retrying the baseline', async () => {
  const { custody, repositoryRoot } = await fixture({
    files: {
      'package.json': JSON.stringify({
        scripts: { 'test:slow': 'node -e "setTimeout(() => {}, 300)"' },
      }),
    },
  });
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: ['npm run test:slow'],
    timeoutMs: 20,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'E_INTEGRATION_CHECK_TIMEOUT');
  assert.equal(result.checks[0].status, 'timed-out');
  assert.equal(result.checks[0].classification, undefined);
  assert.match(result.nextAction, /timeoutMs/u);
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

test('unsafe delegated symlink is reported as a conflict without touching source', async () => {
  const { custody, repositoryRoot } = await fixture();
  await symlink('/etc/passwd', join(custody.worktreePath, 'escape.txt'));
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: ['escape.txt'],
    checks: [],
  });
  assert.equal(result.status, 'blocked');
  assert.ok(
    result.violations.some((violation) => violation.code === 'E_INTEGRATION_UNSAFE_WORKTREE_PATH'),
  );
  await assert.rejects(lstat(join(repositoryRoot, 'escape.txt')), { code: 'ENOENT' });
});

test('installed review command reads private custody but reports only observed metadata', async () => {
  const { base, custody, repositoryRoot, capsule } = await fixture();
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'private delegate edit\n');
  const runDirectory = join(base, 'runs');
  await mkdir(runDirectory, { mode: 0o700 });
  const runId = custody.runId;
  const runPath = join(await realpath(runDirectory), runId);
  const custodyPath = join(runPath, 'custody.json');
  const capsuleDirectory = join(runPath, 'capsule');
  const capsulePath = join(capsuleDirectory, 'capsule.json');
  const capsuleBytes = Buffer.from(JSON.stringify(capsule));
  const capsuleDigest = createHash('sha256').update(capsuleBytes).digest('hex');
  await createRunRecord(
    {
      runId,
      runPath,
      repositoryRoot: custody.repositoryRoot,
      worktreePath: custody.worktreePath,
      custodyPath,
      capsulePath,
      capsuleDigest,
      status: 'completed',
    },
    { directory: runDirectory },
  );
  await updateRunRecord(
    runId,
    { helper: await snapshotHelper(runPath) },
    { directory: runDirectory },
  );
  await writeFile(custodyPath, JSON.stringify(custody), { mode: 0o600 });
  await mkdir(capsuleDirectory, { mode: 0o700 });
  await writeFile(capsulePath, capsuleBytes, { mode: 0o600 });
  const result = await delegateIntegrationCommand('review', {
    runId,
    runDirectory,
    scopePaths: ['tracked.txt'],
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.changedPaths, ['tracked.txt']);
  assert.equal(JSON.stringify(result).includes('private delegate edit'), false);
  await writeFile(capsulePath, Buffer.concat([capsuleBytes, Buffer.from(' ')]), { mode: 0o600 });
  const blockedReview = await delegateIntegrationCommand('review', {
    runId,
    runDirectory,
    scopePaths: ['tracked.txt'],
  });
  assert.equal(blockedReview.ready, false);
  assert.equal(blockedReview.violations[0].code, 'E_DELEGATE_CAPSULE_DRIFT');
  const blockedApply = await delegateIntegrationCommand('apply', {
    runId,
    runDirectory,
    scopePaths: ['tracked.txt'],
  });
  assert.equal(blockedApply.status, 'blocked');
  assert.equal(blockedApply.code, 'E_DELEGATE_CAPSULE_DRIFT');
  assert.equal(blockedApply.report.Task, 'Task unavailable');
  assert.match(blockedApply.report.Issues, /E_DELEGATE_CAPSULE_DRIFT/u);
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

async function recordedRun({ base, custody, capsule }) {
  const runDirectory = join(base, 'runs');
  await mkdir(runDirectory, { mode: 0o700 });
  const runId = custody.runId;
  const runPath = join(await realpath(runDirectory), runId);
  const custodyPath = join(runPath, 'custody.json');
  const capsulePath = join(runPath, 'capsule', 'capsule.json');
  const capsuleBytes = Buffer.from(JSON.stringify(capsule));
  await createRunRecord(
    {
      runId,
      runPath,
      repositoryRoot: custody.repositoryRoot,
      worktreePath: custody.worktreePath,
      custodyPath,
      capsulePath,
      capsuleDigest: createHash('sha256').update(capsuleBytes).digest('hex'),
      status: 'completed',
    },
    { directory: runDirectory },
  );
  await updateRunRecord(
    runId,
    { helper: await snapshotHelper(runPath) },
    { directory: runDirectory },
  );
  await writeFile(custodyPath, JSON.stringify(custody), { mode: 0o600 });
  await mkdir(dirname(capsulePath), { mode: 0o700 });
  await writeFile(capsulePath, capsuleBytes, { mode: 0o600 });
  return { runId, runDirectory };
}

test('recorded integration scope cannot be widened after dispatch', async () => {
  const data = await fixture();
  const { custody, repositoryRoot } = data;
  await writeFile(join(custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const { runId, runDirectory } = await recordedRun(data);
  await updateRunRecord(
    runId,
    { integrationScopePaths: ['tracked.txt'] },
    { directory: runDirectory },
  );
  await assert.rejects(
    delegateIntegrationCommand('apply', {
      runId,
      runDirectory,
      scopePaths: ['keep.txt'],
      checks: [],
    }),
    { code: 'E_INTEGRATION_SCOPE_WIDENED' },
  );
  const reviewed = await delegateIntegrationCommand('review', { runId, runDirectory });
  assert.equal(reviewed.ready, true);
  assert.deepEqual(reviewed.changedPaths, ['tracked.txt']);
  assert.equal(await readFile(join(repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

test('scoped checks and declared generation integrate atomically with auditable provenance', async () => {
  const packagePath = 'packages/widget';
  const sourcePath = `${packagePath}/source.txt`;
  const outputPath = `${packagePath}/generated.txt`;
  const generator =
    "node -e \"const fs=require('fs');fs.writeFileSync('generated.txt',fs.readFileSync('source.txt'))\"";
  const check =
    "node -e \"process.exit(require('fs').readFileSync('generated.txt','utf8')===require('fs').readFileSync('source.txt','utf8')?0:1)\"";
  const fixtureData = await fixture({
    files: {
      [`${packagePath}/package.json`]: JSON.stringify({
        scripts: { generate: generator, test: check },
      }),
      [sourcePath]: 'base\n',
      [outputPath]: 'base\n',
    },
  });
  const { base, custody, repositoryRoot } = fixtureData;
  await writeFile(join(custody.worktreePath, sourcePath), 'delegate\n');
  const { runId, runDirectory } = await recordedRun(fixtureData);
  await delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: [packagePath] });
  const result = await delegateIntegrationCommand('apply', {
    runId,
    runDirectory,
    scopePaths: [packagePath],
    checks: [{ command: 'npm run test', cwd: packagePath }],
    generators: [{ packagePath, script: 'generate', outputPaths: [outputPath] }],
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(result.changedPaths, [sourcePath, outputPath]);
  assert.deepEqual(result.generatedPaths, [outputPath]);
  assert.equal(result.checks[0].status, 'passed');
  assert.equal(await readFile(join(repositoryRoot, outputPath), 'utf8'), 'delegate\n');
  const recorded = await readRunRecord(runId, { directory: runDirectory });
  assert.equal(recorded.status, 'closed');
  assert.equal(recorded.disposition, 'integrated');
  assert.deepEqual(recorded.integration.delegatePaths, [sourcePath]);
  assert.deepEqual(recorded.integration.generatedPaths, [outputPath]);
  assert.equal(
    JSON.stringify(await delegateRunStatus({ runId, runDirectory })).includes('delegate\n'),
    false,
  );
  assert.equal((await delegateRunStatus({ runId, runDirectory })).phase, 'integrated');
  assert.deepEqual((await delegateRunStatus({ runId, runDirectory })).report, result.report);
  assert.deepEqual(
    (await delegateRunnerCommand('status', { runId, runDirectory })).report,
    result.report,
  );
  assert.deepEqual(
    (
      await delegateRunnerCommand('close', {
        runId,
        runDirectory,
        disposition: 'integrated',
      })
    ).report,
    result.report,
  );
  await assert.rejects(
    delegateIntegrationCommand('apply', {
      runId,
      runDirectory,
      scopePaths: [packagePath],
      checks: [],
    }),
    { code: 'E_INTEGRATION_ALREADY_APPLIED' },
  );
  await assert.rejects(resumeDelegateRun({ runId, runDirectory, correction: 'More work' }), {
    code: 'E_DELEGATE_ALREADY_INTEGRATED',
  });
  await writeFile(join(repositoryRoot, sourcePath), 'host correction\n');
  assert.deepEqual((await delegateRunStatus({ runId, runDirectory })).integration.driftPaths, [
    sourcePath,
  ]);
  await writeFile(join(repositoryRoot, sourcePath), 'delegate\n');
  const closedAt = (
    await closeRunRecord(runId, { disposition: 'integrated', directory: runDirectory })
  ).closedAt;
  assert.equal(
    (await closeRunRecord(runId, { disposition: 'integrated', directory: runDirectory })).closedAt,
    closedAt,
  );
  await assert.rejects(
    closeRunRecord(runId, { disposition: 'abandoned', directory: runDirectory }),
    { code: 'E_RUN_CLOSE' },
  );
  assert.equal((await delegateRunStatus({ runId, runDirectory })).phase, 'integrated');
  assert.equal(base.length > 0, true);
});

test('generator side effects outside declared outputs roll back both generated and delegate files', async () => {
  const packagePath = 'packages/widget';
  const sourcePath = `${packagePath}/source.txt`;
  const outputPath = `${packagePath}/generated.txt`;
  const generator =
    "node -e \"const fs=require('fs');fs.writeFileSync('generated.txt','changed');fs.writeFileSync('stray.txt','unlisted')\"";
  const { custody, repositoryRoot } = await fixture({
    files: {
      [`${packagePath}/package.json`]: JSON.stringify({ scripts: { generate: generator } }),
      [sourcePath]: 'base\n',
      [outputPath]: 'base\n',
    },
  });
  await writeFile(join(custody.worktreePath, sourcePath), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: [packagePath],
    checks: [],
    generators: [{ packagePath, script: 'generate', outputPaths: [outputPath] }],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'E_INTEGRATION_GENERATOR_SCOPE');
  assert.equal(await readFile(join(repositoryRoot, sourcePath), 'utf8'), 'base\n');
  assert.equal(await readFile(join(repositoryRoot, outputPath), 'utf8'), 'base\n');
  await assert.rejects(lstat(join(repositoryRoot, packagePath, 'stray.txt')), { code: 'ENOENT' });
});

test('unsafe explicit check and dirty generated destination block before source writes', async () => {
  const packagePath = 'packages/widget';
  const sourcePath = `${packagePath}/source.txt`;
  const outputPath = `${packagePath}/generated.txt`;
  const { custody, repositoryRoot } = await fixture({
    files: {
      [`${packagePath}/package.json`]: JSON.stringify({
        scripts: { generate: 'node -e ""', test: 'node -e ""' },
      }),
      [sourcePath]: 'base\n',
      [outputPath]: 'base\n',
    },
  });
  await writeFile(join(custody.worktreePath, sourcePath), 'delegate\n');
  await assert.rejects(
    integrateDelegateDelta({
      custody,
      run,
      scopePaths: [packagePath],
      checks: ['npm run test; touch secret'],
    }),
    { code: 'E_INTEGRATION_CHECK_SELECTION' },
  );
  await writeFile(join(repositoryRoot, outputPath), 'user work\n');
  await assert.rejects(
    integrateDelegateDelta({
      custody,
      run,
      scopePaths: [packagePath],
      checks: [],
      generators: [{ packagePath, script: 'generate', outputPaths: [outputPath] }],
    }),
    (error) => ['E_INTEGRATION_GENERATOR_DRIFT', 'E_INTEGRATION_SOURCE_DRIFT'].includes(error.code),
  );
  assert.equal(await readFile(join(repositoryRoot, sourcePath), 'utf8'), 'base\n');
  assert.equal(await readFile(join(repositoryRoot, outputPath), 'utf8'), 'user work\n');
});

test('a check that writes repository files cannot silently become delegated output', async () => {
  const packagePath = 'packages/widget';
  const sourcePath = `${packagePath}/source.txt`;
  const { custody, repositoryRoot } = await fixture({
    files: {
      [`${packagePath}/package.json`]: JSON.stringify({
        scripts: {
          'test:mutate': "node -e \"require('fs').writeFileSync('stray.txt','from check')\"",
        },
      }),
      [sourcePath]: 'base\n',
    },
  });
  await writeFile(join(custody.worktreePath, sourcePath), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: [packagePath],
    checks: [{ command: 'npm run test:mutate', cwd: packagePath }],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'E_INTEGRATION_CHECK_SIDE_EFFECT');
  assert.equal(await readFile(join(repositoryRoot, sourcePath), 'utf8'), 'base\n');
  await assert.rejects(lstat(join(repositoryRoot, packagePath, 'stray.txt')), { code: 'ENOENT' });
});

test('baseline classification also rolls back side effects from the baseline rerun', async () => {
  const packagePath = 'packages/widget';
  const sourcePath = `${packagePath}/source.txt`;
  const script =
    "node -e \"const fs=require('fs');if(fs.readFileSync('source.txt','utf8')==='base\\n')fs.writeFileSync('baseline-stray.txt','side effect');process.exit(1)\"";
  const { custody, repositoryRoot } = await fixture({
    files: {
      [`${packagePath}/package.json`]: JSON.stringify({ scripts: { test: script } }),
      [sourcePath]: 'base\n',
    },
  });
  await writeFile(join(custody.worktreePath, sourcePath), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody,
    run,
    scopePaths: [packagePath],
    checks: [{ command: 'npm run test', cwd: packagePath }],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'E_INTEGRATION_BASELINE_SIDE_EFFECT');
  assert.equal(result.checks[0].classification, 'unverified');
  assert.equal(await readFile(join(repositoryRoot, sourcePath), 'utf8'), 'base\n');
  await assert.rejects(lstat(join(repositoryRoot, packagePath, 'baseline-stray.txt')), {
    code: 'ENOENT',
  });
});

test('checks cannot revert concurrent edits or delete a new owner note', async () => {
  const data = await fixture({
    files: {
      'package.json': JSON.stringify({ scripts: { test: 'node check.mjs' } }),
      'check.mjs': 'await new Promise(r=>setTimeout(r,250));',
      'other.txt': 'before\n',
    },
  });
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const integration = integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: ['npm run test'],
  });
  await new Promise((r) => setTimeout(r, 120));
  await writeFile(join(data.repositoryRoot, 'other.txt'), 'owner edit\n');
  await writeFile(join(data.repositoryRoot, 'NOTES.md'), 'owner note\n');
  const result = await integration;
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(await readFile(join(data.repositoryRoot, 'other.txt'), 'utf8'), 'owner edit\n');
  assert.equal(await readFile(join(data.repositoryRoot, 'NOTES.md'), 'utf8'), 'owner note\n');
});

test('source drift during scratch checks preserves owner changes without any partial delta', async () => {
  const gate = await mkdtemp(join(tmpdir(), 'planr-check-gate-'));
  roots.push(gate);
  const started = join(gate, 'started');
  const release = join(gate, 'release');
  const data = await fixture({
    files: {
      'package.json': JSON.stringify({ scripts: { test: 'node check.mjs' } }),
      'check.mjs': `import {writeFile,readFile} from 'node:fs/promises';
        await writeFile(${JSON.stringify(started)},'ready');
        const deadline=Date.now()+10000;
        while(true){try{await readFile(${JSON.stringify(release)});break;}
          catch(error){if(error.code!=='ENOENT'||Date.now()>deadline)throw error;}
          await new Promise(r=>setTimeout(r,10));}`,
    },
  });
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const integration = integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: ['npm run test'],
  });
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await readFile(started);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' || Date.now() > deadline) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await writeFile(join(data.repositoryRoot, 'tracked.txt'), 'owner edit\n');
  } finally {
    await writeFile(release, 'continue');
  }
  const result = await integration;
  assert.equal(result.code, 'E_INTEGRATION_SOURCE_DRIFT');
  assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'owner edit\n');
});

test('physical permissions and unrelated source commits do not cause false drift', async () => {
  const data = await fixture();
  await chmod(join(data.repositoryRoot, 'tracked.txt'), 0o664);
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  await writeFile(join(data.repositoryRoot, 'other.txt'), 'unrelated\n');
  await git(data.repositoryRoot, 'add', 'other.txt');
  await git(data.repositoryRoot, 'commit', '-qm', 'unrelated');
  const result = await integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: [],
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal((await lstat(join(data.repositoryRoot, 'tracked.txt'))).mode & 0o777, 0o664);
});

test('parent-selected checks inherit the parent host environment without storing its credentials', async () => {
  const data = await fixture({
    files: {
      'package.json': JSON.stringify({ scripts: { test: 'node check.mjs' } }),
      'check.mjs':
        "import assert from 'node:assert/strict';assert.equal(process.env.PLANR_TEST_SECRET,'private-sentinel');assert.equal(process.env.HOME," +
        JSON.stringify(process.env.HOME) +
        ');',
    },
  });
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const old = process.env.PLANR_TEST_SECRET;
  process.env.PLANR_TEST_SECRET = 'private-sentinel';
  try {
    const result = await integrateDelegateDelta({
      custody: data.custody,
      run,
      scopePaths: ['tracked.txt'],
      checks: ['npm run test'],
    });
    assert.equal(result.status, 'completed', JSON.stringify(result));
  } finally {
    if (old === undefined) delete process.env.PLANR_TEST_SECRET;
    else process.env.PLANR_TEST_SECRET = old;
  }
});

test('apply requires the exact reviewed patch and size preflight leaves source untouched', async () => {
  const data = await fixture();
  const { runId, runDirectory } = await recordedRun(data);
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'first\n');
  await assert.rejects(
    delegateIntegrationCommand('apply', {
      runId,
      runDirectory,
      scopePaths: ['tracked.txt'],
      checks: [],
    }),
    { code: 'E_INTEGRATION_REVIEW_REQUIRED' },
  );
  await delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: ['tracked.txt'] });
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'second\n');
  await assert.rejects(
    delegateIntegrationCommand('apply', {
      runId,
      runDirectory,
      scopePaths: ['tracked.txt'],
      checks: [],
    }),
    { code: 'E_INTEGRATION_REVIEW_DRIFT' },
  );
  assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
  const result = await integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: [],
    beforeApply: () => {
      throw Object.assign(new Error('Record limit'), { code: 'E_RUN_LIMIT' });
    },
  });
  assert.equal(result.code, 'E_RUN_LIMIT');
  assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

test('rollback compares only helper-written paths and preserves a concurrent edit on one of them', async () => {
  const data = await fixture();
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const result = await integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['tracked.txt'],
    checks: [],
    onProgress: async (_path, phase) => {
      if (phase !== 'after') return;
      await writeFile(join(data.repositoryRoot, 'tracked.txt'), 'new owner edit\n');
      throw Object.assign(new Error('Storage failure'), { code: 'E_IO' });
    },
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.rollbackErrors, [
    { path: 'tracked.txt', code: 'E_INTEGRATION_ROLLBACK_CONFLICT' },
  ]);
  assert.equal(
    await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'),
    'new owner edit\n',
  );
});

test('killed apply is discoverable and explicit recovery rolls back only journaled writes', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 36 }, (_, index) => [
      `batch/file-${String(index).padStart(2, '0')}.txt`,
      'base\n',
    ]),
  );
  const data = await fixture({ files });
  for (const path of Object.keys(files))
    await writeFile(join(data.custody.worktreePath, path), 'delegate\n');
  const { runId, runDirectory } = await recordedRun(data);
  await delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: ['batch'] });
  const record = await readRunRecord(runId, { directory: runDirectory });
  const childScript = join(data.base, 'interrupt.mjs');
  await writeFile(
    childScript,
    `import {watch} from 'node:fs';import {readFile} from 'node:fs/promises';
    import {delegateIntegrationCommand} from ${JSON.stringify(new URL('../../skills/planr-delegate/scripts/integrate.mjs', import.meta.url).href)};
    const file=${JSON.stringify(join(record.runPath, 'record.json'))};
    let reading=false;
    const watcher=setInterval(async()=>{if(reading)return;reading=true;try{
      const record=JSON.parse(await readFile(file,'utf8'));
      if(record.integration?.status==='applying' && record.integration.cursor>=2)process.kill(process.pid,'SIGKILL');
    }finally{reading=false;}},2);
    console.log(JSON.stringify(await delegateIntegrationCommand('apply',${JSON.stringify({ runId, runDirectory, scopePaths: ['batch'], checks: [] })})));clearInterval(watcher);`,
  );
  const child = spawn(process.execPath, [childScript], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => (errors += chunk));
  child.stdout.on('data', (chunk) => (errors += chunk));
  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(exit.signal, 'SIGKILL', errors);
  const interrupted = await readRunRecord(runId, { directory: runDirectory });
  assert.equal(interrupted.integration.status, 'applying');
  const status = await delegateRunStatus({ runId, runDirectory });
  assert.equal(status.phase, 'integration-recovery', JSON.stringify(status));
  await assert.rejects(
    delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: ['batch'] }),
    { code: 'E_RUN_INTEGRATION_RECOVERY' },
  );
  await assert.rejects(
    closeRunRecord(runId, { directory: runDirectory, disposition: 'abandoned' }),
    { code: 'E_RUN_INTEGRATION_RECOVERY' },
  );
  await writeFile(join(data.repositoryRoot, 'NOTES.md'), 'preserved owner note\n');
  const recovered = await delegateIntegrationCommand('recover', { runId, runDirectory });
  assert.equal(recovered.recovered, 'rolled-back', JSON.stringify(recovered));
  for (const path of Object.keys(files))
    assert.equal(await readFile(join(data.repositoryRoot, path), 'utf8'), 'base\n', path);
  assert.equal(
    await readFile(join(data.repositoryRoot, 'NOTES.md'), 'utf8'),
    'preserved owner note\n',
  );
});

test('real run-record preflight rejects oversized final metadata before writing source', async () => {
  const data = await fixture();
  await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
  const { runId, runDirectory } = await recordedRun(data);
  await delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: ['tracked.txt'] });
  const record = await readRunRecord(runId, { directory: runDirectory });
  const padding = 'x'.repeat(64 * 1024 - Buffer.byteLength(JSON.stringify(record)) - 100);
  await updateRunRecord(runId, { padding }, { directory: runDirectory });
  const result = await delegateIntegrationCommand('apply', {
    runId,
    runDirectory,
    scopePaths: ['tracked.txt'],
    checks: [],
  });
  assert.equal(result.code, 'E_RUN_LIMIT', JSON.stringify(result));
  assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
});

async function compiledFixture() {
  const data = await fixture({
    files: {
      '.gitignore': 'node_modules/\ndist/\n',
      'packages/library/package.json': JSON.stringify({
        scripts: { build: 'node build.mjs' },
      }),
      'packages/library/value.txt': 'base',
      'packages/library/build.mjs':
        "import{mkdirSync,readFileSync,writeFileSync}from'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/value.txt',readFileSync('value.txt'));",
      'packages/client/package.json': JSON.stringify({
        scripts: { test: 'node check.mjs' },
      }),
      'packages/client/check.mjs':
        "import{readFileSync}from'node:fs';const v=readFileSync('node_modules/library/dist/value.txt','utf8');if(process.argv[2]!=='tests/focused.test.mjs'||v!==readFileSync('../library/value.txt','utf8'))process.exit(2);if(process.argv.includes('tests/regression.test.mjs')&&v==='candidate')process.exit(3);",
    },
  });
  await mkdir(join(data.repositoryRoot, 'packages/client/node_modules'), {
    recursive: true,
  });
  await symlink('../../library', join(data.repositoryRoot, 'packages/client/node_modules/library'));
  await writeFile(join(data.custody.worktreePath, 'packages/library/value.txt'), 'candidate');
  return data;
}
const buildSteps = [{ cwd: 'packages/library', command: 'npm run build' }];
const focusedCheck = [
  {
    cwd: 'packages/client',
    command: 'npm run test',
    args: ['--', 'tests/focused.test.mjs'],
  },
];

test('scratch prepares workspace builds and package-local dependencies before a focused check', async () => {
  const data = await compiledFixture();
  const { runId, runDirectory } = await recordedRun(data);
  await delegateIntegrationCommand('review', {
    runId,
    runDirectory,
    scopePaths: ['packages/library/value.txt'],
  });
  const result = await delegateIntegrationCommand('apply', {
    runId,
    runDirectory,
    scopePaths: ['packages/library/value.txt'],
    preparation: buildSteps,
    checks: focusedCheck,
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.verification.preparation[0].status, 'passed');
  assert.equal(result.checks[0].exitCode, 0);
  assert.ok(result.checks[0].durationMs >= 0);
  assert.ok(Date.parse(result.checks[0].finishedAt) >= Date.parse(result.checks[0].startedAt));
  assert.equal(
    await readFile(join(data.repositoryRoot, 'packages/library/value.txt'), 'utf8'),
    'candidate',
  );
  await assert.rejects(lstat(join(data.repositoryRoot, 'packages/library/dist')), {
    code: 'ENOENT',
  });
  const evidence = JSON.parse(await readFile(result.verification.evidencePath, 'utf8'));
  assert.equal((await lstat(result.verification.evidencePath)).mode & 0o077, 0);
  assert.equal(evidence.status, 'completed');
  assert.deepEqual(
    evidence.phases.map(({ phase }) => phase),
    ['scratch-preparation', 'build-preparation', 'checks', 'source-write'],
  );
  for (const phase of evidence.phases) assert.ok(phase.durationMs >= 0);
  const status = await delegateRunStatus({ runId, runDirectory });
  assert.deepEqual(status.verification, evidence);
  assert.match(status.report.Checks, /passed, [0-9.]+s/u);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await delegateRunStatus({ runId, runDirectory })).elapsedMs, status.elapsedMs);
  // An accepted integration remains authoritative if a process ended before final timing persisted.
  await updateRunRecord(
    runId,
    {
      verification: {
        ...evidence,
        status: 'running',
        phase: 'source-write',
        process: { pid: 2147483647, started: 'exited', source: 'ps' },
      },
    },
    { directory: runDirectory },
  );
  const recovered = await delegateRunStatus({ runId, runDirectory });
  assert.equal(recovered.phase, 'integrated');
  assert.equal(recovered.nextAction, status.nextAction);
});

test('fresh rebuilt baseline identifies regressions and keeps failed evidence after a successful retry', async () => {
  const data = await compiledFixture();
  const { runId, runDirectory } = await recordedRun(data);
  const input = {
    runId,
    runDirectory,
    scopePaths: ['packages/library/value.txt'],
    preparation: buildSteps,
  };
  await delegateIntegrationCommand('review', input);
  const failed = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        cwd: 'packages/client',
        command: 'npm run test',
        args: ['--', 'tests/focused.test.mjs', 'tests/regression.test.mjs'],
      },
    ],
  });
  assert.equal(failed.code, 'E_INTEGRATION_CHECKS', JSON.stringify(failed));
  assert.equal(failed.checks[0].classification, 'regression');
  assert.equal(failed.checks[0].baseline.exitCode, 0);
  assert.deepEqual(
    failed.verification.preparation.map(({ target }) => target),
    ['candidate', 'baseline'],
  );
  const priorBytes = await readFile(failed.verification.evidencePath);
  assert.equal(
    await readFile(join(data.repositoryRoot, 'packages/library/value.txt'), 'utf8'),
    'base',
  );
  await assert.rejects(delegateIntegrationCommand('apply', { ...input, checks: [] }), {
    code: 'E_INTEGRATION_CHECKS_REQUIRED',
  });
  await writeFile(join(data.custody.worktreePath, 'packages/library/value.txt'), 'corrected');
  await delegateIntegrationCommand('review', input);
  const accepted = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        cwd: 'packages/client',
        command: 'npm run test',
        args: ['--', 'tests/focused.test.mjs', 'tests/regression.test.mjs'],
      },
    ],
  });
  assert.equal(accepted.status, 'completed', JSON.stringify(accepted));
  assert.equal(accepted.verification.attempt, 2);
  assert.notEqual(accepted.verification.evidencePath, failed.verification.evidencePath);
  assert.deepEqual(await readFile(failed.verification.evidencePath), priorBytes);
});

test('failed or mutating preparation blocks before checks and source writes', async () => {
  for (const script of [
    'process.exit(4)',
    "require('fs').writeFileSync('tracked.txt','setup mutation')",
  ]) {
    const data = await fixture({
      files: {
        'package.json': JSON.stringify({
          scripts: { build: `node -e "${script}"`, test: 'node -e ""' },
        }),
      },
    });
    await writeFile(join(data.custody.worktreePath, 'tracked.txt'), 'delegate\n');
    const { runId, runDirectory } = await recordedRun(data);
    const input = {
      runId,
      runDirectory,
      scopePaths: ['tracked.txt'],
      preparation: ['npm run build'],
      checks: ['npm run test'],
    };
    await delegateIntegrationCommand('review', input);
    const result = await delegateIntegrationCommand('apply', input);
    assert.equal(result.status, 'blocked');
    assert.ok(
      ['E_INTEGRATION_PREPARATION', 'E_INTEGRATION_PREPARATION_SIDE_EFFECT'].includes(result.code),
      JSON.stringify(result),
    );
    assert.deepEqual(result.checks, []);
    assert.equal(result.verification.status, 'blocked');
    assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
  }
});

test('focused selection rejects flags, traversal and shell fragments before executing', async () => {
  const data = await compiledFixture();
  for (const args of [
    ['--', '../outside.test.mjs'],
    ['--', '--config=secret'],
    ['--', 'test;touch'],
    ['--', '/tmp/outside.test.mjs'],
  ]) {
    await assert.rejects(
      integrateDelegateDelta({
        custody: data.custody,
        run,
        scopePaths: ['packages/library/value.txt'],
        checks: [{ cwd: 'packages/client', command: 'npm run test', args }],
      }),
      { code: 'E_INTEGRATION_CHECK_SELECTION' },
    );
  }
});

test('Node check selectors cannot run absolute files outside scratch', async () => {
  const data = await compiledFixture();
  for (const checks of [
    ['node --test /tmp/outside.test.mjs'],
    [{ command: 'node', args: ['--test', '/tmp/outside.test.mjs'] }],
  ]) {
    await assert.rejects(
      integrateDelegateDelta({
        custody: data.custody,
        run,
        scopePaths: ['packages/library/value.txt'],
        checks,
      }),
      { code: 'E_INTEGRATION_CHECK_SELECTION' },
    );
    assert.equal(await readFile(join(data.repositoryRoot, 'tracked.txt'), 'utf8'), 'base\n');
  }
});

test('absolute dependency links cannot escape into the owner checkout from scratch', async () => {
  const data = await compiledFixture();
  await rm(join(data.repositoryRoot, 'packages/client/node_modules/library'));
  await symlink(
    join(data.repositoryRoot, 'packages/library'),
    join(data.repositoryRoot, 'packages/client/node_modules/library'),
  );
  const result = await integrateDelegateDelta({
    custody: data.custody,
    run,
    scopePaths: ['packages/library/value.txt'],
    preparation: buildSteps,
    checks: focusedCheck,
  });
  assert.equal(result.code, 'E_INTEGRATION_DEPENDENCY_LINK', JSON.stringify(result));
  assert.equal(
    await readFile(join(data.repositoryRoot, 'packages/library/value.txt'), 'utf8'),
    'base',
  );
});

test('interrupted verification is visible without claiming a completed check', async () => {
  const data = await fixture();
  const { runId, runDirectory } = await recordedRun(data);
  await updateRunRecord(
    runId,
    {
      verification: {
        status: 'running',
        phase: 'checks',
        process: { pid: 2147483647, started: 'exited', source: 'ps' },
        checks: [],
      },
    },
    { directory: runDirectory },
  );
  const status = await delegateRunStatus({ runId, runDirectory });
  assert.equal(status.phase, 'verification-interrupted');
  assert.equal(status.verificationProcessState, 'exited');
  assert.match(status.nextAction, /ended before its final evidence/u);
});

test('stale checkout recovery serializes competing applies despite slow identity inspection', async () => {
  const base = await mkdtemp(join(tmpdir(), 'delegate-checkout-lock-'));
  roots.push(base);
  const root = join(base, 'source');
  const lock = join(
    tmpdir(),
    'planr-integration-lock-' + createHash('sha256').update(root).digest('hex'),
  );
  await mkdir(lock, { mode: 0o700 });
  await writeFile(
    join(lock, 'owner.json'),
    JSON.stringify({ ...(await processIdentity()), started: 'stale' }),
  );
  const marker = join(base, 'inspection-started');
  const script = join(base, 'contender.mjs');
  await writeFile(
    script,
    'import {checkoutLock} from ' +
      JSON.stringify(
        new URL('../../skills/planr-delegate/scripts/integration-transaction.mjs', import.meta.url)
          .href,
      ) +
      '; import {writeFileSync} from "node:fs"; const originalKill = process.kill.bind(process);' +
      // Delay the native liveness probe inside this child, independent of /proc versus ps.
      'process.kill = (pid, signal) => { if (pid === ' +
      process.pid +
      ' && process.env.DELEGATE_TEST_SLOW_IDENTITY === "1") { writeFileSync(' +
      JSON.stringify(marker) +
      ', "started"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } return originalKill(pid, signal); };' +
      ' try { const release = await checkoutLock(' +
      JSON.stringify(root) +
      '); console.log("acquired"); await new Promise(r => process.stdin.once("data", r)); await release(); } catch (error) { console.log(error.code); }',
  );
  const children = [];
  function launch(slow) {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        DELEGATE_TEST_SLOW_IDENTITY: slow ? '1' : '0',
      },
    });
    children.push(child);
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    const ready = new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('\n')) resolve(output.trim());
      });
      child.stderr.on('data', (chunk) => reject(new Error(String(chunk))));
      child.once('error', reject);
    });
    return { ready, exit };
  }
  try {
    const slow = launch(true);
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await lstat(marker);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      assert.ok(Date.now() < deadline, 'stale owner inspection started');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const fast = launch(false);
    const outcomes = await Promise.all([slow.ready, fast.ready]);
    assert.deepEqual(outcomes.sort(), ['E_INTEGRATION_LOCKED', 'acquired']);
    for (const child of children) child.stdin.end('release');
    assert.deepEqual(await Promise.all([slow.exit, fast.exit]), [0, 0]);
    const release = await checkoutLock(root);
    await release();
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await rm(lock, { recursive: true, force: true });
    await rm(lock + '-transitions', { recursive: true, force: true });
  }
});

test('size preflight includes verification evidence added during apply before any source journal', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [
      'batch/' + String(i).padStart(2, '0') + '-' + 'name'.repeat(24) + '.txt',
      'base\n',
    ]),
  );
  const data = await fixture({ files });
  for (const path of Object.keys(files))
    await writeFile(join(data.custody.worktreePath, path), 'delegate\n');
  const { runId, runDirectory } = await recordedRun(data);
  await delegateIntegrationCommand('review', { runId, runDirectory, scopePaths: ['batch'] });
  const record = await readRunRecord(runId, { directory: runDirectory });
  const review = await reviewDelegateDelta({ custody: data.custody, run, scopePaths: ['batch'] });
  const integration = {
    status: 'applied',
    delegatePaths: review.changedPaths,
    generatedPaths: [],
    changedPaths: review.changedPaths,
    states: Object.fromEntries(
      review.changes.map(({ path, after }) => [path, compactIntegrationState(after)]),
    ),
    checks: [],
    generators: [],
    preparation: [],
  };
  const final = {
    ...record,
    integration,
    status: 'closed',
    disposition: 'integrated',
    closedAt: new Date().toISOString(),
  };
  const padding = 'x'.repeat(64 * 1024 - Buffer.byteLength(JSON.stringify(final)) - 512);
  await updateRunRecord(runId, { padding }, { directory: runDirectory });
  const result = await delegateIntegrationCommand('apply', {
    runId,
    runDirectory,
    scopePaths: ['batch'],
    checks: [],
  });
  assert.equal(result.code, 'E_RUN_LIMIT');
  await assert.rejects(lstat(join(record.runPath, 'integration-journal.json')), { code: 'ENOENT' });
  for (const path of Object.keys(files))
    assert.equal(await readFile(join(data.repositoryRoot, path), 'utf8'), 'base\n');
});
