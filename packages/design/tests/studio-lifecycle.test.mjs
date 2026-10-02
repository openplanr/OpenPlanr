import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createArtifactReviewServer,
  listArtifactReviewServers,
} from '@openplanr/artifact/review-server.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { manageDesignStudio } from '../lib/design/studio-lifecycle.mjs';
import { designUtility } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-design-lifecycle-'));
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const closers = [];
  const signalListeners = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((name) => [name, process.listeners(name)]),
  );
  t.after(async () => {
    for (const close of closers) await close();
    for (const [name, original] of Object.entries(signalListeners))
      for (const listener of process.listeners(name))
        if (!original.includes(listener)) process.removeListener(name, listener);
    rmSync(root, { recursive: true, force: true });
  });
  async function design(name, options = {}) {
    const directory = join(root, name);
    mkdirSync(directory);
    const result = designFixture(directory, {
      count: 1,
      frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
      ...options,
    });
    await renderDesignDocument(result.file);
    return { ...result, directory };
  }
  async function start(file) {
    const session = await startDesignReview(file, { env, noOpen: true });
    if (session.close) closers.push(session.close);
    return session;
  }
  return { root, env, closers, design, start };
}

async function waitForStop(file, env) {
  for (let count = 0; count < 30; count++) {
    const result = await manageDesignStudio(file, { env });
    if (result.status === 'stopped') return result;
    await delay(20);
  }
  assert.fail('Studio did not finish shutdown.');
}

test('private Studio utility reports real ownership, reuses a service and safely reopens after stop', async (t) => {
  const context = await fixture(t);
  const design = await context.design('first');
  const run = (args) => designUtility(args, { env: context.env, stdout() {} });
  assert.equal((await run(['studio', design.file, '--action', 'status'])).status, 'stopped');
  const session = await run(['open', design.file, '--no-open']);
  context.closers.push(session.close);
  assert.match(session.url, /\/studio\/operations\/$/u);
  assert.equal(
    (await fetch(new URL('/', session.url), { redirect: 'manual' })).headers.get('location'),
    '/studio',
  );
  const status = await run(['studio', design.file, '--action', 'status']);
  assert.equal(status.status, 'running');
  assert.equal(status.instanceId, session.instanceId);
  assert.equal(status.url, session.url);
  assert.equal(status.browserStatus, 'loading');
  assert.equal(status.verification, 'unverified');
  assert.equal(status.services.length, 1);
  assert.doesNotMatch(JSON.stringify(status), /controlToken|capability|\/r\//u);
  const reused = await context.start(design.file);
  assert.equal(reused.reused, true);
  assert.equal(reused.url, session.url);
  const stopped = await run(['studio', design.file, '--action', 'stop']);
  assert.equal(stopped.status, 'stopping');
  assert.equal(stopped.instanceId, session.instanceId);
  assert.equal((await waitForStop(design.file, context.env)).status, 'stopped');
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 0);
  const reopened = await context.start(design.file);
  assert.notEqual(reopened.instanceId, session.instanceId);
  assert.notEqual(reopened.url, session.url);
  assert.equal((await run(['studio', design.file])).instanceId, reopened.instanceId);
  await assert.rejects(run(['studio', design.file, '--action', 'delete']), /status or stop/u);
});

test('a missing or foreign launcher identity never stops another project service', async (t) => {
  const context = await fixture(t);
  const first = await context.design('first'),
    second = await context.design('second');
  const own = await context.start(first.file),
    foreign = await context.start(second.file);
  const ownStatePath = join(currentDesign(first.file).root, '.design/server.json');
  const ownState = readFileSync(ownStatePath, 'utf8');
  const foreignState = readFileSync(
    join(currentDesign(second.file).root, '.design/server.json'),
    'utf8',
  );
  writeFileSync(ownStatePath, foreignState);
  const attention = await manageDesignStudio(first.file, { env: context.env });
  assert.equal(attention.status, 'attention');
  assert.equal(attention.services.length, 1);
  assert.equal(attention.services[0].instanceId, own.instanceId);
  assert.equal(
    (await manageDesignStudio(first.file, { action: 'stop', env: context.env })).instanceId,
    own.instanceId,
  );
  assert.equal(
    (await manageDesignStudio(second.file, { env: context.env })).instanceId,
    foreign.instanceId,
  );
  writeFileSync(ownStatePath, ownState);
  await manageDesignStudio(first.file, { action: 'stop', env: context.env });
  await waitForStop(first.file, context.env);
  assert.equal((await manageDesignStudio(second.file, { env: context.env })).status, 'running');
});

