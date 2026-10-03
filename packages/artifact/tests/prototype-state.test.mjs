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
    {
      session: { a: { b: { c: { d: { e: { f: { g: true } } } } } } },
      forms: {},
    },
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
    relay.receive({
      origin: 'null',
      source: a,
      data: { ...data, screenId: 'second' },
    }),
    false,
  );
  assert.equal(relay.receive({ origin: 'https://unexpected.example', source: a, data }), false);
  assert.equal(
    relay.receive({
      origin: 'null',
      source: a,
      data: { ...data, nonce: 'stale'.padEnd(43, 'x') },
    }),
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
    parentWindow: {
      addEventListener: () => installed++,
      removeEventListener() {},
    },
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
  const frame = {
    screenId: 'screen',
    viewId: 'view',
    window,
    nonce: 'n'.repeat(43),
    aliases,
  };
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
          session: {
            'answer-title': 'Edited',
            question: 'Question',
            secret: 'Excluded',
          },
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

test('sequenced view updates merge only edited keys and the current view, then acknowledge exact custody', () => {
  const messages = [];
  const a = { postMessage: (data) => messages.push(['a', data]) };
  const b = { postMessage: (data) => messages.push(['b', data]) };
  const frames = [
    { screenId: 'first', viewId: 'a', window: a, nonce: 'a'.repeat(43) },
    { screenId: 'second', viewId: 'b', window: b, nonce: 'b'.repeat(43) },
  ];
  const relay = createPrototypeStateRelay({
    contextId: 'revision-one',
    receiveOnly: true,
    frames: () => frames,
  });
  const send = (frame, sequence, state, sessionKeys, extra = {}) =>
    relay.receive({
      origin: 'null',
      source: frame.window,
      data: {
        type: 'openplanr:prototype-state',
        version: 1,
        nonce: frame.nonce,
        screenId: frame.screenId,
        viewId: frame.viewId,
        sequence,
        state,
        sessionKeys,
        sessionSequences: Object.fromEntries(sessionKeys.map((key) => [key, sequence])),
        ...extra,
      },
    });
  assert.equal(
    send(frames[0], 1, { session: { agreed: true }, forms: { a: { name: 'A' } } }, ['agreed']),
    true,
  );
  assert.equal(messages[0][1].acknowledgedSequence, 1);
  assert.equal(messages[1][1].acknowledgedSequence, 0);
  // B's local edit was prepared before A's update. Its stale snapshot cannot delete A.
  assert.equal(
    send(
      frames[1],
      1,
      {
        session: { stage: 'review' },
        forms: { b: { name: 'B' }, a: { name: 'stale' } },
      },
      ['stage'],
    ),
    true,
  );
  assert.deepEqual(relay.snapshot(), {
    session: { agreed: true, stage: 'review' },
    forms: { a: { name: 'A' }, b: { name: 'B' } },
  });
  assert.equal(
    send(frames[0], 1, { session: {}, forms: {} }, ['agreed']),
    false,
    'duplicate sequence cannot replay stale data',
  );
  assert.equal(send(frames[0], 2, { session: { agreed: false }, forms: {} }, ['agreed']), true);
  assert.equal(relay.snapshot().session.agreed, false, 'same-key updates use accepted order');
  assert.equal(send(frames[1], 2, { session: {}, forms: {} }, ['stage']), true);
  assert.deepEqual(
    relay.snapshot().session,
    { agreed: false },
    'explicit observed-key deletion preserves independent keys',
  );
  assert.equal(
    send(frames[0], 3, { session: {}, forms: {} }, ['agreed'], { reset: true, resetSequence: 3 }),
    true,
  );
  assert.deepEqual(relay.snapshot(), { session: {}, forms: {} });
  relay.dispose();
  assert.equal(send(frames[0], 4, { session: { revived: true }, forms: {} }, ['revived']), false);
});

test('modern prototype deltas reject invalid sequencing, keys and aggregate overflow before acknowledgement', () => {
  const messages = [],
    window = { postMessage: (data) => messages.push(data) };
  const frame = {
    screenId: 'screen',
    viewId: 'view',
    window,
    nonce: 'n'.repeat(43),
  };
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => [frame],
  });
  const data = {
    type: 'openplanr:prototype-state',
    version: 1,
    screenId: 'screen',
    viewId: 'view',
    nonce: frame.nonce,
    sequence: 1,
    sessionKeys: ['a'],
    sessionSequences: { a: 1 },
    state: { session: { a: 'x'.repeat(8192) }, forms: {} },
  };
  for (const change of [
    { sequence: 0 },
    { sequence: -1 },
    { sequence: NaN },
    { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { sessionKeys: ['a', 'a'] },
    { sessionKeys: ['__proto__'] },
    { sessionKeys: ['x'.repeat(257)] },
    { sessionKeys: null },
    { sessionKeys: [1n] },
    { sessionKeys: Array.from({ length: 128 }, (_, i) => `${i}-${'x'.repeat(250)}`) },
    { reset: false },
  ])
    assert.equal(
      relay.receive({
        origin: 'null',
        source: window,
        data: { ...data, ...change },
      }),
      false,
    );
  assert.equal(messages.length, 0);
  assert.equal(relay.receive({ origin: 'null', source: window, data }), true);
  assert.equal(
    relay.receive({
      origin: 'null',
      source: window,
      data: {
        ...data,
        sequence: 2,
        sessionKeys: ['b'],
        sessionSequences: { b: 2 },
        state: { session: { b: 'x'.repeat(8192) }, forms: {} },
      },
    }),
    false,
  );
  assert.equal(messages.at(-1).acknowledgedSequence, 1);
  assert.deepEqual(Object.keys(relay.snapshot().session), ['a']);
});

