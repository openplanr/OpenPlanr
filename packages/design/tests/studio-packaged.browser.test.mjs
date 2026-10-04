import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDesignSkillResources } from '../../../scripts/skills/design-resources.mjs';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { designFixture } from './design-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('installed Studio boots in a browser from its readable runtime source units', {
  timeout: 90_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-portable-studio-browser-'));
  const signals = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((name) => [name, process.listeners(name)]),
  );
  let close;
  let browser;
  t.after(async () => {
    await browser?.close();
    await close?.();
    for (const [name, original] of Object.entries(signals))
      for (const listener of process.listeners(name))
        if (!original.includes(listener)) process.removeListener(name, listener);
    rmSync(root, { recursive: true, force: true });
  });
  const resources = await buildDesignSkillResources({ repoRoot });
  for (const asset of ['studio/studio.js', 'artifact-review-stage.js']) {
    assert.ok(
      resources.some(({ path }) => path.endsWith(`${asset}.sources.json`)),
      asset,
    );
    assert.ok(!resources.some(({ path }) => path.endsWith(`templates/${asset}`)), asset);
  }
  for (const resource of resources) {
    const target = join(root, 'installed', resource.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, resource.bytes);
  }
  const { designUtility } = await import(pathToFileURL(join(root, 'installed/scripts/design.mjs')));
  const designRoot = join(root, 'design');
  mkdirSync(designRoot);
  const { file } = designFixture(designRoot, { count: 2 });
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const run = (args) => designUtility(args, { env, stdout() {} });
  assert.equal((await run(['render', file])).ok, true);
  const opened = await run(['open', file, '--no-open']);
  close = opened.close;
  browser = await launchBrowser({ engine: browserEngine() });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack));
  await page.goto(opened.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-design-ready="true"]', { timeout: 20_000 });
  await page.waitForFunction(
    () =>
      window.__openPlanrArtifactStage &&
      window.__openPlanrDesignStudio &&
      document.querySelectorAll('iframe[src], iframe[srcdoc]').length > 0 &&
      [...document.querySelectorAll('iframe[src], iframe[srcdoc]')].every(
        (frame) => frame.dataset.planrBridgeTrusted === 'true',
      ),
    null,
    { timeout: 20_000 },
  );
  await settleStudioChrome(page);
  for (const view of ['prototype', 'canvas']) {
    await page.locator(`button[data-design-view="${view}"]`).first().click();
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector(`button[data-design-view="${expected}"]`)
          ?.getAttribute('aria-pressed') === 'true',
      view,
      { timeout: 10_000 },
    );
  }
  assert.deepEqual(errors, []);
});
