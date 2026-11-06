import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { designUtility } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

test('Studio launches pooled designs, reports manifest identity, reuses and stops', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-portable-studio-'));
  const signals = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((name) => [name, process.listeners(name)]),
  );
  let close;
  t.after(async () => {
    await close?.();
    for (const [name, original] of Object.entries(signals))
      for (const listener of process.listeners(name))
        if (!original.includes(listener)) process.removeListener(name, listener);
    rmSync(root, { recursive: true, force: true });
  });
  const designRoot = join(root, 'design');
  mkdirSync(designRoot);
  const { file } = designFixture(designRoot, { count: 1 });
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const run = (args) => designUtility(args, { env, stdout() {} });
  const rendered = await run(['render', file]);
  assert.equal(rendered.ok, true);
  const opened = await run(['open', file, '--no-open']);
  close = opened.close;
  assert.match(opened.url, /\/studio\/operations\/$/u);
  const shell = await fetch(opened.url);
  assert.equal(shell.status, 200);
  const cookie = shell.headers.get('set-cookie').split(';')[0];
  const runtime = await fetch(`${opened.url}runtime.js`, { headers: { cookie } });
  assert.equal(runtime.status, 200);
  const identity = JSON.parse((await runtime.text()).match(/"runtimeIdentity":(\{[^}]+\})/u)[1]);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(identity.packageVersion, manifest.version);
  assert.match(identity.sourceHash, /^[a-f0-9]{64}$/u);
  const status = await run(['studio', file, '--action', 'status']);
  assert.equal(status.status, 'running');
  assert.equal(status.instanceId, opened.instanceId);
  assert.doesNotMatch(JSON.stringify(status), /controlToken|capability|\/r\//u);
  const reused = await run(['open', file, '--no-open']);
  assert.equal(reused.reused, true);
  assert.equal(reused.instanceId, opened.instanceId);
  assert.equal((await run(['studio', file, '--action', 'stop'])).status, 'stopping');
  await close();
  assert.equal((await run(['studio', file, '--action', 'status'])).status, 'stopped');
});
