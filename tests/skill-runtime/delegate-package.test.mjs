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
import { SKILL_CLI_CONTRACTS } from '../../scripts/skills/skill-cli.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('skills/planr-delegate/openplanr.skill.json'));
const registry = JSON.parse(read('skills/registry.json'));

const DELEGATE_RUNTIME = resolve(root, 'packages/pipeline/lib/delegate');
const BUNDLES = [
  ['claude', 'dist/plugins/claude/openplanr/skills/delegate'],
  ['openai', 'dist/plugins/openai/openplanr/skills/delegate'],
  ['cursor', 'dist/plugins/cursor/openplanr/rules/planr-delegate'],
];

/** Copies the delegate runtime out of the checkout, as an installed workflow package holds it. */
function installedRuntime(temporary) {
  const copied = join(temporary, 'lib', 'delegate');
  cpSync(DELEGATE_RUNTIME, copied, { recursive: true });
  return copied;
}

/** Calls one runner action in a fresh Node process and returns its exit status and JSON. */
function runAction(runtime, action, input, cwd, env = {}) {
  const runner = pathToFileURL(join(runtime, 'runner.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        `const { delegateRunnerCommand, delegateFailure } = await import(${JSON.stringify(runner)});`,
        `try { console.log(JSON.stringify(await delegateRunnerCommand(${JSON.stringify(action)}, ${JSON.stringify(input)}))); }`,
        'catch (error) { console.log(JSON.stringify(delegateFailure(error))); process.exitCode = 1; }',
      ].join('\n'),
    ],
    { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: cwd, NO_COLOR: '1', ...env } },
  );
  return {
    status: result.status,
    stderr: result.stderr,
    output: JSON.parse(result.stdout || 'null'),
  };
}

test('every host bundle ships the delegate skill as instructions only', () => {
  for (const [host, projection] of BUNDLES) {
    const files = readdirSync(resolve(root, projection), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name).slice(resolve(root, projection).length + 1),
      );
    assert.ok(files.includes('references/openplanr-cli.md'), host);
    assert.deepEqual(
      files.filter((file) => !/\.(?:md|yaml|json)$/u.test(file)),
      [],
      `${host} ships a non-instruction file`,
    );
    for (const file of files.filter((name) => name.endsWith('.md')))
      assert.doesNotMatch(
        readFileSync(resolve(root, projection, file), 'utf8'),
        /scripts\/|\.mjs\b|openplanr@(?:latest|[\^~>])/u,
        `${host}/${file}`,
      );
  }
});

