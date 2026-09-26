import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Script } from 'node:vm';
import { parse } from 'parse5';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
  validateArtifactBridgeMessage,
} from '../lib/artifact/bridge.mjs';
import { mountArtifactAnnotations } from '../lib/artifact/ui/annotations.mjs';
import {
  ARTIFACT_INSPECTION_PROPERTIES,
  normalizeArtifactBridgeToolResult,
  normalizeArtifactInspection,
  normalizeArtifactThumbnail,
  renderArtifactBridgeToolsSource,
} from '../lib/artifact/ui/bridge-tools.mjs';
import { mountArtifactFeedbackRail } from '../lib/artifact/ui/feedback-rail.mjs';

const viewport = { width: 800, height: 600 };
const inspection = () => ({
  tagName: 'button',
  anchor: { planrId: 'save', screen: 'settings' },
  rect: { x: 0, y: 0, width: 100, height: 40 },
  viewport: { ...viewport },
  styles: Object.fromEntries(
    ARTIFACT_INSPECTION_PROPERTIES.map((key) => [key, key === 'font-size' ? '16px' : '']),
  ),
  accessibility: { role: 'button', ariaLabel: 'Save', alt: '', tabIndex: 0, disabled: false },
});
test('inspection and thumbnail results expose only bounded values from authenticated pending requests', () => {
  assert.equal(normalizeArtifactInspection(inspection(), viewport).styles['font-size'], '16px');
  for (const mutate of [
    (value) => {
      value.value = 'private input';
    },
    (value) => {
      value.styles['background-image'] = 'url(file:///secret)';
    },
    (value) => {
      value.styles.color = 'x'.repeat(257);
    },
    (value) => {
      value.rect.width = 801;
    },
    (value) => {
      value.viewport.height = 900;
    },
    (value) => {
      value.anchor.selector = '#secret';
    },
    (value) => {
      Object.defineProperty(value.accessibility, 'ariaLabel', {
        get() {
          throw new Error('Must not execute getters');
        },
      });
    },
  ]) {
    const value = inspection();
    mutate(value);
    assert.equal(normalizeArtifactInspection(value, viewport), null);
  }
  const thumbnail = {
    dataUrl: 'data:image/png;base64,AAAA',
    width: 320,
    height: 240,
    label: 'screen',
  };
  assert.ok(normalizeArtifactThumbnail(thumbnail));
  assert.equal(normalizeArtifactThumbnail({ ...thumbnail, width: 321 }), null);
  assert.equal(
    normalizeArtifactThumbnail({
      ...thumbnail,
      dataUrl: 'data:image/png;base64,' + 'A'.repeat(262144),
    }),
    null,
  );
  const nonce = createArtifactBridgeNonce(),
    source = {};
  const message = {
    channel: 'openplanr.artifact-anchor',
    schemaVersion: '1.0.0',
    nonce,
    artifactId: 'screen',
    requestId: 'request-12345678',
    type: 'inspect.result',
    inspection: inspection(),
  };
  assert.equal(
    normalizeArtifactBridgeToolResult('thumbnail.request', message, viewport).valid,
    false,
  );
  const contract = {
    nonce,
    source,
    artifactId: 'screen',
    viewport,
    pendingRequestIds: new Set([message.requestId]),
  };
  assert.equal(
    validateArtifactBridgeMessage({ source, origin: 'null', data: message }, contract).ok,
    true,
  );
  for (const event of [
    { source: {}, origin: 'null', data: message },
    { source, origin: 'https://example.com', data: message },
    { source, origin: 'null', data: { ...message, nonce: createArtifactBridgeNonce() } },
  ])
    assert.equal(validateArtifactBridgeMessage(event, contract).ok, false);
  assert.equal(
    validateArtifactBridgeMessage(
      { source, origin: 'null', data: message },
      { ...contract, pendingRequestIds: new Set() },
    ).ok,
    false,
  );
  new Script(renderArtifactBridgeToolsSource());
  const prepared = prepareArtifactDocument({
    html: '<button data-planr-id="save">Save</button>',
    artifactId: 'screen',
    nonce,
    parentOrigin: 'http://127.0.0.1:12345',
  });
  const visit = (node) => {
    if (node.tagName === 'script')
      new Script(node.childNodes.map((child) => child.value ?? '').join(''));
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(prepared.html));
  new Script(
    renderArtifactParentRuntime({
      artifactBaseUrl: '/artifact/',
      stageRuntimeUrl: '/stage.js',
      nonce,
    }),
  );
});

