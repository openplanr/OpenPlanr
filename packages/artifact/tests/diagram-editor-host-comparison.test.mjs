import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Exercise canonical TypeScript source before the owning generator projects it.
const require = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = require('esbuild');
const compiled = await build({
  stdin: {
    contents: `export { createEditorDialogs } from './diagram-editor-dialogs.mts';
      export { readHostOptions } from './diagram-editor-host.mts';
      export { createEditorKeyboard } from './diagram-editor-keyboard.mts';`,
    resolveDir: new URL('../lib/artifact/ui/', import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  logLevel: 'silent',
});
const temporary = mkdtempSync(join(tmpdir(), 'planr-host-comparison-'));
const modulePath = join(temporary, 'comparison.mjs');
writeFileSync(modulePath, compiled.outputFiles[0].text);
const { createEditorDialogs, readHostOptions, createEditorKeyboard } = await import(
  pathToFileURL(modulePath)
);
rmSync(temporary, { recursive: true, force: true });

function fixture({
  callback = () => {},
  disposed = false,
  readable = true,
  comparison = true,
  menu = false,
  writable = true,
} = {}) {
  const calls = [];
  const opener = { isConnected: true, closest: () => (menu ? {} : null) };
  const moreButton = {};
  const session = {};
  const state = {
    disposed: false,
    bundle: readable ? {} : null,
    comparison: comparison ? {} : null,
    capabilities: { read: readable, write: writable },
  };
  const ctx = {
    doc: { activeElement: opener },
    win: {},
    session,
    host: {
      onCompareRevisions: (options) => {
        calls.push(['host', options]);
        callback(options);
      },
    },
    dom: { shell: {}, stage: {}, dialogLayer: {}, moreButton },
    current: () => state,
    isDisposed: () => disposed,
    report: (message) => calls.push(['report', message]),
    commands: { trigger: () => opener },
    chrome: { setOverflow: (...args) => calls.push(['overflow', ...args]) },
  };
  return { dialogs: createEditorDialogs(ctx), ctx, state, calls, opener, moreButton, session };
}

test('a trusted host owns comparison presentation exactly once without native modal or focus changes', () => {
  const f = fixture();
  f.dialogs.compareRevisions();
  assert.equal(f.dialogs.active(), null);
  assert.deepEqual(f.calls, [
    ['overflow', false, { restoreFocus: false }],
    ['host', { session: f.session, opener: f.opener }],
  ]);
});

test('overflow comparison hands the host its stable More opener', () => {
  const f = fixture({ menu: true });
  f.dialogs.compareRevisions();
  assert.equal(f.calls[1][1].opener, f.moreButton);
});

test('disposed, unreadable or no longer current comparisons do not invoke the host', () => {
  for (const options of [{ disposed: true }, { readable: false }, { comparison: false }]) {
    const f = fixture(options);
    f.dialogs.compareRevisions();
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  f.state.disposed = true;
  f.dialogs.compareRevisions();
  assert.deepEqual(f.calls, []);
});

test('read-only comparison presentation does not grant editing or mutate the session', () => {
  const f = fixture({ writable: false });
  f.dialogs.compareRevisions();
  assert.equal(f.calls.filter(([name]) => name === 'host').length, 1);
  assert.deepEqual(f.session, {});
});

test('host presentation failure reports retained work without creating a second overlay', () => {
  const f = fixture({
    callback: () => {
      throw new Error('host unavailable');
    },
  });
  f.dialogs.compareRevisions();
  assert.equal(f.dialogs.active(), null);
  assert.deepEqual(f.calls.at(-1), [
    'report',
    'The host comparison could not be opened. Your draft remains unchanged.',
  ]);
  assert.equal(f.calls.filter(([name]) => name === 'host').length, 1);
});

test('comparison hook is optional and invalid hooks fail before mounting', () => {
  assert.doesNotThrow(() => readHostOptions({}));
  assert.doesNotThrow(() => readHostOptions({ onCompareRevisions() {} }));
  assert.throws(
    () => readHostOptions({ onCompareRevisions: true }),
    /Host onCompareRevisions must be a function/,
  );
});

test('keyboard events outside the editor remain owned by the host comparison', () => {
  let prevented = 0;
  const external = { closest: () => null };
  const ctx = {
    doc: {},
    dom: { shell: { contains: () => false } },
    chrome: {},
    dialogs: { active: () => null },
    canvas: { dragging: () => false },
    outline: {},
    inspector: {},
    commands: {},
    layout: { drawer: () => false },
  };
  const keyboard = createEditorKeyboard(ctx);
  for (const key of ['Escape', 'Tab', 'Delete', 's', 'z']) {
    keyboard.keydown({
      key,
      target: external,
      preventDefault: () => {
        prevented += 1;
      },
      ctrlKey: true,
    });
  }
  assert.equal(prevented, 0);
});

const browserEnabled = process.env.PLANR_BROWSER_TESTS === '1';
const { launchBrowser } = await import('../../../tests/support/browser-launcher.mjs');
const { makeBundle } = await import('../../../tests/protocol/fixtures/diagram-authoring.mjs');
const { readFileSync } = await import('node:fs');

async function browserFixture(t, { hosted = true } = {}) {
  const entry = new URL('../lib/artifact/diagram/editor/index.mjs', import.meta.url).pathname;
  const code = await build({
    stdin: {
      contents: `import { createDiagramEditorSession, mountDiagramEditor } from ${JSON.stringify(entry)};
        const session = createDiagramEditorSession({bundle: window.__bundle, acknowledged:true});
        const other = createDiagramEditorSession({bundle: window.__bundle, acknowledged:true});
        session.submit({type:'rename',id:'node-a',label:'Local edit'});
        other.submit({type:'rename',id:'node-a',label:'Remote edit'});
        session.refresh(other.getState().bundle);
        window.__session = session; window.__calls = 0;
        const host = ${
          hosted
            ? `{
          onCompareRevisions({session: supplied, opener}) {
            if (supplied !== session) throw new Error('Wrong session');
            window.__calls++; window.__opener = opener;
            if (window.__throw) throw new Error('Host refused');
            const panel = document.createElement('section'); panel.setAttribute('role','dialog');
            panel.setAttribute('aria-label','Company comparison');
            const input = document.createElement('input'); input.setAttribute('aria-label','Host note');
            panel.append(input); document.body.append(panel); input.focus();
          }
        }`
            : '{}'
        };
        window.__mount = mountDiagramEditor({root:document.querySelector('#editor'),session,host});`,
      resolveDir: import.meta.dirname,
    },
    plugins: [
      {
        name: 'canonical-host-source',
        setup(builder) {
          builder.onResolve({ filter: /diagram-editor-(?:host|dialogs)\.mjs$/ }, (args) => ({
            path: join(args.resolveDir, args.path.replace(/\.mjs$/u, '.mts')),
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.route('https://company.example/comparison', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><div id="editor" style="height:100vh"></div></body></html>',
    }),
  );
  await page.goto('https://company.example/comparison');
  await page.addStyleTag({
    content: readFileSync(
      new URL('../lib/artifact/ui/diagram-editor.css', import.meta.url),
      'utf8',
    ),
  });
  await page.evaluate((bundle) => {
    window.__bundle = bundle;
  }, makeBundle());
  await page.addScriptTag({ content: code.outputFiles[0].text });
  return page;
}

test('rendered host comparison has one owner, stable opener and independent keyboard handling', {
  skip: !browserEnabled,
  timeout: 90_000,
}, async (t) => {
  const page = await browserFixture(t);
  await page.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Company comparison' }).count(), 1);
  assert.equal(await page.locator('#editor [role="dialog"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__calls), 1);
  assert.equal(await page.locator('#editor .de-stage').getAttribute('inert'), null);
  assert.equal(
    await page.getByLabel('Host note').evaluate((input) => document.activeElement === input),
    true,
  );
  const before = await page.evaluate(() => window.__session.getState().bundle.bundleDigest);
  assert.deepEqual(
    await page.getByLabel('Host note').evaluate((input) =>
      ['Escape', 'Tab', 'Delete', 's', 'z'].map((key) => {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ),
    [false, false, false, false, false],
  );
  assert.equal(await page.evaluate(() => window.__session.getState().bundle.bundleDigest), before);
  await page.evaluate(() => {
    document.querySelector('[aria-label="Company comparison"]').remove();
    window.__opener.focus();
    window.__throw = true;
  });
  await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__calls), 2);
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(
    await page.getByRole('alert').textContent(),
    'The host comparison could not be opened. Your draft remains unchanged.',
  );
  assert.equal(await page.evaluate(() => window.__session.getState().bundle.bundleDigest), before);
  await page.evaluate(() => window.__mount.dispose());
});

test('standalone comparison still uses its native modal and owns background isolation', {
  skip: !browserEnabled,
  timeout: 90_000,
}, async (t) => {
  const page = await browserFixture(t, { hosted: false });
  await page.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  assert.equal(
    await page.getByRole('dialog', { name: 'Compare revisions', exact: true }).count(),
    1,
  );
  assert.equal(await page.getByRole('dialog', { name: 'Company comparison' }).count(), 0);
  assert.notEqual(await page.locator('.de-stage').getAttribute('inert'), null);
  await page.getByRole('button', { name: 'Keep my draft', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.evaluate(() => window.__mount.dispose());
});
