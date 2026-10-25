import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

const engine = browserEngine();

test(`canvas ground stays plain and follows its surface token in both themes (${engine})`, {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-canvas-ground-'));
  let browser, review;
  try {
    const { file } = designFixture(root, { count: 1 });
    const rendered = await renderDesignDocument(file);
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(8000);
    for (const url of [pathToFileURL(rendered.views.canvas).href, review.url]) {
      await page.goto(url);
      await page.locator('[data-design-ready="true"]').waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => window.__openPlanrDesignExperience.setTheme(theme), theme);
        for (const camera of [
          { x: 0, y: 0, zoom: 1 },
          { x: 121, y: -49, zoom: 0.5 },
        ]) {
          await page.evaluate(async (camera) => {
            window.__openPlanrDesignStudio.setCamera(camera);
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          }, camera);
          const ground = await page.locator('.planr-stage').evaluate((stage) => {
            const patterns = [stage, ...stage.querySelectorAll('*')].flatMap((node) =>
              [null, '::before', '::after'].flatMap((pseudo) =>
                getComputedStyle(node, pseudo).backgroundImage.includes('radial-gradient')
                  ? [`${node.className}${pseudo ?? ''}`]
                  : [],
              ),
            );
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--planr-color-stage)';
            stage.append(probe);
            const token = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
              patterns,
              background: getComputedStyle(stage).backgroundColor,
              token,
              surface: getComputedStyle(stage).getPropertyValue('--planr-color-stage').trim(),
              boardShadow: getComputedStyle(stage.querySelector('.planr-frame')).boxShadow,
            };
          });
          assert.deepEqual(ground.patterns, [], `${url}/${theme}: no canvas dot pattern`);
          assert.ok(ground.surface, `${theme}: the stage surface token is defined`);
          assert.equal(
            ground.background,
            ground.token,
            `${theme}: the stage uses its surface token`,
          );
          assert.notEqual(ground.boardShadow, 'none', 'Boards remain distinct from the ground');
        }
      }
    }
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