const requireCli = createRequire(new URL('../../cli/package.json', import.meta.url));
const { JSDOM } = requireCli('jsdom');
const digest = 'a'.repeat(64);
const basePin = (id) => ({
  id,
  author: { id: id + '-author', name: 'Alex' },
  artifactId: 'screen',
  variant: 'screen',
  region: { x: 0.1, y: 0.1, w: 0, h: 0 },
  viewport,
  intent: 'fix',
  status: 'open',
  comment: 'Original ' + id,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  replies: [],
});
const baseReview = () => ({
  schemaVersion: '1.0.0',
  reviewId: 'review',
  reviewOf: digest,
  decision: 'pending',
  overall: '',
  pins: [basePin('first'), basePin('second')],
});
function railFixture(t) {
  const dom = new JSDOM(
    `<main class="planr-shell"><input data-planr-reviewer-name><div data-planr-identity-status></div><div data-planr-slot="feedback-rail"></div><textarea id="planr-overall-note"></textarea><div data-planr-slot="decision-status"></div><button data-planr-decision="approved"></button><div data-planr-annotation-layer="screen"></div></main>`,
  );
  const root = dom.window.document.querySelector('main');
  const rail = mountArtifactFeedbackRail({
    root,
    initialReview: baseReview(),
    reviewOf: digest,
    identity: { id: 'me', name: 'Alex' },
  });
  t.after(() => {
    rail.destroy();
    dom.window.close();
  });
  return { dom, root, rail };
}

test('rail preserves drafts, selection, scroll and legacy categories across updates and filters', (t) => {
  const { dom, root, rail } = railFixture(t),
    document = dom.window.document;
  const slot = root.querySelector('[data-planr-slot="feedback-rail"]');
  let reply = slot.querySelector('[name="reply"]');
  reply.value = 'Unsent reply';
  reply.focus();
  reply.setSelectionRange(2, 5);
  slot.scrollTop = 67;
  const overall = root.querySelector('#planr-overall-note');
  overall.value = 'Unsent overall';
  overall.dispatchEvent(new dom.window.Event('input'));
  rail.setPresentation({
    describePin: (pin) => ({ intentLabel: pin.intent === 'fix' ? 'Fix' : 'Suggestion' }),
  });
  const next = baseReview();
  next.pins[0].replies.push({
    id: 'remote',
    author: { name: 'Alex', id: 'other' },
    comment: 'Concurrent',
    createdAt: '2026-09-10T00:01:00.000Z',
  });
  rail.replaceReview(next);
  reply = slot.querySelector('[name="reply"]');
  assert.equal(reply.value, 'Unsent reply');
  assert.equal(document.activeElement, reply);
  assert.equal(reply.selectionStart, 2);
  assert.equal(reply.selectionEnd, 5);
  assert.equal(slot.scrollTop, 67);
  assert.equal(overall.value, 'Unsent overall');
  assert.equal(slot.querySelector('.planr-intent').textContent, 'Fix');
  rail.setPresentation({ filterPin: (pin) => pin.id === 'second' });
  assert.equal(slot.querySelectorAll('.planr-thread').length, 1);
  rail.setPresentation({ filterPin: null });
  assert.equal(slot.querySelector('[name="reply"]').value, 'Unsent reply');
  const snapshot = rail.snapshotDrafts();
  slot.querySelector('[name="reply"]').value = '';
  assert.equal(rail.restoreDrafts(snapshot), true);
  assert.equal(slot.querySelector('[name="reply"]').value, 'Unsent reply');
  assert.equal(rail.restoreDrafts({ ...snapshot, reviewOf: 'b'.repeat(64) }), false);
});

