import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '../lib/artifact/ui/shell.mjs';
import { artifactShareCapabilities, mountArtifactShareDialog, normalizeArtifactSharePreview } from '../lib/artifact/ui/share-dialog.mjs';

const { JSDOM } = createRequire(new URL('../../cli/package.json', import.meta.url))('jsdom');
const preview = { fragmentLength: 1200, compressedBytes: 890, ciphertextBytes: 918 };

function mount(t, options = {}) {
  const envelope = createArtifactEnvelope({ artifacts: [{ id: 'screen', title: 'Screen', html: '<main>Review me</main>' }] });
  const dom = new JSDOM(renderArtifactShellDocument({ envelope }), { url: 'http://127.0.0.1/review/' });
  const { document } = dom.window;
  const controller = mountArtifactShareDialog({ document, window: dom.window, ...options });
  t.after(() => { controller.destroy(); dom.window.close(); });
  return { document, controller, window: dom.window };
}

test('capabilities require real preparation and creation handlers and explicit owner custody for live rooms', () => {
  assert.deepEqual(artifactShareCapabilities(), []);
  assert.deepEqual(artifactShareCapabilities({ prepareShare() {} }), []);
  assert.deepEqual(artifactShareCapabilities({ createShare() {} }), []);
  const snapshots = { prepareShare() {}, createShare() {} };
  assert.deepEqual(artifactShareCapabilities(snapshots), ['fragment', 'short']);
  assert.deepEqual(artifactShareCapabilities({ ...snapshots, supportedTransports: ['live'] }), []);
  assert.deepEqual(artifactShareCapabilities({ ...snapshots, prepareOwnerCustody() {} }), ['live', 'fragment', 'short']);
  assert.deepEqual(artifactShareCapabilities({ ...snapshots, supportedTransports: ['short'] }), ['short']);
});

test('a host without sharing handlers shows actionable unavailable state before creation', async (t) => {
  const { controller, document } = mount(t);
  await controller.open();
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().preview, null);
  assert.match(controller.getState().error, /updated OpenPlanr installation/);
  for (const button of document.querySelectorAll('[data-planr-share-transport], [data-planr-share-confirm]')) assert.equal(button.disabled, true);
  assert.equal(document.querySelector('[data-planr-share-fragment-size]').textContent, 'Unavailable');
  assert.equal(document.querySelector('[data-planr-share-short-size]').textContent, 'Unavailable');
  assert.equal(document.querySelector('[data-planr-share-owner-custody]').hidden, true);
  await controller.confirm();
  assert.doesNotMatch(controller.getState().error, /not a function|0 B/);
});

test('snapshot hosts skip unsupported live room custody and actually create the selected snapshot', async (t) => {
  let creation;
  const copied = [];
  const { controller, document } = mount(t, {
    prepareShare: async () => preview,
    createShare: async (input) => { creation = input; return { transport: input.transport, url: 'https://share.openplanr.dev/#v1.fixture' }; },
    copyText: async (value) => copied.push(value),
  });
  await controller.open();
  assert.equal(controller.getState().transport, 'fragment');
  assert.equal(document.querySelector('[data-planr-share-transport="live"]').disabled, true);
  assert.equal(document.querySelector('[data-planr-share-confirm]').disabled, false);
  controller.dispatch({ type: 'select-transport', transport: 'live' });
  assert.equal(controller.getState().transport, 'fragment', 'programmatic selection cannot bypass capability gating');
  await controller.confirm();
  assert.equal(creation.transport, 'fragment');
  assert.equal(controller.getState().phase, 'created');
  assert.deepEqual(copied, ['https://share.openplanr.dev/#v1.fixture']);
});

test('preparation failure has accurate unavailable metrics and can retry', async (t) => {
  let attempts = 0;
  const { controller, document } = mount(t, {
    supportedTransports: ['short'],
    prepareShare: async () => { if (++attempts === 1) throw new Error('Design is still loading. Retry preparation.'); return preview; },
    createShare: async () => { throw new Error('not called'); },
  });
  const trigger = document.querySelector('[data-planr-action="share"]');
  trigger.focus();
  await controller.open();
  assert.equal(document.querySelector('[data-planr-share-short-size]').textContent, 'Size unavailable');
  assert.equal(document.querySelector('[data-planr-share-confirm]').textContent, 'Retry preparation');
  await controller.confirm();
  assert.equal(controller.getState().phase, 'ready');
  assert.equal(controller.getState().transport, 'short');
  assert.equal(document.querySelector('[data-planr-share-short-size]').textContent, '918 B');
  controller.close();
  assert.equal(document.activeElement, trigger, 'retry preserves the original focus return target');
});

test('unknown preview sizes are rejected instead of being fabricated as zero bytes', async (t) => {
  assert.throws(() => normalizeArtifactSharePreview({}), { code: 'E_ARTIFACT_SHARE_PREVIEW_INVALID' });
  const { controller, document } = mount(t, { prepareShare: async () => ({}), createShare() {} });
  await controller.open();
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().preview, null);
  assert.equal(document.querySelector('[data-planr-share-fragment-size]').textContent, 'Size unavailable');
});

test('oversized fragment-only hosts do not offer an unsupported upload fallback', async (t) => {
  const { controller, document } = mount(t, {
    supportedTransports: ['fragment'],
    prepareShare: async () => ({ ...preview, fragmentLength: 8001 }),
    createShare() { throw new Error('must not create'); },
  });
  await controller.open();
  assert.equal(controller.getState().phase, 'error');
  assert.match(controller.getState().error, /too large/);
  assert.equal(document.querySelector('[data-planr-share-confirm]').disabled, true);
  assert.equal(document.querySelector('[data-planr-share-transport="short"]').disabled, true);
  await controller.confirm();
});
