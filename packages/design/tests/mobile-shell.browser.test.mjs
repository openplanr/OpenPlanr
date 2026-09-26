import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { emptyReviewContext } from '../lib/design/context.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))(
  'playwright',
);
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';
const settle = (page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      [...document.querySelectorAll('.planr-workspace,.design-navigator,.planr-review-rail')]
        .flatMap((value) => value.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    );
  });

async function fieldSizes(page, scope = 'body') {
  return page
    .locator(
      `${scope} input:not([type=hidden]):not([type=checkbox]):not([type=radio]), ${scope} select, ${scope} textarea`,
    )
    .evaluateAll((values) =>
      values
        .filter((value) => {
          const rect = value.getBoundingClientRect(),
            style = getComputedStyle(value);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.left < innerWidth &&
            rect.bottom > 0 &&
            rect.top < innerHeight &&
            style.visibility !== 'hidden'
          );
        })
        .map((value) => ({
          label: value.getAttribute('aria-label') || value.name || value.outerHTML.slice(0, 100),
          font: parseFloat(getComputedStyle(value).fontSize),
          height: value.getBoundingClientRect().height,
          minimum: getComputedStyle(value).minHeight,
          appearance: getComputedStyle(value).appearance,
          padding: getComputedStyle(value).padding,
        })),
    );
}

async function assertMobileFields(page, scope) {
  const fields = await fieldSizes(page, scope);
  assert.ok(fields.length, `Some visible fields are checked in ${scope || 'the shell'}`);
  for (const field of fields) {
    assert.ok(
      field.font >= 16,
      `Mobile field ${field.label} must not trigger iOS focus zoom (${field.font}px)`,
    );
    assert.ok(
      field.height >= 44,
      `Mobile field needs a 44px touch target: ${JSON.stringify(field)}`,
    );
  }
}

async function assertTargets(page, selector) {
  const targets = await page.locator(selector).evaluateAll((values) =>
    values
      .filter((value) => {
        const rect = value.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.left < innerWidth &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          getComputedStyle(value).visibility !== 'hidden'
        );
      })
      .map((value) => ({
        label: value.getAttribute('aria-label') || value.textContent.trim(),
        width: value.getBoundingClientRect().width,
        height: value.getBoundingClientRect().height,
      })),
  );
  assert.ok(targets.length, `Some touch targets match ${selector}`);
  for (const target of targets)
    assert.ok(
      target.width >= 44 && target.height >= 44,
      `${target.label} needs a 44×44px touch target, received ${target.width}×${target.height}`,
    );
}

async function assertShellFits(page) {
  await settle(page);
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scale: visualViewport?.scale,
    panels: [...document.querySelectorAll('.design-toolbar,.design-stage-context')].map(
      (value) => ({
        name: value.className,
        width: value.clientWidth,
        scrollWidth: value.scrollWidth,
        left: value.getBoundingClientRect().left,
        right: value.getBoundingClientRect().right,
      }),
    ),
  }));
  assert.ok(
    geometry.scrollWidth <= geometry.width + 1,
    `Shell must not overflow horizontally: ${JSON.stringify(geometry)}`,
  );
  for (const panel of geometry.panels)
    assert.ok(
      panel.left >= -1 && panel.right <= geometry.width + 1 && panel.scrollWidth <= panel.width + 1,
      `Shell chrome fits its viewport: ${JSON.stringify(panel)}`,
    );
  assert.equal(geometry.scale, 1, 'The shell retains normal browser zoom');
}

async function assertDialogFits(page, selector = 'dialog[open]') {
  await page
    .waitForFunction((selector) => {
      const dialog = document.querySelector(selector);
      if (!dialog) return false;
      const rect = dialog.getBoundingClientRect(),
        viewport = visualViewport;
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= viewport.offsetLeft - 1 &&
        rect.right <= viewport.offsetLeft + viewport.width + 1 &&
        rect.top >= viewport.offsetTop - 1 &&
        rect.bottom <= viewport.offsetTop + viewport.height + 1
      );
    }, selector)
    .catch(async (error) => {
      const geometry = await page.locator(selector).evaluate((value) => ({
        dialog: value.getBoundingClientRect().toJSON(),
        viewport: {
          width: visualViewport.width,
          height: visualViewport.height,
          left: visualViewport.offsetLeft,
          top: visualViewport.offsetTop,
        },
        active: document.activeElement?.getBoundingClientRect().toJSON(),
      }));
      throw new Error(`Dialog must fit the visual viewport: ${JSON.stringify(geometry)}`, {
        cause: error,
      });
    });
  const content = await page
    .locator(selector)
    .evaluate((value) => ({ width: value.clientWidth, scroll: value.scrollWidth }));
  assert.ok(
    content.scroll <= content.width + 1,
    'The dialog scrolls vertically without horizontal clipping',
  );
}