test('reply submit clears only that draft; custom disposition controls and composition survive refresh', (t) => {
  const { dom, root, rail } = railFixture(t),
    document = dom.window.document;
  let opened = 0;
  rail.setPresentation({
    onThreadOpen() {
      opened++;
    },
    decorateThread({ element, pin }) {
      const field = document.createElement('input');
      field.dataset.planrDraftKey = pin.id + '-disposition';
      element.append(field);
    },
  });
  let fields = root.querySelectorAll('[name="reply"]');
  fields[0].value = 'Submit this';
  fields[1].value = 'Keep this';
  const extra = root.querySelector('[data-planr-draft-key]');
  extra.value = 'Owner explanation';
  extra.focus();
  rail.render();
  assert.equal(root.querySelector('[data-planr-draft-key]').value, 'Owner explanation');
  assert.equal(opened, 1);
  fields = root.querySelectorAll('[name="reply"]');
  fields[0]
    .closest('form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(rail.getReview().pins[0].replies[0].comment, 'Submit this');
  fields = root.querySelectorAll('[name="reply"]');
  assert.equal(fields[0].value, '');
  assert.equal(fields[1].value, 'Keep this');
  fields[1].dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  rail.render();
  assert.equal(root.querySelectorAll('[name="reply"]')[1], fields[1]);
  fields[1].dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(root.querySelectorAll('[name="reply"]')[1].value, 'Keep this');
});

test('composer restoration remains bound to its original revision and anchor without hit-testing again', async (t) => {
  const { dom, root, rail } = railFixture(t);
  const stage = {
    getState: () => ({
      status: 'ready',
      artifacts: [{ id: 'screen', viewport }],
      activeArtifactId: 'screen',
      reviewMode: 'comment',
    }),
    dispatch() {},
  };
  const annotations = mountArtifactAnnotations({
    document: dom.window.document,
    window: dom.window,
    root,
    stageController: stage,
    reviewController: rail,
  });
  t.after(() => annotations.destroy());
  annotations.openComposer({
    artifactId: 'screen',
    viewport,
    variant: 'direction',
    region: { x: 0.1, y: 0.2, w: 0, h: 0 },
  });
  const comment = root.querySelector('[data-planr-composer-comment]');
  comment.value = 'Unsent pin';
  comment.setSelectionRange(2, 4);
  const select = dom.window.document.createElement('select');
  select.dataset.planrDraftKey = 'category';
  select.innerHTML =
    '<option value="question">Question</option><option value="blocker">Blocker</option>';
  select.value = 'blocker';
  root.querySelector('[data-planr-annotation-composer]').append(select);
  const draft = annotations.snapshotDraft();
  annotations.closeComposer();
  assert.equal(
    annotations.restoreDraft({ ...draft, anchor: { planrId: 'original', screen: 'screen' } }),
    true,
  );
  assert.equal(root.querySelector('[data-planr-composer-comment]').value, 'Unsent pin');
  const restoredSelect = select.cloneNode(true);
  restoredSelect.value = 'question';
  root.querySelector('[data-planr-annotation-composer]').append(restoredSelect);
  await Promise.resolve();
  assert.equal(
    restoredSelect.value,
    'blocker',
    'Late-injected design category must survive composer restoration',
  );
  assert.equal(annotations.snapshotDraft().anchor.planrId, 'original');
  assert.equal(root.querySelector('[data-planr-composer-comment]').selectionStart, 2);
  assert.equal(annotations.restoreDraft({ ...draft, reviewOf: 'b'.repeat(64) }), false);
  annotations.closeComposer();
});

test('real opaque sandbox exposes bounded inspection and thumbnails without activating product actions', {
  skip: process.env.PLANR_BROWSER_TESTS !== '1',
}, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const nonce = createArtifactBridgeNonce();
  let origin;
  const server = createServer((req, res) => {
    if (req.url === '/stage.js') {
      res.setHeader('content-type', 'application/javascript');
      return res.end(
        `(async()=>{const options=__OPENPLANR_ARTIFACT_STAGE_OPTIONS__;const frame=document.createElement('iframe');frame.width=800;frame.height=600;frame.setAttribute('sandbox','allow-scripts');const artifact={id:'screen',viewport:{width:800,height:600}};options.bridgeClient.attach({artifact,frame});document.body.append(frame);frame.src=URL.createObjectURL(await options.resolveArtifactSource(artifact));window.frame=frame})()`,
      );
    }
    if (req.url === '/artifact/screen') {
      res.setHeader('content-type', 'application/octet-stream');
      return res.end(
        prepareArtifactDocument({
          html: '<style>body{background:#fff}button{width:200px;height:60px;color:rgb(0, 0, 0);font-size:20px;background:rgb(40, 220, 180)}</style><button data-planr-id="save" onclick="this.textContent=\'Clicked\'">Save</button><input value="private input">',
          nonce,
          artifactId: 'screen',
          parentOrigin: origin,
        }).html,
      );
    }
    res.setHeader('permissions-policy', 'fullscreen=(self)');
    res.setHeader('content-type', 'text/html');
    res.end(
      `<html><body><script>${renderArtifactParentRuntime({ artifactBaseUrl: '/artifact/', stageRuntimeUrl: '/stage.js', nonce })}</script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.frame?.dataset.planrBridgeTrusted === 'true');
  const result = await page.evaluate(async () => ({
    inspection: await frame.__openPlanrBridge.inspectAt(30, 30),
    anchor: await frame.__openPlanrBridge.inspect({ planrId: 'save' }),
    thumbnail: await frame.__openPlanrBridge.thumbnail(),
    missing: await frame.__openPlanrBridge.inspect({ planrId: 'missing' }),
  }));
  assert.equal(result.inspection.tagName, 'button');
  assert.equal(result.anchor.styles['font-size'], '20px');
  assert.equal(result.missing, null);
  assert.ok(
    result.thumbnail,
    'Low-resolution capture should be available for simple rendered HTML',
  );
  assert.ok(result.thumbnail.width <= 320 && result.thumbnail.height <= 320);
  assert.equal(
    await page.frames()[1].getByRole('button', { name: 'Save', exact: true }).count(),
    1,
  );
  assert.equal(await page.evaluate(() => frame.contentDocument), null);
  assert.equal(
    await page.evaluate(() => document.fullscreenEnabled),
    true,
    'Trusted studio fullscreen must remain available',
  );
  assert.equal(
    await page.frames()[1].evaluate(() => document.fullscreenEnabled),
    false,
    'Opaque authored content must never inherit top-level fullscreen permission',
  );
  assert.equal(await page.locator('iframe').getAttribute('allowfullscreen'), null);
  assert.equal(await page.locator('iframe').getAttribute('allow'), null);
});
