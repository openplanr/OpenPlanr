import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

const widths = [1440, 834, 820, 390, 680, 681, 960, 961];
const nextControlKey =
  browserEngine() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
const controlSelector = [
  '[data-design-view]',
  '[data-design-toggle-nav]',
  '[data-planr-action="feedback"]',
  '[data-planr-action="share"]',
  '[data-studio-export-menu]',
]
  .map((selector) => `.design-toolbar button${selector}`)
  .join(',');

async function toolbarGeometry(page) {
  return page.evaluate((selector) => {
    const bounds = (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      toolbar: bounds(document.querySelector('.design-toolbar')),
      picker: bounds(document.querySelector('.design-view-picker')),
      layout: document.querySelector('.design-toolbar').dataset.studioLayout,
      workspace: bounds(document.querySelector('.planr-workspace')),
      controls: [...document.querySelectorAll(selector)].map((node) => {
        const style = getComputedStyle(node);
        return {
          key:
            node.dataset.designView ??
            node.dataset.planrAction ??
            (node.hasAttribute('data-design-toggle-nav') ? 'screens' : 'export'),
          ...bounds(node),
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          background: style.backgroundColor,
          focusVisible: node.matches(':focus-visible'),
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth),
        };
      }),
    };
  }, controlSelector);
}

function near(actual, expected, context) {
  assert.ok(Math.abs(actual - expected) <= 1, `${context}: ${actual} vs ${expected}`);
}

function assertAlignment(geometry, width, context) {
  const { toolbar, workspace, controls, picker, layout } = geometry;
  assert.equal(controls.length, 7, `${context}: all modes and actions are present`);
  const review = controls.find(({ key }) => key === 'feedback');
  for (const control of controls) {
    near(control.height, review.height, `${context}: ${control.key} height`);
    if (layout === 'inline')
      near(
        control.y + control.height / 2,
        review.y + review.height / 2,
        `${context}: ${control.key} vertical center`,
      );
    assert.ok(
      control.x >= -1 && control.x + control.width <= width + 1,
      `${context}: ${control.key} stays inside the viewport`,
    );
    assert.ok(
      control.y >= toolbar.y - 1 && control.y + control.height <= toolbar.y + toolbar.height + 1,
      `${context}: ${control.key} stays inside the toolbar`,
    );
    if (width <= 680) {
      assert.ok(
        control.width >= 44 && control.height >= 44,
        `${context}: ${control.key} retains a phone touch target`,
      );
    }
    if (control.key !== 'export') {
      assert.equal(control.fontFamily, review.fontFamily, `${context}: ${control.key} font`);
      assert.equal(control.fontSize, review.fontSize, `${context}: ${control.key} type size`);
    }
    if (['canvas', 'prototype', 'walkthrough'].includes(control.key))
      assert.equal(control.lineHeight, review.lineHeight, `${context}: ${control.key} line height`);
  }
  near(
    picker.x + picker.width / 2,
    toolbar.x + toolbar.width / 2,
    `${context}: geometric header midpoint`,
  );
  for (let index = 0; index < controls.length; index++) {
    for (const other of controls.slice(index + 1)) {
      const control = controls[index];
      const overlapX =
        Math.min(control.x + control.width, other.x + other.width) - Math.max(control.x, other.x);
      const overlapY =
        Math.min(control.y + control.height, other.y + other.height) - Math.max(control.y, other.y);
      assert.ok(
        overlapX <= 1 || overlapY <= 1,
        `${context}: ${control.key} and ${other.key} do not collide`,
      );
    }
  }
  near(workspace.y, toolbar.y + toolbar.height, `${context}: workspace follows the toolbar`);
}

function assertStable(before, after, context, { horizontal = false } = {}) {
  const properties = horizontal ? ['x', 'y', 'width', 'height'] : ['y', 'height'];
  for (const property of properties)
    near(after.toolbar[property], before.toolbar[property], `${context}: toolbar ${property}`);
  for (const control of before.controls) {
    const next = after.controls.find(({ key }) => key === control.key);
    assert.ok(next, `${context}: ${control.key} remains present`);
    for (const property of properties)
      near(next[property], control[property], `${context}: ${control.key} ${property}`);
    for (const property of ['fontFamily', 'fontSize', 'lineHeight'])
      assert.equal(next[property], control[property], `${context}: ${control.key} ${property}`);
  }
}

