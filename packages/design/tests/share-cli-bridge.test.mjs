import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DESIGN_SHARE_COMPAT } from '../lib/design/share-compat.mjs';

const bridge = await import('../lib/design/share-cli-bridge.mjs');

/** A fake `openplanr` that logs each call and answers from a JSON table keyed by subcommand. */
function fakeCli(t, answers) {
  const dir = mkdtempSync(join(tmpdir(), 'planr-fake-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.jsonl');
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers));
  writeFileSync(
    join(dir, 'openplanr'),
    `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
let input = '';
try { input = readFileSync(0, 'utf8'); } catch {}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n');
const answer = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'answers.json'))}, 'utf8'))[args[1]];
process.stdout.write(JSON.stringify(answer.body) + '\\n');
process.exitCode = answer.exit ?? 0;
`,
  );
  chmodSync(join(dir, 'openplanr'), 0o755);
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  return { env: { ...process.env, PATH: dir }, calls };
}

const runtime = (compat) => ({
  body: { ok: true, cli: '9.9.9', pipeline: '9.9.9', designShareCompat: compat },
});

test('without the CLI, sharing fails clearly and local reads keep working', async (t) => {
  const empty = mkdtempSync(join(tmpdir(), 'planr-no-cli-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const env = { ...process.env, PATH: empty };
  await assert.rejects(bridge.shareDesign('/d/design-document.json', { env }), {
    code: 'E_DESIGN_SHARE_CLI_REQUIRED',
    message: /npm install -g openplanr/,
  });
  const status = bridge.getDesignShareStatus('/d/design-document.json', { env });
  assert.equal(status.shared, false);
  assert.equal(status.unavailable.code, 'E_DESIGN_SHARE_CLI_REQUIRED');
  assert.match(status.unavailable.message, /npm install -g openplanr/);
  assert.equal(
    (await bridge.syncDesignShare('/d/design-document.json', { env, unavailable: 'skip' })).skipped,
    'E_DESIGN_SHARE_CLI_REQUIRED',
  );
  await assert.rejects(bridge.syncDesignShare('/d/design-document.json', { env }), {
    code: 'E_DESIGN_SHARE_CLI_REQUIRED',
  });
});

test('a CLI with another sharing format is refused before any share operation runs', async (t) => {
  for (const compat of [DESIGN_SHARE_COMPAT + 1, DESIGN_SHARE_COMPAT - 1, null]) {
    const cli = fakeCli(t, {
      'share-runtime': runtime(compat),
      share: { body: { ok: true, shared: true } },
    });
    await assert.rejects(bridge.shareDesign('/d/design-document.json', { env: cli.env }), {
      code: 'E_DESIGN_SHARE_RUNTIME_MISMATCH',
      message:
        compat > DESIGN_SHARE_COMPAT ? /Update the OpenPlanr plugin/ : /npm install -g openplanr/,
    });
    assert.deepEqual(
      cli.calls().map(({ args }) => args[1]),
      ['share-runtime'],
    );
    assert.equal(
      bridge.getDesignShareStatus('/d/design-document.json', { env: cli.env }).unavailable.code,
      'E_DESIGN_SHARE_RUNTIME_MISMATCH',
    );
  }
});

test('a CLI release without the sharing runtime report is refused as outdated', async (t) => {
  const cli = fakeCli(t, {
    'share-runtime': {
      exit: 1,
      body: {
        ok: false,
        code: 'E_ARTIFACT_INPUT_INVALID',
        problem: 'The artifact file is missing: <path>',
      },
    },
    share: { body: { ok: true, shared: true } },
  });
  await assert.rejects(bridge.shareDesign('/d/design-document.json', { env: cli.env }), {
    code: 'E_DESIGN_SHARE_RUNTIME_MISMATCH',
    message: /too old to share designs.*npm install -g openplanr/s,
  });
  assert.equal(
    (await bridge.syncDesignShare('/d/design-document.json', { env: cli.env, unavailable: 'skip' }))
      .skipped,
    'E_DESIGN_SHARE_RUNTIME_MISMATCH',
  );
  assert.deepEqual([...new Set(cli.calls().map(({ args }) => args[1]))], ['share-runtime']);
});

test('each operation runs the matching CLI command with the file after --', async (t) => {
  const cli = fakeCli(t, {
    'share-runtime': runtime(DESIGN_SHARE_COMPAT),
    share: { body: { ok: true, shared: true, url: 'https://example.test/d/abc' } },
    publish: { body: { ok: true, shared: true } },
    sync: { body: { ok: true, imported: 2 } },
    status: { body: { ok: true, shared: true, url: 'https://example.test/d/abc' } },
    manage: { body: { ok: true } },
    'review-metadata': { body: { ok: true, pending: false } },
  });
  const file = '/work/-odd/design-document.json';
  const options = { env: cli.env };
  assert.equal((await bridge.shareDesign(file, options)).url, 'https://example.test/d/abc');
  await bridge.publishDesignShare(file, options);
  assert.equal((await bridge.syncDesignShare(file, options)).imported, 2);
  assert.equal(bridge.getDesignShareStatus(file, options).shared, true);
  await bridge.manageDesignShare(file, 'pause', options);
  await bridge.exportDesignShareRecovery(file, { ...options, output: '/tmp/r.json' });
  await bridge.importDesignShareRecovery(file, { ...options, input: '/tmp/r.json' });
  await bridge.publishDesignReviewMetadata(
    file,
    { kind: 'disposition', disposition: 'accepted' },
    { ...options, revisionId: 'rev-1' },
  );
  const calls = cli.calls().filter(({ args }) => args[1] !== 'share-runtime');
  assert.deepEqual(
    calls.map(({ args }) => args),
    [
      ['artifact', 'share', '--yes', '--no-open', '--json', '--', file],
      ['artifact', 'publish', '--yes', '--json', '--', file],
      ['artifact', 'sync', '--json', '--', file],
      ['artifact', 'status', '--json', '--', file],
      ['artifact', 'manage', '--action', 'pause', '--yes', '--json', '--', file],
      [
        'artifact',
        'manage',
        '--action',
        'recovery',
        '--output',
        '/tmp/r.json',
        '--json',
        '--',
        file,
      ],
      [
        'artifact',
        'manage',
        '--action',
        'restore',
        '--input',
        '/tmp/r.json',
        '--yes',
        '--json',
        '--',
        file,
      ],
      ['artifact', 'review-metadata', '--revision', 'rev-1', '--input', '-', '--json', '--', file],
    ],
  );
  assert.deepEqual(JSON.parse(calls.at(-1).input), {
    kind: 'disposition',
    disposition: 'accepted',
  });
});

test('an error the CLI reports keeps its code, problem and recovery', async (t) => {
  const cli = fakeCli(t, {
    'share-runtime': runtime(DESIGN_SHARE_COMPAT),
    manage: {
      exit: 1,
      body: {
        ok: false,
        code: 'E_DESIGN_SHARE_FAILED',
        problem: 'Create the shared review first.',
        recovery: 'Share the design, then retry.',
      },
    },
    status: {
      exit: 1,
      body: { ok: false, code: 'E_ARTIFACT_INPUT_INVALID', problem: 'Not a design.' },
    },
  });
  await assert.rejects(
    bridge.manageDesignShare('/d/design-document.json', 'pause', { env: cli.env }),
    {
      code: 'E_DESIGN_SHARE_FAILED',
      message: 'Create the shared review first. Share the design, then retry.',
    },
  );
  assert.throws(() => bridge.getDesignShareStatus('/d/design-document.json', { env: cli.env }), {
    code: 'E_ARTIFACT_INPUT_INVALID',
    message: 'Not a design.',
  });
});
