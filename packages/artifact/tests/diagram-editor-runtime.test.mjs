import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const { chromium } = requireProtocol('playwright');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');
const entry = fileURLToPath(new URL('../lib/artifact/diagram/editor/index.mjs', import.meta.url));
async function bundled(contents, format = 'iife') {
  const result = await build({ stdin: { contents, resolveDir: root, sourcefile: 'diagram-editor-proof.mjs' }, bundle: true, platform: 'browser', format, write: false, target: 'es2022', logLevel: 'silent' });
  return result.outputFiles[0].text;
}

test('browser session uses real scoped owner HTTP, saves offline and recovers a lost acknowledgement after refresh', { timeout: 45_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-browser-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const owner = await startDiagramOwner({ root: directory, slug: 'browser' });
  t.after(() => owner.close());
  const browser = await chromium.launch({ headless: true, ...(process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  // T-051 owns the shell. This fixture supplies only its same-origin mounting
  // document; every API request below reaches the real guarded owner server.
  await page.route(owner.baseUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Diagram session integration</title><main>Session test</main>' }));
  const requests = []; page.on('request', request => requests.push(request.url()));
  const code = await bundled(`import * as api from ${JSON.stringify(entry)}; globalThis.editorApi = api;`);
  async function mount() {
    await page.goto(owner.baseUrl); await page.addScriptTag({ content: code });
    return page.evaluate(async ({ apiBase }) => {
      const api = globalThis.editorApi;
      const transport = api.createDiagramLocalOwnerTransport({ apiBase });
      const read = await transport.read();
      const recovery = api.createDiagramEditorRecovery({ storage: sessionStorage, scope: { sessionId: read.recoveryScope, diagramId: read.diagramId } });
      const draft = api.createDiagramEditorDraft({ diagramId: 'browser', title: 'Offline browser draft' });
      globalThis.editor = await api.openDiagramEditorSession({ transport, recovery, create: draft.bundle });
      globalThis.unbind = api.bindDiagramEditorCancellation(globalThis.editor, window);
      return globalThis.editor.getState();
    }, { apiBase: owner.apiBase });
  }
  assert.equal((await mount()).saveState, 'unsaved');
  const created = await page.evaluate(async () => {
    const editor = globalThis.editor;
    const result = editor.submit({ type: 'create', elements: [{ collection: 'nodes', value: { id: 'step', label: 'Receive order', kind: 'process', description: null } }], presentation: [{
      elementId: 'step', bounds: { x: 20, y: 30, width: 140, height: 70 }, route: null, label: null, zIndex: 1,
      appearance: { shape: 'rectangle', fill: 'surface', stroke: 'default', strokeWidth: 2, strokeStyle: 'solid', fontSize: 14, textAlign: 'center' }, locks: { position: false, size: false, route: false },
    }] });
    const saved = await editor.save(); return { result, saved, state: editor.getState() };
  });
  assert.equal(created.result.ok, true, JSON.stringify(created.result)); assert.equal(created.saved.status, 'saved', JSON.stringify(created.saved));
  assert.equal(created.state.bundle.document.nodes[0].id, 'step');
  await page.route(`${owner.apiBase}commit`, async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  const uncertain = await page.evaluate(async () => {
    globalThis.editor.submit({ type: 'rename', id: 'step', label: 'Saved but response lost' });
    const result = await globalThis.editor.save(); return { result, state: globalThis.editor.getState(), recovery: Object.values(sessionStorage) };
  });
  assert.equal(uncertain.result.ok, false); assert.equal(uncertain.state.saveState, 'offline'); assert.equal(uncertain.state.pendingCount, 1);
  assert.ok(uncertain.recovery.length); assert.ok(uncertain.recovery.every(value => !value.includes('/o/')), 'No capability URLs in recovery');
  const restored = await mount();
  assert.equal(restored.pendingCount, 1); assert.equal(restored.bundle.document.nodes[0].label, 'Saved but response lost');
  const retried = await page.evaluate(async () => ({ result: await globalThis.editor.save(), state: globalThis.editor.getState() }));
  assert.equal(retried.result.ok, true); assert.equal(retried.state.saveState, 'saved'); assert.equal(retried.state.pendingCount, 0);
  const store = createDiagramAuthoringStore({ root: directory, slug: 'browser' });
  assert.equal((await store.history()).length, 3, 'Initialization, creation and one rename; no duplicate revision');
  const cancelled = await page.evaluate(() => {
    const editor = globalThis.editor; editor.beginGesture(); editor.previewGesture({ type: 'move', ids: ['step'], dx: 40, dy: 20 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return editor.getState();
  });
  assert.equal(cancelled.gesture, null); assert.equal(cancelled.pendingCount, 0); assert.equal(cancelled.bundle.presentation.elements[0].bounds.x, 20);
  assert.ok(requests.every(url => url.startsWith(owner.baseUrl)), 'Manual editing needs no external network or company credential');
});

test('portable session and indexed interaction run in a real Worker isolate without DOM or Node globals', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planr-editor-worker-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const code = await bundled(`
    import { createDiagramEditorDraft, createDiagramEditorSession } from ${JSON.stringify(entry)};
    export default { fetch() {
      const draft = createDiagramEditorDraft({diagramId:'worker',title:'Portable'});
      let sequence = 0;
      const editor = createDiagramEditorSession({bundle:draft.bundle,nextTransactionId:()=> 'worker-' + (++sequence)});
      editor.setView({camera:{x:40,y:30,scale:2,fit:null}});
      const result = editor.submit({type:'create',elements:[{collection:'nodes',value:{id:'step',label:'Portable step',kind:'process',description:null}}],presentation:[{
        elementId:'step',bounds:{x:20,y:30,width:140,height:70},route:null,label:null,zIndex:1,
        appearance:{shape:'rectangle',fill:'surface',stroke:'default',strokeWidth:2,strokeStyle:'solid',fontSize:14,textAlign:'center'},locks:{position:false,size:false,route:false}
      }]});
      const hit = editor.query({x:100,y:110,tolerance:3});
      const undone = editor.undo(); const redone = editor.redo();
      return Response.json({runtime:{document:typeof document,process:typeof process,WebSocketPair:typeof WebSocketPair},result:result.ok,hit,undo:undone.ok,redo:redone.ok,state:editor.getState()});
    }};
  `, 'esm');
  const scriptPath = join(directory, 'worker.mjs'); await writeFile(scriptPath, code);
  const worker = new Miniflare({ modules: true, modulesRoot: directory, scriptPath, compatibilityDate: '2026-07-08', log: new Log(LogLevel.ERROR) });
  t.after(() => worker.dispose());
  const response = await worker.dispatchFetch('https://editor.test'); const value = await response.json();
  assert.deepEqual(value.runtime, { document: 'undefined', process: 'undefined', WebSocketPair: 'function' });
  assert.equal(value.result, true); assert.equal(value.undo, true); assert.equal(value.redo, true);
  assert.ok(value.hit.hits.some(item => item.id === 'step'));
  assert.equal(value.state.bundle.document.nodes[0].id, 'step'); assert.equal(value.state.saveState, 'unsaved');
});
