import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runKernelWithoutAmbientEffects } from './fixtures/diagram-authoring-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const { chromium } = requireProtocol('playwright');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');
const fixture = fileURLToPath(new URL('./fixtures/diagram-authoring-runtime.mjs', import.meta.url));

async function bundle(contents, platform, format) {
  const result = await build({
    stdin: { contents, resolveDir: root, sourcefile: 'diagram-kernel-runtime-fixture.mjs' },
    bundle: true, platform, format, write: false, target: 'es2022', logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function verifyBehavior(proof) {
  assert.deepEqual(proof.effects, []);
  const actual = JSON.parse(proof.canonical);
  assert.equal(actual.originalUnchanged, true);
  assert.equal(actual.getterReads, 0, 'A command getter is rejected without executing it');
  assert.deepEqual(actual.movedAgain, actual.moved, 'Compiling and replaying the same transaction agree');
  assert.deepEqual(actual.moved.bundle.document, actual.initialSemantic, 'Moving a container does not change meaning');
  const bounds = Object.fromEntries(actual.moved.bundle.presentation.elements.map(value => [value.elementId, value.bounds]));
  assert.deepEqual(bounds['node-a'], { x: 35, y: 55, width: 140, height: 70 });
  assert.deepEqual(bounds['node-b'], { x: 275, y: 55, width: 140, height: 70 });
  assert.deepEqual(bounds['group-inner'], { x: 25, y: 35, width: 170, height: 120 });
  assert.deepEqual(bounds['group-a'], { x: 15, y: 25, width: 190, height: 150 });
  assert.deepEqual(bounds['lane-a'], { x: -5, y: 5, width: 460, height: 210 });
  assert.deepEqual(bounds['note-a'], actual.initialBounds['note-a'], 'An annotation outside containment stays in place');
  assert.equal(actual.renamed.bundle.document.nodes.find(value => value.id === 'node-a').label, 'Accept Café ☕ order');
  assert.deepEqual(actual.undone.bundle, actual.moved.bundle, 'Undo restores meaning and presentation together');
  assert.deepEqual(actual.redone.bundle, actual.renamed.bundle, 'Redo restores the independently checked edited bundle');
  assert.equal(actual.duplicated.bundle.document.nodes.find(value => value.id === 'node-copy').label, 'Café ☕');
  assert.deepEqual(actual.duplicated.bundle.document.groups.find(value => value.id === 'group-copy').members, ['inner-copy']);
  assert.deepEqual(actual.duplicated.bundle.document.groups.find(value => value.id === 'inner-copy').members, ['node-copy']);
  assert.equal(actual.duplicated.bundle.document.annotations.find(value => value.id === 'note-copy').targetId, 'node-copy');
  assert.equal(actual.duplicated.bundle.document.relations.length, 1, 'The external connector is not silently duplicated');
  assert.deepEqual(actual.duplicated.bundle.document.relations[0], actual.initialSemantic.relations[0]);
  for (const [name, result] of [['locked descendant', actual.locked], ['stale base', actual.stale], ['command getter', actual.hostile], ['wrong-class removal after a valid move', actual.wrongClass]]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.diagnostics.length > 0, `${name}: located diagnostics`);
    assert.equal(Object.hasOwn(result, 'bundle'), false, `${name}: no applicable partial bundle`);
    assert.equal(Object.hasOwn(result, 'transaction'), false, `${name}: no committable transaction`);
  }
  assert.equal(actual.canceled.transaction ?? null, null, 'Canceled gestures create no commit input');
}

test('the same edit, diff, inverse and rejection fixtures agree in Node, Chromium and a Worker isolate', { timeout: 90_000 }, async () => {
  const expected = runKernelWithoutAmbientEffects();
  verifyBehavior(expected);
  const browserCode = await bundle(`
    import { runKernelWithoutAmbientEffects } from ${JSON.stringify(fixture)};
    globalThis.kernelProof = {
      runtime: { document: typeof document, window: typeof window, process: typeof process, Buffer: typeof Buffer },
      ...runKernelWithoutAmbientEffects(),
    };
  `, 'browser', 'iife');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html lang="en"><title>Diagram edit kernel portability</title><body></body></html>');
    await page.addScriptTag({ content: browserCode });
    const { runtime, ...actual } = await page.evaluate(() => globalThis.kernelProof);
    assert.deepEqual(runtime, { document: 'object', window: 'object', process: 'undefined', Buffer: 'undefined' });
    assert.deepEqual(actual, expected, 'Chromium must produce identical canonical transaction, result, diff and inverse bytes');
  } finally {
    await browser.close();
  }

  const directory = await mkdtemp(join(tmpdir(), 'planr-diagram-kernel-worker-'));
  let worker;
  try {
    const workerCode = await bundle(`
      import { runKernelWithoutAmbientEffects } from ${JSON.stringify(fixture)};
      export default { fetch() {
        return Response.json({
          runtime: { WebSocketPair: typeof WebSocketPair, document: typeof document, process: typeof process, Buffer: typeof Buffer },
          ...runKernelWithoutAmbientEffects(),
        });
      } };
    `, 'neutral', 'esm');
    const scriptPath = join(directory, 'worker.mjs');
    await writeFile(scriptPath, workerCode);
    worker = new Miniflare({ modules: true, modulesRoot: directory, scriptPath,
      compatibilityDate: '2026-07-08', log: new Log(LogLevel.ERROR) });
    const response = await worker.dispatchFetch('https://diagram-kernel.test/');
    assert.equal(response.status, 200, await response.clone().text());
    const { runtime, ...actual } = await response.json();
    assert.deepEqual(runtime, { WebSocketPair: 'function', document: 'undefined', process: 'undefined', Buffer: 'undefined' });
    assert.deepEqual(actual, expected, 'Worker must produce identical canonical transaction, result, diff and inverse bytes');
  } finally {
    await worker?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
