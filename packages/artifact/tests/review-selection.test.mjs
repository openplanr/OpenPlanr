import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTIFACT_ERROR_CODES } from '@openplanr/protocol/errors';
import { assertPreviewBridgeMessage } from '@openplanr/protocol/sharing-security-contracts';
import { JSDOM, VirtualConsole } from 'jsdom';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  prepareArtifactDocument,
  prepareArtifactSourceTemplate,
  prepareHostedArtifactDocument,
} from '../lib/artifact/browser-sandbox.mjs';
import { renderAuthoredDiagramSvg } from '../lib/artifact/diagram/authoring/renderer.mjs';

const nonce = Buffer.alloc(32, 11).toString('base64url');
const options = {
  artifactId: 'review-view',
  screenId: 'review-screen',
  nonce,
  parentOrigin: 'https://preview.example.com',
  scriptNonce: Buffer.alloc(18, 7).toString('base64url'),
  allowLocalForms: true,
  prototypeState: true,
  html: `<!doctype html><form><input id="answer" data-planr-id="answer" name="answer"><button id="choose" type="button" data-planr-id="choice"><span id="nested">Choose</span></button></form><a id="next" data-planr-id="next-link" data-design-target="next-screen">Next</a><script>window.choices=0;document.querySelector('#choose').addEventListener('click',()=>window.choices++);</script>`,
};

function preparedFrame(t, overrides = {}) {
  const messages = [],
    svgListeners = [],
    errors = [],
    parent = {
      postMessage: (data, origin) => messages.push({ data: structuredClone(data), origin }),
    },
    console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error));
  const prepared = prepareHostedArtifactDocument({ ...options, ...overrides });
  const dom = new JSDOM(prepared.html, {
    url: 'https://opaque.example.com/source',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) {
      Object.defineProperty(window, 'parent', { value: parent });
      for (const method of ['addEventListener', 'removeEventListener']) {
        const native = window.EventTarget.prototype[method];
        window.EventTarget.prototype[method] = function (type, listener, options) {
          if (type === 'click' && this instanceof window.SVGElement)
            svgListeners.push({ method, target: this, listener });
          return native.call(this, type, listener, options);
        };
      }
      // JSDOM has no layout hit-testing; selection uses the actual clicked DOM ancestor.
      window.document.elementFromPoint = () => null;
      window.URL.createObjectURL = URL.createObjectURL;
      window.URL.revokeObjectURL = URL.revokeObjectURL;
      window.structuredClone = structuredClone;
    },
  });
  t.after(() => dom.window.close());
  assert.deepEqual(errors, [], 'the actual generated bootstrap must initialize');
  const window = dom.window,
    command = {
      schemaVersion: '1.0.0',
      type: 'openplanr:review-selection',
      channel: nonce,
      viewId: options.artifactId,
      enabled: true,
    };
  const send = (data = command, source = parent, origin = options.parentOrigin) =>
    window.dispatchEvent(
      new window.MessageEvent('message', {
        source,
        origin,
        data: window.JSON.parse(JSON.stringify(data)),
      }),
    );
  const selections = () => messages.filter(({ data }) => data.type === 'select');
  return { window, parent, messages, command, send, selections, svgListeners };
}

test('selection is opt-in and begins disabled, preserving native authored handlers and form state', (t) => {
  for (const reviewSelection of [undefined, false, true]) {
    const frame = preparedFrame(t, { reviewSelection });
    const input = frame.window.document.querySelector('#answer');
    input.value = 'Unsaved answer';
    frame.window.document.querySelector('#nested').click();
    assert.equal(frame.window.choices, 1);
    assert.equal(input.value, 'Unsaved answer');
    assert.deepEqual(frame.selections(), []);
    if (reviewSelection !== true) {
      frame.send();
      frame.window.document.querySelector('#nested').click();
      assert.equal(frame.window.choices, 2);
      assert.deepEqual(frame.selections(), [], 'an unopted document cannot acquire selection');
    }
  }
  assert.equal(
    prepareHostedArtifactDocument(options).html,
    prepareHostedArtifactDocument({ ...options, reviewSelection: false }).html,
  );
});

test('authenticated mode controls select nested anchors without remount, then restore Interact', (t) => {
  const frame = preparedFrame(t, { reviewSelection: true });
  const document = frame.window.document,
    input = document.querySelector('#answer'),
    button = document.querySelector('#choose');
  input.value = 'Unsaved answer';
  input.dispatchEvent(new frame.window.Event('input', { bubbles: true }));
  frame.send();
  document.querySelector('#nested').click();
  assert.equal(frame.window.choices, 0, 'selection does not run an authored click handler');
  assert.deepEqual(frame.selections(), [
    {
      data: {
        schemaVersion: '1.0.0',
        channel: nonce,
        type: 'select',
        viewId: options.artifactId,
        elementId: 'choice',
      },
      origin: options.parentOrigin,
    },
  ]);
  assert.equal(assertPreviewBridgeMessage(frame.selections()[0].data).type, 'select');
  document.querySelector('#next').click();
  assert.equal(frame.selections().at(-1).data.elementId, 'next-link');
  assert.equal(frame.messages.filter(({ data }) => data.type === 'navigate').length, 0);
  frame.send({ ...frame.command, enabled: false });
  document.querySelector('#nested').click();
  document.querySelector('#next').click();
  assert.equal(frame.window.choices, 1);
  assert.equal(frame.messages.filter(({ data }) => data.type === 'navigate').length, 1);
  assert.equal(document.querySelector('#answer'), input);
  assert.equal(document.querySelector('#choose'), button);
  assert.equal(input.value, 'Unsaved answer');
});

