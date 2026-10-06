import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { delegateIntegrationCommand } from '../../skills/planr-delegate/scripts/integrate.mjs';
import {
  enrollProfile,
  loadProfile,
  PROFILE_LIFETIME_MS,
} from '../../skills/planr-delegate/scripts/profiles.mjs';
import {
  closeRunRecord,
  createRunRecord,
  pruneClosedRunRecords,
  readRunRecord,
  updateRunRecord,
} from '../../skills/planr-delegate/scripts/run-record.mjs';
import {
  delegateRunnerCommand,
  delegateRunStatus,
  dispatchDelegateRun,
  prepareDelegateRun,
  probeDelegateHost,
  readDelegateCustody,
  recoverDelegateRun,
  resumeDelegateRun,
  validateDelegateCapsule,
  waitDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'planr-runner-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  const runDirectory = join(base, 'private-runs');
  const profileDirectory = join(base, 'profiles');
  await mkdir(root);
  await mkdir(runDirectory, { mode: 0o700 });
  await mkdir(profileDirectory, { mode: 0o700 });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  await writeFile(join(root, 'source.txt'), 'starting text\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  return { base, root, runDirectory, profileDirectory };
}

async function put(root, path, content) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}

async function addExactTask(root) {
  const base = '.planr/specs/SPEC-016-delegate';
  await put(
    root,
    `${base}/tasks/T-071-runner.md`,
    '---\nid: "T-071"\nstoryId: "US-062"\nspecId: "SPEC-016"\n---\n# Task\nUpdate source.txt.\n',
  );
  await put(
    root,
    `${base}/stories/US-062-runner.md`,
    '---\nid: "US-062"\nspecId: "SPEC-016"\n---\nRead US-062-gherkin.feature.\n',
  );
  await put(root, `${base}/stories/US-062-gherkin.feature`, 'Feature: Exact session\n');
  await put(root, `${base}/SPEC-016-delegate.md`, '---\nid: "SPEC-016"\n---\n# Spec\n');
}

async function fakeProfile({ base, profileDirectory, origin = 'http://127.0.0.1:11434' }) {
  const executable = join(base, 'fake-delegate.mjs');
  const logPath = join(base, 'adapter-calls.jsonl');
  await writeFile(
    executable,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      'const operation = process.argv.at(-1);',
      "const protocol = 'openplanr.delegate.adapter';",
      'const version = 1;',
      "if (operation === '--planr-probe') {",
      "  const changed = process.env.FAKE_DESTINATION === 'changed' || (process.env.FAKE_DESTINATION === 'worktree' && process.cwd().includes('planr-delegate-'));",
      `  console.log(JSON.stringify({ protocol, version, capabilities: { implementation: true, structuredResult: true, exactResume: true }, destination: changed ? { class: 'external', origin: 'https://changed.example' } : { class: 'local', origin: ${JSON.stringify(origin)} } }));`,
      '  process.exit(0);',
      '}',
      "let input = '';",
      'for await (const chunk of process.stdin) input += chunk;',
      'const packet = JSON.parse(input);',
      "const prompt = packet.prompt ?? '';",
      "const promptContract = { jsonOnly: prompt.includes('exactly one valid JSON object') && prompt.includes('no Markdown fence'), status: prompt.includes('\"completed\", \"blocked\", or \"question\"'), summary: prompt.includes('\"summary\"'), question: prompt.includes('\"question\"'), checks: prompt.includes('\"checks\"'), issues: prompt.includes('\"issues\"'), adapterSession: prompt.includes('Do not include \"sessionId\"'), noCapsuleBytes: !prompt.includes('SENSITIVE_SOURCE_MARKER'), noBackendSession: !packet.sessionId || !prompt.includes(packet.sessionId) };",
      "appendFileSync(process.env.FAKE_LOG_PATH, JSON.stringify({ operation, sessionId: packet.sessionId ?? null, cwd: packet.cwd, capsulePath: packet.capsulePath ?? null, promptContract }) + '\\n');",
      "if (process.env.FAKE_MODE === 'exit') { process.stderr.write('sk-' + 'xY'.repeat(14)); process.exit(7); }",
      "if (process.env.FAKE_MODE === 'partial') { process.stdout.write('{\"status\":'); process.exit(0); }",
      "if (process.env.FAKE_MODE === 'edit-capsule') appendFileSync(packet.capsulePath, 'tampered');",
      "if (process.env.FAKE_MODE === 'edit-worktree') writeFileSync(packet.cwd + '/source.txt', operation === '--planr-resume' ? 'corrected by generic adapter\\n' : 'edited by generic adapter\\n');",
      "if (process.env.FAKE_MODE === 'hang') await new Promise((resolve) => setTimeout(resolve, 3000));",
      "const sessionId = process.env.FAKE_MODE === 'wrong-session' && operation === '--planr-resume' ? 'session-other' : packet.sessionId ?? process.env.FAKE_SESSION ?? 'session-default';",
      "const status = process.env.FAKE_MODE === 'question' && operation === '--planr-run' ? 'question' : process.env.FAKE_MODE === 'blocked' ? 'blocked' : 'completed';",
      "console.log(JSON.stringify({ protocol, version, status, sessionId, summary: status === 'question' ? 'Need a choice' : status === 'blocked' ? 'Cannot compile the selected source' : 'Done', ...(status === 'question' ? { question: { text: 'Which approach?', options: ['A', 'B'] } } : {}) }));",
    ].join('\n'),
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  await enrollProfile(
    {
      name: 'fake',
      kind: 'generic',
      executable,
      argv: [],
      allowedEnv: ['FAKE_LOG_PATH', 'FAKE_MODE', 'FAKE_SESSION', 'FAKE_DESTINATION'],
      workingDirectory: 'worktree',
      destination: { class: 'local', origin },
    },
    { directory: profileDirectory },
  );
  return { logPath, executable };
}