test('rejected edits remain pending while repeated accepted keys and resets do not overwrite newer views', () => {
  const a = { postMessage() {} },
    b = { postMessage() {} };
  const frames = [
    { screenId: 'a', viewId: 'a', window: a, nonce: 'a'.repeat(43) },
    { screenId: 'b', viewId: 'b', window: b, nonce: 'b'.repeat(43) },
  ];
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => frames,
  });
  const send = (frame, sequence, state, sessionSequences = {}, extra = {}) =>
    relay.receive({
      origin: 'null',
      source: frame.window,
      data: {
        type: 'openplanr:prototype-state',
        version: 1,
        screenId: frame.screenId,
        viewId: frame.viewId,
        nonce: frame.nonce,
        sequence,
        state,
        sessionKeys: Object.keys(sessionSequences),
        sessionSequences,
        ...extra,
      },
    });
  assert.equal(send(frames[0], 1, { session: { a: 'x'.repeat(8192) }, forms: {} }, { a: 1 }), true);
  assert.equal(
    send(frames[1], 1, { session: { b: 'y'.repeat(8192) }, forms: {} }, { b: 1 }),
    false,
  );
  assert.equal(
    send(
      frames[1],
      2,
      { session: { b: 'y'.repeat(8192) }, forms: { b: { name: 'Still local' } } },
      { b: 1 },
    ),
    false,
    'Later form capture retains the rejected edit until it can be accepted',
  );
  assert.equal(send(frames[0], 2, { session: {}, forms: {} }, { a: 2 }), true);
  assert.equal(
    send(
      frames[1],
      3,
      { session: { b: 'y'.repeat(8192) }, forms: { b: { name: 'Still local' } } },
      { b: 1 },
    ),
    true,
  );
  assert.equal(relay.snapshot().session.b, 'y'.repeat(8192));
  assert.equal(send(frames[0], 3, { session: { b: 'Newer remote' }, forms: {} }, { b: 3 }), true);
  assert.equal(
    send(
      frames[1],
      4,
      { session: { b: 'y'.repeat(8192) }, forms: { b: { name: 'Next input' } } },
      { b: 1 },
    ),
    true,
  );
  assert.equal(
    relay.snapshot().session.b,
    'Newer remote',
    'An already accepted key is not a new semantic edit',
  );
  assert.equal(
    send(frames[1], 5, { session: {}, forms: {} }, {}, { reset: true, resetSequence: 5 }),
    true,
  );
  assert.equal(
    send(frames[0], 4, { session: { afterReset: true }, forms: {} }, { afterReset: 4 }),
    true,
  );
  assert.equal(
    send(
      frames[1],
      6,
      { session: {}, forms: { b: { name: 'After reset' } } },
      {},
      { reset: true, resetSequence: 5 },
    ),
    true,
  );
  assert.deepEqual(
    relay.snapshot(),
    { session: { afterReset: true }, forms: { b: { name: 'After reset' } } },
    'A repeated pending reset is applied once',
  );
});

test('legacy frames remain compatible before ordering but cannot downgrade the same nonce afterward', () => {
  const window = { postMessage() {} };
  const frame = { screenId: 'a', viewId: 'a', nonce: 'a'.repeat(43), window };
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => [frame],
  });
  const send = (extra, state = { session: { legacy: true }, forms: {} }) =>
    relay.receive({
      origin: 'null',
      source: window,
      data: {
        type: 'openplanr:prototype-state',
        version: 1,
        screenId: 'a',
        viewId: 'a',
        nonce: frame.nonce,
        state,
        ...extra,
      },
    });
  assert.equal(send({}), true);
  assert.equal(
    send(
      { sequence: 1, sessionKeys: ['ordered'], sessionSequences: { ordered: 1 } },
      { session: { ordered: true }, forms: {} },
    ),
    true,
  );
  const before = relay.snapshot();
  assert.equal(send({}, { session: {}, forms: {} }), false);
  assert.deepEqual(relay.snapshot(), before);
  frame.nonce = 'b'.repeat(43);
  assert.equal(send({}), true, 'A new bootstrap nonce may still be a legacy frame');
});

