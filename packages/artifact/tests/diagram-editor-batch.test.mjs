import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle, placement } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { snapshot } from '../lib/artifact/diagram/authoring/model.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { createDiagramEditorDraft } from '../lib/artifact/diagram/editor/draft.mjs';
import { createDiagramEditorRecovery } from '../lib/artifact/diagram/editor/recovery.mjs';
import { createDiagramEditorSession } from '../lib/artifact/diagram/editor/session.mjs';

const good = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const ids = (prefix) => {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
};
const rename = (id, label) => ({ type: 'rename', id, label });
function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
const recovery = (storage) =>
  createDiagramEditorRecovery({
    storage,
    scope: { sessionId: 'hosted-one', diagramId: 'checkout' },
  });
async function storeFor(t, bundle = null) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-batch-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  if (bundle) good(await store.initialize(bundle, { transactionId: 'initialize-fixture' }));
  return store;
}

/**
 * A hosted-style transport: one request per save, idempotent by batch identity.
 * `reject` answers before anything is stored; `lose` drops the answer after the batch is stored.
 */
function batchTransport(store, { reject = () => null, lose = () => null } = {}) {
  const calls = [],
    receipts = new Map();
  const transport = {
    read: () => store.read(),
    async saveBatch(batch) {
      calls.push(structuredClone(batch));
      const rejection = reject(calls.length);
      if (rejection) return rejection;
      if (!receipts.has(batch.batchId)) {
        if (batch.initialization)
          good(
            await store.initialize(batch.initialization.bundle, {
              transactionId: batch.initialization.transactionId,
            }),
          );
        for (const transaction of batch.transactions) good(await store.commit(transaction));
        const head = good(await store.read());
        receipts.set(batch.batchId, {
          ok: true,
          status: 'saved',
          bundle: head.bundle,
          receipt: { batchId: batch.batchId, result: snapshot(head.bundle) },
        });
      }
      return lose(calls.length) ?? structuredClone(receipts.get(batch.batchId));
    },
  };
  return { transport, calls };
}
const session = (t, options) => {
  const editor = createDiagramEditorSession({ nextTransactionId: ids('edit'), ...options });
  t.after(() => editor.dispose());
  return editor;
};

test('a batch transport saves a new diagram and its edits in one request with a stable identity', async (t) => {
  const store = await storeFor(t);
  const draft = good(createDiagramEditorDraft({ diagramId: 'checkout', title: 'Checkout' }));
  const { transport, calls } = batchTransport(store);
  const editor = session(t, { bundle: draft.bundle, transport, nextTransactionId: ids('edit') });
  const initialization = editor.getState().needsInitialization;
  assert.equal(initialization, true);
  good(
    editor.submit({
      type: 'create',
      elements: [
        {
          collection: 'nodes',
          value: { id: 'node-a', label: 'Receive order', kind: 'process', description: null },
        },
      ],
      presentation: [placement('node-a')],
    }),
  );
  good(editor.submit(rename('node-a', 'Validate order')));
  const saved = good(await editor.save());
  assert.equal(saved.status, 'saved');
  assert.equal(calls.length, 1, 'Initialization and both edits travel as one request');
  assert.equal(calls[0].transactions.length, 2);
  assert.equal(calls[0].base, null);
  assert.equal(calls[0].initialization.transactionId, 'edit-1');
  assert.equal(calls[0].batchId, `batch-2-${calls[0].transactions[1].transactionId}`);
  assert.deepEqual(calls[0].result, editor.getState().bundle);
  assert.deepEqual(good(await store.read()).bundle, editor.getState().bundle);
});

test('an unconfirmed batch is resent exactly before newer edits and is not duplicated', async (t) => {
  const store = await storeFor(t, makeBundle());
  const { transport, calls } = batchTransport(store, {
    lose: (call) => (call === 1 ? { ok: false, status: 'unknown' } : null),
  });
  const editor = session(t, {
    bundle: good(await store.read()).bundle,
    acknowledged: true,
    transport,
  });
  good(editor.submit(rename('node-a', 'First')));
  good(editor.submit(rename('node-a', 'Second')));
  const lost = await editor.save();
  assert.equal(lost.ok, false);
  assert.equal(editor.getState().saveState, 'offline');
  good(editor.submit(rename('node-a', 'Third')));
  good(await editor.save());
  assert.equal(
    calls.length,
    3,
    'The unconfirmed batch is retried, then the newer edit is sent separately',
  );
  assert.deepEqual(calls[1], calls[0], 'The retry repeats the exact batch');
  assert.equal(calls[2].transactions.length, 1);
  assert.equal(calls[2].base.bundleDigest, calls[0].result.bundleDigest);
  assert.equal(
    (await store.history()).length,
    4,
    'Each edit is stored once even though the first response was lost',
  );
  assert.equal(editor.getState().saveState, 'saved');
});