test('selected readiness rejects duplicate or unknown IDs and never claims complete coverage from their count', async (t) => {
  const context = await fixture(t);
  const design = await context.design('coverage', { count: 2 });
  const session = await context.start(design.file);
  const current = currentDesign(design.file);
  const statePath = join(current.root, '.design/server.json');
  const privateUrl = JSON.parse(readFileSync(statePath, 'utf8')).url;
  const ready = (artifacts, revision = current.revision) =>
    fetch(`${privateUrl}api/design-ready`, {
      method: 'POST',
      headers: { origin: new URL(privateUrl).origin, 'content-type': 'application/json' },
      body: JSON.stringify({ revision, status: 'ready', artifacts }),
    });
  const ids = current.entries.map((entry) => entry.artifactId);
  assert.equal((await ready([])).status, 400);
  assert.equal((await ready(['unknown'])).status, 400);
  assert.equal((await ready(ids.map(() => ids[0]))).status, 400);
  assert.equal((await ready([ids[0]])).status, 200);
  assert.equal(
    JSON.parse(readFileSync(join(current.root, '.design/browser-ready.json'), 'utf8')).coverage,
    'selected',
  );
  assert.equal(
    (await manageDesignStudio(design.file, { env: context.env })).browserStatus,
    'ready',
  );
  assert.equal((await ready(ids)).status, 200);
  assert.equal(
    JSON.parse(readFileSync(join(current.root, '.design/browser-ready.json'), 'utf8')).coverage,
    'complete',
  );
  const sourcePath = join(current.root, 'source/screen-1.html');
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace('12 active tasks', '13 active tasks'),
  );
  await renderDesignDocument(design.file);
  assert.equal((await ready(ids)).status, 400);
  assert.equal(
    (await manageDesignStudio(design.file, { env: context.env })).browserStatus,
    'loading',
  );
  assert.equal(session.instanceId, (await context.start(design.file)).instanceId);
});

test('runtime identity names canonical source content and updates for authored changes while retaining renderer identity', async (t) => {
  const context = await fixture(t);
  const design = await context.design('identity');
  const session = await context.start(design.file);
  async function identity() {
    const shell = await fetch(session.url);
    const cookie = shell.headers.get('set-cookie').split(';')[0];
    const runtime = await fetch(`${session.url}runtime.js`, { headers: { cookie } }).then(
      (response) => response.text(),
    );
    return JSON.parse(runtime.match(/"runtimeIdentity":(\{[^}]+\})/u)[1]);
  }
  const original = await identity();
  assert.equal(original.launchContext, 'local Studio');
  assert.equal(
    original.packageVersion,
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  );
  assert.equal(original.rendererIdentity, currentDesign(design.file).rendererRevision);
  assert.match(original.moduleIdentity, /^[a-f0-9]{64}$/u);
  assert.match(original.artifactDigest, /^[a-f0-9]{64}$/u);
  await renderDesignDocument(design.file, { rendererRevision: 'runtime-change' });
  const rerendered = await identity();
  assert.equal(rerendered.sourceHash, original.sourceHash);
  assert.notEqual(rerendered.rendererIdentity, original.rendererIdentity);
  const sourcePath = join(currentDesign(design.file).root, 'source/screen-1.html');
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace('12 active tasks', '13 active tasks'),
  );
  await renderDesignDocument(design.file, { rendererRevision: 'runtime-change' });
  const edited = await identity();
  assert.notEqual(edited.sourceHash, original.sourceHash);
  assert.equal(edited.rendererIdentity, rerendered.rendererIdentity);
});

test('opening under another state directory cannot reuse or replace an unowned Studio', async (t) => {
  const context = await fixture(t);
  const design = await context.design('state-home');
  const session = await context.start(design.file);
  const launcherPath = join(currentDesign(design.file).root, '.design/server.json');
  const arrangementPath = join(currentDesign(design.file).root, '.design/studio-state.json');
  const launcher = readFileSync(launcherPath, 'utf8');
  const arrangement = existsSync(arrangementPath) ? readFileSync(arrangementPath, 'utf8') : null;
  const otherEnv = { ...context.env, PLANR_HOME: join(context.root, 'other-home') };
  await assert.rejects(
    startDesignReview(design.file, { env: otherEnv, noOpen: true, view: 'prototype' }),
    (error) =>
      error.code === 'E_ARTIFACT_LOOPBACK_STATE' &&
      /original session or PLANR_HOME/u.test(error.message),
  );
  assert.equal(readFileSync(launcherPath, 'utf8'), launcher);
  assert.equal(
    existsSync(arrangementPath) ? readFileSync(arrangementPath, 'utf8') : null,
    arrangement,
  );
  assert.equal((await listArtifactReviewServers({ env: otherEnv })).length, 0);
  assert.equal(
    (await manageDesignStudio(design.file, { env: context.env })).instanceId,
    session.instanceId,
  );
  const reused = await context.start(design.file);
  assert.equal(reused.reused, true);
  assert.equal(reused.instanceId, session.instanceId);
});

