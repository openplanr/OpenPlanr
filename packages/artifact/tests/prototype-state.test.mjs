import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrototypeStateRelay,
  renderPrototypeStateBootstrap,
  validatePrototypeSnapshot,
} from '../lib/artifact/ui/prototype-state.mjs';

test('prototype state rejects unbounded, executable and prototype-polluting data', () => {
  assert.equal(
    validatePrototypeSnapshot({
      session: { consent: true, name: 'Person', selected: ['a'] },
      forms: {},
    }),
    true,
  );
  for (const state of [
    { session: { content: 'x'.repeat(16_385) }, forms: {} },
    { session: { value: Infinity }, forms: {} },
    { session: { execute() {} }, forms: {} },
    { session: {}, forms: {}, extra: true },
    { session: JSON.parse('{"__proto__":{"trusted":true}}'), forms: {} },
    { session: { a: { b: { c: { d: { e: { f: { g: true } } } } } } }, forms: {} },
    {
      session: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), i])),
      forms: {},
    },
  ])
    assert.equal(validatePrototypeSnapshot(state), false);
  assert.doesNotMatch(
    renderPrototypeStateBootstrap({
      screenId: '</script>',
      viewId: 'view',
      parentOrigin: 'null',
      nonce: 'n'.repeat(43),
    }),
    /<\/script/u,
  );
});

test('prototype relay binds exact frame, screen and view and disposes its document state', () => {
  const messages = [],
    a = { postMessage: (data) => messages.push(['a', data]) },
    b = { postMessage: (data) => messages.push(['b', data]) };
  const relay = createPrototypeStateRelay({
    contextId: 'document:revision',
    parentWindow: undefined,
    frames: () => [
      { screenId: 'first', viewId: 'a', window: a, nonce: 'a'.repeat(43) },
      { screenId: 'second', viewId: 'b', window: b, nonce: 'b'.repeat(43) },
    ],
  });
  const state = { session: { agreed: true }, forms: { a: { name: 'Person' } } };
  const data = {
    type: 'openplanr:prototype-state',
    version: 1,
    nonce: 'a'.repeat(43),
    screenId: 'first',
    viewId: 'a',
    state,
  };
  assert.equal(relay.receive({ origin: 'null', source: b, data }), false);
  assert.equal(
    relay.receive({ origin: 'null', source: a, data: { ...data, screenId: 'second' } }),
    false,
  );
  assert.equal(relay.receive({ origin: 'https://unexpected.example', source: a, data }), false);
  assert.equal(
    relay.receive({ origin: 'null', source: a, data: { ...data, nonce: 'stale'.padEnd(43, 'x') } }),
    false,
  );
  assert.equal(
    relay.receive({
      origin: 'https://unexpected.example',
      source: a,
      data: { ...data, type: 'openplanr:prototype-state:ready' },
    }),
    false,
  );
  assert.equal(messages.length, 0, 'Navigation to a foreign origin cannot receive a snapshot');
  assert.equal(relay.receive({ origin: 'null', source: a, data }), true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'b');
  assert.equal(messages[0][1].nonce, 'b'.repeat(43));
  state.session.agreed = false;
  assert.equal(relay.snapshot().session.agreed, true, 'caller mutation cannot alter custody');
  const snapshot = relay.snapshot();
  snapshot.session.agreed = false;
  assert.equal(relay.snapshot().session.agreed, true);
  relay.dispose();
  assert.deepEqual(relay.snapshot(), { session: {}, forms: {} });
});

test('receive-only relays leave authentication and listener ownership to the host', () => {
  let installed = 0;
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    parentWindow: { addEventListener: () => installed++, removeEventListener() {} },
    frames: () => [],
  });
  assert.equal(installed, 0);
  relay.dispose();
});

test('opt-in aliases restore only bounded named strings without accepting legacy inbound messages', () => {
  const messages = [];
  const window = { postMessage: (data) => messages.push(data) };
  const aliases = {
    version: 1,
    restoreType: 'fixture:state',
    fields: ['answer-title', 'question'],
  };
  const frame = { screenId: 'screen', viewId: 'view', window, nonce: 'n'.repeat(43), aliases };
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => [frame],
  });
  assert.equal(
    relay.receive({
      origin: 'null',
      source: window,
      data: { type: 'fixture:update', values: { question: 'forged' } },
    }),
    false,
  );
  assert.equal(
    relay.receive({
      origin: 'null',
      source: window,
      data: {
        type: 'openplanr:prototype-state',
        version: 1,
        nonce: frame.nonce,
        screenId: frame.screenId,
        viewId: frame.viewId,
        state: {
          session: { 'answer-title': 'Edited', question: 'Question', secret: 'Excluded' },
          forms: {},
        },
      },
    }),
    true,
  );
  relay.restore(frame);
  assert.deepEqual(messages[1], {
    type: 'fixture:state',
    nonce: frame.nonce,
    state: { 'answer-title': 'Edited', question: 'Question' },
  });
  messages.length = 0;
  relay.restore({ ...frame, nonce: null });
  assert.equal(messages.length, 0);
  relay.dispose();
});
