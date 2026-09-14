import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../../scripts/run-test-group.mjs', import.meta.url));
const runnerEnvironment = { ...process.env };
delete runnerEnvironment.NODE_TEST_CONTEXT;

test('run-test-group excludes explicit cross-repository tests from a collected directory', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-test-group-'));
  const tests = join(temporaryRoot, 'tests');
  mkdirSync(tests);
  const standalone = join(tests, 'standalone.test.mjs');
  const paired = join(tests, 'paired.test.mjs');
  writeFileSync(standalone, "import test from 'node:test'; test('standalone', () => {});\n");
  writeFileSync(paired, "import test from 'node:test'; test('paired must not run', () => { throw new Error('paired'); });\n");

  try {
    const result = spawnSync(process.execPath, [runner, tests, '--exclude', paired], {
      encoding: 'utf8',
      env: runnerEnvironment,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('run-test-group rejects an incomplete exclude option', () => {
  const result = spawnSync(process.execPath, [runner, '--exclude'], {
    encoding: 'utf8',
    env: runnerEnvironment,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--exclude requires a test-file path/u);
});

test('run-test-group keeps ordinary files concurrent and runs opted-in archive proofs afterward', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-test-group-serial-'));
  const tests = join(temporaryRoot, 'tests');
  mkdirSync(tests);
  const readyA = join(temporaryRoot, 'ready-a');
  const readyB = join(temporaryRoot, 'ready-b');
  const doneA = join(temporaryRoot, 'done-a');
  const doneB = join(temporaryRoot, 'done-b');
  const parallelFixture = ({ name, ready, peerReady, done }) => [
    "import assert from 'node:assert/strict';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import test from 'node:test';",
    `const ready = ${JSON.stringify(ready)};`,
    `const peerReady = ${JSON.stringify(peerReady)};`,
    `const done = ${JSON.stringify(done)};`,
    "writeFileSync(ready, 'ready\\n');",
    `test(${JSON.stringify(name)}, async () => {`,
    '  const deadline = Date.now() + 2_000;',
    '  while (!existsSync(peerReady) && Date.now() < deadline) {',
    '    await new Promise((resolve) => setTimeout(resolve, 10));',
    '  }',
    "  assert.equal(existsSync(peerReady), true, 'ordinary files did not execute concurrently');",
    '  await new Promise((resolve) => setTimeout(resolve, 1_000));',
    "  writeFileSync(done, 'done\\n');",
    '});',
    '',
  ].join('\n');
  writeFileSync(
    join(tests, 'a-parallel.test.mjs'),
    parallelFixture({ name: 'parallel a', ready: readyA, peerReady: readyB, done: doneA }),
  );
  writeFileSync(
    join(tests, 'b-parallel.test.mjs'),
    parallelFixture({ name: 'parallel b', ready: readyB, peerReady: readyA, done: doneB }),
  );
  writeFileSync(join(tests, 'z-archive-proof.test.mjs'), [
    '// @planr-test-group serial',
    "import assert from 'node:assert/strict';",
    "import { existsSync } from 'node:fs';",
    "import test from 'node:test';",
    `test('archive proof', () => {`,
    `  assert.equal(existsSync(${JSON.stringify(doneA)}), true);`,
    `  assert.equal(existsSync(${JSON.stringify(doneB)}), true);`,
    '});',
    '',
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [runner, tests], {
      encoding: 'utf8',
      env: runnerEnvironment,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readFileSync(doneA, 'utf8'), 'done\n');
    assert.equal(readFileSync(doneB, 'utf8'), 'done\n');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
