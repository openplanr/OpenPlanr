import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../support/browser-launcher.mjs';
import { enterpriseJourneyProof } from './fixtures/enterprise-journeys.mjs';

const root = resolve(import.meta.dirname, '../..');
const requireProtocol = createRequire(
  new URL('../../packages/protocol/package.json', import.meta.url),
);
const { build } = requireProtocol('esbuild');
const { Miniflare, Log, LogLevel } = requireProtocol('miniflare');

test('exact packed journey readers agree offline in Node, browser and Worker', {
  timeout: 120_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openplanr-company-contracts-'));
  let browser, runtime;
  try {
    const [{ filename }] = JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
        cwd: join(root, 'packages/protocol'),
        encoding: 'utf8',
      }),
    );
    execFileSync('tar', ['-xzf', join(directory, filename), '-C', directory]);
    const fixture = await readFile(
      new URL('./fixtures/enterprise-journeys.mjs', import.meta.url),
      'utf8',
    );
    const imports = fixture.replaceAll(
      '../../../packages/protocol/src/',
      `${join(directory, 'package/src')}/`,
    );
    const bundle = async (format, extra = '') =>
      (
        await build({
          stdin: { contents: `${imports}\n${extra}`, resolveDir: directory },
          platform: 'neutral',
          format,
          bundle: true,
          target: 'es2022',
          write: false,
          logLevel: 'silent',
        })
      ).outputFiles[0].text;
    const expected = enterpriseJourneyProof();
    assert.ok(expected.cases.every((entry) => entry.passed));
    const node = await import(
      `data:text/javascript;base64,${Buffer.from(await bundle('esm')).toString('base64')}`
    );
    assert.deepEqual(node.enterpriseJourneyProof(), expected);
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>Company contract readers</title>');
    await page.addScriptTag({
      content: await bundle('iife', 'globalThis.companyProof=enterpriseJourneyProof();'),
    });
    assert.deepEqual(await page.evaluate(() => globalThis.companyProof), expected);
    const scriptPath = join(directory, 'worker.mjs');
    await writeFile(
      scriptPath,
      await bundle(
        'esm',
        'export default { fetch(){return Response.json(enterpriseJourneyProof());} };',
      ),
    );
    runtime = new Miniflare({
      modules: true,
      modulesRoot: directory,
      scriptPath,
      compatibilityDate: '2026-07-08',
      log: new Log(LogLevel.ERROR),
    });
    const response = await runtime.dispatchFetch('https://company-contracts.test/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    for (const name of Object.keys(
      (await import('../../packages/protocol/src/enterprise-journey-contracts.mjs'))
        .ENTERPRISE_JOURNEY_SCHEMAS,
    )) {
      const asset = JSON.parse(
        await readFile(join(directory, 'package/schemas/v1.19.0', `${name}.schema.json`), 'utf8'),
      );
      assert.equal(asset['x-openplanr-contract'].version, '1.19.0');
    }
  } finally {
    await browser?.close();
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
