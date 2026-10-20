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
        import { NavRail, StatusBar } from './src/features/shell/shell-navigation.tsx';
        import { parseDashboardRoute } from './src/app/router.tsx';
        import { ActivitySessionFeed } from './src/features/planning/ActivitySessionFeed.tsx';
        import { EMPTY_SESSION_ACTIVITY } from './src/features/planning/planning-session-activity.ts';
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
        let status = { branch: null, nodeCount: null, edgeCount: null, connectionState: 'booting', buildId: 'geometry-fixture' };
        const render = (patch = {}) => {
          state = { ...state, ...patch };
          const readyBoard = state.route === '#/board' && state.connectionState === 'connected';
          flushSync(() => root.render(createElement(DashboardProviders, {
            buildId: 'shell-geometry-fixture',
            initialHash: state.route,
            binding: readyBoard ? binding : null,
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
          renderRail: (branch) => {
            flushSync(() => root.render(createElement('div', { className: 'pc-shell' },
              createElement(NavRail, {
                branch, product: 'planning', route: parseDashboardRoute('#/list'),
                compact: false, operateAvailable: true, onOpenPalette: () => undefined,
              }))));
          },
          renderStatus: (patch = {}) => {
            status = { ...status, ...patch };
            flushSync(() => root.render(createElement(StatusBar, status)));
          },
          renderFeed: (connection) => {
            flushSync(() => root.render(createElement('div', { className: 'op-planning pc-activity' },
              createElement(ActivitySessionFeed, {
                activity: { ...EMPTY_SESSION_ACTIVITY, connection }, entries: [], nodes: [],
              }))));
          },
          preference: () => ({ savedCompact, saves: [...saves] }),
          clearPreference: () => { savedCompact = undefined; },
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
  assert.deepEqual(actual.palette, baseline.palette, `${context}: palette stays fixed`);
  assert.deepEqual(actual.main, baseline.main, `${context}: main stays fixed`);
  assert.deepEqual(actual.scroll, baseline.scroll, `${context}: scroll stays fixed`);
}

async function assertBoardShell(page, width, context) {
  await render(page, { route: '#/list', connectionState: 'connected' });
  await page.waitForSelector('[data-route-kind="planning.list"]');
  const baseline = await geometry(page);
  await render(page, { route: '#/board', connectionState: 'connected' });
  const board = page.locator('[data-route-kind="planning.board"].op-planning--board');
  await board.waitFor({ state: 'visible' });
  assert.equal(await board.locator('.pc-status-board__column').count(), 5);
  await settle(page);
  assertRail(await geometry(page), baseline, width, context);
  await render(page, { route: '#/board', connectionState: 'booting' });
}

test('bundles the shell geometry fixture into a standalone browser script', async () => {
  const code = await bundleFixture();
  assert(code.length > 0);
  assert.doesNotThrow(() => new Script(code));
  assert.doesNotMatch(styles, /@import\s/u);
});

test('topbar grid fixes the palette position across routes and reserves the rail branch line', {
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
    assert.equal(baseline.palette.width, width >= 1200 ? 300 : 44);
    for (const route of ['#/board', '#/graph', '#/home', '#/operate/today', '#/list']) {
      await render(page, { route });
      assert.deepEqual((await geometry(page)).palette, baseline.palette, `${width}: ${route}`);
    }
    const labels = await page
      .locator('.pc-rail__item > span:not(.pc-rail__count)')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          width: element.getBoundingClientRect().width,
          fits: element.scrollWidth <= element.clientWidth,
        })),
      );
    for (const label of labels) {
      assert(label.width > 24, `${width}: ${label.text} retains a legible text column`);
      assert(label.fits, `${width}: ${label.text} is not clipped`);
    }
  }
  await page.evaluate(() => window.shellGeometry.renderRail(null));
  await settle(page);
  const branch = page.locator('.pc-rail__branch');
  assert.equal(await branch.evaluate((element) => element.childNodes.length), 0);
  const before = await branch.boundingBox();
  assert(before);
  assert.equal(before.height, 16);
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('rail-bootstrap');
    window.shellGeometry.renderRail('feature/a-long-bootstrap-branch-name');
  });
  await settle(page);
  assert.equal(await branch.innerText(), 'feature/a-long-bootstrap-branch-name · .planr/');
  assert.equal(await branch.evaluate((element) => element.childNodes.length), 1);
  assert.deepEqual(await branch.boundingBox(), before);
  const shifts = await page.evaluate(() =>
    window.__dashboardLayoutShifts
      .snapshot()
      .shifts.filter((shift) => shift.phase === 'rail-bootstrap'),
  );
  assert.equal(
    shifts.reduce((total, shift) => total + shift.value, 0),
    0,
    JSON.stringify(shifts),
  );
  assert.deepEqual(errors, []);
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
      if (route === '#/board') await assertBoardShell(page, 236, `expanded Board ${repeat}`);
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
      if (route === '#/board') await assertBoardShell(page, 64, `compact Board ${repeat}`);
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

  await page.evaluate(() => {
    window.shellGeometry.clearPreference();
    window.shellGeometry.remount();
  });
  for (const route of ['#/graph', '#/board', '#/sprints', '#/activity']) {
    await render(page, { route });
    assertRail(await geometry(page), compact, 64, `default compact ${route}`);
  }
  for (const route of ['#/home', '#/list']) {
    await render(page, { route });
    assertRail(await geometry(page), expanded, 236, `default expanded ${route}`);
  }
  await render(page, { route: '#/detail/QT-071' });
  assert.equal(await page.locator('nav.pc-rail').count(), 0, 'detail has no navigation rail');

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
  assert.equal(await page.locator('.pc-shell-inspector, .pc-inspector-sheet').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Show inspector: select an item first', exact: true })
      .isDisabled(),
    true,
    'an inspector cannot be opened without a selection',
  );
  const emptySelection = await geometry(page);
  assert.equal(emptySelection.main.width, emptySelection.column.width);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

