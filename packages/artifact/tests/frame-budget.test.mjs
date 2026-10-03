import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createArtifactEnvelope, createSharedArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '../lib/artifact/ui/shell.mjs';
import { mountArtifactStage } from '../lib/artifact/ui/stage.mjs';

const { JSDOM } = createRequire(new URL('../../cli/package.json', import.meta.url))('jsdom');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(
  t,
  {
    budget = '3',
    resolver,
    bridge = true,
    transport = 'srcdoc',
    count = 9,
    frameBudget,
    frameLoadTimeoutMs,
    omitResolver = false,
    assignedSource,
  } = {},
) {
  const artifacts = Array.from({ length: count }, (_, i) => ({
    id: `screen-${i}`,
    title: `Screen ${i}`,
    html: `<main>Screen ${i}</main>`,
  }));
  const viewer = { mode: 'single', activeArtifactId: 'screen-0' };
  const envelope =
    count > 256
      ? createSharedArtifactEnvelope({
          sources: [{ id: 'source', html: '<main>Shared screen</main>' }],
          artifacts: artifacts.map(({ html: _html, ...artifact }) => ({
            ...artifact,
            sourceId: 'source',
          })),
          viewer,
        })
      : createArtifactEnvelope({ artifacts, viewer });
  const dom = new JSDOM(renderArtifactShellDocument({ envelope }), {
    url: 'http://127.0.0.1/review/',
  });
  const { document } = dom.window,
    root = document.querySelector('.planr-shell');
  dom.window.TextDecoder = TextDecoder;
  const assignedFrame = document.querySelector('iframe');
  if (assignedSource) assignedFrame.srcdoc = assignedSource;
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
    ...(frameBudget === undefined ? {} : { frameBudget }),
    ...(frameLoadTimeoutMs === undefined ? {} : { frameLoadTimeoutMs }),
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
    ...(omitResolver ? { resolveArtifactSource: undefined } : {}),
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
    assignedFrame,
    sourceRequests,
    attachments,
    detachments,
    revoked,
    loaded,
    trusted,
    finish,
  };
}

