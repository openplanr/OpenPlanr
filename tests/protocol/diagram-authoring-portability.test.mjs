import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateAuthoringCases } from './fixtures/diagram-authoring.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireProtocol = createRequire(new URL('../../packages/protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const { chromium } = requireProtocol('playwright');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');
const fixture = fileURLToPath(new URL('./fixtures/diagram-authoring.mjs', import.meta.url));

async function bundle(contents, platform, format) {
  const result = await build({
    stdin: { contents, resolveDir: root, sourcefile: 'diagram-authoring-runtime-fixture.mjs' },
    bundle: true, platform, format, write: false, target: 'es2022', logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

// Deliberately execute the same case constructors in each runtime: serializing
// fixtures through JSON would turn Infinity into null and lose hostile getters,
// prototypes and sparse-array cases before a remote validator ever saw them.
test('authoring contracts return the same located diagnostics in Node, Chromium and a real Worker isolate', { timeout: 90_000 }, async () => {
  const expected = evaluateAuthoringCases();
  assert.ok(expected.some(value => value.valid), 'The portability table must exercise valid content');
  assert.ok(expected.some(value => !value.valid), 'The portability table must exercise rejected content');
  for (const value of expected) {
    assert.equal(value.threw, null, value.name);
    assert.equal(value.valid, value.expectedValid, `${value.name}: ${JSON.stringify(value.diagnostics)}`);
    if (value.expectedRule) assert.ok(value.diagnostics.some(diagnostic => diagnostic.rule === value.expectedRule), value.name);
    assert.equal(value.unchanged, true, value.name);
    assert.equal(value.getterReads, 0, `${value.name}: validation must not invoke accessors`);
    for (const diagnostic of value.diagnostics) {
      assert.equal(typeof diagnostic.path, 'string', `${value.name}: located diagnostic`);
      assert.equal(typeof diagnostic.rule, 'string', `${value.name}: typed diagnostic`);
    }
  }

  const browserCode = await bundle(`
    import { evaluateAuthoringCases } from ${JSON.stringify(fixture)};
    globalThis.authoringProof = {
      runtime: { document: typeof document, window: typeof window, process: typeof process, Buffer: typeof Buffer },
      cases: evaluateAuthoringCases(),
    };
  `, 'browser', 'iife');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html lang="en"><title>Diagram contract portability</title><body></body></html>');
    await page.addScriptTag({ content: browserCode });
    const actual = await page.evaluate(() => globalThis.authoringProof);
    assert.deepEqual(actual.runtime, { document: 'object', window: 'object', process: 'undefined', Buffer: 'undefined' });
    assert.deepEqual(actual.cases, expected, 'Chromium must validate the same fixtures with identical located diagnostics');
  } finally {
    await browser.close();
  }

  const directory = await mkdtemp(join(tmpdir(), 'planr-diagram-authoring-worker-'));
  let runtime;
  try {
    const workerCode = await bundle(`
      import { evaluateAuthoringCases } from ${JSON.stringify(fixture)};
      export default { fetch() {
        return Response.json({
          runtime: { WebSocketPair: typeof WebSocketPair, document: typeof document, process: typeof process, Buffer: typeof Buffer },
          cases: evaluateAuthoringCases(),
        });
      } };
    `, 'neutral', 'esm');
    const scriptPath = join(directory, 'worker.mjs');
    await writeFile(scriptPath, workerCode);
    runtime = new Miniflare({
      modules: true, modulesRoot: directory, scriptPath,
      compatibilityDate: '2026-07-08', log: new Log(LogLevel.ERROR),
    });
    const response = await runtime.dispatchFetch('https://diagram-authoring.test/');
    assert.equal(response.status, 200, await response.clone().text());
    const actual = await response.json();
    assert.deepEqual(actual.runtime, { WebSocketPair: 'function', document: 'undefined', process: 'undefined', Buffer: 'undefined' });
    assert.deepEqual(actual.cases, expected, 'Worker isolate must validate the same fixtures with identical located diagnostics');
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
