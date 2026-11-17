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
  'design-system/components/artifact-row.css',
  'design-system/components/chip-menu.css',
  'features/shell/console-shell.css',
  'features/shell/unified-shell.css',
  'features/search/command-palette.css',
  'features/planning/activity.css',
  'features/planning/board.css',
  '../../../packages/canvas/src/styles.css',
  'features/shell/floating-chrome.css',
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
        import { ChromeProvider, ChromeRoot } from '@openplanr/canvas/react';
        import { HelpCard } from './src/features/shell/floating-chrome-parts.tsx';
        import { ActivitySinceOpened } from './src/features/planning/ActivityParts.tsx';
        import { createDashboardQueryIdentity } from './src/lib/binding/query-identity.ts';
        import { dashboardProductStatePolicy, parseDashboardProductState } from './src/lib/api/product-state.ts';
        import { parsePlanningGraphEnvelope } from './src/features/planning/planning-api.ts';
        import { sha256Jcs } from '@openplanr/protocol/canonical-json';
        import { installDashboardLayoutShifts } from '../../packages/cli/tests/dashboard/fixtures/dashboard-layout-shifts.ts';

        installDashboardLayoutShifts();
        const graph = {nodes:[{
          id:'SPEC-001',type:'spec',title:'Geometry board',status:'in-progress',frontmatter:{id:'SPEC-001'}
        }],edges:[]};
        const binding = createDashboardQueryIdentity({
          productArea:'planning',route:'#/board',actorId:'geometry-reader',
          projectId:'sha256:' + 'a'.repeat(64),scopeId:'planning',domainId:'planning',domainVersion:'1.0.0',
          cycleId:null,subjectId:null,eventHead:{sequence:0,hash:null},viewHash:sha256Jcs(graph),generation:1
        });
        const boardProjection = parseDashboardProductState(JSON.parse(JSON.stringify({
          kind:'ready',binding,data:{
            kind:'planning-graph-snapshot',schemaVersion:'1.0.0',
            binding:{actorId:binding.actorId,projectId:binding.projectId,scopeId:'planning',
              domainId:'planning',domainVersion:'1.0.0',generation:1},
            cursor:{eventHead:binding.eventHead,viewHash:binding.viewHash},mode:'spec',graph
          },reasonCodes:[],error:null,mutationEnabled:false,policy:dashboardProductStatePolicy('ready')
        })),{currentBinding:binding,validateData:value => {
          parsePlanningGraphEnvelope(value,binding);
          return true;
        }});
        const container = document.getElementById('root');
        let root = createRoot(container);
        let saved = {};
        const saves = [];
        const makeAdapters = () => ({
          loadSingleLetters: () => true,
          saveSingleLetters: () => undefined,
          copy: async () => undefined,
          themePreference: { initialChoice: 'dark', save: () => undefined },
          chromePreference: {
            storage: () => ({
              get: (key) => saved[key],
              set: (key, value) => { saved = { ...saved, [key]: value }; saves.push([key, value]); },
            }),
          },
        });
        let adapters = makeAdapters();
        let state = { route: '#/list', projectName: 'OpenPlanr', connectionState: 'booting' };
        let status = {
          project: 'OpenPlanr', branch: null, totals: null, access: 'Read-only · booting',
          storageNotice: null, buildId: 'geometry-fixture',
        };
        const render = (patch = {}) => {
          state = { ...state, ...patch };
          const readyBoard = state.route === '#/board' && state.connectionState === 'connected';
          flushSync(() => root.render(createElement(DashboardProviders, {
            buildId: 'shell-geometry-fixture',
            initialHash: state.route,
            binding,
            projection: readyBoard ? boardProjection : undefined,
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
          renderHelp: (patch = {}) => {
            status = { ...status, ...patch };
            flushSync(() => root.render(createElement(ChromeProvider, null,
              createElement(ChromeRoot, { className: 'pc-chrome' },
                createElement(HelpCard, { status, onClose: () => undefined, onAllShortcuts: () => undefined })))));
          },
          renderFeed: (connection) => {
            flushSync(() => root.render(createElement('div', { className: 'op-planning pc-activity' },
              createElement(ActivitySinceOpened, { connection, rows: [] }))));
          },
          preference: () => ({ saved, saves: [...saves] }),
          clearPreference: () => { saved = {}; },
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
      navigation: rect('[data-chrome-slot="navigation"]'),
      sidebar: rect('[data-chrome-slot="sidebar"]'),
      menu: rect('[data-chrome-slot="menu"]'),
      toolbar: rect('[data-chrome-slot="toolbar"]'),
      action: rect('[data-chrome-slot="action"]'),
      help: rect('[data-chrome-slot="help"]'),
      column: rect('.pc-shell__column'),
      main: rect('.pc-shell__main'),
      scroll: rect('.pc-shell__scroll'),
      palette: rect('[data-chrome-slot="toolbar"] button[aria-label^="Search or run"]'),
      viewport: { width: innerWidth, height: innerHeight },
      inset: getComputedStyle(document.querySelector('.pc-shell__scroll')).paddingLeft,
    };
  });
}

/** Approved floating geometry: 12 px inset, panels 64 px from top and bottom, fixed pill sizes. */
function assertChromeFrame(actual, context) {
  const { width, height } = actual.viewport;
  assert.deepEqual(
    actual.navigation,
    { x: 12, y: 64, width: 264, height: height - 128 },
    `${context}: navigation panel`,
  );
  assert.deepEqual(
    actual.sidebar,
    { x: width - 12 - 312, y: 64, width: 312, height: height - 128 },
    `${context}: sidebar`,
  );
  assert.equal(actual.toolbar.height, 44, `${context}: tool pill height`);
  assert.equal(actual.toolbar.y, 12, `${context}: tool pill inset`);
  for (const slot of ['menu', 'action', 'help'])
    assert.equal(actual[slot].height, 40, `${context}: ${slot} height`);
  assert.deepEqual(actual.menu.x, 12, `${context}: menu inset`);
  assert.equal(actual.action.x + actual.action.width, width - 12, `${context}: action inset`);
  assert.deepEqual(
    actual.help,
    { x: width - 52, y: height - 52, width: 40, height: 40 },
    `${context}: round help`,
  );
}

function assertChrome(actual, baseline, pinned, context) {
  assertChromeFrame(actual, context);
  assert.equal(actual.column.x, 0, `${context}: content column spans the window`);
  assert.equal(
    actual.inset,
    pinned ? '296px' : '20px',
    `${context}: content insets only for pinned navigation`,
  );
  assert.deepEqual(actual.palette, baseline.palette, `${context}: palette stays fixed`);
  assert.deepEqual(actual.menu, baseline.menu, `${context}: menu stays fixed`);
  assert.deepEqual(actual.action, baseline.action, `${context}: action pill stays fixed`);
  assert.deepEqual(actual.main, baseline.main, `${context}: main stays fixed`);
  assert.deepEqual(actual.scroll, baseline.scroll, `${context}: scroll stays fixed`);
}

async function panel(page, slot) {
  return page.locator(`[data-chrome-slot="${slot}"]`).getAttribute('data-open');
}

async function assertBoardShell(page, baseline, pinned, context) {
  await render(page, { route: '#/list', connectionState: 'connected' });
  await page.waitForSelector('[data-route-kind="planning.list"]');
  await render(page, { route: '#/board', connectionState: 'connected' });
  const board = page.locator('[data-route-kind="planning.board"].op-planning--board');
  await board.waitFor({ state: 'visible' });
  assert.equal(await board.locator('.pc-status-board__column').count(), 5);
  await settle(page);
  assertChrome(await geometry(page), baseline, pinned, context);
  await render(page, { route: '#/board', connectionState: 'booting' });
}

test('bundles the shell geometry fixture into a standalone browser script', async () => {
  const code = await bundleFixture();
  assert(code.length > 0);
  assert.doesNotThrow(() => new Script(code));
  assert.doesNotMatch(styles, /@import\s/u);
});

test('tool pill fixes the palette position across routes and the help card reserves the branch line', {
  timeout: 60_000,
}, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: await bundleFixture() });
  await settle(page);
  for (const width of [1440, 1200, 1120, 1024, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    await render(page, { route: '#/list' });
    const baseline = await geometry(page);
    assertChromeFrame(baseline, `${width}`);
    assert.equal(baseline.palette.height, 38);
    for (const route of ['#/board', '#/graph', '#/home', '#/operate/today', '#/list']) {
      await render(page, { route });
      assert.deepEqual((await geometry(page)).palette, baseline.palette, `${width}: ${route}`);
    }
    await page.keyboard.press('Alt+BracketLeft');
    await settle(page);
    assert.equal(await panel(page, 'navigation'), 'true');
    const labels = await page.locator('.pc-nav-item > span:first-of-type').evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        width: element.getBoundingClientRect().width,
        fits: element.scrollWidth <= element.clientWidth,
      })),
    );
    assert.equal(labels.length, 17);
    for (const label of labels) {
      assert(label.width > 24, `${width}: ${label.text} retains a legible text column`);
      assert(label.fits, `${width}: ${label.text} is not clipped`);
    }
    await page.keyboard.press('Alt+BracketLeft');
    await settle(page);
  }
  await page.evaluate(() => window.shellGeometry.renderHelp({ branch: null }));
  await settle(page);
  const branch = page.locator('.pc-help-card dt:text-is("Branch") + dd');
  assert.equal(await branch.innerText(), 'Unavailable');
  const before = await branch.boundingBox();
  assert(before);
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('help-bootstrap');
    window.shellGeometry.renderHelp({
      branch: 'feature/a-long-bootstrap-branch-name-for-a-help-card',
    });
  });
  await settle(page);
  assert.equal(
    await branch.getAttribute('title'),
    'feature/a-long-bootstrap-branch-name-for-a-help-card',
  );
  assert.equal(await branch.evaluate((element) => element.childNodes.length), 1);
  assert.deepEqual(await branch.boundingBox(), before);
  assert(
    await branch.evaluate((element) => element.scrollWidth > element.clientWidth),
    'a long branch ends in an ellipsis instead of widening the card',
  );
  const shifts = await page.evaluate(() =>
    window.__dashboardLayoutShifts
      .snapshot()
      .shifts.filter((shift) => shift.phase === 'help-bootstrap'),
  );
  assert.equal(
    shifts.reduce((total, shift) => total + shift.value, 0),
    0,
    JSON.stringify(shifts),
  );
  assert.deepEqual(errors, []);
});

