import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../../tests/support/browser-launcher.mjs';
import { bundleBrandGalleryFixture, mountBrandGallery } from '../helpers/brand-gallery-fixture.mjs';
import { redesignParityRows, resolveParityToken } from '../helpers/redesign-parity-rows.mjs';

async function clipboard(page, mode = 'success') {
  await page.evaluate((mode) => {
    window.redesignWrites = [];
    const writeText = async (text) => {
      if (mode === 'failure') throw new Error('Clipboard permission denied');
      window.redesignWrites.push(text);
    };
    const value = mode === 'missing' ? undefined : { writeText };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
  }, mode);
}

async function copyWithFeedback(page, selector, label) {
  await page.locator(selector).evaluate((button, label) => {
    window.redesignFeedback = null;
    let clicked;
    const width = button.getBoundingClientRect().width;
    const observer = new MutationObserver(() => {
      const visibleLabel = button.querySelector('.pc-copy-label > [data-active="true"]');
      if (clicked === undefined || visibleLabel?.textContent !== label) return;
      window.redesignFeedback = {
        delay: performance.now() - clicked,
        width,
        after: button.getBoundingClientRect().width,
      };
      observer.disconnect();
    });
    const mutations = { subtree: true, childList: true, characterData: true, attributes: true };
    observer.observe(button, mutations);
    const recordClick = () => {
      clicked = performance.now();
    };
    button.addEventListener('click', recordClick, { once: true, capture: true });
  }, label);
  await page.locator(selector).click();
  await page.waitForFunction(() => window.redesignFeedback !== null);
  const feedback = await page.evaluate(() => window.redesignFeedback);
  assert(feedback.delay < 100, `${selector}: feedback took ${feedback.delay}ms`);
  assert.equal(feedback.after, feedback.width, `${selector}: copy feedback changed width`);
}

async function checkRow(page, row, theme) {
  const expected = resolveParityToken(row.expected, theme);
  const elements = page.locator(row.selector);
  assert((await elements.count()) > 0, `${row.id}: missing ${row.selector}`);
  if (row.property === 'clipboard' || row.property === 'text-after-copy') {
    await copyWithFeedback(page, row.selector, 'Copied');
    if (row.property === 'clipboard') {
      const ids = await page
        .locator('[data-gallery-recipe="row"] [data-canonical-id]')
        .evaluateAll((nodes) => nodes.slice(0, 3).map((node) => node.dataset.canonicalId));
      assert.deepEqual(await page.evaluate(() => window.redesignWrites), [
        ids.map((id) => `openplanr status ${id} --md`).join('\n'),
      ]);
    }
    return;
  }
  const samples = await elements.evaluateAll(
    (nodes, { property, expected }) =>
      nodes.map((node) => {
        if (property === 'text')
          return { actual: node.querySelector('[data-active="true"]')?.textContent, expected };
        if (['role', 'aria-live'].includes(property))
          return { actual: node.getAttribute(property), expected };
        const rect = node.getBoundingClientRect();
        const distances = {
          'bottom-distance': innerHeight - rect.bottom,
          'left-distance': rect.left,
          'right-distance': innerWidth - rect.right,
        };
        if (property in distances)
          return { actual: distances[property], expected: parseFloat(expected) };
        if (expected.startsWith('min('))
          return {
            actual: rect.width,
            expected: Math.min(800, node.parentElement.getBoundingClientRect().width - 128),
          };
        const probe = document.createElement('span');
        probe.style.setProperty(property, expected);
        document.body.append(probe);
        const resolved = getComputedStyle(probe).getPropertyValue(property);
        const actual = getComputedStyle(node).getPropertyValue(property);
        probe.remove();
        if (property === 'font-family')
          return { actual: actual.split(',')[0].replaceAll('"', ''), expected };
        return { actual, expected: resolved };
      }),
    { property: row.property, expected },
  );
  for (const sample of samples) {
    const label = `${row.id} ${theme} ${row.viewport} ${row.property}: ${JSON.stringify(sample)}`;
    if (typeof sample.actual === 'number' || /^-?[\d.]+px$/u.test(sample.expected))
      assert(Math.abs(parseFloat(sample.actual) - parseFloat(sample.expected)) <= 2, label);
    else assert.equal(sample.actual, sample.expected, label);
  }
}