test('controls bind the parent window, exact origin, current nonce and view with closed inert data', (t) => {
  const frame = preparedFrame(t, { reviewSelection: true });
  const invalid = [
    { data: frame.command, source: {} },
    { data: frame.command, origin: 'https://forged.example.com' },
    { data: frame.command, origin: 'null' },
    { data: { ...frame.command, channel: Buffer.alloc(32, 12).toString('base64url') } },
    { data: { ...frame.command, viewId: 'stale-view' } },
    { data: { ...frame.command, schemaVersion: '2.0.0' } },
    { data: { ...frame.command, type: 'openplanr:execute' } },
    { data: { ...frame.command, enabled: 'true' } },
    { data: { ...frame.command, fetch: 'https://forged.example.com' } },
  ];
  for (const { data, source = frame.parent, origin = options.parentOrigin } of invalid)
    frame.send(data, source, origin);
  let getters = 0;
  for (const kind of ['accessor', 'hidden', 'symbol', 'prototype']) {
    const data = frame.window.JSON.parse(JSON.stringify(frame.command));
    if (kind === 'accessor')
      Object.defineProperty(data, 'enabled', {
        enumerable: true,
        get: () => {
          getters++;
          return true;
        },
      });
    if (kind === 'hidden')
      Object.defineProperty(data, 'enabled', { value: true, enumerable: false });
    if (kind === 'symbol') data[Symbol('authority')] = true;
    if (kind === 'prototype') Object.setPrototypeOf(data, { authority: true });
    frame.window.dispatchEvent(
      new frame.window.MessageEvent('message', {
        source: frame.parent,
        origin: options.parentOrigin,
        data,
      }),
    );
  }
  assert.equal(getters, 0);
  frame.window.document.querySelector('#nested').click();
  assert.equal(frame.window.choices, 1);
  assert.deepEqual(frame.selections(), []);
  frame.send();
  frame.window.document.querySelector('#nested').click();
  assert.equal(frame.selections().length, 1, 'the exact trusted control still enables selection');
  for (const data of [
    { ...frame.command, enabled: false, viewId: 'stale-view' },
    { ...frame.command, enabled: false, unknown: true },
  ])
    frame.send(data);
  frame.window.document.querySelector('#nested').click();
  assert.equal(frame.window.choices, 1, 'forged disable controls cannot change an active mode');
  assert.equal(frame.selections().length, 2);
});

test('selection uses bounded semantic IDs and keeps pooled identity binding and sandbox policy', (t) => {
  const frame = preparedFrame(t, { reviewSelection: true, prototypeState: false });
  frame.send();
  const button = frame.window.document.querySelector('#choose');
  for (const id of ['', '_invalid', 'a'.repeat(129)]) {
    button.setAttribute('data-planr-id', id);
    button.click();
  }
  assert.deepEqual(frame.selections(), []);
  button.setAttribute('data-planr-id', `a${'b'.repeat(127)}`);
  button.click();
  assert.equal(frame.selections().length, 1);
  assert.equal(assertPreviewBridgeMessage(frame.selections()[0].data).viewId, options.artifactId);
  const template = prepareArtifactSourceTemplate({
    ...options,
    parentOrigin: 'null',
    reviewSelection: true,
  });
  assert.equal(template.html.split(template.artifactIdToken).length, 2);
  const document = prepareArtifactDocument({
    ...options,
    parentOrigin: 'http://127.0.0.1:45000',
    reviewSelection: true,
  });
  assert.match(document.csp, /connect-src 'none'/);
  assert.match(document.csp, /form-action 'none'/);
  for (const reviewSelection of ['true', null, {}])
    assert.throws(() => prepareHostedArtifactDocument({ ...options, reviewSelection }));
  assert.ok(
    prepareHostedArtifactDocument({
      ...options,
      artifactId: 'v'.repeat(128),
      reviewSelection: true,
    }).html,
  );
  assert.throws(
    () =>
      prepareHostedArtifactDocument({
        ...options,
        artifactId: 'v'.repeat(129),
        reviewSelection: true,
      }),
    (error) => error.code === ARTIFACT_ERROR_CODES.SANDBOX_POLICY && /128/.test(error.message),
  );
  assert.ok(
    prepareHostedArtifactDocument({
      ...options,
      artifactId: 'v'.repeat(512),
      reviewSelection: false,
    }).html,
  );
});

