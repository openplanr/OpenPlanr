import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveAuth } from '../../lib/design-engine/auth.mjs';
import { resolveProvider } from '../../lib/design-engine/providers/index.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../lib/design-engine/cli.mjs');

// Preloaded into the CLI: sets the umask and reports the mode of every credentials file right
// after each write.
const modeProbe = (umask) => `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';

process.umask(${umask});
for (const name of ['openSync', 'writeFileSync', 'renameSync']) {
  const original = fs[name];
  fs[name] = function (...args) {
    const result = original.apply(this, args);
    const path = String(name === 'renameSync' ? args[1] : args[0]);
    if (basename(path).startsWith('credentials.json'))
      fs.writeSync(2, 'CREDENTIALS_MODE ' + (fs.statSync(path).mode & 0o777).toString(8) + '\\n');
    return result;
  };
}
syncBuiltinESMExports();
`;

const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'planr-auth-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const setup = (home, { umask = 0o022, key = 'sk-test-owner-only' } = {}) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(modeProbe(umask))}`,
      CLI,
      'setup',
      '--key',
      key,
      '--no-smoke',
    ],
    { env: { ...process.env, PLANR_HOME: home }, encoding: 'utf8' },
  );

test('order 1: credentials.json wins over env', () => {
  const home = tmp();
  writeFileSync(join(home, 'credentials.json'), JSON.stringify({ openai_api_key: 'sk-stored' }));
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: home, OPENAI_API_KEY: 'sk-env' } });
  assert.equal(auth.source, 'credentials');
  assert.equal(auth.apiKey, 'sk-stored');
});

test('order 2: env used when no credentials; no .env match → no disclosure', () => {
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: tmp(), OPENAI_API_KEY: 'sk-env' } });
  assert.equal(auth.source, 'env');
  assert.equal(auth.warnings.length, 0);
});

test('silent-billing DISCLOSURE when the env key matches the cwd .env (and gitignore is checked)', () => {
  const cwd = tmp();
  writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=sk-shared\n');
  const auth = resolveAuth({
    cwd,
    env: { PLANR_HOME: tmp(), OPENAI_API_KEY: 'sk-shared' },
    checkIgnore: () => false, // simulate NOT gitignored
  });
  assert.equal(auth.source, 'env');
  assert.ok(
    auth.warnings.some((w) => w.startsWith('DISCLOSURE')),
    'billing disclosure present',
  );
  assert.ok(
    auth.warnings.some((w) => w.startsWith('SECURITY')),
    'not-gitignored warning present',
  );
  assert.ok(!auth.warnings.join(' ').includes('sk-shared'), 'the key itself is never echoed');
});

test('gitignored .env carrying the key → disclosure only, no SECURITY warning', () => {
  const cwd = tmp();
  writeFileSync(join(cwd, '.env.local'), "OPENAI_API_KEY='sk-shared'\n");
  const auth = resolveAuth({
    cwd,
    env: { PLANR_HOME: tmp(), OPENAI_API_KEY: 'sk-shared' },
    checkIgnore: () => true,
  });
  assert.ok(auth.warnings.some((w) => w.startsWith('DISCLOSURE')));
  assert.ok(!auth.warnings.some((w) => w.startsWith('SECURITY')));
});

test('order 3: nothing resolves → source none, apiKey null (caller offers claude-svg)', () => {
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: tmp() } });
  assert.deepEqual({ apiKey: auth.apiKey, source: auth.source }, { apiKey: null, source: 'none' });
});

test('a dormant key in cwd .env (not exported) → HINT, never auto-used, never echoed', () => {
  const cwd = tmp();
  writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=sk-dormant\n');
  const auth = resolveAuth({ cwd, env: { PLANR_HOME: tmp() } });
  assert.equal(auth.apiKey, null, 'the engine never auto-reads .env');
  assert.equal(auth.source, 'none');
  assert.ok(
    auth.warnings.some((w) => w.startsWith('HINT') && w.includes('.env')),
    'doctor can surface the dormant key',
  );
  assert.ok(!auth.warnings.join(' ').includes('sk-dormant'), 'the key value is never echoed');
});