test('changed Studio settings require stopping the exact owned service before reopening', async (t) => {
  const context = await fixture(t);
  const design = await context.design('settings');
  const foreignDesign = await context.design('other-project');
  const session = await context.start(design.file);
  const foreign = await context.start(foreignDesign.file);
  const launcherPath = join(currentDesign(design.file).root, '.design/server.json');
  const arrangementPath = join(currentDesign(design.file).root, '.design/studio-state.json');
  const launcher = readFileSync(launcherPath, 'utf8');
  const arrangement = existsSync(arrangementPath) ? readFileSync(arrangementPath, 'utf8') : null;
  for (const options of [{ sourceTransport: 'blob' }, { frameBudget: 1 }, { port: 1 }]) {
    await assert.rejects(
      startDesignReview(design.file, {
        env: context.env,
        noOpen: true,
        view: 'prototype',
        ...options,
      }),
      /already running with different settings or runtime/u,
    );
    assert.equal(readFileSync(launcherPath, 'utf8'), launcher);
    assert.equal(
      existsSync(arrangementPath) ? readFileSync(arrangementPath, 'utf8') : null,
      arrangement,
    );
    assert.equal((await listArtifactReviewServers({ env: context.env })).length, 2);
    assert.equal(
      (await manageDesignStudio(design.file, { env: context.env })).instanceId,
      session.instanceId,
    );
  }
  const legacyLauncher = { ...JSON.parse(launcher), version: '1.3.0' };
  writeFileSync(launcherPath, JSON.stringify(legacyLauncher));
  await assert.rejects(context.start(design.file), /different settings or runtime/u);
  assert.equal(readFileSync(launcherPath, 'utf8'), JSON.stringify(legacyLauncher));
  writeFileSync(launcherPath, launcher);
  assert.equal(
    (await manageDesignStudio(design.file, { env: context.env, action: 'stop' })).instanceId,
    session.instanceId,
  );
  await waitForStop(design.file, context.env);
  const changed = await startDesignReview(design.file, {
    env: context.env,
    noOpen: true,
    sourceTransport: 'blob',
    frameBudget: 1,
  });
  context.closers.push(changed.close);
  assert.notEqual(changed.instanceId, session.instanceId);
  assert.equal(
    (await manageDesignStudio(foreignDesign.file, { env: context.env })).instanceId,
    foreign.instanceId,
  );
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 2);
});

test('reuse refuses missing or obsolete observed runtime identity without replacing custody', async (t) => {
  const context = await fixture(t);
  const design = await context.design('obsolete-runtime');
  const session = await context.start(design.file);
  const launcherPath = join(currentDesign(design.file).root, '.design/server.json');
  const launcher = readFileSync(launcherPath, 'utf8');
  for (const changed of [
    'missing',
    'moduleIdentity',
    'sourceHash',
    'artifactDigest',
    'rendererIdentity',
  ]) {
    const observeOldRuntime = async (url, options) => {
      const response = await fetch(url, options);
      if (!String(url).endsWith('api/design-status')) return response;
      const data = await response.json();
      if (changed === 'missing') delete data.runtimeIdentity;
      else data.runtimeIdentity[changed] = '0'.repeat(64);
      return Response.json(data);
    };
    await assert.rejects(
      startDesignReview(design.file, {
        env: context.env,
        noOpen: true,
        fetchImpl: observeOldRuntime,
      }),
      /different settings or runtime/u,
    );
    assert.equal(readFileSync(launcherPath, 'utf8'), launcher);
    assert.equal((await listArtifactReviewServers({ env: context.env })).length, 1);
    assert.equal(
      (await manageDesignStudio(design.file, { env: context.env })).instanceId,
      session.instanceId,
    );
  }
  const reused = await context.start(design.file);
  assert.equal(reused.reused, true);
  assert.equal(reused.instanceId, session.instanceId);
});