// Browser emulation does not open a native iOS keyboard. Keep its real viewport
// EventTarget and emulate the dimensions/offset that iOS reports when it opens,
// so geometry is verified without weakening zoom or disabling accessibility.
async function keyboardViewport(page, height) {
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    for (const property of ['height', 'offsetTop']) delete viewport[property];
    if (height !== null)
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => height },
        offsetTop: { configurable: true, get: () => 54 },
      });
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
  }, height);
}

test(`mobile shell fields, touch controls and welcome remain usable without changing authored designs (${engine})`, {
  timeout: 120000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-mobile-shell-'));
  let browser, review;
  try {
    const { file, document } = designFixture(root, {
      count: 2,
      frames: [{ id: 'mobile', label: 'Mobile', width: 390, height: 760 }],
    });
    document.defaultView = 'prototype';
    document.title = 'Workspace — review the complete application journey';
    for (const screen of document.screens) {
      screen.source.styles = [];
      writeFileSync(
        join(root, screen.source.html),
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:16px;background:#f5f7f6;color:#17372b;font:13px/1.5 system-ui}input{font:12px/1.4 system-ui;height:22px;width:160px}button{font:12px/1.4 system-ui}
        </style></head><body><h1>${screen.title}</h1><label>Product field <input aria-label="Product field" value="Authored value"></label>
        <button data-planr-id="${screen.anchors[0]}">Authored action</button></body></html>`,
      );
    }
    writeFileSync(file, JSON.stringify(document));
    const context = emptyReviewContext(document);
    context.brief.purpose =
      'Explore the application journey and help us understand whether its steps, labels, and decisions are clear on your phone. Your comments stay tied to the screen you reviewed.';
    context.brief.requests = [
      'Is each next step clear?',
      'Which screen needs clarification?',
      'Can you complete the journey comfortably on your phone?',
    ];
    writeFileSync(join(root, 'review-context.json'), JSON.stringify(context));
    const rendered = await renderDesignDocument(file);
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await engines[engine].launch({
      headless: true,
      ...(engine === 'chromium' &&
      existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? { channel: 'chrome' }
        : {}),
    });
    for (const [host, url] of [
      ['portable', pathToFileURL(rendered.views.prototype).href],
      ['local', review.url],
    ]) {
      const browserContext = await browser.newContext({ ...engines.devices['iPhone 13'] });
      const page = await browserContext.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.locator('[data-design-ready=true]').waitFor();
      await page.waitForFunction(() => window.__openPlanrDesignExperience);
      const viewportMeta = await page.locator('meta[name=viewport]').getAttribute('content');
      assert.doesNotMatch(
        viewportMeta,
        /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/iu,
        'Accessibility zoom stays available',
      );
      const frame = await (
        await page.locator('.planr-artifact-panel:not([hidden]) iframe').elementHandle()
      ).contentFrame();
      const authoredBefore = await frame
        .getByRole('textbox', { name: 'Product field' })
        .evaluate((value) => ({
          font: getComputedStyle(value).fontSize,
          height: value.getBoundingClientRect().height,
        }));
      assert.equal(
        authoredBefore.font,
        '12px',
        'Fixture deliberately includes a smaller authored product field',
      );

      for (const viewport of [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() =>
          window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: false }),
        );
        await assertShellFits(page);
        await assertMobileFields(page, '.planr-shell');
        await assertTargets(
          page,
          '.design-toolbar button,.design-toolbar summary,.design-stage-actions button,.design-stage-actions select,.design-canvas-tools button',
        );
        await page.evaluate(() =>
          window.__openPlanrDesignStudio.setPanels({ navOpen: true, reviewOpen: false }),
        );
        await settle(page);
        await assertMobileFields(page, '.design-navigator');
        await page.evaluate(() =>
          window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: true }),
        );
        await settle(page);
        await assertMobileFields(page, '.planr-review-rail');
        await page.evaluate(() =>
          window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: false }),
        );
        await page.evaluate(() => window.__openPlanrDesignExperience.about());
        await assertDialogFits(page);
        await assertTargets(page, 'dialog[open] button');
        await page.getByRole('button', { name: 'Start walkthrough', exact: true }).tap();
        const name = page.getByRole('textbox', { name: 'Reviewer name', exact: true });
        await name.waitFor();
        await assertDialogFits(page);
        await assertMobileFields(page, 'dialog[open]');
        assert.equal(
          await page
            .locator('dialog[open] .design-dialog-content')
            .evaluate((node) => node.scrollTop),
          0,
          'The profile step starts at the top even after scrolling through a long welcome',
        );
        await assertTargets(page, 'dialog[open] button,.design-avatar-option');
        await name.fill('Mobile reviewer');
        if (viewport.width === 390) {
          const camera = await page.evaluate(() => {
            const state = window.__openPlanrDesignStudio.getState();
            return { camera: state.camera, zoom: state.zoom };
          });
          await keyboardViewport(page, 300);
          await assertDialogFits(page);
          await page.waitForFunction(() => {
            const field = document.querySelector('[name=reviewer-name]'),
              rect = field.getBoundingClientRect(),
              viewport = visualViewport;
            return (
              rect.top >= viewport.offsetTop &&
              rect.bottom <= viewport.offsetTop + viewport.height &&
              document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) ===
                field
            );
          });
          assert.equal(
            await name.inputValue(),
            'Mobile reviewer',
            'Keyboard resizing preserves the focused draft',
          );
          assert.deepEqual(
            await page.evaluate(() => {
              const state = window.__openPlanrDesignStudio.getState();
              return { camera: state.camera, zoom: state.zoom };
            }),
            camera,
            'A keyboard resize does not move or refit the product camera',
          );
          const evidence = process.env.OPENPLANR_MOBILE_SHELL_EVIDENCE_DIR;
          if (evidence) {
            mkdirSync(evidence, { recursive: true });
            await page.screenshot({ path: join(evidence, `${host}-${engine}-keyboard.png`) });
          }
          const beforePinch = await page.locator('dialog[open]').boundingBox();
          await page.evaluate(() => {
            Object.defineProperties(visualViewport, {
              height: { configurable: true, get: () => 190 },
              offsetTop: { configurable: true, get: () => 70 },
              scale: { configurable: true, get: () => 1.5 },
            });
            visualViewport.dispatchEvent(new Event('resize'));
            visualViewport.dispatchEvent(new Event('scroll'));
          });
          await settle(page);
          assert.deepEqual(
            await page.locator('dialog[open]').boundingBox(),
            beforePinch,
            'Native pinch zoom does not trigger compensating dialog resize or movement',
          );
          await page.evaluate(() => {
            delete visualViewport.scale;
          });
          await keyboardViewport(page, null);
          await assertDialogFits(page);
          await name.evaluate((value) => value.blur());
          await settle(page);
          assert.deepEqual(
            await page.evaluate(() => {
              const state = window.__openPlanrDesignStudio.getState();
              return { camera: state.camera, zoom: state.zoom };
            }),
            camera,
            'Dismissing the keyboard and leaving the field preserve the original camera',
          );
        }
        await page.getByRole('button', { name: 'Continue to review', exact: true }).tap();
        await page.locator('dialog[open]').waitFor({ state: 'detached' });
        await assertShellFits(page);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const studio = window.__openPlanrDesignStudio;
        studio.setView('prototype');
        studio.setTool('annotate');
      });
      await page
        .locator('.planr-artifact-panel:not([hidden]) .planr-annotation-layer')
        .tap({ position: { x: 30, y: 35 } });
      const composer = '[data-planr-annotation-composer]';
      await page.locator(composer).waitFor();
      await assertDialogFits(page, composer);
      await assertMobileFields(page, composer);
      await assertTargets(page, `${composer} button`);
      await page.locator('[data-planr-composer-comment]').fill('Mobile test annotation.');
      await page.locator('[data-planr-composer-submit]').tap();
      await page.locator(composer).waitFor({ state: 'detached' });
      await page.evaluate(() =>
        window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: true }),
      );
      await page.locator('[data-planr-reply-toggle]').first().tap();
      await page.locator('textarea[name=reply]').first().fill('Mobile test reply draft.');
      await assertMobileFields(page, '.planr-review-rail');
      assert.deepEqual(
        await frame
          .getByRole('textbox', { name: 'Product field' })
          .evaluate((value) => ({
            font: getComputedStyle(value).fontSize,
            height: value.getBoundingClientRect().height,
          })),
        authoredBefore,
        'Touch typography and layout rules apply only to the board shell',
      );
      assert.equal(
        await page.locator('.planr-shell').getAttribute('data-planr-frame-budget'),
        '3',
        'Mobile resource policy remains active',
      );
      assert.deepEqual(errors, []);
      await browserContext.close();
    }
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await desktop.goto(pathToFileURL(rendered.views.prototype).href);
    await desktop.locator('[data-design-ready=true]').waitFor();
    const framePicker = await desktop
      .locator('[data-design-frame]')
      .evaluate((value) => ({
        font: getComputedStyle(value).fontSize,
        height: value.getBoundingClientRect().height,
      }));
    assert.equal(framePicker.font, '13px', 'Desktop keeps its compact field typography');
    assert.ok(
      framePicker.height < 44,
      'The mobile touch expansion does not resize desktop controls',
    );
    await desktop.close();
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
