import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDesignSkillResources } from '../../../scripts/skills/design-resources.mjs';
import { designFixture } from './design-fixture.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('portable Studio launches pooled designs, reports manifest identity, reuses and stops outside the source checkout', async (t) => {
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
  const resources = await buildDesignSkillResources({ repoRoot });
  for (const required of [
    'scripts/runtime/packages/design/package.json',
    'scripts/runtime/packages/protocol/schemas/v1.16.0/artifact-envelope.schema.json',
    'scripts/runtime/packages/protocol/schemas/v1.16.0/design-review-bundle.schema.json',
  ])
    assert.ok(
      resources.some(({ path }) => path === required),
      `portable helper includes ${required}`,
    );
  for (const resource of resources) {
    const target = join(root, 'installed', resource.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, resource.bytes);
  }
  const { designUtility } = await import(pathToFileURL(join(root, 'installed/scripts/design.mjs')));
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
  const manifest = resources.find(
    ({ path }) => path === 'scripts/runtime/packages/design/package.json',
  );
  assert.equal(identity.packageVersion, JSON.parse(manifest.bytes.toString('utf8')).version);
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
