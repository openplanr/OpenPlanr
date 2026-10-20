import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchBrowser } from '../../../../tests/support/browser-launcher.mjs';
import {
  assertBrandGalleryEvidence,
  brandGalleryStates,
  brandGalleryStyles,
  bundleBrandGalleryFixture,
  colorChannels,
  mountBrandGallery,
  recordBrandGalleryEvidence,
} from '../helpers/brand-gallery-fixture.mjs';

function createEvidenceDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-brand-gallery-'));
  t.diagnostic(`Gallery evidence: ${directory}`);
  return directory;
}

test('converts computed Oklab colours to unrounded sRGB channels', () => {
  assert.deepEqual(colorChannels('rgb(94, 234, 212)'), [94, 234, 212]);
  assert.deepEqual(colorChannels('color(srgb 0.2 0.4 0.8)'), [51, 102, 204]);
  const converted = colorChannels('oklab(0.834158 -0.12165 -0.00247926)');
  [91.19263, 226.43387, 205.30054].forEach((expected, index) => {
    assert(Math.abs(converted[index] - expected) < 0.00001);
  });
  assert(colorChannels('oklab(0 0 0)').every((channel) => channel === 0));
  assert(colorChannels('oklab(1 0 0)').every((channel) => Math.abs(channel - 255) < 0.00001));
  assert.throws(() => colorChannels('color(display-p3 1 0 0)'), /Unsupported colour space/u);
});