test('shared patterns match token parity in both themes and viewports', {
  timeout: 120_000,
}, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const code = await bundleBrandGalleryFixture();
  const evidence = mkdtempSync(join(tmpdir(), 'openplanr-redesign-'));
  t.diagnostic(`Gallery screenshots: ${evidence}`);
  for (const theme of ['dark', 'light']) {
    for (const viewport of ['D', 'M']) {
      const context = await browser.newContext({
        viewport: viewport === 'D' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        await mountBrandGallery(page, { theme, code });
        await clipboard(page);
        const signals = await page
          .locator('[data-redesign-status] .pc-artifact__dot')
          .evaluateAll((nodes) => ({
            rings: nodes.every((node) => getComputedStyle(node).width === '10px'),
            diamond: nodes.some(
              (node) =>
                node.dataset.glyph === 'diamond' &&
                getComputedStyle(node).transform.startsWith('matrix('),
            ),
          }));
        assert.deepEqual(signals, { rings: true, diamond: true });
        assert.deepEqual(
          await page.locator('[data-redesign-priority] .pc-priority').allTextContents(),
          ['High', 'Medium', 'Low'],
        );
        for (const [id, expected] of [
          ['high', '--op-danger'],
          ['medium', '--op-warning'],
          ['low', '--op-muted'],
        ]) {
          const selector = `[data-redesign-priority] [data-priority="${id}"]`;
          await checkRow(page, { id, selector, property: 'color', expected, viewport }, theme);
        }
        const heights = await page
          .locator('.pc-state-empty, .pc-state-loading')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
        assert(
          Math.abs(heights[0] - heights[1]) <= 2,
          'Loading card must reserve the final empty card shape',
        );
        for (const row of redesignParityRows.filter((row) => row.viewport === viewport)) {
          if (row.expected === 'Copy 3 commands')
            await page.getByRole('button', { name: 'Select three', exact: true }).click();
          if (row.property === 'text-after-copy') {
            await page.getByRole('button', { name: 'Select one', exact: true }).click();
            await clipboard(page);
          }
          await checkRow(page, row, theme);
        }
        await page
          .locator('[data-redesign-fixture]')
          .screenshot({ path: join(evidence, `${theme}-${viewport}.png`) });
      } finally {
        await context.close();
      }
    }
  }
});

async function withGalleryThemes(t, run) {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const code = await bundleBrandGalleryFixture();
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await mountBrandGallery(page, { theme, code });
    await run(page, theme);
    await context.close();
  }
}

test('copy reset causes no layout shift', {
  timeout: 60_000,
}, async (t) => {
  await withGalleryThemes(t, async (page, theme) => {
    const bar = page.locator('.pc-selection-bar');
    const copy = bar.locator('.pc-selection-bar__copy');
    for (const mode of ['success', 'failure', 'missing']) {
      await clipboard(page, mode);
      const label = mode === 'success' ? 'Copied' : 'Copy failed';
      await copyWithFeedback(page, '.pc-selection-bar__copy', label);
      assert.match(await bar.locator('[aria-live="polite"]').textContent(), new RegExp(label, 'u'));
      await page.waitForTimeout(1750);
      assert.equal(await copy.locator('[data-active="true"]').textContent(), label);
      await copy.locator('[data-active="true"]').filter({ hasText: 'Copy command' }).waitFor();
    }
    await page.evaluate(() => window.brandGalleryFixture.setState('error'));
    const command = page.locator('[data-gallery-recipe="command"] .pc-command-hint');
    await command.locator('[data-state="blocked"]').waitFor();
    await copy.locator('[data-active="true"]').filter({ hasText: 'Copy failed' }).waitFor();
    await page.locator('.pc-selection-bar__copy[data-state="idle"]').waitFor();
    await command.locator('[data-state="idle"]').waitFor();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const shifts = await page.evaluate(() => window.brandGalleryShifts);
    assert.equal(
      shifts.reduce((sum, value) => sum + value, 0),
      0,
      `${theme}: CLS through reset`,
    );
  });
});

test('selection actions protect text editing', { timeout: 60_000 }, async (t) => {
  await withGalleryThemes(t, async (page) => {
    const bar = page.locator('.pc-selection-bar');
    await clipboard(page);
    for (const selector of ['input', 'textarea', '[contenteditable]', '[role="textbox"]']) {
      await page.evaluate((selector) => {
        const element = document.createElement(
          selector === 'input' || selector === 'textarea' ? selector : 'div',
        );
        if (selector === '[contenteditable]') element.contentEditable = 'true';
        if (selector === '[role="textbox"]') {
          element.setAttribute('role', 'textbox');
          element.tabIndex = 0;
        }
        element.dataset.copyEditingFixture = '';
        document.body.append(element);
        element.focus();
      }, selector);
      await page.keyboard.press('c');
      assert.deepEqual(await page.evaluate(() => window.redesignWrites), []);
      await page.locator('[data-copy-editing-fixture]').evaluate((element) => element.remove());
    }
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.redesignWrites.length === 1);
    await bar.getByRole('button', { name: 'Clear selection' }).click();
    assert.equal(await bar.count(), 0);
    await page.getByRole('button', { name: 'Select one', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await bar.getByRole('button', { name: 'Open', exact: true }).click();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.brandGalleryFixture.setState('error'));
    const command = page.locator('[data-gallery-recipe="command"]');
    await command.locator('[data-state="blocked"]').first().waitFor();
    await command.locator('.pc-command-hint[data-state="idle"]').waitFor();
    await copyWithFeedback(
      page,
      '[data-gallery-recipe="command"] .pc-command-hint__copy',
      'Copy failed',
    );
  });
});

test('coarse desktop pointers use the selection sheet', async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  await context.route('**/*', (route) => route.abort());
  await mountBrandGallery(page);
  for (const row of redesignParityRows.filter((row) => row.viewport === 'M'))
    await checkRow(page, row, 'dark');
});
