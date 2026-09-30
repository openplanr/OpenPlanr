import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { matchSkillRequest } from '../../packages/skill-runtime/src/matching/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('skills/planr-delegate/openplanr.skill.json'));
const registry = JSON.parse(read('skills/registry.json'));

function runProbe(helper, input, cwd) {
  return spawnSync(process.execPath, [helper, 'probe'], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: cwd,
      NO_COLOR: '1',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      CLAUDE_CONFIG_DIR: '',
    },
  });
}

function runAction(helper, action, input, cwd) {
  return spawnSync(process.execPath, [helper, action], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: cwd, NO_COLOR: '1' },
  });
}

test('installed helpers can be imported from a stdin script without executing a CLI action', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-stdin-'));
  try {
    for (const host of ['claude', 'openai']) {
      const copied = join(temporary, host);
      cpSync(resolve(root, `dist/plugins/${host}/openplanr/skills/delegate`), copied, {
        recursive: true,
      });
      const workspace = join(temporary, `${host}-workspace`);
      mkdirSync(workspace);
      const runner = pathToFileURL(join(copied, 'scripts/runner.mjs')).href;
      const integration = pathToFileURL(join(copied, 'scripts/integrate.mjs')).href;
      const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
        cwd: workspace,
        input: [
          `const runner = await import(${JSON.stringify(runner)});`,
          `const integration = await import(${JSON.stringify(integration)});`,
          'console.log(JSON.stringify({ runner: typeof runner.delegateRunnerCommand, integration: typeof integration.delegateIntegrationCommand }));',
        ].join('\n'),
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', HOME: workspace, NO_COLOR: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), {
        runner: 'function',
        integration: 'function',
      });
      assert.deepEqual(readdirSync(workspace), []);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('delegate is a canonical opt-in package with installed Claude and Codex resources', () => {
  assert.equal(manifest.skillId, 'planr-delegate');
  assert.equal(manifest.execution, 'host-agent');
  assert.deepEqual(manifest.hosts, ['claude-code', 'codex', 'chatgpt', 'cursor']);
  assert.ok(manifest.resources.some(({ path }) => path === 'scripts/runner.mjs'));
  assert.ok(manifest.resources.some(({ path }) => path === 'references/operator-guide.md'));
  for (const host of ['openai', 'claude']) {
    const projection = `dist/plugins/${host}/openplanr/skills/delegate`;
    assert.match(read(`${projection}/SKILL.md`), /^name: delegate$/mu);
    for (const resource of manifest.resources.filter(({ hosts }) =>
      hosts.includes(host === 'openai' ? 'codex' : 'claude-code'),
    )) {
      if (host === 'openai' && resource.path === 'agents/openai.yaml') continue;
      assert.equal(
        readFileSync(resolve(root, projection, resource.path)).equals(
          readFileSync(resolve(root, 'skills/planr-delegate', resource.path)),
        ),
        true,
        `${host}/${resource.path}`,
      );
    }
  }
});

test('the installed helper probes offline without the source checkout or model credentials', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-package-'));
  try {
    for (const host of ['openai', 'claude']) {
      const packaged = resolve(root, `dist/plugins/${host}/openplanr/skills/delegate`);
      const copied = join(temporary, host);
      cpSync(packaged, copied, { recursive: true });
      const workspace = join(temporary, `${host}-workspace`);
      mkdirSync(workspace);
      const ok = runProbe(join(copied, 'scripts/runner.mjs'), {}, workspace);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(JSON.parse(ok.stdout).localExecutable, true);
      const unsupported = runProbe(
        join(copied, 'scripts/runner.mjs'),
        { hostCapabilities: { localExecution: false } },
        workspace,
      );
      assert.equal(unsupported.status, 1);
      assert.equal(JSON.parse(unsupported.stderr).code, 'E_DELEGATE_HOST_UNSUPPORTED');
      assert.deepEqual(readdirSync(workspace), [], 'probe must not create project state');
      assert.deepEqual(readdirSync(copied).sort(), [
        'SKILL.md',
        ...(host === 'openai' ? ['agents', 'openplanr.skill.json'] : []),
        'references',
        'scripts',
      ]);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a copied skill supports first-use setup with an empty user profile store', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-first-use-'));
  try {
    const copied = join(temporary, 'skill');
    cpSync(resolve(root, 'dist/plugins/claude/openplanr/skills/delegate'), copied, {
      recursive: true,
    });
    const workspace = join(temporary, 'workspace');
    mkdirSync(workspace);
    const helper = join(copied, 'scripts/runner.mjs');
    const executable = join(temporary, 'adapter.mjs');
    writeFileSync(
      executable,
      [
        '#!/usr/bin/env node',
        "if (process.argv.at(-1) === '--planr-probe') {",
        "  console.log(JSON.stringify({ protocol: 'openplanr.delegate.adapter', version: 1, capabilities: { implementation: true, structuredResult: true, exactResume: true }, destination: { class: 'external', origin: 'https://example.test' } }));",
        '  process.exit(0);',
        '}',
        'process.exit(2);',
      ].join('\n'),
    );
    chmodSync(executable, 0o700);
    const profile = {
      name: 'first-use',
      kind: 'generic',
      executable,
      argv: [],
      allowedEnv: [],
      workingDirectory: 'worktree',
    };
    const input = { repositoryRoot: workspace, profile };
    const empty = runAction(helper, 'probe', { repositoryRoot: workspace }, workspace);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout).profiles, []);
    const preview = runAction(helper, 'profile-preview', input, workspace);
    assert.equal(preview.status, 0, preview.stderr);
    const destination = JSON.parse(preview.stdout).destination;
    assert.deepEqual(destination, { class: 'external', origin: 'https://example.test' });
    assert.ok(!preview.stdout.includes(executable));
    assert.deepEqual(readdirSync(workspace), [], 'preview must not create a capsule or worktree');
    const enrolled = runAction(
      helper,
      'profile-enroll',
      {
        ...input,
        expectedDestination: destination,
        allowBackendDefault: true,
      },
      workspace,
    );
    assert.equal(enrolled.status, 0, enrolled.stderr);
    const choices = runAction(helper, 'probe', { repositoryRoot: workspace }, workspace);
    assert.equal(choices.status, 0, choices.stderr);
    assert.equal(JSON.parse(choices.stdout).profiles[0].name, 'first-use');
    const removed = runAction(helper, 'profile-remove', { name: 'first-use' }, workspace);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).removed, true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('explicit delegation routes to delegate while ordinary Ship stays host-native', () => {
  assert.equal(
    matchSkillRequest({ registry, input: 'Use planr-delegate for this task' }).skillId,
    'planr-delegate',
  );
  assert.equal(
    matchSkillRequest({ registry, input: 'Delegate implementation to another coding agent' })
      .skillId,
    'planr-delegate',
  );
  assert.equal(matchSkillRequest({ registry, input: 'Ship this' }).skillId, 'planr-ship');
  assert.equal(
    matchSkillRequest({ registry, input: 'Build the requested local code change from this task' })
      .skillId,
    'planr-ship',
  );
});
