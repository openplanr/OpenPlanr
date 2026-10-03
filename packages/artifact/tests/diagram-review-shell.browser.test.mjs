import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareDiagramShareBundle } from '../lib/artifact/diagram/review-bundle.mjs';
import { renderDiagram } from '../lib/artifact/diagram/runtime.mjs';
import { startDiagramReview } from '../lib/artifact/diagram-review.mjs';

const { build } = createRequire(new URL('../../protocol/package.json', import.meta.url))('esbuild');

test('local and shared reviews preserve one common diagram shell with explicit host actions', {
  skip: process.env.PLANR_BROWSER_TESTS !== '1',
  timeout: 90000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'planr-diagram-shell-parity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const document = JSON.parse(
    readFileSync(
      new URL('../fixtures/diagram/grammars/sequence.planr-diagram.json', import.meta.url),
      'utf8',
    ),
  );
  await renderDiagram(document, { outputRoot: directory });
  const manifest = join(
    directory,
    'diagrams',
    document.diagramId,
    `${document.diagramId}.manifest.json`,
  );
  const bundle = await prepareDiagramShareBundle(manifest);
  const owner = await startDiagramReview(manifest, {
    noOpen: true,
    env: { ...process.env, PLANR_HOME: join(directory, 'home') },
  });
  t.after(() => owner.close());
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const local = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const shared = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  for (const page of [local, shared]) page.on('pageerror', (error) => errors.push(error.message));
  await local.goto(owner.url);
  await local.locator('.studio-toolbar').waitFor();
  await shared.route('https://share.test/shell-parity', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="review" style="height:100vh"></div>',
    }),
  );
  await shared.goto('https://share.test/shell-parity');
  for (const name of [
    'generated/artifact-theme.css',
    'diagram-editor.css',
    'diagram-studio.css',
    'diagram-shared-review.css',
    'studio-shell.css',
  ])
    await shared.addStyleTag({
      content: readFileSync(new URL(`../lib/artifact/ui/${name}`, import.meta.url), 'utf8').replace(
        /^@import.*;$/gmu,
        '',
      ),
    });
  const entry = join(import.meta.dirname, '../lib/artifact/ui/diagram-shared-review.mjs');
  const built = await build({
    stdin: {
      contents: `import {mountDiagramSharedReview} from ${JSON.stringify(entry)}; window.parityExports = []; window.parity = mountDiagramSharedReview({root:document.querySelector('#review'),bundle:${JSON.stringify(bundle)},host:{reviewOf:'a'.repeat(64),onExport:format=>window.parityExports.push(format)}});`,
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  await shared.addScriptTag({ content: built.outputFiles[0].text });
  await shared.locator('[data-diagram-shared-ready="true"]').waitFor();
  const commonStructure = async (page) =>
    page.locator('.diagram-shell').evaluate((root) => {
      const selectors = [
        '.diagram-toolbar',
        '.studio-toolbar',
        '.diagram-workspace',
        '.diagram-outline',
        '.diagram-overview .diagram-type',
        '.diagram-element-details',
        '.diagram-canvas',
        '.diagram-scene > .diagram-drawing',
        '.diagram-canvas-tools',
        '.diagram-canvas-status',
        '.planr-review-rail',
        '.diagram-legend',
        '[data-presentation-nav]',
        '[data-planr-announcer]',
      ];
      const controls = root.querySelectorAll(
        '.diagram-outline [data-action], .diagram-canvas-tools button, [data-presentation-nav] button',
      );
      return {
        landmarks: selectors.map((selector) => ({
          selector,
          elements: [...root.querySelectorAll(selector)].map((element) => ({
            tag: element.tagName,
            role: element.getAttribute('role'),
            label: element.getAttribute('aria-label'),
            controls: element.getAttribute('aria-controls'),
          })),
        })),
        controls: [...controls].map((button) => ({
          action: button.dataset.action,
          type: button.getAttribute('type'),
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
        })),
        grammar: root.querySelector('.diagram-type').textContent,
        legend: root.querySelector('.diagram-legend').textContent,
        caption: root.querySelector('.diagram-canvas-status').className,
        drawingParent: root.querySelector('.diagram-drawing').parentElement.className,
        embeddedFrames: root.querySelectorAll('iframe').length,
      };
    });
  const structure = await commonStructure(local);
  assert.deepEqual(await commonStructure(shared), structure);
  for (const landmark of structure.landmarks) assert.equal(landmark.elements.length, 1);
  for (const [selector, label] of [
    ['.diagram-outline', 'Diagram navigator'],
    ['.diagram-element-details', 'Selected element'],
    ['.diagram-canvas', 'Diagram canvas'],
    ['[data-presentation-nav]', 'Presentation chapters'],
  ])
    assert.equal(
      structure.landmarks.find((item) => item.selector === selector).elements[0].label,
      label,
    );
  for (const control of structure.controls) assert.equal(control.type, 'button');
  for (const action of [
    'previous-chapter',
    'next-chapter',
    'fit',
    'width',
    'connections',
    'comment-element',
  ])
    assert.ok(structure.controls.some((control) => control.action === action));
  assert.equal(structure.embeddedFrames, 0);
  assert.equal(structure.drawingParent, 'diagram-scene');
  assert.equal(await local.locator('[data-action="share-diagram"]').count(), 1);
  assert.equal(await shared.locator('[data-action="share-diagram"]').count(), 0);
  assert.equal(await local.locator('[data-shared-history]').count(), 0);
  assert.equal(await shared.locator('[data-shared-history]').count(), 1);
  assert.equal(await local.locator('[data-save-state]').textContent(), 'Saved on this computer');
  assert.equal(await shared.locator('[data-save-state]').textContent(), 'Shared review');
  await local.locator('[data-studio-export-menu]').click();
  assert.equal(
    await local.getByRole('menuitem', { name: 'Agent handoff · JSON', exact: true }).count(),
    1,
  );
  const [download] = await Promise.all([
    local.waitForEvent('download'),
    local.getByRole('menuitem', { name: 'SVG vector', exact: true }).click(),
  ]);
  assert.equal(download.url(), new URL('download/svg', owner.url).href);
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /\.svg$/u);
  await shared.locator('[data-studio-export-menu]').click();
  assert.equal(
    await shared.getByRole('menuitem', { name: 'Agent handoff · JSON', exact: true }).count(),
    0,
  );
  assert.equal(
    await shared.getByRole('menuitem', { name: 'Feedback JSON', exact: true }).count(),
    1,
  );
  await shared.getByRole('menuitem', { name: 'SVG', exact: true }).click();
  assert.deepEqual(await shared.evaluate(() => window.parityExports), ['svg']);
  assert.deepEqual(errors, []);
});