test('ordered delta arrays must be dense and their metadata must use plain exact key identities', () => {
  const window = { postMessage() {} };
  const frame = { screenId: 'a', viewId: 'a', nonce: 'a'.repeat(43), window };
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => [frame],
  });
  const send = (sessionKeys, sessionSequences, sequence, session) =>
    relay.receive({
      origin: 'null',
      source: window,
      data: {
        type: 'openplanr:prototype-state',
        version: 1,
        screenId: 'a',
        viewId: 'a',
        nonce: frame.nonce,
        sequence,
        sessionKeys,
        sessionSequences,
        state: { session, forms: {} },
      },
    });
  assert.equal(send(['undefined'], { undefined: 1 }, 1, { undefined: 'Retained' }), true);
  const sparse = structuredClone(new Array(1));
  assert.equal(send(sparse, { unrelated: 0 }, 2, {}), false);
  const custom = ['undefined'];
  custom.extra = 'ignored';
  assert.equal(send(structuredClone(custom), { undefined: 2 }, 2, {}), false);
  assert.equal(send(['undefined'], new Date(), 2, {}), false);
  assert.deepEqual(relay.snapshot().session, { undefined: 'Retained' });
  assert.equal(send(['undefined'], { undefined: 2 }, 2, {}), true);
});

test('trusted document generations retire sequence custody and reject old queued updates at a reused WindowProxy', () => {
  const sent = [],
    window = { postMessage: (data) => sent.push(data) };
  let generation = 'challenge-first';
  const frame = () => ({
    screenId: 'form',
    viewId: 'form',
    window,
    nonce: 'n'.repeat(43),
    generation,
  });
  const relay = createPrototypeStateRelay({
    contextId: 'revision',
    receiveOnly: true,
    frames: () => [frame()],
  });
  const documentId = 'a'.repeat(43),
    nextDocumentId = 'b'.repeat(43);
  const data = {
    type: 'openplanr:prototype-state',
    version: 1,
    nonce: 'n'.repeat(43),
    screenId: 'form',
    viewId: 'form',
    documentId,
    generation,
    sequence: 5,
    sessionKeys: ['answer'],
    sessionSequences: { answer: 5 },
    state: { session: { answer: 'Retained' }, forms: { form: { name: 'Retained' } } },
  };
  const receive = (data) => relay.receive({ origin: 'null', source: window, data });
  assert.equal(receive(data), true);
  generation = null;
  assert.equal(
    receive({ ...data, sequence: 6 }),
    false,
    'Untrusted loads cannot receive or change state',
  );
  generation = 'challenge-second';
  relay.restore(frame());
  assert.equal(
    sent.at(-1).acknowledgedSequence,
    0,
    'Only the authenticated new challenge retires sequence custody',
  );
  assert.equal(receive(data), false, 'The queued prior-generation update cannot become a new edit');
  assert.equal(
    receive({ ...data, generation: undefined, documentId: undefined, sequence: 100 }),
    false,
    'A modern channel cannot downgrade during trusted generation reconfiguration',
  );
  assert.equal(receive({ ...data, type: 'openplanr:prototype-state:ready' }), false);
  assert.equal(
    receive({ ...data, type: 'openplanr:prototype-state:ready', generation: null }),
    true,
  );
  assert.equal(
    sent.at(-1).documentId,
    documentId,
    'Old ready requests produce only an old-document-addressed restore',
  );
  assert.equal(
    receive({
      ...data,
      generation,
      documentId: nextDocumentId,
      sequence: 1,
      sessionSequences: { answer: 1 },
      state: { session: { answer: 'New input' }, forms: { form: { name: 'New input' } } },
    }),
    true,
  );
  assert.equal(
    receive({ ...data, generation, sequence: 9 }),
    false,
    'A prior bootstrap identity cannot overwrite the new document',
  );
  const legacy = { ...data, generation: undefined, documentId: undefined, sequence: 9 };
  assert.equal(
    receive(legacy),
    false,
    'Modern generation binding cannot downgrade to the older channel',
  );
  assert.equal(relay.snapshot().session.answer, 'New input');
  relay.dispose();
});

test('trusted generation changes retain compatibility with bootstraps predating generation support', () => {
  const window = { postMessage() {} };
  let generation = 'challenge-old-first';
  const relay = createPrototypeStateRelay({
    contextId: 'old-bootstrap',
    receiveOnly: true,
    frames: () => [{ screenId: 'form', viewId: 'form', nonce: 'n'.repeat(43), window, generation }],
  });
  const data = {
    type: 'openplanr:prototype-state',
    version: 1,
    nonce: 'n'.repeat(43),
    screenId: 'form',
    viewId: 'form',
    sequence: 4,
    sessionKeys: ['answer'],
    sessionSequences: { answer: 4 },
    state: { session: { answer: 'Old supported bootstrap' }, forms: {} },
  };
  assert.equal(relay.receive({ origin: 'null', source: window, data }), true);
  generation = 'challenge-old-second';
  assert.equal(
    relay.receive({
      origin: 'null',
      source: window,
      data: { ...data, sequence: 1, sessionSequences: { answer: 1 } },
    }),
    true,
  );
  assert.equal(relay.snapshot().session.answer, 'Old supported bootstrap');
  relay.dispose();
});