test('Studio toolbar modes align with actions across themes, widths and interactive states', {
  timeout: 90_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-studio-toolbar-'));
  const screenshotDirectory = process.env.STUDIO_TOOLBAR_SCREENSHOT_DIR;
  let browser, session;
  try {
    if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
    const { file } = designFixture(root, { count: 2 });
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      noOpen: true,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        const unexpectedRequests = [],
          errors = [];
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (
            ['http:', 'https:'].includes(url.protocol) &&
            url.origin !== new URL(session.url).origin
          ) {
            unexpectedRequests.push(url.href);
            return route.abort();
          }
          return route.continue();
        });
        await context.addInitScript(
          ({ preference, origin }) => {
            if (window === window.top && location.origin === origin)
              localStorage.setItem('openplanr.design.theme', preference);
          },
          { preference: theme, origin: new URL(session.url).origin },
        );
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(session.url);
        await page.waitForSelector('[data-design-ready="true"]');
        await settleStudioChrome(page);
        assert.equal(await page.locator('html').getAttribute('data-planr-theme'), theme);

        // Hold a real content save so its controller supplies the pending status.
        const reviewToggle = page.locator('.design-toolbar [data-planr-action="feedback"]');
        if ((await reviewToggle.getAttribute('aria-expanded')) === 'false')
          await reviewToggle.click();
        await settleStudioChrome(page);
        await page.evaluate(() => window.__openPlanrDesignStudio.flush());
        const savedGeometry = await toolbarGeometry(page);
        let releaseSave;
        const released = new Promise((resolve) => {
          releaseSave = resolve;
        });
        const saveRoute = async (route) => {
          if (route.request().method() === 'PUT') {
            await released;
          }
          await route.continue();
        };
        await page.route('**/api/design-state', saveRoute);
        try {
          const started = page.waitForRequest(
            (request) =>
              request.method() === 'PUT' &&
              new URL(request.url()).pathname.endsWith('/api/design-state'),
          );
          await page.locator(`[data-design-rating="${theme === 'dark' ? 4 : 3}"]`).click();
          await started;
          await page.waitForFunction(
            () => document.querySelector('[data-design-save-state]').dataset.status === 'saving',
          );
          const pending = await toolbarGeometry(page);
          assertAlignment(pending, 1440, `${theme}: saving`);
          assertStable(savedGeometry, pending, `${theme}: saving`);
        } finally {
          releaseSave();
          await page.evaluate(() => window.__openPlanrDesignStudio.flush());
          await page.unroute('**/api/design-state', saveRoute);
        }

        for (const width of widths) {
          const label = `${theme} at ${width}px`;
          await page.setViewportSize({ width, height: 1000 });
          await settleStudioChrome(page);
          const baseline = await toolbarGeometry(page);
          assertAlignment(baseline, width, label);
          for (const view of ['canvas', 'prototype', 'walkthrough']) {
            await page.locator(`button[data-design-view="${view}"]`).click();
            await page.waitForFunction(
              (expected) => window.__openPlanrDesignStudio.getState().view === expected,
              view,
            );
            await page.mouse.move(width - 1, 999);
            await settleStudioChrome(page);
            assert.equal(
              await page.locator('.design-view-picker [aria-pressed="true"]').count(),
              1,
            );
            assert.equal(
              await page.locator(`button[data-design-view="${view}"]`).getAttribute('aria-pressed'),
              'true',
            );
            const selected = await toolbarGeometry(page);
            assertAlignment(selected, width, `${label}: ${view} selected`);
            assertStable(baseline, selected, `${label}: selected`);
          }

          const quiet = await toolbarGeometry(page);
          await page.locator('button[data-design-view="canvas"]').hover();
          await settleStudioChrome(page);
          const hovered = await toolbarGeometry(page);
          assert.notEqual(
            hovered.controls.find(({ key }) => key === 'canvas').background,
            quiet.controls.find(({ key }) => key === 'canvas').background,
            `${label}: hover remains visible`,
          );
          assertStable(quiet, hovered, `${label}: hover`);
          await page.mouse.move(width - 1, 999);
          await page.locator('.design-toolbar [data-design-toggle-nav]').focus();
          for (const view of ['canvas', 'prototype', 'walkthrough']) {
            await page.keyboard.press(nextControlKey);
            const focused = await toolbarGeometry(page);
            const control = focused.controls.find(({ key }) => key === view);
            assert.ok(
              control.focusVisible && control.outlineStyle !== 'none' && control.outlineWidth >= 2,
              `${label}: ${view} has visible keyboard focus`,
            );
            assertStable(quiet, focused, `${label}: keyboard focus`);
          }

          const beforeMenu = await toolbarGeometry(page);
          await page.locator('[data-studio-export-menu]').click();
          await page.getByRole('menu').waitFor();
          assertStable(beforeMenu, await toolbarGeometry(page), `${label}: export menu`, {
            horizontal: true,
          });
          const menu = await page.getByRole('menu').boundingBox();
          assert.ok(
            menu.x >= 0 && menu.x + menu.width <= width,
            `${label}: export menu stays inside the viewport`,
          );
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });

          if (width <= 960) {
            for (const [selector, title] of [
              ['[data-design-toggle-nav]', 'Screens'],
              ['[data-planr-action="feedback"]', 'Review'],
            ]) {
              const beforeDrawer = await toolbarGeometry(page);
              await page.locator(`.design-toolbar ${selector}`).click();
              const drawer = page.getByRole('dialog', { name: title, exact: true });
              await drawer.waitFor();
              await settleStudioChrome(page);
              assertStable(beforeDrawer, await toolbarGeometry(page), `${label}: ${title} drawer`, {
                horizontal: true,
              });
              await page.keyboard.press('Escape');
              await drawer.waitFor({ state: 'hidden' });
            }
          }
          if (screenshotDirectory && [1440, 390].includes(width)) {
            await settleStudioChrome(page);
            await page.screenshot({
              path: join(screenshotDirectory, `studio-toolbar-${theme}-${width}.png`),
              animations: 'disabled',
            });
          }
        }
        assert.deepEqual(errors, [], `${theme}: no browser runtime errors`);
        assert.deepEqual(unexpectedRequests, [], `${theme}: fixture stays offline`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