test('selection reads canonical authored SVG node and connector identity without rewriting source', (t) => {
  const bundle = makeBundle();
  bundle.document.annotations = [];
  bundle.document.accessibility.readingOrder = bundle.document.accessibility.readingOrder.filter(
    (id) => id !== 'note-a',
  );
  bundle.presentation.elements = bundle.presentation.elements.filter(
    ({ elementId }) => elementId !== 'note-a',
  );
  const rendered = renderAuthoredDiagramSvg(sealBundle(bundle));
  assert.equal(rendered.ok, true);
  const frame = preparedFrame(t, {
    reviewSelection: true,
    prototypeState: false,
    html: `<!doctype html>${rendered.svg}<script>window.diagramClicks=0;document.querySelector('svg').addEventListener('click',()=>window.diagramClicks++);</script>`,
  });
  const document = frame.window.document,
    svg = document.querySelector('svg'),
    node = svg.querySelector('[data-element-id="node-a"]'),
    nodeChild = node.querySelector('tspan'),
    connectorChild = svg.querySelector('[data-element-id="edge-a"] > path');
  const click = (target) =>
    target.dispatchEvent(new frame.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  click(nodeChild);
  assert.equal(frame.window.diagramClicks, 1);
  assert.deepEqual(frame.selections(), [], 'canonical Diagram clicks start in Interact');
  frame.send();
  click(nodeChild);
  click(connectorChild);
  assert.deepEqual(
    frame.selections().map(({ data }) => {
      assertPreviewBridgeMessage(data);
      return { viewId: data.viewId, elementId: data.elementId };
    }),
    [
      { viewId: options.artifactId, elementId: 'node-a' },
      { viewId: options.artifactId, elementId: 'edge-a' },
    ],
  );
  assert.equal(frame.window.diagramClicks, 1, 'selection suppresses authored handlers');
  assert.equal(document.querySelector('svg'), svg);
  node.setAttribute('data-planr-id', 'primary-node');
  click(nodeChild);
  assert.equal(frame.selections().at(-1).data.elementId, 'primary-node');
  node.setAttribute('data-planr-id', '_invalid');
  click(nodeChild);
  assert.equal(
    frame.selections().length,
    3,
    'an invalid primary ID cannot fall through to an alias',
  );
  node.removeAttribute('data-planr-id');
  for (const id of ['', '_invalid', 'a'.repeat(129)]) {
    node.setAttribute('data-element-id', id);
    click(nodeChild);
  }
  assert.equal(frame.selections().length, 3);
  node.setAttribute('data-element-id', 'a'.repeat(128));
  click(nodeChild);
  assert.equal(frame.selections().at(-1).data.elementId, 'a'.repeat(128));
  frame.send({ ...frame.command, enabled: false });
  click(nodeChild);
  assert.equal(frame.window.diagramClicks, 6, 'disabling selection restores native handlers');
  assert.equal(document.querySelector('svg'), svg);
});

test('authenticated Review owns and releases only native SVG click eligibility', (t) => {
  const html =
    '<!doctype html><svg id="diagram" xmlns="http://www.w3.org/2000/svg"><g data-element-id="node-a"><rect width="100" height="50"/></g></svg><svg id="decoration" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
  for (const reviewSelection of [false, true]) {
    const frame = preparedFrame(t, { reviewSelection, prototypeState: false, html }),
      svg = frame.window.document.querySelector('#diagram'),
      original = svg.outerHTML;
    assert.deepEqual(frame.svgListeners, [], 'Interact adds no direct SVG click listener');
    frame.send({ ...frame.command, channel: 'forged-channel' });
    assert.deepEqual(
      frame.svgListeners,
      [],
      'forged mode controls cannot change native eligibility',
    );
    frame.send();
    if (!reviewSelection) {
      assert.deepEqual(frame.svgListeners, [], 'legacy preparation remains unchanged');
      continue;
    }
    assert.equal(frame.svgListeners.length, 1);
    const owned = frame.svgListeners[0];
    assert.equal(owned.method, 'addEventListener');
    assert.equal(owned.target, svg, 'decorative SVG has no Review listener');
    frame.send({ ...frame.command, enabled: false, viewId: 'stale-view' });
    assert.equal(frame.svgListeners.length, 1, 'forged disable cannot release eligibility');
    let authoredClicks = 0;
    const authored = () => authoredClicks++;
    svg.addEventListener('click', authored);
    frame.send({ ...frame.command, enabled: false });
    assert.deepEqual(frame.svgListeners.at(-1), { ...owned, method: 'removeEventListener' });
    const target = svg.querySelector('rect');
    target.dispatchEvent(new frame.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(authoredClicks, 1, 'Interact preserves the authored listener');
    assert.deepEqual(frame.selections(), []);
    assert.equal(svg.outerHTML, original, 'eligibility never changes canonical SVG markup');
    assert.equal(frame.window.document.querySelector('#diagram'), svg);
    frame.send();
    frame.send();
    target.dispatchEvent(new frame.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(frame.selections().length, 1, 'repeated mode controls emit one closed selection');
    assert.equal(authoredClicks, 1, 'Review suppresses authored clicks');
    assertPreviewBridgeMessage(frame.selections()[0].data);
    frame.send({ ...frame.command, enabled: false });
    target.dispatchEvent(new frame.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(authoredClicks, 2, 'repeated toggles release only the owned listener');
  }
});
