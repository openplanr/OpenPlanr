import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createDiagramAuthoringStore } from '../../packages/artifact/lib/artifact/diagram/authoring/store.mjs';
import { startDiagramOwner } from '../../packages/artifact/lib/artifact/diagram/editor/local-owner.mjs';
import { mixedBundle } from '../../packages/artifact/tests/fixtures/diagram-editor-capacity.mjs';
import { FIREFOX_COOP_PAGE_PREFS, launchBrowser } from '../support/browser-launcher.mjs';

const reportPath = process.argv[2];
if (!reportPath) throw new TypeError('Supply a local JSON evidence output path.');
const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-capacity-')));
const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
await store.initialize(mixedBundle(), { transactionId: 'capacity-fixture' });
const owner = await startDiagramOwner({
  root,
  slug: 'checkout',
  noOpen: true,
  env: { ...process.env, PLANR_HOME: join(root, 'home') },
});
const evidence = {
  fixture: {
    elements: 1000,
    nodes: 600,
    connectors: 300,
    groups: 50,
    lanes: 50,
    module: 'packages/artifact/tests/fixtures/diagram-editor-capacity.mjs',
  },
  viewport: { width: 1440, height: 900 },
  network: 'Loopback HTTP; no external assets',
  device: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    memoryBytes: totalmem(),
    node: process.version,
  },
  metric:
    'Input capture to first changed selected SVG element markup; pointer includes requestAnimationFrame preview scheduling',
  conditions:
    '20 fresh pages per engine, five alternating keyboard edits per page; 100 completed alternating pointer drags on a separate loaded page; no owner save during measurements',
  targets: { usableLoadP95Ms: 3000, inputResponseP95Ms: 50 },
  engines: {},
};
const stats = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    samples: values,
    p50: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
    max: ordered.at(-1),
  };
};
async function arm(page, kind) {
  await page.evaluate((kind) => {
    const svg = document.querySelector('[data-editor-svg]');
    const selector = '[data-editor-svg] [data-element-id="node-7"]';
    const before = document.querySelector(selector).outerHTML;
    window.__measuredGeometryResponse = new Promise((resolve, reject) => {
      let started;
      const capture = (event) => {
        if (
          (kind === 'keydown' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) ||
          (kind === 'pointermove' && event.buttons === 1)
        )
          started ??= performance.now();
      };
      const finish = () => {
        observer.disconnect();
        document.removeEventListener(kind, capture, true);
        clearTimeout(timeout);
      };
      const observer = new MutationObserver(() => {
        if (started === undefined || document.querySelector(selector)?.outerHTML === before) return;
        const elapsed = performance.now() - started;
        finish();
        resolve(elapsed);
      });
      const timeout = setTimeout(() => {
        finish();
        reject(new Error('Input produced no changed selected geometry'));
      }, 5000);
      document.addEventListener(kind, capture, true);
      observer.observe(svg, { subtree: true, attributes: true, childList: true });
    });
  }, kind);
}
const errors = [],
  external = [];
try {
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    process.env.PLANR_BROWSER_ENGINE = engine;
    const browser = await launchBrowser({
      firefoxUserPrefs: { ...FIREFOX_COOP_PAGE_PREFS, 'network.proxy.type': 0 },
    });
    try {
      const loads = [],
        keyboard = [],
        pointer = [];
      async function pageReady() {
        const page = await browser.newPage({ viewport: evidence.viewport });
        page.on('pageerror', (error) => errors.push(`${engine}: ${error.message}`));
        page.on('request', (request) => {
          if (!request.url().startsWith(new URL(owner.baseUrl).origin))
            external.push(request.url());
        });
        const start = performance.now();
        await page.goto(owner.baseUrl, { timeout: 15000 });
        await page
          .locator('[data-editor-svg] [data-element-id="node-599"]')
          .waitFor({ timeout: 20000 });
        const load = performance.now() - start;
        await page.locator('[data-action=select-id][data-id=node-7]').click();
        return { page, load };
      }
      for (let iteration = 0; iteration < 20; iteration++) {
        const { page, load } = await pageReady();
        loads.push(load);
        await page.getByLabel('Diagram canvas', { exact: true }).focus();
        for (let sample = 0; sample < 5; sample++) {
          await arm(page, 'keydown');
          await page.keyboard.press(sample % 2 ? 'ArrowLeft' : 'ArrowRight');
          keyboard.push(await page.evaluate(() => window.__measuredGeometryResponse));
        }
        await page.close();
      }
      const { page } = await pageReady();
      for (let sample = 0; sample < 100; sample++) {
        const rect = await page.locator('[data-editor-svg] [data-element-id=node-7]').boundingBox();
        assert.ok(rect && rect.width > 0 && rect.height > 0);
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await arm(page, 'pointermove');
        await page.mouse.move(x + (sample % 2 ? -6 : 6), y);
        pointer.push(await page.evaluate(() => window.__measuredGeometryResponse));
        await page.mouse.up();
      }
      await page.close();
      evidence.engines[engine] = {
        browser: browser.version(),
        usableLoad: stats(loads),
        keyboardResponse: stats(keyboard),
        pointerResponse: stats(pointer),
      };
      process.stdout.write(
        `${JSON.stringify({
          engine,
          loadP95Ms: evidence.engines[engine].usableLoad.p95,
          keyboardP95Ms: evidence.engines[engine].keyboardResponse.p95,
          pointerP95Ms: evidence.engines[engine].pointerResponse.p95,
        })}\n`,
      );
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  evidence.pass = Object.values(evidence.engines).every(
    (result) =>
      result.usableLoad.p95 < 3000 &&
      result.keyboardResponse.p95 < 50 &&
      result.pointerResponse.p95 < 50,
  );
  await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.ok(evidence.pass, 'Capacity target missed; retain measured evidence.');
} finally {
  await owner.close();
  await rm(root, { recursive: true, force: true });
}
