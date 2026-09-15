import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';

// Media emulation overrides every frame directly, hiding CSS inheritance bugs.
// Use the actual browser preference and also exercise Chromium's dark preference.
for (const darkBrowser of engine === 'chromium' ? [false, true] : [false]) {
  test(`shell appearance leaves authored screens unchanged (${engine}, browser ${darkBrowser ? 'dark' : 'default'})`, { timeout: 45000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'openplanr-theme-isolation-'));
    let browser, session;
    try {
      const { file, document } = designFixture(root, { count: 4, frames: [{ id: 'desktop', label: 'Desktop', width: 640, height: 480 }] });
      const styles = [
        ':root{color-scheme:light dark}body{background:#f4f8fc;color:#123456}@media(prefers-color-scheme:dark){body{background:#182838;color:#edf3fa}}',
        ':root{color-scheme:light}body{background:#fff;color:#123456}',
        ':root{color-scheme:dark}body{background:#182838;color:#edf3fa}',
        '', // Unstyled/transparent documents must not inherit the shell backing.
      ];
      document.screens.forEach((screen, i) => {
        screen.source.styles = [];
        writeFileSync(join(root, screen.source.html), `<!doctype html><html><head><style>${styles[i]}</style></head><body><h1>Product ${i + 1}</h1><input value="Authored field"><button data-planr-id="action-${i + 1}" onclick="this.textContent='Saved'">Save product</button></body></html>`);
      });
      writeFileSync(file, JSON.stringify(document));
      const rendered = await renderDesignDocument(file);
      session = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') }, port: 0 });
      browser = await engines[engine].launch({ headless: true,
        ...(engine === 'chromium' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
        ...(darkBrowser ? { args: ['--force-dark-mode'] } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: null });
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(30000);
      for (const url of [pathToFileURL(rendered.views.canvas).href, session.url]) {
        await page.goto(url);
        await page.waitForSelector('[data-design-ready="true"]');
        const frames = page.locator('[data-planr-artifact-frame]');
        const snapshot = async () => {
          const result = [];
          for (const frame of await frames.all()) {
            const child = await (await frame.elementHandle()).contentFrame();
            await child.locator('input').waitFor({ state: 'attached' });
            result.push({ backing: await frame.evaluate(el => getComputedStyle(el).backgroundColor),
              source: await frame.evaluate(el => el.getAttribute('srcdoc') || el.getAttribute('src')),
              product: await child.evaluate(() => ({
                mount: window.__themeIsolationMount ??= Math.random(),
                dark: matchMedia('(prefers-color-scheme:dark)').matches,
                body: getComputedStyle(document.body).backgroundColor,
                ink: getComputedStyle(document.body).color,
                input: getComputedStyle(document.querySelector('input')).backgroundColor,
                scheme: getComputedStyle(document.documentElement).colorScheme,
              })),
            });
          }
          return result;
        };
        await page.evaluate(() => window.__openPlanrDesignExperience.setTheme('light'));
        const baseline = await snapshot();
        assert.equal(baseline[0].product.dark, await page.evaluate(() => matchMedia('(prefers-color-scheme:dark)').matches));
        for (const view of ['canvas', 'prototype', 'walkthrough']) {
          await page.evaluate(view => window.__openPlanrDesignStudio.setView(view), view);
          for (const theme of ['dark', 'system', 'light']) {
            await page.evaluate(theme => window.__openPlanrDesignExperience.setTheme(theme), theme);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.deepEqual(await snapshot(), baseline, `${view}/${theme}: authored colors, native controls, media queries and transparent backing remain unchanged`);
          }
        }
        // Product interaction and authored scheme declarations remain intact.
        assert.equal(baseline[1].product.scheme, 'light');
        assert.equal(baseline[2].product.scheme, 'dark');
        await page.evaluate(() => window.__openPlanrDesignStudio.setView('prototype'));
        const action = page.frameLocator('[data-planr-artifact-frame]').first().getByRole('button', { name: 'Save product' });
        await action.focus();
        await action.press('Enter');
        await page.frameLocator('[data-planr-artifact-frame]').first().getByRole('button', { name: 'Saved', exact: true }).waitFor();
      }
    } finally { await browser?.close(); await session?.close(); await rm(root, { recursive: true, force: true }); }
  });
}
