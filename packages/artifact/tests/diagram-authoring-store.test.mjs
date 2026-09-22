import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { makeBundle, makeTransaction, placement, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createDiagramAuthoringStore, previewLegacyDiagramMigration } from '../lib/artifact/diagram/authoring/store.mjs';
import { renderDiagram } from '../lib/artifact/diagram/index.mjs';
import { withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { compileDiagramCommand, createConditionalInverse } from '../lib/artifact/diagram/authoring/index.mjs';

const storeUrl = new URL('../lib/artifact/diagram/authoring/store.mjs', import.meta.url).href;
const fixtureUrl = new URL('../../../tests/protocol/fixtures/diagram-authoring.mjs', import.meta.url).href;
const create = (root, options = {}) => createDiagramAuthoringStore({ root, slug: 'checkout', ...options });
async function workspace(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'openplanr-authoring-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function initialized(t, bundle = makeBundle('swimlane', { source: true })) {
  const root = await workspace(t);
  const store = create(root);
  const result = await store.initialize(bundle, { transactionId: 'initialize-checkout' });
  assert.equal(result.status, 'saved');
  return { root, store, bundle, result };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === `E_DIAGRAM_STORE_${code}`);

function child(root, body) {
  const script = `import {createDiagramAuthoringStore} from ${JSON.stringify(storeUrl)}; import {makeTransaction} from ${JSON.stringify(fixtureUrl)}; const root=process.env.DIAGRAM_TEST_ROOT; ${body}`;
  const processHandle = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DIAGRAM_TEST_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  processHandle.stdout.setEncoding('utf8'); processHandle.stdout.on('data', text => { output += text; });
  processHandle.stderr.setEncoding('utf8'); processHandle.stderr.on('data', text => { errors += text; });
  return { process: processHandle, done: once(processHandle, 'exit').then(([code, signal]) => ({ code, signal, output, errors })) };
}

test('complete snapshots, exact retry receipts and conditional undo survive store restart', async t => {
  const { root, store, bundle, result: first } = await initialized(t);
  const transaction = makeTransaction(bundle);
  const preview = await store.preview(transaction);
  assert.equal(preview.ok, true);
  assert.deepEqual((await store.read()).bundle, bundle, 'preview is inert');
  const saved = await store.commit(transaction);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.bundle, preview.bundle);
  const restarted = create(root);
  assert.deepEqual((await restarted.read()).bundle, saved.bundle);
  assert.deepEqual(await restarted.commit(transaction), { ...saved, replayed: true });
  assert.deepEqual(await restarted.readSnapshot(first.receipt.resultBytesDigest), bundle);
  assert.deepEqual((await restarted.history()).map(r => r.transactionId), ['rename-checkout', 'initialize-checkout']);
  const inverse = createConditionalInverse(saved.bundle, saved.receipt.inverse, { transactionId: 'undo-rename' });
  assert.equal(inverse.ok, true);
  assert.deepEqual((await restarted.commit(inverse.transaction)).bundle, bundle);
  assert.deepEqual(await restarted.commit(transaction), { ...saved, replayed: true }, 'an old receipt still identifies its historical result');
  assert.equal((await restarted.history({ limit: 1, beforeSequence: 3 }))[0].transactionId, transaction.transactionId);
  assert.equal((await readdir(join(root, 'diagrams', 'checkout', '.authoring', 'snapshots'))).length, 2, 'undo reuses the exact immutable snapshot');
});

