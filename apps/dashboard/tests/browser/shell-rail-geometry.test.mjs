import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { build } from 'esbuild';
import { launchBrowser } from '../../../../tests/support/browser-launcher.mjs';

const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const styles = [
  'design-system/tokens.css',
  'design-system/typography.css',
  'design-system/planr-console-tokens.css',
  'design-system/components/planr-console.css',
  'features/shell/console-shell.css',
  'features/shell/unified-shell.css',
  'features/search/command-palette.css',
]
  .map((path) =>
    readFileSync(resolve(dashboard, 'src', path), 'utf8').replace(/@import[^;]*;/gu, ''),
  )
  .join('\n');

let bundle;
function bundleFixture() {
  bundle ??= build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { DashboardProviders } from './src/app/providers.tsx';
        import { UnifiedShell } from './src/features/shell/UnifiedShell.tsx';

        const container = document.getElementById('root');
        let root = createRoot(container);
        let savedCompact = false;
        const saves = [];
        const makeAdapters = () => ({
          loadSingleLetters: () => true,
          saveSingleLetters: () => undefined,
          copy: async () => undefined,
          themePreference: { initialChoice: 'dark', save: () => undefined },
          railPreference: {
            initialCompact: savedCompact,
            save: (compact) => { savedCompact = compact; saves.push(compact); },
          },
        });
        let adapters = makeAdapters();
        let state = { route: '#/list', projectName: 'OpenPlanr', connectionState: 'booting' };
        const render = (patch = {}) => {
          state = { ...state, ...patch };
          flushSync(() => root.render(createElement(DashboardProviders, {
            buildId: 'shell-geometry-fixture',
            initialHash: state.route,
            identity: {
              projectName: state.projectName,
              projectDetail: 'Geometry fixture',
              actorLabel: 'Fixture actor',
              bindingLabel: 'Fixture scope',
            },
            connection: {
              state: state.connectionState,
              label: state.connectionState,
              reason: 'Fixture state supplied without network access.',
            },
          }, createElement(UnifiedShell, { adapters }))));
        };
        window.shellGeometry = {
          render,
          preference: () => ({ savedCompact, saves: [...saves] }),
          remount: () => {
            flushSync(() => root.unmount());
            root = createRoot(container);
            adapters = makeAdapters();
            render();
          },
        };
        render();
      `,
      loader: 'tsx',
      resolveDir: dashboard,
      sourcefile: 'shell-geometry-fixture.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  }).then((result) => result.outputFiles[0].text);
  return bundle;
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function render(page, patch) {
  await page.evaluate((patch) => window.shellGeometry.render(patch), patch);
  await settle(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing shell geometry target: ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      rail: rect('nav.pc-rail'),
      column: rect('.pc-shell__column'),
      main: rect('.pc-shell__main'),
      scroll: rect('.pc-shell__scroll'),
      crumb: rect('.pc-topbar__crumb'),
      palette: rect('.pc-topbar__palette'),
      end: rect('.pc-topbar__end'),
    };
  });
}

function assertRail(actual, baseline, width, context) {
  assert.equal(actual.rail.width, width, `${context}: rail width`);
  assert.equal(actual.column.x, width, `${context}: content column starts at rail edge`);
  assert.equal(actual.rail.width, baseline.rail.width, `${context}: rail stays fixed`);
  assert.equal(actual.column.x, baseline.column.x, `${context}: column stays fixed`);
}

test('bundles the shell geometry fixture into a standalone browser script', async () => {
  const code = await bundleFixture();
  assert(code.length > 0);
  assert.doesNotThrow(() => new Script(code));
  assert.doesNotMatch(styles, /@import\s/u);
});

test('keeps rail preferences and startup top-bar geometry stable across mounted route changes', {
  timeout: 60_000,
}, async (t) => {
  const code = await bundleFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const requests = [];
  const errors = [];
  context.on('request', (request) => requests.push(request.url()));
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: code });
  await page.waitForSelector('nav.pc-rail');
  await settle(page);

  const expanded = await geometry(page);
  assert.equal(expanded.rail.width, 236);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const route of ['#/board', '#/list', '#/graph', '#/home']) {
      await render(page, { route });
      assertRail(await geometry(page), expanded, 236, `expanded ${repeat} ${route}`);
    }
  }

  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await settle(page);
  const compact = await geometry(page);
  assert.equal(compact.rail.width, 64);
  assert.deepEqual(await page.evaluate(() => window.shellGeometry.preference()), {
    savedCompact: true,
    saves: [true],
  });
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const route of ['#/board', '#/list', '#/graph', '#/home']) {
      await render(page, { route });
      assertRail(await geometry(page), compact, 64, `compact ${repeat} ${route}`);
    }
  }
  await page.evaluate(() => window.shellGeometry.remount());
  await settle(page);
  assertRail(await geometry(page), compact, 64, 'restored compact preference');
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await settle(page);
  await page.evaluate(() => window.shellGeometry.remount());
  await settle(page);
  assertRail(await geometry(page), expanded, 236, 'restored expanded preference');
  assert.deepEqual(await page.evaluate(() => window.shellGeometry.preference()), {
    savedCompact: false,
    saves: [true, false],
  });

  await render(page, { route: '#/list', projectName: 'OpenPlanr', connectionState: 'booting' });
  const startup = await geometry(page);
  for (const patch of [
    { projectName: 'HQ' },
    { connectionState: 'connected' },
    { projectName: 'P', connectionState: 'booting' },
    { projectName: 'HQ', connectionState: 'connected' },
  ]) {
    await render(page, patch);
    const current = await geometry(page);
    for (const slot of ['crumb', 'palette', 'end'])
      assert.deepEqual(
        current[slot],
        startup[slot],
        `${slot} remains fixed: ${JSON.stringify(patch)}`,
      );
  }
  await render(page, { route: '#/list', connectionState: 'connected' });
  const beforeInspector = await geometry(page);
  for (let index = 0; index < 3; index += 1) {
    const toggle = page.getByRole('button', { name: /^(Show|Hide) inspector$/ });
    await toggle.click();
    await settle(page);
    const afterToggle = await geometry(page);
    assert.deepEqual(
      afterToggle.main,
      beforeInspector.main,
      'inspector never reflows the main region',
    );
    assert.deepEqual(
      afterToggle.scroll,
      beforeInspector.scroll,
      'inspector never reflows the list scroll region',
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

test('mobile touch reaches the palette instead of an overflowing capability control', {
  timeout: 60_000,
}, async (t) => {
  const code = await bundleFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  t.after(() => context.close());
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  await page.setContent(
    '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: code });
  await render(page, { route: '#/operate/today', connectionState: 'connected' });
  const hit = await page.evaluate(() => {
    const palette = document.querySelector('.pc-topbar__palette');
    const capability = document.querySelector('.pc-topbar__end > button.pc-conn');
    if (!palette || !capability) throw new Error('Missing mobile controls');
    const box = palette.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return {
      x,
      y,
      receivesTouch: document.elementFromPoint(x, y)?.closest('button') === palette,
      capabilityWidth: capability.getBoundingClientRect().width,
      viewport: window.innerWidth,
    };
  });
  assert.equal(hit.viewport, 390);
  assert.equal(hit.capabilityWidth, 44);
  assert.equal(hit.receivesTouch, true);
  await page.touchscreen.tap(hit.x, hit.y);
  await page.locator('dialog.pc-palette').waitFor({ state: 'visible' });
});