test('keeps pinned navigation and startup pill geometry stable across mounted route changes', {
  timeout: 90_000,
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
  await page.waitForSelector('[data-chrome-slot="navigation"]');
  await render(page, { connectionState: 'connected' });

  const closed = await geometry(page);
  assertChromeFrame(closed, 'closed');
  assert.equal(await panel(page, 'navigation'), 'false');
  assert.equal(await panel(page, 'sidebar'), 'false');
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const route of ['#/board', '#/list', '#/graph', '#/home']) {
      await render(page, { route });
      if (route === '#/board')
        await assertBoardShell(page, closed, false, `closed Board ${repeat}`);
      await render(page, { connectionState: 'connected' });
      assertChrome(await geometry(page), closed, false, `closed ${repeat} ${route}`);
    }
  }

  await render(page, { route: '#/list', connectionState: 'connected' });
  await page.getByRole('button', { name: 'List: show navigation', exact: true }).click();
  await page
    .locator('[data-chrome-slot="navigation"]')
    .getByRole('button', { name: 'Pin navigation', exact: true })
    .click();
  await settle(page);
  const pinned = await geometry(page);
  assertChrome(pinned, closed, true, 'pinned');
  assert.deepEqual(await page.evaluate(() => window.shellGeometry.preference().saved), {
    'canvas.chrome.panel.navigation': { open: true, pinned: true },
  });
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const route of ['#/board', '#/list', '#/graph', '#/home']) {
      await render(page, { route });
      if (route === '#/board') await assertBoardShell(page, pinned, true, `pinned Board ${repeat}`);
      await render(page, { connectionState: 'connected' });
      assertChrome(await geometry(page), pinned, true, `pinned ${repeat} ${route}`);
      assert.equal(await panel(page, 'navigation'), 'true');
    }
  }
  await page.evaluate(() => window.shellGeometry.remount());
  await render(page, { route: '#/list', connectionState: 'connected' });
  assertChrome(await geometry(page), pinned, true, 'restored pinned navigation');
  await page
    .locator('[data-chrome-slot="navigation"]')
    .getByRole('button', { name: 'Pin navigation', exact: true })
    .click();
  await page.evaluate(() => window.shellGeometry.remount());
  await render(page, { route: '#/list', connectionState: 'connected' });
  assertChrome(await geometry(page), closed, false, 'an unpinned panel starts closed');
  assert.equal(await panel(page, 'navigation'), 'false');
  assert.deepEqual(
    (await page.evaluate(() => window.shellGeometry.preference().saves)).filter(
      ([key]) => key === 'canvas.chrome.panel.navigation',
    ),
    [
      ['canvas.chrome.panel.navigation', { open: true, pinned: false }],
      ['canvas.chrome.panel.navigation', { open: true, pinned: true }],
      ['canvas.chrome.panel.navigation', { open: true, pinned: false }],
    ],
  );

  await page.evaluate(() => {
    window.shellGeometry.clearPreference();
    window.shellGeometry.remount();
  });
  for (const route of ['#/graph', '#/board', '#/sprints', '#/activity', '#/home', '#/list']) {
    await render(page, { route, connectionState: 'connected' });
    assertChrome(await geometry(page), closed, false, `default closed ${route}`);
  }
  await render(page, { route: '#/detail/QT-071' });
  const detail = await geometry(page);
  assertChromeFrame(detail, 'detail keeps the floating chrome');
  assert.deepEqual(detail.main, closed.main, 'detail keeps main fixed');
  assert.deepEqual(detail.scroll, closed.scroll, 'detail keeps scroll fixed');

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
    for (const slot of ['menu', 'palette', 'action'])
      assert.deepEqual(
        current[slot],
        startup[slot],
        `${slot} remains fixed: ${JSON.stringify(patch)}`,
      );
  }
  await render(page, { route: '#/list', connectionState: 'connected' });
  assert.equal(await page.getByRole('region', { name: 'Inspector', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-inspector-pending]').count(), 0);
  assert.equal(await panel(page, 'sidebar'), 'false', 'no inspector opens without a selection');
  const emptySelection = await geometry(page);
  assert.equal(emptySelection.main.width, emptySelection.column.width);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

test('navigation panel reaches every item and group at 1440 by 720', {
  timeout: 60_000,
}, async (t) => {
  const code = await bundleFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 720 } });
  t.after(() => context.close());
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: code });
  const expectedGroups = [
    { label: 'Plan', items: ['Home', 'List', 'Graph', 'Board', 'Sprints', 'Activity', 'Search'] },
    { label: 'Operate', items: ['Today', 'Inbox', 'Actions', 'Cycles'] },
    { label: 'Record', items: ['Evidence', 'Outcomes', 'History', 'Recovery'] },
    { label: 'Reference', items: ['Console', 'Diagnostics'] },
  ];

  for (const route of ['#/graph', '#/operate/today']) {
    await render(page, { route });
    await page.keyboard.press('Alt+BracketLeft');
    await settle(page);
    const navigation = page.getByRole('navigation', { name: 'Navigation', exact: true });
    assert.equal(await panel(page, 'navigation'), 'true');
    assert.equal(await navigation.getByRole('button', { name: /^Search or run/u }).count(), 1);
    for (const name of ['Pin navigation', 'Close navigation'])
      assert.equal(await navigation.getByRole('button', { name, exact: true }).count(), 1);
    assert.equal(await navigation.getByRole('region').count(), expectedGroups.length);
    for (const group of expectedGroups)
      assert.equal(
        await navigation.getByRole('region', { name: group.label, exact: true }).count(),
        1,
      );
    // Measuring during the open transition reads a fractional box from the in-flight transform.
    await navigation.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    const report = await navigation.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const body = element.querySelector('.canvas-chrome-panel-body');
      if (!body) throw new Error('Missing navigation panel body');
      const groups = [...element.querySelectorAll('section')].map((section) => ({
        label: section.querySelector('.pc-chrome-label')?.textContent,
        items: [...section.querySelectorAll('a')].map(
          (item) => item.querySelector('span')?.textContent,
        ),
      }));
      const controls = [...element.querySelectorAll('a, button')].map((control) => {
        control.scrollIntoView({ block: 'nearest' });
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          label: control.getAttribute('aria-label') ?? control.textContent,
          visible: style.display !== 'none' && style.visibility !== 'hidden',
          inside:
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom,
          receivesPointer: hit === control || control.contains(hit),
        };
      });
      return {
        width: bounds.width,
        groups,
        controls,
        horizontal: body.scrollWidth > body.clientWidth,
        overflowY: getComputedStyle(body).overflowY,
      };
    });
    assert.equal(report.width, 264);
    assert.deepEqual(report.groups, expectedGroups, `${route}: every navigation group`);
    assert.equal(report.controls.length, expectedGroups.flatMap((group) => group.items).length + 3);
    assert.equal(report.horizontal, false, `${route}: no horizontal overflow`);
    assert.equal(report.overflowY, 'auto', `${route}: hidden items scroll into reach`);
    for (const control of report.controls) {
      assert.equal(control.visible, true, `${route}: ${control.label} is visible`);
      assert.equal(control.inside, true, `${route}: ${control.label} fits inside the panel`);
      assert.equal(
        control.receivesPointer,
        true,
        `${route}: ${control.label} receives pointer input`,
      );
    }
    await page.keyboard.press('Alt+BracketLeft');
  }
  assert.deepEqual(errors, []);
});