test('the unconfirmed batch boundary survives recovery after a reload', async (t) => {
  const store = await storeFor(t, makeBundle()),
    storage = memoryStorage();
  const lost = batchTransport(store, { lose: () => ({ ok: false, status: 'unknown' }) });
  const bundle = good(await store.read()).bundle;
  const first = session(t, {
    bundle,
    acknowledged: true,
    transport: lost.transport,
    recovery: recovery(storage),
  });
  good(first.submit(rename('node-a', 'First')));
  good(first.submit(rename('node-a', 'Second')));
  assert.equal((await first.save()).ok, false);
  good(first.submit(rename('node-a', 'Third')));
  first.dispose();
  const reopened = batchTransport(store);
  const second = session(t, {
    bundle,
    acknowledged: true,
    transport: reopened.transport,
    recovery: recovery(storage),
  });
  assert.equal(second.getState().pendingCount, 3);
  good(await second.save());
  assert.equal(
    reopened.calls[0].batchId,
    lost.calls[0].batchId,
    'The reloaded session resends the same batch first',
  );
  assert.equal(reopened.calls[0].transactions.length, 2);
  assert.equal(reopened.calls[1].transactions.length, 1);
});

test('a rejected batch commits nothing, so later edits are sent together in a new batch', async (t) => {
  const store = await storeFor(t, makeBundle());
  const { transport, calls } = batchTransport(store, {
    reject: (call) => (call === 1 ? { ok: false, httpStatus: 413 } : null),
  });
  const editor = session(t, {
    bundle: good(await store.read()).bundle,
    acknowledged: true,
    transport,
  });
  good(editor.submit(rename('node-a', 'Too large')));
  assert.equal((await editor.save()).ok, false);
  good(editor.submit(rename('node-a', 'Smaller')));
  good(await editor.save());
  assert.equal(calls.length, 2);
  assert.equal(calls[1].transactions.length, 2, 'The rejected prefix is not resent on its own');
  assert.notEqual(calls[1].batchId, calls[0].batchId);
});

test('a stale-base conflict clears the unconfirmed batch and keeps the draft for comparison', async (t) => {
  const store = await storeFor(t, makeBundle());
  const { transport, calls } = batchTransport(store, {
    reject: (call) => (call === 1 ? { ok: false, httpStatus: 409 } : null),
  });
  const editor = session(t, {
    bundle: good(await store.read()).bundle,
    acknowledged: true,
    transport,
  });
  good(editor.submit(rename('node-a', 'Mine')));
  assert.equal((await editor.save()).ok, false);
  assert.equal(editor.getState().saveState, 'conflict');
  assert.equal(editor.getState().pendingCount, 1);
  good(editor.submit(rename('node-a', 'Mine again')));
  await editor.save();
  assert.equal(
    calls.at(-1).transactions.length,
    2,
    'After a definitive rejection the next save rebatches every pending edit',
  );
});

for (const retain of [false, true])
  test(`access loss reported by a save updates subscribers and ${retain ? 'retains' : 'clears'} recovery`, async (t) => {
    const store = await storeFor(t, makeBundle()),
      storage = memoryStorage();
    const { transport } = batchTransport(store, { reject: () => ({ ok: false, httpStatus: 401 }) });
    const editor = session(t, {
      bundle: good(await store.read()).bundle,
      acknowledged: true,
      transport,
      recovery: recovery(storage),
      retainRecoveryOnAccessLoss: retain,
    });
    const events = [];
    editor.subscribe((event) => events.push(event));
    good(editor.submit(rename('node-a', 'Pending')));
    assert.equal(storage.entries.size, 1);
    const result = await editor.save();
    assert.equal(result.ok, false);
    assert.equal(editor.getState().saveState, 'access-changed');
    assert.equal(
      events.at(-1).saveState,
      'access-changed',
      'Subscribers receive the final access state instead of a stuck Saving state',
    );
    assert.equal(storage.entries.size, retain ? 1 : 0);
  });

test('revoked read access retains same-identity recovery only when the host asks for it', async (t) => {
  const store = await storeFor(t, makeBundle());
  for (const retain of [false, true]) {
    const storage = memoryStorage();
    const editor = session(t, {
      bundle: good(await store.read()).bundle,
      acknowledged: true,
      recovery: recovery(storage),
      retainRecoveryOnAccessLoss: retain,
    });
    good(editor.submit(rename('node-a', `Pending ${retain}`)));
    editor.setCapabilities({ read: false, write: false });
    assert.equal(storage.entries.size, retain ? 1 : 0);
    assert.equal(editor.getState().bundle, null);
  }
});
