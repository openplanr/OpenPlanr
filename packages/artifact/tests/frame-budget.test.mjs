import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '../lib/artifact/ui/shell.mjs';
import { mountArtifactStage } from '../lib/artifact/ui/stage.mjs';

const { JSDOM } = createRequire(new URL('../../cli/package.json', import.meta.url))('jsdom');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, { budget = '3', resolver, bridge = true, transport = 'srcdoc' } = {}) {
  const artifacts = Array.from({ length: 9 }, (_, i) => ({
    id: `screen-${i}`,
    title: `Screen ${i}`,
    html: `<main>Screen ${i}</main>`,
  }));
  const envelope = createArtifactEnvelope({
    artifacts,
    viewer: { mode: 'single', activeArtifactId: 'screen-0' },
  });
  const dom = new JSDOM(renderArtifactShellDocument({ envelope }), {
    url: 'http://127.0.0.1/review/',
  });
  const { document } = dom.window,
    root = document.querySelector('.planr-shell');
  dom.window.TextDecoder = TextDecoder;
  if (budget !== null) root.dataset.planrFrameBudget = budget;
  const sourceRequests = [],
    attachments = [],
    detachments = [],
    revoked = [];
  let url = 0;
  dom.window.URL.createObjectURL = () => `blob:fixture-${++url}`;
  dom.window.URL.revokeObjectURL = (value) => revoked.push(value);
  const stage = mountArtifactStage({
    document,
    window: dom.window,
    sourceTransport: transport,
    resolveArtifactSource(artifact, context) {
      sourceRequests.push({ id: artifact.id, ...context });
      return resolver ? resolver(artifact, context) : `<main>${artifact.id}</main>`;
    },
    ...(bridge
      ? {
          bridgeClient: {
            attach({ artifact, frame }) {
              const identity = {};
              frame.__openPlanrBridge = identity;
              attachments.push({ id: artifact.id, identity });
              return () => {
                detachments.push(artifact.id);
                delete frame.__openPlanrBridge;
                delete frame.dataset.planrBridgeTrusted;
              };
            },
          },
        }
      : {}),
    hosted: { enabled: false },
    share: { available: false },
  });
  const loaded = (id) => stage.getFrame(id).dispatchEvent(new dom.window.Event('load'));
  const trusted = (id) => {
    const frame = stage.getFrame(id);
    frame.dataset.planrBridgeTrusted = 'true';
    frame.dispatchEvent(new dom.window.CustomEvent('planr:artifact-bridge-ready'));
  };
  const finish = async (id) => {
    await flush();
    loaded(id);
    if (bridge) trusted(id);
    await flush();
  };
  t.after(() => {
    stage.destroy();
    dom.window.close();
  });
  return {
    dom,
    stage,
    root,
    document,
    sourceRequests,
    attachments,
    detachments,
    revoked,
    loaded,
    trusted,
    finish,
  };
}

test('opt-in startup loads one document and waits for its authenticated bridge', async (t) => {
  const f = fixture(t, { resolver: (artifact) => `<main>${artifact.id}</main>` });
  await flush();
  assert.equal(f.stage.frameBudget, 3);
  assert.deepEqual(
    f.sourceRequests.map((value) => value.id),
    ['screen-0'],
  );
  assert.equal(f.stage.getFrame('screen-0').dataset.planrFrameState, 'loading');
  f.loaded('screen-0');
  await flush();
  assert.equal(
    f.stage.getState().status,
    'loading',
    'load alone must not make an opaque product frame usable',
  );
  f.trusted('screen-0');
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'ready');
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
  for (let i = 1; i < 9; i++) {
    assert.equal(f.stage.getFrame(`screen-${i}`).dataset.planrFrameState, 'unloaded');
    assert.equal(f.stage.getFrame(`screen-${i}`).hasAttribute('srcdoc'), false);
  }
});

test('bounded demand preparation is sequential, retains LRU documents and detaches evicted bridges', async (t) => {
  const f = fixture(t, { resolver: (artifact) => `<main>${artifact.id}</main>` });
  await f.finish('screen-0');
  await f.stage.ready;
  const batch = f.stage.ensureFrames(['screen-0', 'screen-1', 'screen-2']);
  await flush();
  assert.deepEqual(
    f.sourceRequests.map((value) => value.id),
    ['screen-0', 'screen-1'],
  );
  await f.finish('screen-1');
  assert.equal(f.sourceRequests.at(-1).id, 'screen-2');
  await f.finish('screen-2');
  await batch;
  const originalBridge = f.stage.getFrame('screen-0').__openPlanrBridge;
  await f.stage.ensureFrames(['screen-2', 'screen-1']);
  const next = f.stage.ensureFrames(['screen-1', 'screen-3']);
  await flush();
  assert.equal(f.stage.getFrame('screen-0').dataset.planrFrameState, 'unloaded');
  assert.equal(f.stage.getFrame('screen-0').hasAttribute('srcdoc'), false);
  assert.equal(f.stage.getFrame('screen-0').__openPlanrBridge, undefined);
  assert.deepEqual(f.detachments, ['screen-0']);
  assert.equal(f.document.querySelectorAll('iframe[srcdoc]').length, 3);
  await f.finish('screen-3');
  await next;
  const back = f.stage.ensureFrames(['screen-0']);
  await f.finish('screen-0');
  await back;
  assert.notEqual(
    f.stage.getFrame('screen-0').__openPlanrBridge,
    originalBridge,
    'Revisiting an evicted frame must establish a fresh bridge',
  );
  assert.equal(f.stage.getLoadedArtifactIds().length, 3);
  assert.deepEqual(f.detachments, ['screen-0', 'screen-2']);
});