function environment(logPath, mode = 'completed', session = 'session-default') {
  return { ...process.env, FAKE_LOG_PATH: logPath, FAKE_MODE: mode, FAKE_SESSION: session };
}

async function calls(logPath) {
  try {
    return (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function modelServer(t) {
  let loaded = false;
  let contextLength = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/models')
      return new Response(JSON.stringify({ data: [{ id: 'local-test' }] }));
    if (path === '/api/v1/models')
      return new Response(
        JSON.stringify({
          models: [
            {
              key: 'local-test',
              loaded_instances: loaded
                ? [
                    {
                      id: 'local-test',
                      ...(contextLength ? { config: { context_length: contextLength } } : {}),
                    },
                  ]
                : [],
            },
          ],
        }),
      );
    return new Response('{}', { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return {
    origin: 'http://127.0.0.1:11434',
    load() {
      loaded = true;
    },
    setContextLength(value) {
      contextLength = value;
    },
  };
}

test('first-use preview is read-only; enrollment rechecks destination and model readiness', async (t) => {
  const { base, root, runDirectory, profileDirectory } = await fixture(t);
  const backend = await modelServer(t);
  const { executable } = await fakeProfile({ base, profileDirectory, origin: backend.origin });
  await delegateRunnerCommand('profile-remove', { name: 'fake', profileDirectory });
  const profile = {
    name: 'fake',
    kind: 'generic',
    executable,
    argv: ['--model', 'local-test'],
    allowedEnv: [],
    workingDirectory: 'worktree',
  };
  const input = { repositoryRoot: root, profileDirectory, profile };
  const preview = await delegateRunnerCommand('profile-preview', input);
  assert.deepEqual(preview.destination, { class: 'local', origin: backend.origin });
  assert.deepEqual(preview.backend.visibleModels, ['local-test']);
  assert.equal(preview.readiness.state, 'model-not-loaded');
  await assert.rejects(
    delegateRunnerCommand('profile-enroll', {
      ...input,
      profile: { ...profile, argv: [] },
      expectedDestination: preview.destination,
    }),
    { code: 'E_PROFILE_MODEL_CHOICE' },
  );
  assert.ok(!JSON.stringify(preview).includes(executable));
  assert.deepEqual(await readdir(profileDirectory), []);
  assert.deepEqual(await readdir(runDirectory), []);
  await assert.rejects(
    delegateRunnerCommand('profile-enroll', {
      ...input,
      expectedDestination: { class: 'local', origin: 'http://127.0.0.1:12345' },
    }),
    { code: 'E_DESTINATION_CHANGED' },
  );
  assert.deepEqual(await readdir(profileDirectory), []);
  const unloadedEnrollment = await delegateRunnerCommand('profile-enroll', {
    ...input,
    expectedDestination: preview.destination,
  });
  assert.equal(unloadedEnrollment.readiness.state, 'model-not-loaded');
  await assert.rejects(
    prepareDelegateRun({
      repositoryRoot: root,
      request: 'Update only source.txt for the original request.',
      selectedFiles: ['source.txt'],
      scopePaths: ['source.txt'],
      profile: 'fake',
      profileDirectory,
      runDirectory,
    }),
    { code: 'E_DELEGATE_MODEL_NOT_LOADED' },
  );
  assert.deepEqual(await readdir(runDirectory), []);
  backend.load();
  const enrolled = await delegateRunnerCommand('profile-enroll', {
    ...input,
    expectedDestination: preview.destination,
  });
  assert.equal(enrolled.readiness.state, 'ready');
  const all = await delegateRunnerCommand('probe', { repositoryRoot: root, profileDirectory });
  assert.equal(all.profiles[0].readiness.state, 'ready');
  assert.equal(all.profiles[0].selectedModel, 'local-test');
  await delegateRunnerCommand('profile-enroll', {
    repositoryRoot: root,
    profileDirectory,
    profile: { ...profile, name: 'second' },
    expectedDestination: preview.destination,
  });
  const several = await delegateRunnerCommand('probe', { repositoryRoot: root, profileDirectory });
  assert.deepEqual(
    several.profiles.map(({ name, readiness }) => [name, readiness.state]),
    [
      ['fake', 'ready'],
      ['second', 'ready'],
    ],
  );
  assert.deepEqual(await readdir(runDirectory), []);
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Update only source.txt for the original request.',
    selectedFiles: ['source.txt'],
    scopePaths: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
  });
  assert.equal(prepared.preview.mode, 'direct-request');
  assert.deepEqual(prepared.preview.integrationScopePaths, ['source.txt']);
  assert.ok(prepared.preview.inventory.some(({ path }) => path === 'source.txt'));
  assert.deepEqual(
    await delegateRunnerCommand('profile-remove', { name: 'fake', profileDirectory }),
    {
      name: 'fake',
      removed: true,
    },
  );
});

test('expired profile can be previewed and renewed under the same name', async (t) => {
  const { base, root, profileDirectory } = await fixture(t);
  const backend = await modelServer(t);
  const { executable } = await fakeProfile({ base, profileDirectory, origin: backend.origin });
  await enrollProfile(
    {
      name: 'fake',
      kind: 'generic',
      executable,
      argv: ['--model', 'local-test'],
      allowedEnv: [],
      workingDirectory: 'worktree',
      destination: { class: 'local', origin: backend.origin },
    },
    { directory: profileDirectory, now: Date.now() - PROFILE_LIFETIME_MS - 1000 },
  );
  const before = await delegateRunnerCommand('probe', { repositoryRoot: root, profileDirectory });
  assert.equal(before.profiles[0].readiness.state, 'expired');
  const preview = await delegateRunnerCommand('profile-preview', {
    repositoryRoot: root,
    profileDirectory,
    profile: 'fake',
  });
  assert.equal(preview.enrollment.status, 'expired');
  backend.load();
  const renewed = await delegateRunnerCommand('profile-enroll', {
    repositoryRoot: root,
    profileDirectory,
    profile: 'fake',
    expectedDestination: preview.destination,
  });
  assert.ok(renewed.expiresAt > Date.now());
  const after = await delegateRunnerCommand('probe', { repositoryRoot: root, profileDirectory });
  assert.equal(after.profiles[0].readiness.state, 'ready');
});

test('installed helper command accepts bounded JSON stdin and reports the preview without running the adapter', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const runnerPath = fileURLToPath(
    new URL('../../skills/planr-delegate/scripts/runner.mjs', import.meta.url),
  );
  const probe = JSON.parse(
    execFileSync(process.execPath, [runnerPath, 'probe'], { input: '', encoding: 'utf8' }),
  );
  assert.equal(probe.localExecutable, true);
  await assert.rejects(
    delegateRunnerCommand('probe', { hostCapabilities: { localExecution: false } }),
    (error) => error.code === 'E_DELEGATE_HOST_UNSUPPORTED',
  );
  const output = execFileSync(process.execPath, [runnerPath, 'prepare'], {
    input: JSON.stringify({
      repositoryRoot: root,
      request: 'Change source.txt.',
      selectedFiles: ['source.txt'],
      scopePaths: ['source.txt'],
      profile: 'fake',
      profileDirectory,
      runDirectory: join(base, '.openplanr', 'delegate', 'runs'),
    }),
    env: { ...environment(logPath), HOME: base },
    encoding: 'utf8',
  });
  const preview = JSON.parse(output);
  assert.ok(preview.runId);
  assert.equal(preview.preview.profile, 'fake');
  assert.equal(preview.presentation.phase, 'preview');
  assert.deepEqual(preview.presentation.destination, preview.preview.destination);
  assert.deepEqual(preview.presentation.selectedPaths, preview.preview.selectedPaths);
  assert.deepEqual(preview.presentation.integrationScopePaths, ['source.txt']);
  assert.deepEqual(preview.presentation.inventory, preview.preview.inventory);
  assert.deepEqual(await calls(logPath), []);
  await assert.rejects(
    delegateRunnerCommand('prepare', {
      runDirectory,
      repositoryRoot: root,
      scopePaths: ['source.txt'],
    }),
    (error) => error.code === 'E_DELEGATE_PRIVATE',
  );
  await assert.rejects(delegateRunnerCommand('prepare', { repositoryRoot: root }), {
    code: 'E_DELEGATE_SCOPE',
  });
});

test('prepared helper survives projection replacement and detects changes to its private copy', async (t) => {
  const { root, base, profileDirectory } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const source = fileURLToPath(new URL('../../skills/planr-delegate/scripts/', import.meta.url));
  const projection = join(base, 'projection');
  await cp(source, projection, { recursive: true });
  const runDirectory = join(base, '.openplanr', 'delegate', 'runs');
  const environmentVariables = { ...environment(logPath), HOME: base };
  const prepared = JSON.parse(
    execFileSync(process.execPath, [join(projection, 'runner.mjs'), 'prepare'], {
      input: JSON.stringify({
        repositoryRoot: root,
        request: 'Inspect source.txt.',
        selectedFiles: ['source.txt'],
        scopePaths: ['source.txt'],
        profile: 'fake',
        profileDirectory,
        runDirectory,
      }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(prepared.preview.helper.schemaVersion, '1.0.0');
  await rm(projection, { recursive: true }); // A generate/rebuild removes the active projection.
  const status = JSON.parse(
    execFileSync(process.execPath, [prepared.preview.helper.runnerPath, 'status'], {
      input: JSON.stringify({ runId: prepared.runId, runDirectory }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(status.status, 'prepared');
  assert.equal(status.helper.digest, prepared.preview.helper.digest);
  const handoff = JSON.parse(
    execFileSync(process.execPath, [prepared.preview.helper.runnerPath, 'dispatch'], {
      input: JSON.stringify({ runId: prepared.runId, runDirectory, profileDirectory }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(handoff.status, 'completed');
  await writeFile(join(status.worktreePath, 'source.txt'), 'implemented by delegate\n');
  const review = JSON.parse(
    execFileSync(process.execPath, [prepared.preview.helper.integrationPath, 'review'], {
      input: JSON.stringify({ runId: prepared.runId, runDirectory, scopePaths: ['source.txt'] }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(review.ready, true);
  assert.deepEqual(review.changedPaths, ['source.txt']);
  const applied = JSON.parse(
    execFileSync(process.execPath, [prepared.preview.helper.integrationPath, 'apply'], {
      input: JSON.stringify({
        runId: prepared.runId,
        runDirectory,
        scopePaths: ['source.txt'],
        checks: [],
      }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(applied.status, 'completed');
  assert.equal(await readFile(join(root, 'source.txt'), 'utf8'), 'implemented by delegate\n');
  const finished = JSON.parse(
    execFileSync(process.execPath, [prepared.preview.helper.runnerPath, 'status'], {
      input: JSON.stringify({ runId: prepared.runId, runDirectory }),
      env: environmentVariables,
      encoding: 'utf8',
    }),
  );
  assert.equal(finished.phase, 'integrated');
  assert.deepEqual(finished.report, applied.report);
  await writeFile(join(prepared.preview.helper.directory, 'context.mjs'), 'tampered\n');
  await assert.rejects(delegateRunnerCommand('status', { runId: prepared.runId, runDirectory }), {
    code: 'E_DELEGATE_HELPER_DRIFT',
  });
});

test('tool-capable generic adapter edits, resumes its exact session, and integrates observed changes', async (t) => {
  const { root, base, runDirectory, profileDirectory } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const env = environment(logPath, 'edit-worktree', 'generic-session-1');
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Update source.txt in the disposable checkout.',
    selectedFiles: ['source.txt'],
    scopePaths: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env,
  });
  const first = await dispatchDelegateRun({ runId: prepared.runId, runDirectory, env });
  assert.equal(first.status, 'completed');
  assert.equal(first.record.backendSessionId, 'generic-session-1');
  assert.equal(
    await readFile(join(prepared.preview.worktreePath, 'source.txt'), 'utf8'),
    'edited by generic adapter\n',
  );
  const corrected = await resumeDelegateRun({
    runId: prepared.runId,
    runDirectory,
    correction: 'Review correction: update the text once more.',
    env,
  });
  assert.equal(corrected.status, 'completed');
  assert.equal(corrected.record.backendSessionId, 'generic-session-1');
  assert.equal(
    await readFile(join(prepared.preview.worktreePath, 'source.txt'), 'utf8'),
    'corrected by generic adapter\n',
  );
  const review = await delegateIntegrationCommand('review', {
    runId: prepared.runId,
    runDirectory,
    scopePaths: ['source.txt'],
  });
  assert.equal(review.ready, true);
  assert.deepEqual(review.changedPaths, ['source.txt']);
  const applied = await delegateIntegrationCommand('apply', {
    runId: prepared.runId,
    runDirectory,
    scopePaths: ['source.txt'],
    checks: [],
  });
  assert.equal(applied.status, 'completed');
  assert.equal(await readFile(join(root, 'source.txt'), 'utf8'), 'corrected by generic adapter\n');
  assert.deepEqual(
    (await delegateRunStatus({ runId: prepared.runId, runDirectory })).report,
    applied.report,
  );
  assert.deepEqual(
    (await calls(logPath)).map(({ operation, sessionId }) => [operation, sessionId]),
    [
      ['--planr-run', null],
      ['--planr-resume', 'generic-session-1'],
    ],
  );
});

test('local context capacity is disclosed, rechecked, and blocks before a worktree exists', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const backend = await modelServer(t);
  backend.load();
  backend.setContextLength(262_144);
  await fakeProfile({ base, profileDirectory, origin: backend.origin });
  const profile = JSON.parse(await readFile(join(profileDirectory, 'fake.json'), 'utf8'));
  await enrollProfile(
    { ...profile, argv: ['--model', 'local-test'] },
    { directory: profileDirectory },
  );
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Update source.txt.',
    selectedFiles: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
  });
  assert.equal(prepared.record.contextCapacity.state, 'within-conservative-bound');
  assert.equal(prepared.record.contextCapacity.modelContextTokens, 262_144);
  assert.deepEqual(prepared.preview.contextCapacity, prepared.record.contextCapacity);
  assert.deepEqual(
    (await delegateRunStatus({ runId: prepared.runId, runDirectory })).contextCapacity,
    prepared.record.contextCapacity,
  );
  backend.setContextLength(1_000);
  const blocked = await dispatchDelegateRun({ runId: prepared.runId, runDirectory });
  assert.equal(blocked.status, 'prepared');
  assert.equal(blocked.record.diagnostic.code, 'E_DELEGATE_CONTEXT_CAPACITY');
  await assert.rejects(
    prepareDelegateRun({
      repositoryRoot: root,
      request: 'Update source.txt.',
      selectedFiles: ['source.txt'],
      profile: 'fake',
      profileDirectory,
      runDirectory,
    }),
    { code: 'E_DELEGATE_CONTEXT_CAPACITY' },
  );
  const runIds = await readdir(runDirectory);
  const rejected = runIds.find((id) => id !== prepared.runId);
  const retained = await readRunRecord(rejected, { directory: runDirectory });
  assert.equal(retained.status, 'blocked');
  assert.equal(retained.worktreePath, null);
  assert.ok((await stat(retained.capsulePath)).isFile());
});

test('selected local profile is diagnosed before capsule preparation or dispatch', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const unavailableOrigin = 'http://127.0.0.1:9';
  await fakeProfile({ base, profileDirectory, origin: unavailableOrigin });
  const original = JSON.parse(await readFile(join(profileDirectory, 'fake.json'), 'utf8'));
  await enrollProfile(
    {
      ...original,
      argv: ['--model', 'local-test'],
    },
    { directory: profileDirectory },
  );
  const discovery = await delegateRunnerCommand('probe', { profileDirectory });
  assert.equal(discovery.profiles[0].selectedModel, 'local-test');
  const checked = await delegateRunnerCommand('probe', {
    profile: 'fake',
    repositoryRoot: root,
    profileDirectory,
  });
  assert.equal(checked.selected.destination.origin, unavailableOrigin);
  assert.equal(checked.selected.backend.status, 'unreachable');
  assert.equal(checked.selected.ready, false);
  await assert.rejects(
    prepareDelegateRun({
      repositoryRoot: root,
      request: 'Change source.txt.',
      selectedFiles: ['source.txt'],
      selectedPaths: ['source.txt'],
      profile: 'fake',
      profileDirectory,
      runDirectory,
    }),
    (error) => error.code === 'E_DELEGATE_BACKEND_UNAVAILABLE',
  );
  assert.deepEqual(await readdir(runDirectory), []);
});

test('private records are bounded, credential-free, and retained until explicit closure', async (t) => {
  const { runDirectory } = await fixture(t);
  const active = await createRunRecord(
    { runId: 'active', status: 'question' },
    { directory: runDirectory },
  );
  const closed = await createRunRecord(
    { runId: 'closed', status: 'completed' },
    { directory: runDirectory },
  );
  assert.equal(active.schemaVersion, '2.0.0');
  assert.equal((await stat(join(runDirectory, 'active', 'record.json'))).mode & 0o077, 0);
  await assert.rejects(
    updateRunRecord(
      'active',
      { lastHandoff: { text: `sk-${'xY'.repeat(14)}` } },
      { directory: runDirectory },
    ),
    (error) => error.code === 'E_RUN_CREDENTIAL',
  );
  await assert.rejects(
    closeRunRecord(closed.runId, { disposition: 'integrated', directory: runDirectory }),
    { code: 'E_RUN_NOT_INTEGRATED' },
  );
  await closeRunRecord(closed.runId, { disposition: 'abandoned', directory: runDirectory });
  const removed = await pruneClosedRunRecords({
    directory: runDirectory,
    now: Date.now() + 31 * 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(removed, ['closed']);
  assert.equal((await readRunRecord('active', { directory: runDirectory })).status, 'question');
});

test('task and direct request previews disclose inventory, one writable repository, profile and destination before dispatch', async (t) => {
  const fixtureData = await fixture(t);
  const { root, runDirectory, profileDirectory, base } = fixtureData;
  const { logPath } = await fakeProfile({ base, profileDirectory });
  await addExactTask(root);
  const common = {
    repositoryRoot: root,
    selectedFiles: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env: environment(logPath),
  };
  const task = await prepareDelegateRun({ ...common, taskSelector: 'T-071' });
  const direct = await prepareDelegateRun({ ...common, request: 'Update source.txt safely.' });
  assert.equal(task.preview.mode, 'task');
  assert.equal(direct.preview.mode, 'direct-request');
  for (const prepared of [task, direct]) {
    assert.equal(prepared.preview.writableRepository, await realpath(root));
    assert.equal(prepared.preview.profile, 'fake');
    assert.deepEqual(prepared.preview.destination, {
      class: 'local',
      origin: 'http://127.0.0.1:11434',
    });
    assert.ok(prepared.preview.inventory.some(({ path }) => path === 'source.txt'));
    assert.ok(prepared.record.capsulePath.startsWith(await realpath(runDirectory)));
    assert.ok(prepared.record.worktreePath.startsWith(await realpath(base)));
    const custody = await readDelegateCustody({ runId: prepared.runId, runDirectory });
    assert.equal(custody.worktreePath, prepared.record.worktreePath);
    assert.equal(custody.repositoryRoot, await realpath(root));
  }
  assert.ok(task.preview.inventory.some(({ path }) => path.endsWith('/T-071-runner.md')));
  assert.deepEqual(await calls(logPath), []);
  await assert.rejects(
    prepareDelegateRun({
      ...common,
      request: 'Another request',
      env: { ...environment(logPath), FAKE_DESTINATION: 'changed' },
    }),
    (error) => error.code === 'E_DESTINATION_CHANGED',
  );
  assert.deepEqual(await calls(logPath), []);
});

test('prepare discloses missing worktree dependencies before dispatch', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  await put(root, 'package.json', '{"name":"fixture","private":true}');
  await put(root, 'package-lock.json', '{"name":"fixture","lockfileVersion":3}');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'declare dependencies');
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Change source.txt.',
    selectedFiles: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(prepared.preview.worktreeDependencies.state, 'not-provisioned');
  assert.deepEqual(prepared.preview.worktreeDependencies.lockfiles, [
    { file: 'package-lock.json', manager: 'npm' },
  ]);
  assert.match(prepared.preview.worktreeDependencies.nextAction, /detached worktree/u);
  assert.deepEqual(await calls(logPath), []);
});

test('status and bounded wait expose custody and progress without capsule or model output', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Change source.txt.',
    selectedFiles: ['source.txt'],
    selectedPaths: ['source.txt'],
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env: environment(logPath),
  });
  const status = await delegateRunStatus({ runId: prepared.runId, runDirectory });
  const cliStatus = await delegateRunnerCommand('status', { runId: prepared.runId, runDirectory });
  assert.equal(status.phase, 'prepared');
  assert.ok(cliStatus.elapsedMs >= status.elapsedMs);
  assert.deepEqual(
    { ...cliStatus, elapsedMs: 0, inactivityMs: 0 },
    { ...status, elapsedMs: 0, inactivityMs: 0 },
  );
  assert.deepEqual(status.selectedPaths, ['source.txt']);
  assert.equal(status.destination.origin, 'http://127.0.0.1:11434');
  assert.ok(!JSON.stringify(status).includes('Change source.txt.'));
  await updateRunRecord(
    prepared.runId,
    {
      status: 'running',
      activePid: 999999,
      backendSessionId: null,
    },
    { directory: runDirectory },
  );
  const waiting = await waitDelegateRun({ runId: prepared.runId, runDirectory, timeoutMs: 10 });
  const cliWait = await delegateRunnerCommand('wait', {
    runId: prepared.runId,
    runDirectory,
    timeoutMs: 10,
  });
  assert.equal(waiting.status, 'running');
  assert.equal(cliWait.processState, 'exited');
  assert.equal(waiting.exactSessionResume, false);
  const recovered = await recoverDelegateRun({ runId: prepared.runId, runDirectory });
  assert.equal(recovered.status, 'blocked');
  assert.equal((await delegateRunStatus({ runId: prepared.runId, runDirectory })).phase, 'blocked');
  await assert.rejects(
    waitDelegateRun({ runId: prepared.runId, runDirectory, timeoutMs: 60_001 }),
    {
      code: 'E_DELEGATE_TIMEOUT',
    },
  );
});

test('destination drift in the detached worktree blocks preparation with retained custody and no run', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  await assert.rejects(
    prepareDelegateRun({
      repositoryRoot: root,
      request: 'Change source.txt.',
      selectedFiles: ['source.txt'],
      profile: 'fake',
      profileDirectory,
      runDirectory,
      env: { ...environment(logPath), FAKE_DESTINATION: 'worktree' },
    }),
    (error) => error.code === 'E_DESTINATION_CHANGED',
  );
  const [runId] = await readdir(runDirectory);
  const retained = await readRunRecord(runId, { directory: runDirectory });
  assert.equal(retained.status, 'blocked');
  assert.equal(retained.diagnostic.code, 'E_DELEGATE_DESTINATION_CHANGED');
  assert.ok((await stat(retained.custodyPath)).isFile());
  assert.ok((await stat(retained.worktreePath)).isDirectory());
  assert.deepEqual(await calls(logPath), []);
});

test('destination changes after preview block dispatch and exact-session continuation', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const common = { repositoryRoot: root, profile: 'fake', profileDirectory, runDirectory };
  const prepared = await prepareDelegateRun({
    ...common,
    request: 'First request',
    env: environment(logPath),
  });
  const changedEnv = { ...environment(logPath), FAKE_DESTINATION: 'changed' };
  const blockedDispatch = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory,
    env: changedEnv,
  });
  assert.equal(blockedDispatch.status, 'prepared');
  assert.equal(blockedDispatch.record.diagnostic.code, 'E_DELEGATE_DESTINATION_CHANGED');
  assert.deepEqual(await calls(logPath), []);

  const questionRun = await prepareDelegateRun({
    ...common,
    request: 'Second request',
    env: environment(logPath),
  });
  const question = await dispatchDelegateRun({
    runId: questionRun.runId,
    runDirectory,
    env: environment(logPath, 'question'),
  });
  assert.equal(question.status, 'question');
  const blockedResume = await resumeDelegateRun({
    runId: questionRun.runId,
    answer: 'Use A.',
    runDirectory,
    env: changedEnv,
  });
  assert.equal(blockedResume.status, 'question');
  assert.equal(blockedResume.record.diagnostic.code, 'E_DELEGATE_DESTINATION_CHANGED');
  assert.equal(blockedResume.record.backendSessionId, 'session-default');
  assert.deepEqual(
    (await calls(logPath)).map(({ operation }) => operation),
    ['--planr-run'],
  );
});

test('profile renewal and key ordering preserve stable identity while execution fields still gate dispatch', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const profilePath = join(profileDirectory, 'fake.json');
  const enrolled = JSON.parse(await readFile(profilePath, 'utf8'));
  const { workingDirectory, destination, ...otherFields } = enrolled;
  await writeFile(profilePath, JSON.stringify({ ...otherFields, destination, workingDirectory }));
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    profile: 'fake',
    profileDirectory,
    runDirectory,
    request: 'Implement the selected change',
    env: environment(logPath),
  });
  const current = JSON.parse(await readFile(profilePath, 'utf8'));
  await enrollProfile(
    { ...current, allowedEnv: [...current.allowedEnv].reverse() },
    { directory: profileDirectory },
  );

  const result = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(
    (await calls(logPath)).map(({ operation }) => operation),
    ['--planr-run'],
  );

  const next = await prepareDelegateRun({
    repositoryRoot: root,
    profile: 'fake',
    profileDirectory,
    runDirectory,
    request: 'A second selected change',
    env: environment(logPath),
  });
  const changed = JSON.parse(await readFile(profilePath, 'utf8'));
  changed.allowedEnv.push('SOME_NEW_ENV');
  await writeFile(profilePath, JSON.stringify(changed));
  const blocked = await dispatchDelegateRun({
    runId: next.runId,
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(blocked.status, 'prepared');
  assert.equal(blocked.record.diagnostic.code, 'E_DELEGATE_PROFILE_CHANGED');
});

test('changed private capsule blocks dispatch and a delegate mutation blocks completion without losing custody', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const common = { repositoryRoot: root, profile: 'fake', profileDirectory, runDirectory };
  const before = await prepareDelegateRun({
    ...common,
    request: 'First request',
    env: environment(logPath),
  });
  assert.deepEqual(await validateDelegateCapsule({ runId: before.runId, runDirectory }), {
    valid: true,
    code: null,
  });
  await writeFile(
    before.record.capsulePath,
    `${await readFile(before.record.capsulePath, 'utf8')}\n`,
  );
  assert.deepEqual(await validateDelegateCapsule({ runId: before.runId, runDirectory }), {
    valid: false,
    code: 'E_DELEGATE_CAPSULE_DRIFT',
  });
  const blockedBefore = await dispatchDelegateRun({
    runId: before.runId,
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(blockedBefore.status, 'prepared');
  assert.equal(blockedBefore.record.diagnostic.code, 'E_DELEGATE_CAPSULE_DRIFT');
  assert.deepEqual(await calls(logPath), []);

  const during = await prepareDelegateRun({
    ...common,
    request: 'Second request',
    env: environment(logPath),
  });
  const blockedDuring = await dispatchDelegateRun({
    runId: during.runId,
    runDirectory,
    env: environment(logPath, 'edit-capsule'),
  });
  assert.equal(blockedDuring.status, 'blocked');
  assert.equal(blockedDuring.record.diagnostic.code, 'E_DELEGATE_CAPSULE_DRIFT');
  assert.equal(blockedDuring.record.backendSessionId, 'session-default');
  assert.ok((await stat(blockedDuring.record.worktreePath)).isDirectory());
  assert.equal(await readFile(join(root, 'source.txt'), 'utf8'), 'starting text\n');
});

test('two questions retain separate exact sessions and only the selected session resumes', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const common = { repositoryRoot: root, profile: 'fake', profileDirectory, runDirectory };
  const first = await prepareDelegateRun({
    ...common,
    request: 'First request',
    env: environment(logPath, 'question', 'session-first'),
  });
  const second = await prepareDelegateRun({
    ...common,
    request: 'Second request',
    env: environment(logPath, 'question', 'session-second'),
  });
  assert.equal(
    (
      await dispatchDelegateRun({
        runId: first.runId,
        runDirectory,
        env: environment(logPath, 'question', 'session-first'),
      })
    ).status,
    'question',
  );
  assert.equal(
    (
      await dispatchDelegateRun({
        runId: second.runId,
        runDirectory,
        env: environment(logPath, 'question', 'session-second'),
      })
    ).status,
    'question',
  );
  const resumed = await resumeDelegateRun({
    runId: first.runId,
    answer: 'Use A.',
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.record.backendSessionId, 'session-first');
  assert.equal((await readRunRecord(second.runId, { directory: runDirectory })).status, 'question');
  assert.deepEqual(
    (await calls(logPath)).map(({ operation, sessionId }) => [operation, sessionId]),
    [
      ['--planr-run', null],
      ['--planr-run', null],
      ['--planr-resume', 'session-first'],
    ],
  );
  const correction = await resumeDelegateRun({
    runId: first.runId,
    correction: 'Please improve the check.',
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(correction.status, 'completed');
  assert.equal((await calls(logPath)).at(-1).sessionId, 'session-first');
  const wrong = await resumeDelegateRun({
    runId: first.runId,
    correction: 'Apply one more correction.',
    runDirectory,
    env: environment(logPath, 'wrong-session'),
  });
  assert.equal(wrong.status, 'blocked');
  assert.equal(wrong.record.diagnostic.code, 'E_DELEGATE_SESSION');
  assert.equal(wrong.record.backendSessionId, 'session-first');
  await updateRunRecord(
    second.runId,
    { backendSessionId: '../latest' },
    { directory: runDirectory },
  );
  const invalid = await resumeDelegateRun({
    runId: second.runId,
    answer: 'Use B.',
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(invalid.status, 'blocked');
  assert.equal(invalid.record.diagnostic.code, 'E_DELEGATE_SESSION');
  assert.equal(
    (await calls(logPath)).filter(({ operation }) => operation === '--planr-resume').length,
    3,
  );
});

test('initial and resume prompts require one JSON result while omitting capsule bytes and backend session IDs', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Change source.txt using SENSITIVE_SOURCE_MARKER as private context.',
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env: environment(logPath),
  });
  const question = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory,
    env: environment(logPath, 'question'),
  });
  assert.equal(question.status, 'question');
  const completed = await resumeDelegateRun({
    runId: prepared.runId,
    answer: 'Use A.',
    runDirectory,
    env: environment(logPath),
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.record.executionTiming.attempts, 2);
  assert.equal(completed.record.executionTiming.last.phase, 'delegate-correction');
  assert.equal(completed.record.executionTiming.last.status, 'completed');
  assert.ok(
    completed.record.executionTiming.durationMs >= completed.record.executionTiming.last.durationMs,
  );
  const timedStatus = await delegateRunStatus({
    runId: prepared.runId,
    runDirectory,
  });
  assert.deepEqual(timedStatus.timings.execution, completed.record.executionTiming);
  assert.ok(timedStatus.timings.preparation.durationMs >= 0);
  const invocations = await calls(logPath);
  assert.deepEqual(
    invocations.map(({ operation }) => operation),
    ['--planr-run', '--planr-resume'],
  );
  for (const { promptContract } of invocations) {
    assert.deepEqual(promptContract, {
      jsonOnly: true,
      status: true,
      summary: true,
      question: true,
      checks: true,
      issues: true,
      adapterSession: true,
      noCapsuleBytes: true,
      noBackendSession: true,
    });
  }
  assert.deepEqual(
    invocations.map(({ capsulePath }) => capsulePath),
    [prepared.record.capsulePath, prepared.record.capsulePath],
  );
});

test('a delegate blocker remains concrete in the private record after restart', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Compile the source.',
    profile: 'fake',
    profileDirectory,
    runDirectory,
    env: environment(logPath),
  });
  const outcome = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory,
    env: environment(logPath, 'blocked'),
  });
  assert.equal(outcome.status, 'blocked');
  const recovered = await recoverDelegateRun({ runId: prepared.runId, runDirectory });
  assert.equal(recovered.reportedBlocker, 'Cannot compile the selected source');
  assert.equal(recovered.backendSessionId, 'session-default');
});

test('timeout, cancellation, exit, partial output and restart recovery keep private custody', async (t) => {
  const { root, runDirectory, profileDirectory, base } = await fixture(t);
  const { logPath } = await fakeProfile({ base, profileDirectory });
  const common = { repositoryRoot: root, profile: 'fake', profileDirectory, runDirectory };
  for (const [mode, expected] of [
    ['hang', 'E_DELEGATE_TIMEOUT'],
    ['exit', 'E_ADAPTER_EXIT'],
    ['partial', 'E_ADAPTER_RESULT'],
  ]) {
    const prepared = await prepareDelegateRun({
      ...common,
      request: `Request for ${mode}`,
      env: environment(logPath),
    });
    const outcome = await dispatchDelegateRun({
      runId: prepared.runId,
      runDirectory,
      env: environment(logPath, mode),
      timeoutMs: mode === 'hang' ? 1000 : 2000,
    });
    assert.equal(outcome.status, 'blocked');
    assert.equal(outcome.record.diagnostic.code, expected);
    assert.ok(!outcome.record.diagnostic.message.includes(`sk-${'xY'.repeat(14)}`));
    assert.ok((await stat(outcome.record.capsulePath)).isFile());
    assert.ok((await stat(outcome.record.worktreePath)).isDirectory());
    assert.ok((await stat(outcome.record.custodyPath)).isFile());
    assert.ok((await stat(join(runDirectory, prepared.runId, 'record.json'))).size <= 64 * 1024);
  }
  const cancelled = await prepareDelegateRun({
    ...common,
    request: 'Cancelled request',
    env: environment(logPath),
  });
  const controller = new AbortController();
  controller.abort();
  const cancelledResult = await dispatchDelegateRun({
    runId: cancelled.runId,
    runDirectory,
    env: environment(logPath),
    signal: controller.signal,
  });
  assert.equal(cancelledResult.status, 'prepared');
  assert.equal(cancelledResult.record.diagnostic.code, 'E_DELEGATE_CANCELLED');
  const interrupted = await prepareDelegateRun({
    ...common,
    request: 'Interrupted request',
    env: environment(logPath),
  });
  await updateRunRecord(
    interrupted.runId,
    { status: 'running', activePid: 999999999, backendSessionId: 'session-interrupted' },
    { directory: runDirectory },
  );
  const recovered = await recoverDelegateRun({ runId: interrupted.runId, runDirectory });
  assert.equal(recovered.status, 'blocked');
  assert.equal(recovered.backendSessionId, 'session-interrupted');
  assert.ok((await stat(recovered.worktreePath)).isDirectory());
  const operationalText = `${await readFile(join(runDirectory, interrupted.runId, 'record.json'), 'utf8')}\n${await readFile(logPath, 'utf8')}`;
  assert.ok(!operationalText.includes('private credential text'));
  assert.ok(!operationalText.includes('Interrupted request'));
});

test('host preflight diagnoses missing Git and empty repositories before creating task state', async (t) => {
  const { base, root, runDirectory, profileDirectory } = await fixture(t);
  const host = await probeDelegateHost({
    repositoryRoot: root,
    env: { PATH: join(base, 'missing') },
  });
  assert.equal(host.ready, false);
  assert.equal(host.git.ready, false);
  assert.deepEqual(host.git.diagnostic, { code: 'E_ADAPTER_LAUNCH', cause: 'ENOENT' });
  const empty = join(base, 'empty');
  await mkdir(empty);
  git(empty, 'init', '-q');
  assert.equal((await probeDelegateHost({ repositoryRoot: empty })).repository.ready, false);
  await assert.rejects(
    prepareDelegateRun({
      repositoryRoot: empty,
      profile: 'missing',
      request: 'Do not collect this request',
      runDirectory,
      profileDirectory,
    }),
    (error) => error.code === 'E_DELEGATE_PREREQUISITE',
  );
  assert.deepEqual(await readdir(runDirectory), []);
  assert.deepEqual(await readdir(profileDirectory), []);
});

test('onboarding distinguishes inaccessible engines from missing PATH entries', async (t) => {
  const { base, root } = await fixture(t);
  const bin = join(base, 'engine-bin');
  await mkdir(bin);
  await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  const result = await probeDelegateHost({ repositoryRoot: root, env: { PATH: bin } });
  assert.equal(result.git.ready, false);
  assert.deepEqual(result.discoveryDiagnostics, [{ kind: 'claude', code: 'EACCES' }]);
  assert.deepEqual(result.engines, []);
});