test('the optional CLI path names the minimum CLI for its probe and install line, without npx', () => {
  const reference = read('skills/planr-delegate/references/openplanr-cli.md');
  const minimum = SKILL_CLI_CONTRACTS.delegate.since;
  assert.ok(reference.includes(`npm install -g openplanr@${minimum}`));
  assert.ok(reference.includes(`version ${minimum} or later`));
  assert.doesNotMatch(reference, /\{\{|npx -y|npx openplanr/u);
  assert.match(read('skills/planr-delegate/SKILL.md'), /\]\(references\/openplanr-cli\.md\)/u);
});

test('Codex resume puts the exec flags before resume, which rejects -C and -s', () => {
  const commands = read('skills/planr-delegate/references/native-commands.md');
  assert.ok(
    commands.includes(
      '`codex exec --json -o <out>/last.md -C <dir> -s workspace-write resume <session-id> - < <correction>`',
    ),
  );
  assert.doesNotMatch(commands, /exec resume[^\n|]*(?:-C|-s|--cd|--sandbox)\b/u);
});

test('an installed runtime classifies the reported sources and still rejects a recognizable credential', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-credentials-'));
  const source = [
    '  secret: recording.secretAccessKey,',
    '  issueLiveKitToken: TIssueLiveKitBookingToken;',
    '  apiKey: configValidation.config!.apiKey,',
    '  apiSecret: configValidation.config!.apiSecret,',
    '  apiSecret: "test_secret_must_be_at_least_32_bytes_long_",',
    '',
  ].join('\n');
  try {
    const runtime = installedRuntime(temporary);
    const repository = join(temporary, 'repository');
    mkdirSync(join(repository, 'src'), { recursive: true });
    writeFileSync(join(repository, 'src/booking.ts'), source);
    writeFileSync(join(repository, 'src/token.ts'), `const token = "ghp_${'A'.repeat(30)}";\n`);
    const context = pathToFileURL(join(runtime, 'context.mjs')).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
      cwd: repository,
      input: [
        `const { assertCredentialFreeText, buildContextCapsule } = await import(${JSON.stringify(context)});`,
        `const lines = ${JSON.stringify(source.split('\n'))};`,
        'for (const line of lines) assertCredentialFreeText(line);',
        `const capsule = await buildContextCapsule({ repositoryRoot: ${JSON.stringify(repository)}, request: 'Review.', selectedFiles: ['src/booking.ts'] });`,
        'let rejected;',
        `try { await buildContextCapsule({ repositoryRoot: ${JSON.stringify(repository)}, request: 'Review.', selectedFiles: ['src/token.ts'] }); } catch (error) { rejected = error; }`,
        'console.log(JSON.stringify({ copied: capsule.files.some((file) => file.path === "src/booking.ts"), code: rejected?.code, finding: rejected?.details?.findings?.[0], leaked: JSON.stringify(rejected?.details ?? {}).includes("ghp_") }));',
      ].join('\n'),
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: repository, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.copied, true);
    assert.equal(observed.code, 'E_CAPSULE_SECRET');
    assert.equal(observed.finding.rule, 'credential-format');
    assert.equal(observed.finding.resolvable, false);
    assert.equal(observed.leaked, false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('delegate is a canonical opt-in package whose bundles match its sources', () => {
  assert.equal(manifest.skillId, 'planr-delegate');
  assert.equal(manifest.execution, 'host-agent');
  assert.deepEqual(manifest.hosts, ['claude-code', 'codex', 'chatgpt', 'cursor']);
  assert.ok(manifest.resources.some(({ path }) => path === 'references/openplanr-cli.md'));
  assert.ok(manifest.resources.every(({ executable }) => executable === false));
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

test('the installed runtime probes offline without the source checkout or model credentials', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-package-'));
  try {
    const runtime = installedRuntime(temporary);
    const workspace = join(temporary, 'workspace');
    mkdirSync(workspace);
    const credentials = { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', CLAUDE_CONFIG_DIR: '' };
    const ok = runAction(runtime, 'probe', {}, workspace, credentials);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.output.localExecutable, true);
    const unsupported = runAction(
      runtime,
      'probe',
      { hostCapabilities: { localExecution: false } },
      workspace,
      credentials,
    );
    assert.equal(unsupported.status, 1);
    assert.equal(unsupported.output.code, 'E_DELEGATE_HOST_UNSUPPORTED');
    assert.deepEqual(readdirSync(workspace), [], 'probe must not create project state');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('an installed runtime supports first-use setup with an empty user profile store', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-delegate-first-use-'));
  try {
    const runtime = installedRuntime(temporary);
    const workspace = join(temporary, 'workspace');
    mkdirSync(workspace);
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
    const path = { PATH: process.env.PATH };
    const empty = runAction(runtime, 'probe', { repositoryRoot: workspace }, workspace, path);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(empty.output.profiles, []);
    const preview = runAction(runtime, 'profile-preview', input, workspace, path);
    assert.equal(preview.status, 0, preview.stderr);
    const destination = preview.output.destination;
    assert.deepEqual(destination, { class: 'external', origin: 'https://example.test' });
    assert.ok(!JSON.stringify(preview.output).includes(executable));
    assert.deepEqual(readdirSync(workspace), [], 'preview must not create a capsule or worktree');
    const enrolled = runAction(
      runtime,
      'profile-enroll',
      { ...input, expectedDestination: destination, allowBackendDefault: true },
      workspace,
      path,
    );
    assert.equal(enrolled.status, 0, enrolled.stderr);
    const choices = runAction(runtime, 'probe', { repositoryRoot: workspace }, workspace, path);
    assert.equal(choices.output.profiles[0].name, 'first-use');
    const removed = runAction(runtime, 'profile-remove', { name: 'first-use' }, workspace, path);
    assert.equal(removed.output.removed, true);
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
