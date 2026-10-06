import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSession, saveSession } from '../../lib/design-engine/session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PIPELINE_BIN = join(here, '..', '..', 'bin', 'openplanr-pipeline.mjs');

/** A private PLANR_HOME and working directory, so no command touches the real user state. */
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'planr-removed-openai-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home);
  const env = { ...process.env, PLANR_HOME: home };
  delete env.OPENAI_API_KEY;
  const run = (...args) =>
    spawnSync(process.execPath, [PIPELINE_BIN, 'design-engine', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
  return { root, home, run };
}

function openaiSession(dir) {
  mkdirSync(dir, { recursive: true });
  saveSession(
    dir,
    'A',
    createSession({ id: 'old-A', provider: 'openai', target: 'logo', brief: 'mark' }),
  );
  return join(dir, 'session-A.json');
}

test('setup and evolve name their removal and where a saved key lives', (t) => {
  const { home, run } = workspace(t);
  const setup = run('setup', '--key', 'not-a-real-key');
  assert.equal(setup.status, 1);
  assert.match(setup.stderr, /setup was removed/u);
  assert.ok(setup.stderr.includes(join(home, 'credentials.json')));
  assert.ok(!setup.stderr.includes('not-a-real-key'));
  const evolve = run('evolve', '--from', 'variant-A.png');
  assert.equal(evolve.status, 1);
  assert.match(evolve.stderr, /evolve was removed/u);
});

test('generate rejects the openai provider and reference images before creating a session', (t) => {
  const { root, run } = workspace(t);
  for (const args of [
    ['--provider', 'openai'],
    ['--from-image', 'reference.png'],
  ]) {
    const sessionDir = join(root, `session-${args[0].slice(2)}`);
    const result = run('generate', '--brief', 'mark', '--session-dir', sessionDir, ...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /openai provider was removed|reference images are not supported/u);
    assert.equal(existsSync(sessionDir), false, args.join(' '));
  }
});

test('iterate and record refuse a session made with the openai provider', (t) => {
  const { root, run } = workspace(t);
  const sessionDir = join(root, 'session');
  const sessionFile = openaiSession(sessionDir);
  const before = readFileSync(sessionFile, 'utf8');
  const iterate = run(
    'iterate',
    '--variant',
    'A',
    '--feedback',
    'tighter',
    '--session-dir',
    sessionDir,
  );
  assert.equal(iterate.status, 1);
  assert.match(iterate.stderr, /openai provider, which this engine no longer runs/u);
  const artifact = join(root, 'variant-A.svg');
  writeFileSync(artifact, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const record = run('record', '--variant', 'A', '--file', artifact, '--session-dir', sessionDir);
  assert.equal(record.status, 1);
  assert.match(record.stderr, /record into a new --session-dir or variant/u);
  assert.equal(readFileSync(sessionFile, 'utf8'), before);
});

test('check and taste on a PNG without attribute flags explain what they need', (t) => {
  const { root, run } = workspace(t);
  const image = join(root, 'variant-A.png');
  writeFileSync(image, 'png');
  const check = run('check', '--file', image);
  assert.equal(check.status, 1);
  assert.match(check.stderr, /check validates an SVG sheet/u);
  const taste = run('taste', 'approved', image, '--project', 'demo');
  assert.equal(taste.status, 1);
  assert.match(taste.stderr, /needs --fonts, --colors, --layouts or --aesthetics/u);
});