test('each interrupted durability boundary remains unacknowledged until exact recovery', async t => {
  for (const phase of ['before-journal', 'after-journal', 'after-temporary-flush', 'after-replacement', 'after-receipt', 'after-head', 'before-acknowledgement']) {
    await t.test(phase, async t => {
      const { root, store, bundle } = await initialized(t);
      const transaction = makeTransaction(bundle);
      const expected = (await store.preview(transaction)).bundle;
      const interrupted = create(root, { faultInjector: point => { if (point === phase) throw new Error(`interrupted ${phase}`); } });
      if (phase === 'before-journal') {
        await assert.rejects(interrupted.commit(transaction), /interrupted/u);
        assert.deepEqual((await create(root).read()).bundle, bundle);
        assert.equal((await create(root).recover({ transactionId: transaction.transactionId })).status, 'not-found');
      } else {
        const uncertain = await interrupted.commit(transaction);
        assert.equal(uncertain.status, 'unknown');
        assert.equal(uncertain.ok, false);
        const recovered = await create(root).recover({ transactionId: transaction.transactionId, fingerprint: uncertain.fingerprint });
        assert.equal(recovered.status, 'saved');
        assert.deepEqual(recovered.bundle, expected);
        assert.deepEqual((await create(root).read()).bundle, expected);
        assert.equal((await create(root).history()).length, 2);
      }
    });
  }
});

test('process death during a save is recovered after restart without an age-based lock timeout', async t => {
  for (const phase of ['after-journal', 'after-temporary-flush', 'after-replacement', 'after-receipt', 'before-acknowledgement']) {
    await t.test(phase, async t => {
      const { root, store, bundle } = await initialized(t);
      const expected = (await store.preview(makeTransaction(bundle))).bundle;
      const run = child(root, `const store=createDiagramAuthoringStore({root,slug:'checkout',faultInjector:phase=>{if(phase===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');}});const state=await store.read();await store.commit(makeTransaction(state.bundle));`);
      const exit = await run.done;
      assert.equal(exit.signal, 'SIGKILL', exit.errors);
      const result = await create(root).recover({ transactionId: 'rename-checkout' });
      assert.equal(result.status, 'saved');
      assert.deepEqual(result.bundle, expected);
      assert.equal((await create(root).history()).length, 2);
    });
  }
});

test('competing writers and stale bases cannot overwrite a complete save', async t => {
  const { root, store, bundle } = await initialized(t);
  const first = makeTransaction(bundle);
  const second = compileDiagramCommand(bundle, { type: 'rename', id: 'node-b', label: 'A competing name' }, { transactionId: 'competing-rename' }).transaction;
  const settled = await Promise.allSettled([create(root).commit(first), create(root).commit(second)]);
  assert.equal(settled.filter(r => r.status === 'fulfilled' && r.value.status === 'saved').length, 1);
  const failure = settled.find(r => r.status === 'rejected');
  assert.ok(['E_DIAGRAM_STORE_LOCKED', 'E_DIAGRAM_STORE_INVALID_TRANSACTION'].includes(failure.reason.code));
  const head = await store.read();
  const stale = head.receipt.transactionId === first.transactionId ? second : first;
  await rejectsCode(store.commit(stale), 'INVALID_TRANSACTION');
  assert.deepEqual((await store.read()).bundle, head.bundle);
  assert.equal((await store.history()).length, 2);
});

test('transaction identity reuse rejects different bytes, including recovery identity mismatch', async t => {
  const { root, store, bundle } = await initialized(t);
  const transaction = makeTransaction(bundle);
  const saved = await store.commit(transaction);
  const changed = structuredClone(transaction);
  changed.operations[0].after.label = 'A substituted result';
  await rejectsCode(store.commit(changed), 'ID_REUSE');
  await rejectsCode(store.initialize(bundle, { transactionId: transaction.transactionId }), 'ID_REUSE');
  await rejectsCode(store.recover({ transactionId: transaction.transactionId, fingerprint: `sha256:${'0'.repeat(64)}` }), 'ID_REUSE');
  assert.deepEqual((await create(root).read()).bundle, saved.bundle);
});

