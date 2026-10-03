import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../support/browser-launcher.mjs';
import { enterpriseResourceProof } from './fixtures/enterprise-resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireProtocol = createRequire(
  new URL('../../packages/protocol/package.json', import.meta.url),
);
const { build } = requireProtocol('esbuild');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');
const fixture = fileURLToPath(new URL('./fixtures/enterprise-resources.mjs', import.meta.url));
async function bundle(contents, format) {
  const result = await build({
    stdin: { contents, resolveDir: root },
    platform: 'neutral',
    bundle: true,
    format,
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

test('opaque revision readers and escaped mixed-version handoffs agree in Node, browser and real Worker', {
  timeout: 90_000,
}, async () => {
  const expected = enterpriseResourceProof();
  assert.equal(expected.cases.length, 15);
  assert.ok(expected.cases.every(({ identity, rejection }) => identity && rejection));
  const imports = `import { enterpriseResourceProof } from ${JSON.stringify(fixture)};`;
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>Enterprise resource compatibility</title>');
    await page.addScriptTag({
      content: await bundle(
        `${imports}globalThis.resourceProof=enterpriseResourceProof();`,
        'iife',
      ),
    });
    assert.deepEqual(await page.evaluate(() => globalThis.resourceProof), expected);
  } finally {
    await browser.close();
  }
  const directory = await mkdtemp(join(tmpdir(), 'planr-enterprise-resource-worker-'));
  let runtime;
  try {
    const scriptPath = join(directory, 'worker.mjs');
    await writeFile(
      scriptPath,
      await bundle(
        `${imports}export default { fetch(){return Response.json(enterpriseResourceProof());} };`,
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
    const response = await runtime.dispatchFetch('https://enterprise-resources.test/');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), expected);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