test('a resolved key (credentials or env) never selects openai on its own — only --provider openai does', () => {
  const home = tmp();
  writeFileSync(join(home, 'credentials.json'), JSON.stringify({ openai_api_key: 'sk-stored' }));
  for (const env of [{ PLANR_HOME: home }, { PLANR_HOME: tmp(), OPENAI_API_KEY: 'sk-env' }]) {
    const auth = resolveAuth({ cwd: tmp(), env });
    assert.ok(auth.apiKey, 'a key resolved');
    assert.equal(resolveProvider({ requested: 'auto', auth }).name, 'claude-svg');
    assert.equal(resolveProvider({ requested: 'openai', auth }).name, 'openai');
  }
});

test('corrupt credentials.json falls through to env with a warning', () => {
  const home = tmp();
  writeFileSync(join(home, 'credentials.json'), '{not json');
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: home, OPENAI_API_KEY: 'sk-env' } });
  assert.equal(auth.source, 'env');
  assert.ok(auth.warnings.some((w) => w.includes('could not be parsed')));
});

test('setup writes the key file owner-only from the moment it exists', {
  skip: process.platform === 'win32' && 'POSIX file modes',
}, () => {
  const home = tmp();
  const result = setup(home);
  assert.equal(result.status, 0, result.stderr);
  const modes = [...result.stderr.matchAll(/^CREDENTIALS_MODE (\d+)$/gm)].map(([, mode]) => mode);
  assert.ok(modes.length > 0, `the probe saw no credentials write: ${result.stderr}`);
  assert.deepEqual(
    [...new Set(modes)],
    ['600'],
    `modes of the key file as it was written: ${modes.join(', ')}`,
  );
  const stored = JSON.parse(readFileSync(join(home, 'credentials.json'), 'utf8'));
  assert.equal(stored.openai_api_key, 'sk-test-owner-only');
});

test('setup creates a missing PLANR_HOME owner-only under a group-writable umask', {
  skip: process.platform === 'win32' && 'POSIX file modes',
}, () => {
  const home = join(tmp(), 'fresh-home');
  const result = setup(home, { umask: 0o002 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, 'credentials.json')).mode & 0o777, 0o600);
});

const OLD_KEY = 'sk-old-7731-kept';
const OTHER_TOOLS = { linear: 'lin-kept', 'company:acme': 'acme-kept', openai_api_key: OLD_KEY };
for (const [label, bytes, reason, mode] of [
  [
    'truncated',
    Buffer.from(`{"linear": "lin-kept", "openai_api_key": "${OLD_KEY}`),
    'not valid JSON',
  ],
  [
    'not UTF-8',
    Buffer.concat([Buffer.from(`{"openai_api_key": "${OLD_KEY}`), Buffer.from([0xff, 0x22, 0x7d])]),
    'not valid JSON',
  ],
  ['an array', Buffer.from('[]'), 'not a JSON object'],
  ['a bare string', Buffer.from(JSON.stringify(OLD_KEY)), 'not a JSON object'],
  ['unreadable', Buffer.from(JSON.stringify(OTHER_TOOLS)), 'EACCES', 0o000],
]) {
  test(`setup keeps a credentials file that is ${label} and never echoes it`, {
    skip:
      (process.platform === 'win32' && 'POSIX file modes') ||
      (mode === 0o000 && process.getuid?.() === 0 && 'root reads mode-000 files'),
  }, () => {
    const home = tmp();
    const file = join(home, 'credentials.json');
    writeFileSync(file, bytes);
    if (mode !== undefined) chmodSync(file, mode);

    const result = setup(home, { key: 'sk-new-owner-key' });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      result.stderr.includes(
        `${file} is unreadable (${reason}); it was left unchanged. Repair it or move it aside, then retry.`,
      ),
      result.stderr,
    );
    for (const output of [result.stdout, result.stderr])
      assert.equal(output.includes(OLD_KEY), false, 'no output contains the stored key');
    if (mode !== undefined) {
      assert.equal(statSync(file).mode & 0o777, mode);
      chmodSync(file, 0o600);
    }
    assert.deepEqual(readFileSync(file), bytes, 'the file is byte-identical');
  });
}