test('changed unknown canonical bytes stop recovery without overwriting source or recovery intent', async t => {
  const { root, store, bundle } = await initialized(t);
  const transaction = makeTransaction(bundle);
  const uncertain = await create(root, { faultInjector: phase => { if (phase === 'after-journal') throw new Error('disconnect'); } }).commit(transaction);
  const different = compileDiagramCommand(bundle, { type: 'rename', id: 'node-b', label: 'Unrecognized edit' }, { transactionId: 'unknown-edit' }).bundle;
  const differentBytes = `${JSON.stringify(different)}\n`;
  await writeFile(store.path, differentBytes);
  const journal = join(root, 'diagrams', 'checkout', '.authoring', 'pending.json');
  const priorJournal = await readFile(journal);
  const recovered = await create(root).recover({ transactionId: transaction.transactionId, fingerprint: uncertain.fingerprint });
  assert.equal(recovered.status, 'unknown');
  assert.equal(await readFile(store.path, 'utf8'), differentBytes);
  assert.deepEqual(await readFile(journal), priorJournal);
  assert.equal((await create(root).history()).length, 1);
});

test('traversal, symlink components, hard links, and unowned collisions leave outside bytes untouched', async t => {
  const root = await workspace(t);
  const outside = await workspace(t);
  const sentinel = join(outside, 'source.json');
  await writeFile(sentinel, 'outside source');
  assert.throws(() => createDiagramAuthoringStore({ root, slug: '../outside' }), /identifier/u);
  const alias = join(root, 'linked-root');
  await symlink(outside, alias);
  await rejectsCode(create(alias).initialize(makeBundle(), { transactionId: 'initialize' }), 'PATH');
  await symlink(outside, join(root, 'diagrams'));
  await rejectsCode(create(root).initialize(makeBundle(), { transactionId: 'initialize' }), 'PATH');
  await rm(join(root, 'diagrams'));
  const target = join(root, 'diagrams', 'checkout');
  await mkdir(target, { recursive: true });
  const bundlePath = join(target, 'checkout.planr-diagram-bundle.json');
  await symlink(sentinel, bundlePath);
  await rejectsCode(create(root).initialize(makeBundle(), { transactionId: 'initialize' }), 'PATH');
  await rm(bundlePath);
  await link(sentinel, bundlePath);
  await rejectsCode(create(root).initialize(makeBundle(), { transactionId: 'initialize' }), 'PATH');
  await rm(bundlePath);
  await writeFile(bundlePath, 'unowned file');
  await rejectsCode(create(root).initialize(makeBundle(), { transactionId: 'initialize' }), 'COLLISION');
  assert.equal(await readFile(bundlePath, 'utf8'), 'unowned file');
  assert.equal(await readFile(sentinel, 'utf8'), 'outside source');
});

test('post-initialization canonical and snapshot substitution is detected before committing', async t => {
  const { root, store, bundle, result } = await initialized(t);
  const initial = await readFile(store.path);
  await writeFile(store.path, `${JSON.stringify(bundle)}\n`);
  await rejectsCode(store.read(), 'CHANGED');
  await rejectsCode(store.commit(makeTransaction(bundle)), 'CHANGED');
  await writeFile(store.path, initial);
  const snapshotFile = join(root, 'diagrams', 'checkout', '.authoring', 'snapshots', `${result.receipt.resultBytesDigest.slice(7)}.json`);
  await writeFile(snapshotFile, '{}\n');
  await rejectsCode(store.readSnapshot(result.receipt.resultBytesDigest), 'CORRUPT');
  await rejectsCode(store.commit(makeTransaction(bundle)), 'CORRUPT');
  assert.deepEqual(await readFile(store.path), initial);
});

