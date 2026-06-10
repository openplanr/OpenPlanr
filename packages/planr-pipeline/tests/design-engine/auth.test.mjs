import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';

import { resolveAuth } from '../../lib/design-engine/auth.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'planr-auth-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

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
  assert.ok(auth.warnings.some((w) => w.startsWith('DISCLOSURE')), 'billing disclosure present');
  assert.ok(auth.warnings.some((w) => w.startsWith('SECURITY')), 'not-gitignored warning present');
  assert.ok(!auth.warnings.join(' ').includes('sk-shared'), 'the key itself is never echoed');
});

test('gitignored .env carrying the key → disclosure only, no SECURITY warning', () => {
  const cwd = tmp();
  writeFileSync(join(cwd, '.env.local'), "OPENAI_API_KEY='sk-shared'\n");
  const auth = resolveAuth({ cwd, env: { PLANR_HOME: tmp(), OPENAI_API_KEY: 'sk-shared' }, checkIgnore: () => true });
  assert.ok(auth.warnings.some((w) => w.startsWith('DISCLOSURE')));
  assert.ok(!auth.warnings.some((w) => w.startsWith('SECURITY')));
});

test('order 3: nothing resolves → source none, apiKey null (caller offers claude-svg)', () => {
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: tmp() } });
  assert.deepEqual({ apiKey: auth.apiKey, source: auth.source }, { apiKey: null, source: 'none' });
});

test('corrupt credentials.json falls through to env with a warning', () => {
  const home = tmp();
  writeFileSync(join(home, 'credentials.json'), '{not json');
  const auth = resolveAuth({ cwd: tmp(), env: { PLANR_HOME: home, OPENAI_API_KEY: 'sk-env' } });
  assert.equal(auth.source, 'env');
  assert.ok(auth.warnings.some((w) => w.includes('could not be parsed')));
});