test('compact product navigation fits every item and group at 1440 by 720', {
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
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();

  for (const [route, expectedGroups] of [
    [
      '#/graph',
      [{ label: 'Plan', items: ['Home', 'List', 'Graph', 'Board', 'Sprints', 'Activity'] }],
    ],
    [
      '#/operate/today',
      [
        { label: 'Work', items: ['Today', 'Inbox', 'Actions', 'Cycles'] },
        { label: 'Record', items: ['Evidence', 'Outcomes', 'History', 'Recovery'] },
      ],
    ],
  ]) {
    await render(page, { route });
    const rail = page.getByRole('navigation', { name: 'Dashboard navigation', exact: true });
    assert.equal(await rail.getAttribute('data-compact'), 'true');
    assert.equal(
      await rail.getByRole('button', { name: 'Search or jump', exact: true }).count(),
      1,
    );
    assert.equal(
      await rail.getByRole('button', { name: 'Expand navigation', exact: true }).count(),
      1,
    );
    assert.equal(await rail.getByRole('region').count(), expectedGroups.length);
    for (const group of expectedGroups)
      assert.equal(await rail.getByRole('region', { name: group.label, exact: true }).count(), 1);
    const report = await rail.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const groups = [...element.querySelectorAll('.pc-rail__section')].map((section) => ({
        label: section.querySelector('.pc-rail__label')?.textContent,
        items: [...section.querySelectorAll('a')].map((item) => item.getAttribute('aria-label')),
      }));
      const overflow = [
        element,
        element.querySelector('.pc-rail__sections'),
        ...element.querySelectorAll('.pc-rail__section'),
      ].map((region) => {
        if (!region) throw new Error('Missing compact navigation region');
        return {
          horizontal: region.scrollWidth > region.clientWidth,
          vertical: region.scrollHeight > region.clientHeight,
        };
      });
      const controls = [...element.querySelectorAll('a, button')].map((control) => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          label: control.getAttribute('aria-label'),
          visible: style.display !== 'none' && style.visibility !== 'hidden',
          inside:
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom,
          receivesPointer: hit === control || control.contains(hit),
        };
      });
      const separators = [
        element.querySelector('.pc-rail__sections'),
        ...element.querySelectorAll('.pc-rail__section + .pc-rail__section'),
        element.querySelector('.pc-rail__footer'),
      ].map((region) => {
        if (!region) throw new Error('Missing compact navigation group separator');
        const style = getComputedStyle(region);
        return { width: style.borderTopWidth, style: style.borderTopStyle };
      });
      return { width: bounds.width, groups, overflow, controls, separators };
    });
    assert.equal(report.width, 64);
    assert.deepEqual(report.groups, expectedGroups, `${route}: product-specific navigation groups`);
    assert.equal(report.controls.length, expectedGroups.flatMap((group) => group.items).length + 2);
    for (const overflow of report.overflow)
      assert.deepEqual(overflow, { horizontal: false, vertical: false });
    for (const control of report.controls) {
      assert.equal(control.visible, true, `${route}: ${control.label} is visible`);
      assert.equal(control.inside, true, `${route}: ${control.label} fits inside the rail`);
      assert.equal(
        control.receivesPointer,
        true,
        `${route}: ${control.label} receives pointer input`,
      );
    }
    for (const separator of report.separators)
      assert.deepEqual(separator, { width: '1px', style: 'solid' });
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
  await page.evaluate(() => window.shellGeometry.renderStatus());
  await settle(page);
  const statusGeometry = () =>
    page.locator('.pc-statusbar').evaluate((element) =>
      [
        '.pc-statusbar__item--branch',
        '.pc-statusbar__item--totals',
        '.pc-watcher',
        '.pc-statusbar__end',
      ].map((selector) => {
        const slot = element.querySelector(selector);
        if (!slot) throw new Error(`Missing status geometry target: ${selector}`);
        const { x, y, width, height } = slot.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  const startup = await statusGeometry();
  assert.deepEqual(
    startup.slice(0, 3).map((slot) => slot.width),
    [120, 216, 192],
  );
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('status-bootstrap');
    window.shellGeometry.renderStatus({
      branch: 'feature/a-long-bootstrap-branch-name',
      connectionState: 'connected',
    });
  });
  await settle(page);
  assert.deepEqual(
    await statusGeometry(),
    startup,
    'bootstrap metadata keeps every status slot fixed',
  );
  await page.evaluate(() => window.shellGeometry.renderStatus({ nodeCount: 1280, edgeCount: 320 }));
  await settle(page);
  assert.deepEqual(await statusGeometry(), startup, 'graph totals keep every status slot fixed');
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
        feed: rect('.pc-activity__feed'),
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
  assert.equal(watching.badge.height, 28, 'Activity artboard pill height');
  assert.equal(watching.badge.x, watching.connection.x);
  await page.evaluate(() => {
    window.__dashboardLayoutShifts.markPhase('activity-disconnect');
    window.shellGeometry.renderFeed('paused');
  });
  await settle(page);
  const paused = await feedGeometry();
  assert.equal(
    await page.locator('.pc-activity__connection > .pc-badge').innerText(),
    'Disconnected · session retained',
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
    const statusbar = document.querySelector('.pc-statusbar');
    const watcher = statusbar?.querySelector('.pc-watcher');
    const live = watcher?.querySelector('.pc-watcher__label');
    const title = topbar?.querySelector('.pc-topbar__view');
    if (!topbar || !statusbar || !watcher || !live || !title)
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
    const watcherBox = watcher.getBoundingClientRect();
    const statusBox = statusbar.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    return {
      title: title.textContent,
      titleVisible: titleBox.width > 0 && titleBox.height > 0,
      hiddenCrumbs: [
        ...topbar.querySelectorAll('.pc-topbar__crumb, .pc-topbar__separator, .pc-topbar__subject'),
      ].every((element) => element.getClientRects().length === 0),
      controls,
      line3,
      live: {
        text: live.textContent?.trim(),
        accessibleName: watcher.getAttribute('aria-label'),
        labelCount: watcher.querySelectorAll('.pc-watcher__label').length,
        dotVisible:
          (watcher.querySelector('.pc-watcher__dot')?.getBoundingClientRect().width ?? 0) > 0,
        textFits: liveText.width <= liveBox.width + 1 && liveBox.width > 0,
        inside:
          liveBox.left >= watcherBox.left &&
          liveBox.right <= watcherBox.right &&
          liveBox.top >= watcherBox.top &&
          liveBox.bottom <= watcherBox.bottom &&
          watcherBox.left >= statusBox.left &&
          watcherBox.right <= statusBox.right &&
          watcherBox.top >= statusBox.top &&
          watcherBox.bottom <= statusBox.bottom,
      },
    };
  });
  assert.equal(mobile.title, 'Home');
  assert.equal(mobile.titleVisible, true);
  assert.equal(mobile.hiddenCrumbs, true, 'mobile shows only the current view title');
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
    accessibleName: 'watcher connected',
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