test('blank and 1000-element mixed bundles save without any renderer or rasterizer', async t => {
  const blank = makeBundle('flowchart', { blank: true });
  const empty = await initialized(t, blank);
  assert.deepEqual((await create(empty.root).read()).bundle, blank);
  const dense = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < 500; index++) {
    const id = `node-${index}`;
    dense.document.nodes.push({ id, label: `Node ${index}`, kind: 'process', description: null });
    dense.presentation.elements.push(placement(id, 'rectangle', index * 200, 0));
    if (index) {
      const edge = `edge-${index}`;
      dense.document.relations.push({ id: edge, from: `node-${index - 1}`, to: id, kind: 'flow', direction: 'forward', label: null, weight: null });
      dense.presentation.elements.push({ ...placement(edge, 'connector'), bounds: null, route: { mode: 'automatic', strategy: 'orthogonal', from: { side: 'right', offset: 0.5 }, to: { side: 'left', offset: 0.5 }, points: [] } });
    }
  }
  dense.document.annotations.push({ id: 'note-a', text: 'A valid dense source is independent of export budgets.', targetId: null });
  dense.presentation.elements.push(placement('note-a', 'text'));
  sealBundle(dense);
  assert.equal(dense.presentation.elements.length, 1000);
  const large = await initialized(t, dense);
  assert.deepEqual((await create(large.root).read()).bundle, dense);
  await rejectsCode(create(large.root, { maxBundleBytes: 100 }).read(), 'CAPACITY');
  assert.deepEqual((await create(large.root).read()).bundle, dense);
});

test('first initialization can resume after process death before claiming empty metadata folders', async t => {
  const root = await workspace(t);
  const run = child(root, `const {makeBundle}=await import(${JSON.stringify(fixtureUrl)});const store=createDiagramAuthoringStore({root,slug:'checkout',faultInjector:phase=>{if(phase==='before-ownership')process.kill(process.pid,'SIGKILL');}});await store.initialize(makeBundle(),{transactionId:'initialize-checkout'});`);
  assert.equal((await run.done).signal, 'SIGKILL');
  assert.equal((await create(root).read()).status, 'absent');
  assert.equal((await create(root).initialize(makeBundle(), { transactionId: 'initialize-checkout' })).status, 'saved');
});

test('pending ID reuse and substituted recovery records cannot commit an unproven result', async t => {
  const { root, store, bundle } = await initialized(t);
  const transaction = makeTransaction(bundle);
  const uncertain = await create(root, { faultInjector: phase => { if (phase === 'after-journal') throw new Error('disconnect'); } }).commit(transaction);
  const changed = structuredClone(transaction);
  changed.operations[0].after.label = 'Substitute the pending edit';
  await rejectsCode(create(root).commit(changed), 'ID_REUSE');
  assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')), bundle);
  await rejectsCode(create(root).recover({ transactionId: 'different-transaction' }), 'IDENTITY');
  const journalPath = join(root, 'diagrams', 'checkout', '.authoring', 'pending.json');
  const pending = JSON.parse(await readFile(journalPath, 'utf8'));
  pending.transaction.operations[0].after.label = 'Changed after journal flush';
  await writeFile(journalPath, JSON.stringify(pending));
  await rejectsCode(create(root).recover({ transactionId: transaction.transactionId, fingerprint: uncertain.fingerprint }), 'CORRUPT');
  assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')), bundle);
});

test('accessor transactions are rejected without evaluating properties or saving any edit', async t => {
  const { store, bundle } = await initialized(t);
  let reads = 0;
  const transaction = makeTransaction(bundle);
  Object.defineProperty(transaction, 'transactionId', { enumerable: true, get() { reads++; return 'hostile'; } });
  await rejectsCode(store.commit(transaction), 'INVALID');
  assert.equal(reads, 0);
  assert.deepEqual((await store.read()).bundle, bundle);
});

test('presentation obstruction is domain-valid content and is saved without a quality gate', async t => {
  const bundle = makeBundle();
  const blocker = { id: 'blocker', label: 'Obstructing node', kind: 'process', description: null };
  bundle.document.nodes.push(blocker);
  bundle.presentation.elements.push(placement('blocker', 'rectangle', 175, 25));
  sealBundle(bundle);
  const { root } = await initialized(t, bundle);
  assert.deepEqual((await create(root).read()).bundle, bundle);
});