test('bounded startup loads one document and waits for its authenticated bridge', async (t) => {
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

test('a 465-view catalog retains dormant frame identities and hosts without connected preview contexts', async (t) => {
  let resolveSource;
  const f = fixture(t, {
    count: 465,
    resolver: (artifact) =>
      artifact.id === 'screen-0'
        ? new Promise((resolve) => {
            resolveSource = resolve;
          })
        : '<main>Ready</main>',
  });
  const first = f.stage.getFrame('screen-0');
  const dormant = f.stage.getFrame('screen-464');
  const host = f.stage.getPanel('screen-464').querySelector('.planr-frame');
  assert.equal(f.document.querySelectorAll('.planr-artifact-panel').length, 465);
  assert.equal(f.document.querySelectorAll('.planr-frame').length, 465);
  assert.equal(f.document.querySelectorAll('iframe').length, 0);
  assert.equal(dormant.isConnected, false);
  await flush();
  resolveSource('<main>Ready</main>');
  await f.finish('screen-0');
  await f.stage.ready;
  const firstWindow = first.contentWindow;
  for (const action of [
    { type: 'set-review-mode', reviewMode: 'comment' },
    { type: 'set-review-mode', reviewMode: 'interact' },
    { type: 'set-theme', theme: 'dark' },
  ])
    f.stage.dispatch(action);
  assert.equal(f.stage.getFrame('screen-0'), first);
  assert.equal(first.contentWindow, firstWindow);
  assert.equal(f.document.querySelectorAll('iframe').length, 1);
  const demand = f.stage.ensureFrames(['screen-0', 'screen-463', 'screen-464']);
  await f.finish('screen-463');
  await f.finish('screen-464');
  await demand;
  assert.equal(f.stage.getFrame('screen-464'), dormant);
  assert.equal(dormant.parentElement, host);
  assert.equal(f.document.querySelectorAll('iframe').length, 3);
  f.stage.destroy();
  assert.equal(f.document.querySelectorAll('iframe').length, 0);
  assert.equal(f.document.querySelectorAll('.planr-frame').length, 465);
});

test('a source completing after its frame host is removed cannot reconnect a preview context', async (t) => {
  let resolveSource;
  const f = fixture(t, {
    resolver: (artifact) =>
      artifact.id === 'screen-8'
        ? new Promise((resolve) => {
            resolveSource = resolve;
          })
        : '<main>Ready</main>',
  });
  await f.finish('screen-0');
  await f.stage.ready;
  const frame = f.stage.getFrame('screen-8');
  const pending = f.stage.ensureFrames(['screen-8']);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await flush();
  f.stage.getPanel('screen-8').querySelector('.planr-frame').remove();
  resolveSource('<main>Late source</main>');
  await cancelled;
  assert.equal(frame.isConnected, false);
  assert.equal(frame.hasAttribute('srcdoc'), false);
  assert.equal(frame.__openPlanrBridge, undefined);
  assert.equal(f.document.querySelectorAll('iframe').length, 1);
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
});

test('an already assigned legacy frame retains its existing context while source preparation is pending', async (t) => {
  const f = fixture(t, {
    assignedSource: '<main>Existing source</main>',
    resolver: () => new Promise(() => {}),
  });
  const frame = f.assignedFrame;
  const context = frame.contentWindow;
  await flush();
  f.stage.dispatch({ type: 'set-review-mode', reviewMode: 'comment' });
  assert.equal(f.stage.getFrame('screen-0'), frame);
  assert.equal(frame.isConnected, true);
  assert.equal(frame.contentWindow, context);
  assert.equal(frame.srcdoc, '<main>Existing source</main>');
  assert.equal(f.document.querySelectorAll('iframe').length, 1);
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
  assert.equal(f.stage.getFrame('screen-0').isConnected, false);
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

test('leaving a document cancels pending and queued sources without a late revival', async (t) => {
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
  const signal = f.sourceRequests.at(-1).signal;
  let aborts = 0;
  signal.addEventListener('abort', () => aborts++);
  f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide'));
  assert.equal(signal.aborted, true);
  assert.equal(aborts, 1);
  assert.equal(f.document.querySelectorAll('iframe').length, 0);
  resolveSource('<main>Too late</main>');
  await cancelled;
  await flush();
  assert.deepEqual(
    f.sourceRequests.map(({ id }) => id),
    ['screen-0', 'screen-1'],
  );
  assert.deepEqual(f.stage.getLoadedArtifactIds(), []);
  assert.equal(f.stage.getFrame('screen-1').isConnected, false);
  assert.equal(f.stage.getFrame('screen-1').hasAttribute('srcdoc'), false);
  assert.equal(f.attachments.length, 1);
  f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide'));
  f.stage.destroy();
  assert.equal(aborts, 1, 'Repeated cleanup cannot abort another owner or revive a source');
});

test('persisted pagehide preserves ready window state and unfinished source custody', async (t) => {
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
  const frame = f.stage.getFrame('screen-0');
  const activeWindow = frame.contentWindow;
  const bridge = frame.__openPlanrBridge;
  const source = frame.srcdoc;
  const pending = f.stage.ensureFrames(['screen-1']);
  await flush();
  const signal = f.sourceRequests.at(-1).signal;
  f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(signal.aborted, false);
  assert.equal(frame.isConnected, true);
  assert.equal(frame.contentWindow, activeWindow);
  assert.equal(frame.__openPlanrBridge, bridge);
  assert.equal(frame.srcdoc, source);
  assert.deepEqual(f.detachments, []);
  resolveSource('<main>Resume</main>');
  await f.finish('screen-1');
  await pending;
  assert.equal(f.stage.getFrame('screen-1').dataset.planrFrameState, 'ready');
  assert.equal(frame.contentWindow, activeWindow);
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
  assert.equal(f.stage.getFrame('screen-1').isConnected, false);
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

test('explicit eager hosts retain all-artifact loading but wait for the active authenticated frame', async (t) => {
  const f = fixture(t, { budget: null, frameBudget: null, resolver: () => '<main>Ready</main>' });
  await flush();
  assert.equal(f.stage.frameBudget, null);
  assert.equal(f.document.querySelectorAll('iframe').length, 9);
  assert.equal(f.sourceRequests.length, 9);
  for (let i = 0; i < 9; i++) f.loaded(`screen-${i}`);
  assert.equal(f.stage.getState().status, 'loading');
  for (let i = 0; i < 9; i++) f.trusted(`screen-${i}`);
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

test('a 186-artifact host is bounded by default and an inactive failure does not invalidate its active screen', async (t) => {
  const f = fixture(t, {
    budget: null,
    count: 186,
    resolver: (artifact) =>
      artifact.id === 'screen-185'
        ? Promise.reject(Error('Unavailable inactive source'))
        : '<main>Ready</main>',
  });
  await f.finish('screen-0');
  await f.stage.ready;
  assert.equal(f.stage.frameBudget, 3);
  assert.equal(f.sourceRequests.length, 1);
  assert.equal(f.document.querySelectorAll('iframe[srcdoc]').length, 1);
  await assert.rejects(f.stage.ensureFrames(['screen-185']), /Unavailable inactive source/);
  assert.equal(f.stage.getState().status, 'ready');
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
  const failed = f.stage
    .getFrameDiagnostics()
    .find(({ artifactId }) => artifactId === 'screen-185');
  assert.equal(failed.failedPhase, 'source');
  assert.equal(failed.code, 'E_ARTIFACT_FRAME_LOAD');
  assert.ok(failed.elapsedMs >= 0);
});

test('selecting a frame loads it on demand and returning to a trusted ready frame is immediate', async (t) => {
  const f = fixture(t, { budget: null });
  await f.finish('screen-0');
  await f.stage.ready;
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-8' });
  await flush();
  assert.equal(f.stage.getState().status, 'loading');
  assert.equal(f.sourceRequests.at(-1).id, 'screen-8');
  await f.finish('screen-8');
  assert.equal(f.stage.getState().status, 'ready');
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-0' });
  assert.equal(f.stage.getState().status, 'ready');
  assert.equal(f.sourceRequests.length, 2);
});

test('an unresolved source has a bounded deadline, phase evidence, and a working retry action', async (t) => {
  let interrupted = true;
  const f = fixture(t, {
    budget: null,
    frameLoadTimeoutMs: 25,
    resolver: () => (interrupted ? new Promise(() => {}) : '<main>Recovered</main>'),
  });
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'invalid');
  const diagnostic = f.stage.getFrameDiagnostics()[0];
  assert.equal(diagnostic.status, 'error');
  assert.equal(diagnostic.failedPhase, 'source');
  assert.equal(diagnostic.code, 'E_ARTIFACT_FRAME_TIMEOUT');
  assert.ok(diagnostic.elapsedMs >= 20);
  const retry = f.document.querySelector('[data-planr-action="retry-frame"]');
  assert.equal(retry.hidden, false);
  assert.match(f.document.querySelector('.planr-stage-status p').textContent, /source step/);
  interrupted = false;
  retry.click();
  await f.finish('screen-0');
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'ready');
  assert.equal(f.stage.getFrameDiagnostics()[0].attempt, 2);
});

test('an explicit eager host settles all untrusted frames with deadlines while its active trusted frame stays ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { budget: null, frameBudget: null, frameLoadTimeoutMs: 100 });
  await f.finish('screen-0');
  await f.stage.ready;
  for (let i = 1; i < 9; i++) f.loaded(`screen-${i}`);
  t.mock.timers.tick(100);
  await flush();
  assert.equal(f.stage.getState().status, 'ready');
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
  const failed = f.stage.getFrameDiagnostics().filter(({ status }) => status === 'error');
  assert.equal(failed.length, 8);
  assert.ok(
    failed.every(
      ({ failedPhase, code }) => failedPhase === 'bridge' && code === 'E_ARTIFACT_FRAME_TIMEOUT',
    ),
  );
});

test('a new selection preempts an inactive load instead of waiting for its deadline', async (t) => {
  let resolveInactive;
  const f = fixture(t, {
    resolver: (artifact) =>
      artifact.id === 'screen-1'
        ? new Promise((resolve) => {
            resolveInactive = resolve;
          })
        : '<main>Ready</main>',
  });
  await f.finish('screen-0');
  await f.stage.ready;
  const old = f.stage.ensureFrames(['screen-1']);
  const cancelled = assert.rejects(old, { name: 'AbortError' });
  await flush();
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-2' });
  await cancelled;
  await f.finish('screen-2');
  assert.equal(f.stage.getState().status, 'ready');
  assert.equal(f.stage.getState().activeArtifactId, 'screen-2');
  resolveInactive('<main>Late</main>');
  await flush();
  assert.equal(f.stage.getFrame('screen-1').hasAttribute('srcdoc'), false);
  assert.equal(f.stage.getFrame('screen-1').isConnected, false);
});

test('returning to a ready screen cancels an unfinished selection and restores stage readiness', async (t) => {
  const f = fixture(t, {
    resolver: (artifact) =>
      artifact.id === 'screen-1' ? new Promise(() => {}) : '<main>Ready</main>',
  });
  await f.finish('screen-0');
  await f.stage.ready;
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-1' });
  await flush();
  assert.equal(f.stage.getState().status, 'loading');
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-0' });
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'ready');
  assert.equal(f.stage.getFrame('screen-1').dataset.planrFrameState, 'unloaded');
});

test('missing source configuration settles as actionable failure rather than indefinite loading', async (t) => {
  const f = fixture(t, { omitResolver: true });
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'invalid');
  assert.equal(f.stage.getFrameDiagnostics()[0].code, 'E_ARTIFACT_SOURCE_UNAVAILABLE');
  assert.equal(f.document.querySelector('[data-planr-action="retry-frame"]').hidden, false);
});

test('rapid A to B to A selection discards queued B and cannot invalidate the replacement A', async (t) => {
  const pending = [];
  const f = fixture(t, {
    resolver: (artifact, context) =>
      new Promise((resolve) => {
        pending.push({ id: artifact.id, signal: context.signal, resolve });
      }),
  });
  await flush();
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-1' });
  f.stage.dispatch({ type: 'set-active', artifactId: 'screen-0' });
  await flush();
  assert.equal(f.stage.getState().activeArtifactId, 'screen-0');
  assert.equal(f.stage.getState().status, 'loading');
  assert.deepEqual(
    pending.map(({ id }) => id),
    ['screen-0', 'screen-0'],
  );
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(f.stage.getFrame('screen-1').dataset.planrFrameState, 'unloaded');
  pending[0].resolve('<main>Retired source</main>');
  await flush();
  assert.equal(f.stage.getFrame('screen-0').hasAttribute('srcdoc'), false);
  assert.equal(f.stage.getState().status, 'loading');
  pending[1].resolve('<main>Current source</main>');
  await f.finish('screen-0');
  await f.stage.ready;
  assert.equal(f.stage.getState().status, 'ready');
  assert.match(f.stage.getFrame('screen-0').srcdoc, /Current source/);
  assert.deepEqual(f.stage.getLoadedArtifactIds(), ['screen-0']);
});
