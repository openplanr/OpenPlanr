import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../support/browser-launcher.mjs';
import { evaluateReviewCases, reviewCatalogProof } from './fixtures/diagram-review.mjs';

const root = resolve(import.meta.dirname, '../..');
const requireProtocol = createRequire(
  new URL('../../packages/protocol/package.json', import.meta.url),
);
const { build } = requireProtocol('esbuild');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');
const fixture = fileURLToPath(new URL('./fixtures/diagram-review.mjs', import.meta.url));
async function bundle(contents, format) {
  const result = await build({
    stdin: { contents, resolveDir: root },
    platform: 'neutral',
    bundle: true,
    format,
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    define: { 'import.meta.url': '"https://protocol.test/src/browser-contracts.mjs"' },
  });
  return result.outputFiles[0].text;
}

test('native review schemas, semantic rejection and asset catalogs agree in Node, Chromium and Worker', {
  timeout: 90_000,
}, async () => {
  const expected = { cases: evaluateReviewCases(), catalog: reviewCatalogProof() };
  const imports = `import { evaluateReviewCases, reviewCatalogProof } from ${JSON.stringify(fixture)};`;
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><html><title>Native diagram review contracts</title><body></body></html>',
    );
    await page.addScriptTag({
      content: await bundle(
        `${imports}globalThis.reviewProof={ cases:evaluateReviewCases(), catalog:reviewCatalogProof() };`,
        'iife',
      ),
    });
    assert.deepEqual(await page.evaluate(() => globalThis.reviewProof), expected);
  } finally {
    await browser.close();
  }
  const directory = await mkdtemp(join(tmpdir(), 'planr-review-worker-'));
  let runtime;
  try {
    const scriptPath = join(directory, 'worker.mjs');
    await writeFile(
      scriptPath,
      await bundle(
        `${imports}export default { fetch(){return Response.json({cases:evaluateReviewCases(),catalog:reviewCatalogProof()});} };`,
        'esm',
      ),
    );
    runtime = new Miniflare({
      modules: true,
      modulesRoot: directory,
      scriptPath,
      compatibilityDate: '2026-07-08',
      log: new Log(LogLevel.ERROR),
    });
    const response = await runtime.dispatchFetch('https://review-contracts.test/');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), expected);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