test('destroy cancels source preparation and queued demand without reviving a document', async (t) => {
  let resolveSource;
  const f = fixture(t, {
    resolver: (artifact) =>
      artifact.id === 'screen-1'
        ? new Promise((resolve) => {
            resolveSource = resolve;
          })
        : '<main>Loaded</main>',
  });
  await f.finish('screen-0');
  await f.stage.ready;
  const pending = f.stage.ensureFrames(['screen-1']);
  const queued = f.stage.ensureFrames(['screen-2']);
  const cancelled = Promise.all([
    assert.rejects(pending, { name: 'AbortError' }),
    assert.rejects(queued, { name: 'AbortError' }),
  ]);
  await flush();
  f.stage.destroy();
  resolveSource('<main>Late</main>');
  await cancelled;
  await flush();
  assert.equal(f.sourceRequests.at(-1).signal.aborted, true);
  assert.equal(f.document.querySelectorAll('iframe[srcdoc],iframe[src]').length, 0);
  assert.equal(f.attachments.length, 1);
  assert.deepEqual(f.stage.getLoadedArtifactIds(), []);
  assert.deepEqual(
    f.sourceRequests.map((value) => value.id),
    ['screen-0', 'screen-1'],
  );
});

test('failed sources release their slot and retry with a new authenticated bridge', async (t) => {
  let fail = true;
  const f = fixture(t, {
    resolver: (artifact) => {
      if (artifact.id === 'screen-1' && fail) throw Error('Interrupted source');
      return '<main>Ready</main>';
    },
  });
  await f.finish('screen-0');
  await f.stage.ready;
  await assert.rejects(f.stage.ensureFrames(['screen-1']), /Interrupted source/);
  assert.equal(f.stage.getFrame('screen-1').dataset.planrFrameState, 'error');
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
  fail = false;
  const retry = f.stage.ensureFrames(['screen-1']);
  await f.finish('screen-1');
  await retry;
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0', 'screen-1']);
  await assert.rejects(
    f.stage.ensureFrames(['screen-0', 'screen-1', 'screen-2', 'screen-3']),
    RangeError,
  );
  await assert.rejects(f.stage.ensureFrames(['unknown']), TypeError);
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0', 'screen-1']);
});

test('disposal removes load and trust listeners while an assigned document is awaiting authentication', async (t) => {
  const f = fixture(t);
  await f.finish('screen-0');
  await f.stage.ready;
  const pending = f.stage.ensureFrames(['screen-1']);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await flush();
  const frame = f.stage.getFrame('screen-1');
  f.loaded('screen-1');
  await flush();
  assert.equal(frame.dataset.planrFrameState, 'loading');
  f.stage.destroy();
  await cancelled;
  frame.dispatchEvent(new f.dom.window.Event('load'));
  frame.dispatchEvent(new f.dom.window.CustomEvent('planr:artifact-bridge-ready'));
  await flush();
  assert.equal(frame.dataset.planrFrameState, 'unloaded');
  assert.equal(frame.__openPlanrBridge, undefined);
  assert.equal(frame.hasAttribute('srcdoc'), false);
  assert.deepEqual(f.detachments, ['screen-0', 'screen-1']);
});

test('a ready frame that loses bridge trust cannot reuse its previous readiness', async (t) => {
  const f = fixture(t);
  await f.finish('screen-0');
  await f.stage.ready;
  const previous = f.stage.getFrame('screen-0').__openPlanrBridge;
  f.stage.getFrame('screen-0').dataset.planrBridgeTrusted = 'false';
  const requested = f.stage.ensureFrames(['screen-0']);
  await flush();
  assert.equal(f.stage.getFrame('screen-0').dataset.planrFrameState, 'loading');
  assert.notEqual(f.stage.getFrame('screen-0').__openPlanrBridge, previous);
  f.loaded('screen-0');
  await flush();
  assert.deepEqual(f.stage.getLoadedArtifactIds(), []);
  f.trusted('screen-0');
  await requested;
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
  assert.equal(f.sourceRequests.length, 2);
});

test('a startup source rejection reaches the ordinary unavailable state without an unhandled promise', async (t) => {
  const f = fixture(t, { resolver: () => Promise.reject(Error('Source unavailable')) });
  await f.stage.ready;
  await flush();
  assert.equal(f.stage.getState().status, 'invalid');
  assert.equal(f.stage.getFrame('screen-0').dataset.planrFrameState, 'error');
  assert.equal(f.stage.getLoadedArtifactIds().length, 0);
});

test('object URLs are revoked when documents are retired and on final disposal', async (t) => {
  const f = fixture(t, { bridge: false, transport: 'blob', resolver: () => '<main>Ready</main>' });
  await f.finish('screen-0');
  await f.stage.ready;
  for (let i = 1; i < 6; i++) {
    const loaded = f.stage.ensureFrames([`screen-${i}`]);
    await f.finish(`screen-${i}`);
    await loaded;
  }
  assert.equal(f.revoked.length, 3);
  assert.equal(new Set(f.revoked).size, 3);
  f.stage.destroy();
  assert.equal(f.revoked.length, 6);
  assert.equal(new Set(f.revoked).size, 6);
});

test('hosts without the opt-in retain eager all-artifact readiness', async (t) => {
  const f = fixture(t, { budget: null, resolver: () => '<main>Ready</main>' });
  await flush();
  assert.equal(f.stage.frameBudget, null);
  assert.equal(f.sourceRequests.length, 9);
  for (let i = 0; i < 9; i++) f.loaded(`screen-${i}`);
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'ready');
  assert.equal(f.stage.getLoadedArtifactIds().length, 9);
  const before = f.sourceRequests.length;
  await f.stage.ensureFrames(['screen-3', 'screen-8']);
  assert.equal(
    f.sourceRequests.length,
    before,
    'Ensuring already loaded eager frames does not reload them',
  );
});
