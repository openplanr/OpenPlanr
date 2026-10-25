import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';

test(`shared source props are present before authored scripts and styles run (${browserEngine()})`, {
  timeout: 30000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-props-browser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { count: 1, variants: 2 });
  document.schemaVersion = '1.1.0';
  document.screens[0].anchors = [];
  document.screens[0].props = {
    theme: { type: 'enum', options: ['light', 'dark'], default: 'light' },
    expanded: { type: 'boolean', default: true },
  };
  document.variants[1].props = { 'screen-1': { theme: 'dark', expanded: false } };
  const source = `<!doctype html><html><head><style>
    body[data-prop-theme="light"]{background-color:rgb(255,255,255);color:rgb(0,0,0)}
    body[data-prop-theme="dark"]{background-color:rgb(0,0,0);color:rgb(255,255,255)}
    body.prop-expanded-false main{display:none}
    </style></head><body class="workspace"><script>
    window.initialProps = {theme:document.body.dataset.propTheme,
      expanded:document.body.dataset.propExpanded,classes:[...document.body.classList]};
    </script><main><h1>Shared workspace source</h1></main></body></html>`;
  writeFileSync(join(root, 'source/screen-1.html'), source);
  writeFileSync(file, JSON.stringify(document));
  const prepared = prepareDesignDocument(file);
  const browser = await launchBrowser({ engine: browserEngine() });
  t.after(() => browser.close());
  const observed = [];
  for (const variantId of ['A', 'B']) {
    const entry = prepared.entries.find((entry) => entry.variantId === variantId);
    const artifact = prepared.envelope.artifacts.find(({ id }) => id === entry.artifactId);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(resolveArtifactHtml(prepared.envelope, artifact));
    observed.push(
      await page.evaluate(() => {
        const body = document.body;
        const normalized = body.cloneNode(true);
        for (const { name } of [...normalized.attributes])
          if (name.startsWith('data-prop-')) normalized.removeAttribute(name);
        for (const name of [...normalized.classList])
          if (name.startsWith('prop-')) normalized.classList.remove(name);
        return {
          screen: body.dataset.planrScreen,
          theme: body.dataset.propTheme,
          expanded: body.dataset.propExpanded,
          initial: window.initialProps,
          background: getComputedStyle(body).backgroundColor,
          display: getComputedStyle(body.querySelector('main')).display,
          normalized: normalized.outerHTML,
        };
      }),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.deepEqual(
    observed.map(({ screen }) => screen),
    ['screen-1', 'screen-1'],
  );
  assert.deepEqual(
    observed.map(({ theme }) => theme),
    ['light', 'dark'],
  );
  assert.deepEqual(
    observed.map(({ expanded }) => expanded),
    ['true', 'false'],
  );
  assert.deepEqual(
    observed.map(({ background }) => background),
    ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
  );
  assert.notEqual(observed[0].display, 'none');
  assert.equal(observed[1].display, 'none');
  for (const item of observed) {
    assert.equal(item.initial.theme, item.theme);
    assert.equal(item.initial.expanded, item.expanded);
    assert.ok(item.initial.classes.includes(`prop-theme-${item.theme}`));
    assert.ok(item.initial.classes.includes(`prop-expanded-${item.expanded}`));
    assert.ok(item.initial.classes.includes('workspace'));
  }
  assert.equal(observed[0].normalized, observed[1].normalized);
  assert.equal(readFileSync(join(root, 'source/screen-1.html'), 'utf8'), source);
  assert.deepEqual(
    prepared.sourceFiles.filter((path) => path.endsWith('.html')),
    ['source/screen-1.html'],
  );
});
