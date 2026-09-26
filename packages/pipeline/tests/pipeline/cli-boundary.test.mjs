import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(repositoryRoot, 'bin', 'planr-pipeline.mjs');

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), 'planr-cli-boundary-'));
}

function invoke(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function machineFailure(root, args) {
  const result = invoke(root, args);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /\n\s+at\s/u);
  const value = JSON.parse(result.stderr);
  assert.equal(value.ok, false);
  assert.deepEqual(
    Object.keys(value).sort(),
    Object.keys(value)
      .filter((key) => ['ok', 'code', 'problem', 'fix'].includes(key))
      .sort(),
  );
  return value;
}

test('an option token cannot become a missing feature or create an artifact', () => {
  const root = temporaryRoot();
  try {
    const failure = machineFailure(root, ['plan', '--json', '--no-launch']);
    assert.equal(failure.code, 'E_FEATURE_INVALID');
    assert.equal(failure.problem, 'plan requires a feature slug.');
    assert.equal(existsSync(join(root, '.planr')), false);
    assert.equal(existsSync(join(root, 'input')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('closed parsing accepts options on either side of the positional feature', () => {
  for (const args of [
    ['prepare-plan', '--json', 'safe-feature'],
    ['prepare-plan', 'safe-feature', '--json'],
  ]) {
    const root = temporaryRoot();
    try {
      const result = invoke(root, args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const value = JSON.parse(result.stdout);
      assert.equal(value.ok, true);
      assert.equal(value.slug, 'safe-feature');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('closed parsing rejects unknown, duplicate, missing-value, separator, and extra tokens', () => {
  const cases = [
    { args: ['plan', 'safe-feature', '--unknown', '--json'], code: 'E_CLI_ARGUMENT_INVALID' },
    {
      args: ['plan', 'safe-feature', '--runtime', 'codex', '--runtime', 'cursor', '--json'],
      code: 'E_CLI_ARGUMENT_INVALID',
    },
    { args: ['plan', 'safe-feature', '--runtime', '--json'], code: 'E_CLI_ARGUMENT_INVALID' },
    { args: ['plan', '--', '--json'], code: 'E_FEATURE_INVALID' },
    { args: ['plan', 'safe-feature', '--', 'extra', '--json'], code: 'E_CLI_ARGUMENT_INVALID' },
  ];
  for (const { args, code } of cases) {
    const root = temporaryRoot();
    try {
      assert.equal(machineFailure(root, args).code, code);
      assert.equal(existsSync(join(root, '.planr')), false);
      assert.equal(existsSync(join(root, 'input')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('machine failures are bounded and redact caller and host paths', () => {
  const root = temporaryRoot();
  try {
    const privatePath = join(root, 'private', 'event.json');
    const unexpected = machineFailure(root, [privatePath, '--json']);
    assert.equal(unexpected.code, 'E_COMMAND_UNKNOWN');
    assert.doesNotMatch(JSON.stringify(unexpected), /private|planr-cli-boundary/u);

    const unreadable = machineFailure(root, [
      'advance-ship',
      'safe-feature',
      '--run-id',
      `ship_${'a'.repeat(32)}`,
      '--event-file',
      privatePath,
      '--json',
    ]);
    assert.equal(unreadable.code, 'E_INPUT_FILE_UNREADABLE');
    assert.doesNotMatch(JSON.stringify(unreadable), /private|planr-cli-boundary/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retired planning-review lifecycle commands are unavailable before project access', () => {
  const root = temporaryRoot();
  try {
    for (const action of [
      'prepare-plan-review',
      'start-plan-review',
      'advance-plan-review',
      'decide-plan-review',
    ]) {
      const failure = machineFailure(root, [action, 'safe-feature', '--json']);
      assert.equal(failure.code, 'E_COMMAND_UNKNOWN');
    }
    assert.equal(existsSync(join(root, '.planr')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('portable CLI refuses trusted-host operations before effects and returns exact adapter handoff', () => {
  const root = temporaryRoot();
  try {
    const diagnosePath = join(root, 'diagnose.json');
    const fixPath = join(root, 'fix.json');
    const experimentPath = join(root, 'experiment.json');
    writeFileSync(diagnosePath, `${JSON.stringify({ mode: 'diagnose' })}\n`);
    writeFileSync(fixPath, `${JSON.stringify({ mode: 'fix' })}\n`);
    writeFileSync(experimentPath, `${JSON.stringify({ type: 'experiment.ran' })}\n`);
    const cases = [
      {
        args: ['investigate', 'start', 'safe-feature', '--request-file', diagnosePath, '--json'],
        code: 'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
        recovery: /registered runtime adapter/u,
      },
      {
        args: ['investigate', 'start', 'safe-feature', '--request-file', fixPath, '--json'],
        code: 'E_INVESTIGATION_OWNER_INTERACTIVE_REQUIRED',
        recovery: /directly in a terminal/u,
      },
      {
        args: [
          'investigate',
          'advance',
          'safe-feature',
          '--run-id',
          `inv_${'a'.repeat(32)}`,
          '--event-file',
          experimentPath,
          '--json',
        ],
        code: 'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
        recovery: /registered runtime adapter/u,
      },
      {
        args: [
          'investigate',
          'verify',
          'safe-feature',
          '--run-id',
          `inv_${'a'.repeat(32)}`,
          '--json',
        ],
        code: 'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
        recovery: /registered runtime adapter/u,
      },
      {
        args: [
          'prepare-browser-qa',
          'safe-feature',
          '--run-id',
          `ship_${'a'.repeat(32)}`,
          '--json',
        ],
        code: 'E_BROWSER_QA_TRUSTED_HOST_REQUIRED',
        recovery: /registered browser runtime adapter/u,
      },
      {
        args: [
          'record-browser-qa',
          'safe-feature',
          '--run-id',
          `ship_${'a'.repeat(32)}`,
          '--generation',
          '0',
          '--result-file',
          join(root, 'must-not-be-read.json'),
          '--json',
        ],
        code: 'E_BROWSER_QA_TRUSTED_HOST_REQUIRED',
        recovery: /registered browser runtime adapter/u,
      },
    ];
    for (const { args, code, recovery } of cases) {
      const failure = machineFailure(root, args);
      assert.equal(failure.code, code);
      assert.match(failure.fix, recovery);
      assert.equal(existsSync(join(root, '.planr')), false);
      assert.equal(existsSync(join(root, '.investigation')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