test('bundles the artboard gallery with local fonts and fixture-owned forced states', async () => {
  const code = await bundleBrandGalleryFixture();
  const styles = brandGalleryStyles();
  assert(code.length > 0);
  assert.doesNotMatch(styles, /@import\s/u);
  assert.doesNotMatch(styles, /(?:url\(\s*["']?|@import\s*["'])https?:\/\//u);
  for (const state of ['hover', 'active', 'focus-visible'])
    assert(styles.includes(`:is(:${state},[data-fixture-${state}])`));
  for (const family of ['Outfit', 'DM Sans Variable', 'Source Code Pro'])
    assert(styles.includes(`font-family:"${family}"`));
});

test('excludes the gallery from production routes, source entries and built assets', async () => {
  const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const routes = await build({
    stdin: {
      contents: `export {DASHBOARD_ROUTE_DEFINITIONS,parseDashboardRoute} from './src/app/router.tsx';
      export {DASHBOARD_ROUTE_FIXTURES} from '../../packages/cli/tests/e2e/fixtures/dashboard-route-catalog.ts';`,
      loader: 'ts',
      resolveDir: dashboard,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const catalog = await import(
    `data:text/javascript,${encodeURIComponent(routes.outputFiles[0].text)}`
  );
  assert.doesNotMatch(JSON.stringify(catalog.DASHBOARD_ROUTE_DEFINITIONS), /gallery/iu);
  assert.doesNotMatch(JSON.stringify(catalog.DASHBOARD_ROUTE_FIXTURES), /gallery/iu);
  for (const hash of ['#/gallery', '#/brand-gallery', '#/brand-fixture-gallery'])
    assert.equal(catalog.parseDashboardRoute(hash).kind, 'not-found');
  const production = await build({
    absWorkingDir: dashboard,
    entryPoints: ['src/main.tsx'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: {
      'process.env.NODE_ENV': '"production"',
      __OPENPLANR_DASHBOARD_BUILD_ID__: '"gallery-exclusion-check"',
    },
    logLevel: 'silent',
  });
  assert.doesNotMatch(
    Object.keys(production.metafile.inputs).join('\n'),
    /brand-fixture-gallery/iu,
  );
  const manifest = JSON.parse(
    readFileSync(resolve(dashboard, 'dist/dashboard-manifest.json'), 'utf8'),
  );
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /brand-fixture-gallery|BrandFixtureGallery|data-brand-gallery/u,
  );
  const scripts = manifest.assets.filter((asset) => /\.(?:js|map)$/u.test(asset));
  assert(
    scripts.some((asset) => asset.endsWith('.js')),
    'Production manifest has no script entry',
  );
  for (const asset of scripts)
    assert.doesNotMatch(
      readFileSync(resolve(dashboard, 'dist', asset), 'utf8'),
      /brand-fixture-gallery|BrandFixtureGallery|data-brand-gallery|data-gallery-artboard/u,
      asset,
    );
});

test('records both themes and every recipe state without layout shift', {
  timeout: 120_000,
}, async (t) => {
  const evidenceDirectory = createEvidenceDirectory(t);
  const code = await bundleBrandGalleryFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const theme of ['dark', 'light']) {
    for (const state of brandGalleryStates) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        const external = [],
          errors = [];
        await context.route('**/*', (route) => {
          external.push(route.request().url());
          return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await mountBrandGallery(page, { theme, state, code });
        const evidence = await recordBrandGalleryEvidence(page, { theme, state });
        writeFileSync(
          resolve(evidenceDirectory, `${theme}-${state}.json`),
          JSON.stringify(evidence, null, 2),
        );
        assertBrandGalleryEvidence(evidence);
        assert.deepEqual(external, [], `${theme} ${state}: unexpected network request`);
        assert.deepEqual(errors, [], `${theme} ${state}: browser error`);
        assert.equal(
          await page.locator('[data-brand-gallery]').getAttribute('data-gallery-state'),
          state,
        );
        await assertGalleryState(page, evidence, state);
      } finally {
        await context.close();
      }
    }
  }
});

async function assertGalleryState(page, evidence, state) {
  if (state === 'disabled') {
    for (const recipe of [
      'button-primary',
      'icon-button',
      'input',
      'filter',
      'segmented',
      'switch',
      'tabs',
    ]) {
      const entry = evidence.recipes.find((sample) => sample.name === recipe);
      assert(entry.controls.length > 0, `${recipe}: no native controls`);
      assert(
        entry.controls.every((control) => control.disabled),
        `${recipe}: enabled control in disabled state`,
      );
    }
  }
  if (state === 'loading') {
    assert.equal(
      await page.locator('[data-gallery-recipe="button-primary"] [aria-busy="true"]').count(),
      1,
    );
    assert.equal(await page.getByRole('status', { name: 'Reading planning files' }).count(), 1);
    const command = evidence.recipes.find((recipe) => recipe.name === 'command');
    assert.equal(command.commandState, 'pending');
    assert(command.controls.every((control) => control.disabled && control.busy === 'true'));
  }
  if (state === 'error') {
    assert.equal(
      evidence.recipes.find((recipe) => recipe.name === 'command').commandState,
      'blocked',
    );
    assert.equal(await page.getByText('Copy was blocked', { exact: true }).count(), 1);
  }
  if (state === 'active') {
    assert.equal(
      await page.locator('[data-gallery-recipe^="button-"] button[aria-pressed="true"]').count(),
      5,
    );
  }
  if (state === 'focus-visible') {
    const rings = evidence.recipes
      .flatMap((recipe) => recipe.geometry)
      .filter((sample) => ['pc-button', 'pc-input', 'pc-chip'].includes(sample.className));
    assert(rings.length > 0);
    assert(rings.every((sample) => sample.outline === '2px' && sample.outlineOffset === '2px'));
  }
}

test('uses shared row keyboard navigation and preserves selection and scroll through a patch', {
  timeout: 60_000,
}, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  await mountBrandGallery(page);
  const rows = page.locator('[data-gallery-recipe="row"] [data-keyboard-item]');
  assert.equal(await rows.count(), 4);
  await rows.first().focus();
  await page.keyboard.press('j');
  assert.equal(await rows.nth(1).evaluate((element) => element === document.activeElement), true);
  const selected = await rows.nth(1).getAttribute('data-canonical-id');
  assert(selected);
  const before = await page.evaluate(() => ({
    scroll: window.scrollY,
    selected: document.querySelector(
      '[data-gallery-recipe="row"] [data-selected="true"] [data-canonical-id]',
    )?.dataset.canonicalId,
  }));
  await page.evaluate(({ id, title }) => window.brandGalleryFixture.patchTitle(id, title), {
    id: selected,
    title: 'Patched artboard row with the same canonical identity',
  });
  const after = await page.evaluate(() => ({
    scroll: window.scrollY,
    selected: document.querySelector(
      '[data-gallery-recipe="row"] [data-selected="true"] [data-canonical-id]',
    )?.dataset.canonicalId,
  }));
  assert.deepEqual(after, before);
  assert.equal(after.selected, selected);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await rows.nth(1).evaluate((element) => element === document.activeElement), true);
});

test('records real inspector and tooltip overlay geometry and feedback states', {
  timeout: 60_000,
}, async (t) => {
  const evidenceDirectory = createEvidenceDirectory(t);
  const code = await bundleBrandGalleryFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const theme of ['dark', 'light']) {
    for (const state of ['normal', 'loading', 'empty', 'error', 'reduced-motion']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        await mountBrandGallery(page, { theme, state, code });
        await page.locator('[data-gallery-recipe="inspector"] > .pc-button').click();
        await page.getByRole('dialog').waitFor();
        const trigger = page.locator('[data-gallery-recipe="tooltip"] button');
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(400);
        const tooltip = page.locator('.pc-tooltip');
        await tooltip.waitFor({ state: 'visible' });
        assert.equal(await tooltip.isVisible(), true);
        const overlays = await page.evaluate(() =>
          ['.pc-inspector-sheet', '.pc-tooltip'].map((selector) => {
            const element = document.querySelector(selector);
            if (!element) throw new Error(`Missing gallery overlay ${selector}`);
            const css = getComputedStyle(element),
              rect = element.getBoundingClientRect();
            return {
              selector,
              width: rect.width,
              height: rect.height,
              radius: css.borderTopLeftRadius,
              paddingTop: css.paddingTop,
              paddingRight: css.paddingRight,
              font: css.fontFamily,
              fontSize: css.fontSize,
              fontWeight: css.fontWeight,
              animation: css.animationName,
              state: element.dataset.state,
              text: element.textContent,
            };
          }),
        );
        writeFileSync(
          resolve(evidenceDirectory, `${theme}-${state}-overlays.json`),
          JSON.stringify(overlays, null, 2),
        );
        assertOverlayGeometry(overlays, state);
      } finally {
        await context.close();
      }
    }
  }
});

function assertOverlayGeometry(overlays, state) {
  const [inspector, tooltip] = overlays;
  assert(Math.abs(inspector.width - 420) <= 2);
  assert.equal(inspector.radius, '16px');
  assert.equal(inspector.paddingTop, '20px');
  assert.equal(inspector.paddingRight, '20px');
  assert.equal(inspector.state, ['loading', 'empty', 'error'].includes(state) ? state : 'ready');
  assert.equal(tooltip.radius, '8px');
  assert.equal(tooltip.paddingTop, '8px');
  assert.equal(tooltip.paddingRight, '12px');
  assert.equal(tooltip.font.split(',')[0].replaceAll('"', ''), 'DM Sans Variable');
  assert.equal(tooltip.fontSize, '12px');
  assert.equal(tooltip.fontWeight, '400');
  assert(tooltip.width > 0 && tooltip.width <= 320 && tooltip.height > 0);
  if (state === 'reduced-motion') assert.equal(inspector.animation, 'none');
  if (state === 'empty') assert.match(inspector.text, /No item selected/u);
  if (state === 'error') assert.match(inspector.text, /could not be read/u);
}