test('status bootstrap and Activity disconnect preserve their painted geometry without shifts', {
  timeout: 60_000,
}, async (t) => {
  const code = await bundleFixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => window.shellGeometry.renderHelp());
  await settle(page);
  const statusGeometry = () =>
    page.locator('.pc-help-card').evaluate((element) =>
      [element, element.querySelector('header > span'), ...element.querySelectorAll('dd')].map(
        (slot) => {
          if (!slot) throw new Error('Missing help status geometry target');
          const { x, y, width, height } = slot.getBoundingClientRect();
          return { x, y, width, height };
        },
      ),
    );
  const startup = await statusGeometry();
  assert.equal(startup[0].width, 300, 'help card width');
  assert.deepEqual(
    startup.slice(2).map((slot) => slot.width),
    [startup[2].width, startup[2].width, startup[2].width, startup[2].width],
    'every fact uses one value column',
  );
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('status-bootstrap');
    window.shellGeometry.renderHelp({
      branch: 'feature/a-long-bootstrap-branch-name',
      access: 'Read-only · Live',
    });
  });
  await settle(page);
  assert.deepEqual(
    await statusGeometry(),
    startup,
    'bootstrap metadata keeps every status slot fixed',
  );
  const startupShifts = await page.evaluate(() =>
    window.__dashboardLayoutShifts
      .snapshot()
      .shifts.filter((shift) => shift.phase === 'status-bootstrap'),
  );
  assert.equal(
    startupShifts.reduce((total, shift) => total + shift.value, 0),
    0,
    JSON.stringify(startupShifts),
  );
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('long-build-id');
    window.shellGeometry.renderHelp({
      buildId: 'dashboard-0.1.25-00d9a858d03fba2e-with-a-long-local-suffix',
    });
  });
  await settle(page);
  const withLongBuild = await statusGeometry();
  assert.deepEqual(withLongBuild[0], startup[0], 'a long build id keeps the card fixed');
  assert.deepEqual(withLongBuild.slice(2), startup.slice(2), 'and every fact fixed');
  const build = page.locator('.pc-help-card header > span');
  assert.equal(
    await build.getAttribute('title'),
    'dashboard-0.1.25-00d9a858d03fba2e-with-a-long-local-suffix',
  );
  assert(
    await build.evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth &&
        getComputedStyle(element).textOverflow === 'ellipsis' &&
        element.getBoundingClientRect().right <=
          (element.closest('.pc-help-card')?.getBoundingClientRect().right ?? 0),
    ),
    'a long build id ends in an ellipsis inside the card',
  );
  await page.evaluate(() => window.shellGeometry.renderHelp({ totals: '1280 nodes · 320 edges' }));
  await settle(page);
  assert.deepEqual(
    await statusGeometry(),
    withLongBuild,
    'graph totals keep every status slot fixed',
  );
  assert.equal(
    await page.locator('.pc-help-card dt:text-is("Totals") + dd').innerText(),
    '1280 nodes · 320 edges',
  );

  await page.evaluate(() => window.shellGeometry.renderFeed('connected'));
  await settle(page);
  const feedGeometry = () =>
    page.locator('.pc-activity').evaluate((element) => {
      const rect = (selector) => {
        const target = element.querySelector(selector);
        if (!target) throw new Error(`Missing Activity geometry target: ${selector}`);
        const { x, y, width, height } = target.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        header: rect('[aria-label="Live session activity"] .pc-card__head'),
        connection: rect('.pc-activity__connection'),
        badge: rect('.pc-activity__connection > .pc-badge'),
        feed: rect('.pc-activity__live'),
        reserveVisibility: getComputedStyle(
          element.querySelector('.pc-activity__connection'),
          '::before',
        ).visibility,
      };
    });
  const watching = await feedGeometry();
  assert.equal(await page.locator('.pc-activity__connection > .pc-badge').innerText(), 'Watching');
  assert.equal(watching.reserveVisibility, 'hidden');
  assert(watching.badge.width <= watching.connection.width);
  assert.equal(watching.badge.height, 26, 'Activity artboard pill height');
  assert.equal(watching.badge.x, watching.connection.x);
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('activity-disconnect');
    window.shellGeometry.renderFeed('paused');
  });
  await settle(page);
  const paused = await feedGeometry();
  assert.equal(
    await page.locator('.pc-activity__connection > .pc-badge').innerText(),
    'Reconnecting · changes so far are kept',
  );
  assert.deepEqual(paused.header, watching.header);
  assert.deepEqual(
    paused.connection,
    watching.connection,
    'disconnect does not move the reserved wrapper',
  );
  assert.deepEqual(paused.feed, watching.feed);
  assert.equal(paused.badge.height, watching.badge.height);
  assert.equal(paused.badge.y, watching.badge.y);
  assert.equal(paused.badge.x, watching.badge.x, 'both labels keep their painted origin');
  assert(
    paused.badge.width <= paused.connection.width,
    'the longer label fits its reserved region',
  );
  const disconnectShifts = await page.evaluate(() =>
    window.__dashboardLayoutShifts
      .snapshot()
      .shifts.filter((shift) => shift.phase === 'activity-disconnect'),
  );
  assert.equal(
    disconnectShifts.reduce((total, shift) => total + shift.value, 0),
    0,
    JSON.stringify(disconnectShifts),
  );
  assert.deepEqual(errors, []);
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
  await render(page, { route: '#/home', connectionState: 'connected' });
  const mobile = await page.evaluate(() => {
    const topbar = document.querySelector('.pc-topbar');
    const live = topbar?.querySelector('.pc-topbar__end .pc-conn--watcher');
    const output = live?.closest('output');
    const title = topbar?.querySelector('.pc-topbar__view');
    if (!topbar || !live || !output || !title)
      throw new Error('Missing mobile shell geometry target');
    const line3Probe = document.createElement('span');
    line3Probe.style.color = 'var(--op-line3)';
    document.body.append(line3Probe);
    const line3 = getComputedStyle(line3Probe).color;
    line3Probe.remove();
    const controls = [
      ...topbar.querySelectorAll(
        '.pc-topbar__palette, .pc-topbar__end > button.pc-conn, .pc-icon-button',
      ),
    ].map((control) => {
      const box = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return {
        label: control.getAttribute('aria-label') ?? control.textContent?.trim(),
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        background: style.backgroundColor,
        inside: box.left >= 0 && box.right <= window.innerWidth,
      };
    });
    const range = document.createRange();
    range.selectNodeContents(live);
    const liveText = range.getBoundingClientRect();
    const liveBox = live.getBoundingClientRect();
    const topbarBox = topbar.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    return {
      title: title.textContent,
      titleVisible: titleBox.width > 0 && titleBox.height > 0,
      hiddenCrumbs: [
        ...topbar.querySelectorAll('.pc-topbar__crumb, .pc-topbar__separator, .pc-topbar__subject'),
      ].every((element) => element.getClientRects().length === 0),
      floatingChrome: document.querySelectorAll('.canvas-chrome-root').length,
      controls,
      line3,
      live: {
        text: live.textContent?.trim(),
        title: live.getAttribute('title'),
        announced: output.getAttribute('aria-live'),
        labelCount: topbar.querySelectorAll('.pc-conn--watcher').length,
        dotVisible: (live.querySelector('.pc-conn__dot')?.getBoundingClientRect().width ?? 0) > 0,
        textFits: liveText.width <= liveBox.width + 1 && liveBox.width > 0,
        inside:
          liveBox.left >= topbarBox.left &&
          liveBox.right <= topbarBox.right &&
          liveBox.top >= topbarBox.top &&
          liveBox.bottom <= topbarBox.bottom,
      },
    };
  });
  assert.equal(mobile.title, 'Home');
  assert.equal(mobile.titleVisible, true);
  assert.equal(mobile.hiddenCrumbs, true, 'mobile shows only the current view title');
  assert.equal(mobile.floatingChrome, 0, 'phones keep the top bar instead of floating chrome');
  assert.equal(mobile.controls.length, 1);
  for (const control of mobile.controls) {
    assert.equal(control.width, 44, `${control.label}: touch width`);
    assert.equal(control.height, 44, `${control.label}: touch height`);
    assert.equal(control.radius, '0px', `${control.label}: mobile artboard radius`);
    assert.equal(control.borderWidth, '0px', `${control.label}: ghost search border`);
    assert.equal(control.background, 'rgba(0, 0, 0, 0)', `${control.label}: transparent chrome`);
    assert.equal(control.inside, true, `${control.label}: fits inside the viewport`);
  }
  assert.deepEqual(mobile.live, {
    text: 'Live',
    title: 'connection: connected',
    announced: 'polite',
    labelCount: 1,
    dotVisible: true,
    textFits: true,
    inside: true,
  });
  await render(page, { route: '#/operate/today', connectionState: 'connected' });
  await page.locator('.pc-mobile-more > summary').click();
  const capability = page.locator('.pc-mobile-more__controls button.pc-conn');
  await capability.waitFor({ state: 'visible' });
  const capabilityBox = await capability.boundingBox();
  assert(capabilityBox && capabilityBox.width >= 44 && capabilityBox.height >= 44);
  await page.locator('.pc-mobile-more > summary').click();
  const hit = await page.evaluate(() => {
    const palette = document.querySelector('.pc-topbar__palette');
    if (!palette) throw new Error('Missing mobile search control');
    const box = palette.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return {
      x,
      y,
      receivesTouch: document.elementFromPoint(x, y)?.closest('button') === palette,
      topbarButtons: document.querySelectorAll('.pc-topbar button').length,
      viewport: window.innerWidth,
    };
  });
  assert.equal(hit.viewport, 390);
  assert.equal(hit.topbarButtons, 1);
  assert.equal(hit.receivesTouch, true);
  await page.touchscreen.tap(hit.x, hit.y);
  await page.locator('dialog.pc-palette').waitFor({ state: 'visible' });
});