test('a stale private session link does not strand its live service and stop restores a clean launch', async (t) => {
  const context = await fixture(t);
  const design = await context.design('stale-link');
  const session = await context.start(design.file);
  const launcherPath = join(currentDesign(design.file).root, '.design/server.json');
  const state = JSON.parse(readFileSync(launcherPath, 'utf8'));
  state.url = state.url.replace(/\/r\/([^/]+)\/[^/]+\//u, `/r/$1/${'X'.repeat(43)}/`);
  writeFileSync(launcherPath, JSON.stringify(state));
  await assert.rejects(context.start(design.file), /saved session link is unavailable/u);
  assert.equal(readFileSync(launcherPath, 'utf8'), JSON.stringify(state));
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 1);
  assert.equal(
    (await manageDesignStudio(design.file, { action: 'stop', env: context.env })).instanceId,
    session.instanceId,
  );
  await waitForStop(design.file, context.env);
  const restored = await context.start(design.file);
  assert.notEqual(restored.instanceId, session.instanceId);
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 1);
});

test('a missing launcher can stop the sole exact authenticated owner before reopening', async (t) => {
  const context = await fixture(t);
  const design = await context.design('missing-link');
  const foreignDesign = await context.design('foreign-owner');
  const session = await context.start(design.file);
  const foreign = await context.start(foreignDesign.file);
  const launcherPath = join(currentDesign(design.file).root, '.design/server.json');
  rmSync(launcherPath);
  const status = await manageDesignStudio(design.file, { env: context.env });
  assert.equal(status.status, 'attention');
  assert.match(status.notice, /Stop.*then open/u);
  await assert.rejects(context.start(design.file), /saved session link is unavailable/u);
  assert.equal(existsSync(launcherPath), false);
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 2);
  const stopped = await designUtility(['studio', design.file, '--action', 'stop'], {
    env: context.env,
    stdout() {},
  });
  assert.equal(stopped.instanceId, session.instanceId);
  await waitForStop(design.file, context.env);
  const reopened = await context.start(design.file);
  assert.notEqual(reopened.instanceId, session.instanceId);
  assert.equal(
    (await manageDesignStudio(foreignDesign.file, { env: context.env })).instanceId,
    foreign.instanceId,
  );
  assert.equal((await listArtifactReviewServers({ env: context.env })).length, 2);
});

test('multiple recovered owners require exact selection and cannot stop another project', async (t) => {
  const context = await fixture(t);
  const design = await context.design('multiple-owners');
  const foreignDesign = await context.design('foreign-selection');
  const original = await context.start(design.file);
  const foreign = await context.start(foreignDesign.file);
  const additional = createArtifactReviewServer({
    env: context.env,
    serverMetadata: { kind: 'design', projectRoot: currentDesign(design.file).root },
  });
  await additional.listen();
  context.closers.push(() => additional.close());
  rmSync(join(currentDesign(design.file).root, '.design/server.json'));
  const run = (args) =>
    designUtility(['studio', design.file, ...args], { env: context.env, stdout() {} });
  const status = await run(['--action', 'status']);
  assert.equal(status.status, 'attention');
  assert.equal(status.services.length, 2);
  assert.match(status.notice, /--instance-id/u);
  await assert.rejects(context.start(design.file), /saved session link is unavailable/u);
  await assert.rejects(run(['--action', 'stop']), /Multiple owned Studio services.*--instance-id/u);
  await assert.rejects(
    run(['--action', 'stop', '--instance-id', foreign.instanceId]),
    /not owned by this design/u,
  );
  await assert.rejects(
    manageDesignStudio(design.file, { env: context.env, action: 'stop', instanceId: null }),
    /valid exact instance ID/u,
  );
  const stopped = await run(['--action', 'stop', '--instance-id', original.instanceId]);
  assert.equal(stopped.instanceId, original.instanceId);
  for (let count = 0; count < 30; count++) {
    if (
      !(await listArtifactReviewServers({ env: context.env })).some(
        (service) => service.instanceId === original.instanceId,
      )
    )
      break;
    await delay(20);
  }
  const remaining = await run(['--action', 'status']);
  assert.equal(remaining.services.length, 1);
  assert.equal(remaining.services[0].instanceId, additional.instanceId);
  assert.equal(
    (await run(['--action', 'stop', '--instance-id', additional.instanceId])).instanceId,
    additional.instanceId,
  );
  await waitForStop(design.file, context.env);
  const reopened = await context.start(design.file);
  assert.notEqual(reopened.instanceId, original.instanceId);
  assert.equal(
    (await manageDesignStudio(foreignDesign.file, { env: context.env })).instanceId,
    foreign.instanceId,
  );
});