test('legacy adoption resumes after real interruption only while legacy custody remains unchanged', async t => {
  for (const changed of [false, true]) {
    await t.test(changed ? 'changed legacy source rejects adoption' : 'unchanged legacy source resumes adoption', async t => {
      const root = await workspace(t);
      const legacy = JSON.parse(await readFile(new URL('../fixtures/diagram/grammars/flowchart.planr-diagram.json', import.meta.url), 'utf8'));
      legacy.diagramId = 'checkout';
      legacy.nodes.forEach(node => { node.kind = 'process'; });
      legacy.relations = [{ id: 'flow', from: 'item-a', to: 'item-b', kind: 'flow', label: 'Continue', weight: null }];
      legacy.accessibility.readingOrder = ['item-a', 'flow', 'item-b'];
      await renderDiagram(withDocumentDigest(legacy), { outputRoot: root });
      const directory = join(root, 'diagrams', 'checkout');
      const prior = new Map(await Promise.all((await readdir(directory)).map(async name => [name, await readFile(join(directory, name))])));
      const preview = await previewLegacyDiagramMigration({ root, slug: 'checkout' });
      assert.equal(preview.ok, true);
      const run = child(root, `const store=createDiagramAuthoringStore({root,slug:'checkout',faultInjector:phase=>{if(phase==='before-ownership')process.kill(process.pid,'SIGKILL');}});await store.initialize(${JSON.stringify(preview.bundle)},{transactionId:'adopt-checkout'});`);
      const exit = await run.done;
      assert.equal(exit.signal, 'SIGKILL', exit.errors);
      if (changed) {
        const sourcePath = join(directory, 'checkout.planr-diagram.json');
        const modified = Buffer.concat([await readFile(sourcePath), Buffer.from('\n')]);
        await writeFile(sourcePath, modified);
        await rejectsCode(create(root).initialize(preview.bundle, { transactionId: 'adopt-checkout' }), 'COLLISION');
        assert.deepEqual(await readFile(sourcePath), modified);
        await assert.rejects(readFile(create(root).path), { code: 'ENOENT' });
        prior.delete('checkout.planr-diagram.json');
      } else {
        const saved = await create(root).initialize(preview.bundle, { transactionId: 'adopt-checkout' });
        assert.equal(saved.status, 'saved');
        assert.deepEqual((await create(root).read()).bundle, preview.bundle);
      }
      for (const [name, bytes] of prior) assert.deepEqual(await readFile(join(directory, name)), bytes);
    });
  }
});


test('save and preview capture inert caller bytes synchronously before asynchronous work', async t => {
  const root = await workspace(t);
  const bundle = makeBundle();
  const original = structuredClone(bundle);
  const initialization = create(root).initialize(bundle, { transactionId: 'initialize-checkout' });
  bundle.document.title = 'Caller changed its source immediately';
  sealBundle(bundle);
  const initial = await initialization;
  assert.deepEqual(initial.bundle, original);

  const previewTransaction = makeTransaction(original);
  const untouched = structuredClone(previewTransaction);
  const previewing = create(root).preview(previewTransaction);
  previewTransaction.operations[0].after.label = 'Mutated after preview call';
  const preview = await previewing;
  assert.equal(preview.bundle.document.nodes[0].label, untouched.operations[0].after.label);

  const transaction = makeTransaction(original);
  let mutatedDuringJournal = false;
  const store = create(root, { faultInjector: phase => {
    if (phase === 'before-journal') {
      transaction.operations[0].after.label = 'Mutated during journal boundary';
      mutatedDuringJournal = true;
    }
  } });
  const committing = store.commit(transaction);
  transaction.operations[0].after.label = 'Mutated immediately after commit call';
  const saved = await committing;
  assert.equal(mutatedDuringJournal, true);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.bundle, preview.bundle);
  assert.deepEqual(await create(root).commit(untouched), { ...saved, replayed: true });
  await rejectsCode(create(root).commit(transaction), 'ID_REUSE');
  assert.deepEqual((await create(root).read()).bundle, preview.bundle);
});
