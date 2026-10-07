import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { contrastRatio } from '../lib/artifact/internal/contrast.mjs';
import { ARTIFACT_SHELL_CSS } from '../lib/artifact/ui/shell.mjs';
import { loadArtifactTheme, renderArtifactThemeCss } from '../lib/artifact/ui/tokens.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const options = { skip: !enabled, timeout: 90_000 };
const { build } = createRequire(new URL('../../protocol/package.json', import.meta.url))('esbuild');
const ui = new URL('../lib/artifact/ui/', import.meta.url);
const read = (url) => readFileSync(url, 'utf8');
const chromeCss = read(new URL('studio-shell.css', ui));
const authoringCss = read(new URL('diagram-editor-base.css', ui)) + chromeCss;
const designCss = ['studio.css', 'enhancements.css', 'handoff-center.css']
  .map((name) => read(new URL(`../../design/templates/studio/${name}`, import.meta.url)))
  .join('\n');
const diagramCss = read(new URL('diagram-studio.css', ui));
const themeCss = renderArtifactThemeCss(loadArtifactTheme());
const title = 'Checkout platform · Long artifact title retained for review';
const evidenceRoot = process.env.PLANR_STUDIO_IDENTITY_EVIDENCE;

async function fixture(t, surface) {
  const diagram = surface === 'diagram' || surface === 'presentation';
  const compiled = await build({
    stdin: {
      contents: `
        import { mountDesignStudioChrome, mountDiagramStudioChrome } from ${JSON.stringify(new URL('studio-shell-mount-impl.mjs', ui).pathname)};
        import { createDiagramEditorSession, mountDiagramEditor } from ${JSON.stringify(new URL('../diagram/editor/index.mjs', ui).pathname)};
        const root = document.querySelector('#fixture');
        const canvas = root.querySelector('[data-fixture-canvas]');
        const draft = root.querySelector('[data-fixture-draft]');
        window.__identity = { canvas, draft, exports: 0 };
        if (${JSON.stringify(surface)} === 'authoring') {
          const session = createDiagramEditorSession({ bundle: window.__bundle });
          const editor = mountDiagramEditor({ root, session, host: { colorScheme: 'light' } });
          window.__identity.editor = editor;
          window.__identity.session = session;
          window.__identity.canvas = root.querySelector('[data-editor-svg]');
          const edit = session.submit({type:'rename',id:'node-a',label:'Accepted Studio edit'});
          if (!edit.ok) throw new Error('The real editor rejected the fixture edit.');
          session.setView({selection:['node-a']});
          window.__identity.acceptedBundle = JSON.stringify(session.getState().bundle);
          window.__identity.acceptedSession = session;
        } else if (${JSON.stringify(surface)} === 'design') {
          window.__identity.chrome = mountDesignStudioChrome({ root, title: ${JSON.stringify(title)}, state: { view: 'canvas', navOpen: false, reviewOpen: false } });
        } else {
          window.__identity.chrome = mountDiagramStudioChrome({ root, title: ${JSON.stringify(title)} });
        }
        root.addEventListener('click', event => {
          if (event.target.closest('[data-design-export],[data-export]')) window.__identity.exports++;
        });
        window.__identity.baselineCamera = window.__identity.session ? JSON.stringify(window.__identity.session.getState().view.camera) : null;
      `,
      resolveDir: import.meta.dirname,
      sourcefile: 'studio-identity-fixture.mjs',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  const oldToolbar =
    surface === 'design'
      ? `<header class="design-toolbar"><button class="design-share planr-toolbar-action" aria-label="Share design"><svg class="design-icon" width="16" height="16" aria-hidden="true" viewBox="0 0 16 16"><path d="M8 2v10M3 7l5-5 5 5" stroke="currentColor" fill="none"/></svg><span class="design-button-label">Share design</span></button><details class="design-export"><summary>Export</summary></details></header>`
      : `<header class="diagram-toolbar"><nav data-presentation-nav class="diagram-presentation-nav" aria-label="Presentation chapters" ${surface === 'presentation' ? '' : 'hidden'}><button aria-label="Previous chapter">←</button><div><strong data-chapter-label>Checkout</strong><span data-chapter-progress>1 of 2</span></div><button aria-label="Next chapter">→</button></nav><button data-action="share-diagram">Share diagram</button><button data-shared-history>Revisions</button><div class="diagram-export-menu"><button data-export="json">Export JSON</button></div></header>`;
  const body =
    surface === 'authoring'
      ? '<div id="fixture" style="height:100dvh"></div>'
      : `<div id="fixture" class="planr-shell ${diagram ? 'diagram-shell' : ''}" data-present="${surface === 'presentation'}" data-outline-open="false" data-planr-rail-open="false" data-design-nav-open="false">${oldToolbar}<div class="planr-workspace"><main class="planr-stage" data-fixture-canvas><svg width="100" height="100" aria-label="Synthetic direct canvas"><path d="M0 0h10"/></svg></main><aside class="planr-review-rail"><textarea data-fixture-draft>Pending review draft</textarea></aside></div></div>`;
  await page.route('https://studio.example/identity', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en" ${surface === 'design' ? 'data-design-studio=""' : ''}><meta charset="utf-8"><title>Studio identity fixture</title><body ${surface === 'authoring' ? 'class="planr-diagram-owner-page"' : ''} style="margin:0">${body}</body></html>`,
    }),
  );
  await page.goto('https://studio.example/identity');
  await page.addStyleTag({
    content:
      surface === 'authoring'
        ? themeCss + authoringCss
        : themeCss + ARTIFACT_SHELL_CSS + (surface === 'design' ? designCss : diagramCss),
  });
  const bundle = makeBundle();
  bundle.document.title = title;
  sealBundle(bundle);
  await page.evaluate((value) => {
    window.__bundle = value;
  }, bundle);
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.locator('[data-studio-react-chrome]').waitFor();
  await settle(page);
  if (surface === 'authoring') {
    const result = await page.evaluate(() => {
      const result = window.__identity.session.setView({
        camera: { x: 23, y: -17, scale: 1.25, fit: null },
      });
      const camera = window.__identity.session.getState().view.camera;
      const stage = document.querySelector('.de-canvas').getBoundingClientRect();
      window.__identity.baselineCamera = {
        scale: camera.scale,
        worldX: (stage.width / 2 - camera.x) / camera.scale,
        worldY: (stage.height / 2 - camera.y) / camera.scale,
      };
      return result;
    });
    assert.equal(result.ok, true, 'Real editor accepts the explicit camera');
  }
  return page;
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__identity.layoutReadiness = { previous: null, stable: 0 };
  });
  // Hidden legacy controls can retain a running transition in Firefox/WebKit. Wait for the
  // measured, visible toolbar's transitions and stable geometry/colors within the page budget.
  await page.waitForFunction(() => {
    const toolbar = document.querySelector('.studio-toolbar');
    const visible = [...toolbar.querySelectorAll('*')].filter(
      (element) =>
        element.getClientRects().length && getComputedStyle(element).visibility === 'visible',
    );
    const running = toolbar
      .getAnimations({ subtree: true })
      .some(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
          animation.effect?.target?.getClientRects().length,
      );
    const signature = JSON.stringify([
      toolbar.getBoundingClientRect().toJSON(),
      document.querySelector('.de-canvas,.planr-workspace').getBoundingClientRect().toJSON(),
      ...visible.map((element) => {
        const style = getComputedStyle(element);
        return [
          element.getBoundingClientRect().toJSON(),
          style.color,
          style.backgroundColor,
          style.fontSize,
        ];
      }),
    ]);
    const readiness = window.__identity.layoutReadiness;
    readiness.stable = signature === readiness.previous && !running ? readiness.stable + 1 : 0;
    readiness.previous = signature;
    return readiness.stable >= 2;
  });
}

// Scale the computed text, rather than only the root rem size: the toolbar uses fixed px fonts.
// This is explicit 200% text-size stress, not an assertion about browser page zoom or device scale.
async function textSize(page, scale) {
  await page.locator('.studio-toolbar').evaluate((toolbar, factor) => {
    const textElements = [...toolbar.querySelectorAll('*')].filter((element) =>
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      ),
    );
    for (const element of textElements) {
      if (element.dataset.identityFontSize) element.style.removeProperty('font-size');
    }
    const bases = textElements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    textElements.forEach((element, index) => {
      element.dataset.identityFontSize = String(bases[index]);
      element.style.fontSize = `${bases[index] * factor}px`;
    });
  }, scale);
}

async function observe(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.studio-toolbar');
    const identity = toolbar.querySelector('.studio-identity');
    const badge = identity.querySelector('.studio-type-badge');
    const label = identity.querySelector('.de-title,.planr-title-block strong');
    const rect = (element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const text = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();
      const clip = rect(element);
      const region = rect(identity);
      return {
        value: element.textContent,
        display: getComputedStyle(element).display,
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        bounds: clip,
        visibleWidth: Math.max(
          0,
          Math.min(bounds.right, clip.right, region.right) -
            Math.max(bounds.left, clip.left, region.left),
        ),
        glyphWidth: bounds.width,
        glyphRight: bounds.right,
        textTop: bounds.top,
        textBottom: bounds.bottom,
      };
    };
    const buttons = [...toolbar.querySelectorAll('button')].filter(
      (element) =>
        element.getClientRects().length && getComputedStyle(element).visibility === 'visible',
    );
    return {
      toolbarCount: document.querySelectorAll('[data-studio-react-chrome]').length,
      toolbar: rect(toolbar),
      identity: rect(identity),
      badge: text(badge),
      title: text(label),
      buttons: buttons.map((element) => ({
        label: element.getAttribute('aria-label') || element.textContent,
        color: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
        ...rect(element),
      })),
      bodyOverflow: document.documentElement.scrollWidth > innerWidth,
      canvasRetained:
        window.__identity.canvas ===
        document.querySelector('[data-editor-svg],[data-fixture-canvas]'),
      draftRetained:
        !window.__identity.draft ||
        window.__identity.draft === document.querySelector('[data-fixture-draft]'),
      draft: window.__identity.draft?.value ?? null,
      cameraRetained: window.__identity.session
        ? (() => {
            const camera = window.__identity.session.getState().view.camera;
            const stage = document.querySelector('.de-canvas').getBoundingClientRect();
            const before = window.__identity.baselineCamera;
            return (
              Math.abs(camera.scale - before.scale) < 0.001 &&
              Math.abs((stage.width / 2 - camera.x) / camera.scale - before.worldX) < 0.05 &&
              Math.abs((stage.height / 2 - camera.y) / camera.scale - before.worldY) < 0.05
            );
          })()
        : null,
      acceptedEditRetained: window.__identity.session
        ? window.__identity.session === window.__identity.acceptedSession &&
          JSON.stringify(window.__identity.session.getState().bundle) ===
            window.__identity.acceptedBundle &&
          window.__identity.session.getState().view.selection.includes('node-a')
        : null,
      stage: rect(document.querySelector('.de-canvas,.planr-workspace')),
    };
  });
}

for (const surface of ['design', 'diagram', 'presentation', 'authoring']) {
  test(
    `${surface} keeps visible type and title without overlapping native controls`,
    options,
    async (t) => {
      const page = await fixture(t, surface);
      const observations = [];
      if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
      t.after(() => {
        if (evidenceRoot)
          writeFileSync(
            join(evidenceRoot, `${browserEngine()}-${surface}.json`),
            `${JSON.stringify(observations, null, 2)}\n`,
          );
      });
      for (const width of [375, 390, 680, 681, 700, 701, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await page.emulateMedia({
            colorScheme: theme === 'light' ? 'dark' : 'light',
          });
          await page.evaluate(
            ([currentSurface, currentTheme]) => {
              document.documentElement.dataset.planrTheme = currentTheme;
              if (currentSurface === 'authoring')
                window.__identity.editor.setColorScheme(currentTheme);
            },
            [surface, theme],
          );
          for (const scale of [1, 2]) {
            await textSize(page, scale);
            await settle(page);
            const record = {
              surface,
              width,
              theme,
              scale,
              ...(await observe(page)),
            };
            observations.push(record);
            if (evidenceRoot && [375, 768, 1440].includes(width))
              await page.screenshot({
                path: join(
                  evidenceRoot,
                  `${browserEngine()}-${surface}-${width}-${theme}-${scale}.png`,
                ),
              });
            const context = `${surface} ${width}px ${theme} ${scale * 100}% text`;
            assert.equal(record.toolbarCount, 1, context);
            assert.equal(record.badge.value, surface === 'design' ? 'Design' : 'Diagram', context);
            assert.notEqual(
              record.badge.display,
              'none',
              `${context}: labeled type remains visible`,
            );
            assert.ok(
              record.badge.visibleWidth >= record.badge.glyphWidth - 1,
              `${context}: complete type label is visible (${record.badge.visibleWidth}/${record.badge.glyphWidth}px)`,
            );
            assert.equal(record.title.value, title, context);
            assert.ok(
              record.title.visibleWidth >= 36,
              `${context}: title is visible and may truncate`,
            );
            if (scale === 1 && surface === 'authoring' && width <= 700) {
              assert.equal(
                await page
                  .locator('.planr-diagram-editor')
                  .evaluate((node) => node.dataset.layout.split(' ').includes('compact')),
                true,
                `${context}: native editor uses its compact container breakpoint`,
              );
              assert.ok(
                record.toolbar.height >= 88 && record.toolbar.height <= 110,
                `${context}: two compact rows retain comfortable targets without a tall header`,
              );
            } else if (
              scale === 1 &&
              width >= 681 &&
              (await page.locator('.studio-toolbar').getAttribute('data-studio-layout')) ===
                'inline'
            )
              assert.equal(record.toolbar.height, 60, `${context}: compact desktop/tablet header`);
            assert.ok(
              record.badge.textTop >= record.toolbar.top - 1 &&
                record.badge.textBottom <= record.toolbar.bottom + 1,
              `${context}: type text is not vertically clipped`,
            );
            assert.ok(
              record.title.textTop >= record.toolbar.top - 1 &&
                record.title.textBottom <= record.toolbar.bottom + 1,
              `${context}: title text is not vertically clipped`,
            );
            assert.equal(record.bodyOverflow, false, `${context}: no horizontal page overflow`);
            for (const button of record.buttons) {
              if (surface === 'presentation' && button.label.endsWith('chapter'))
                assert.ok(
                  contrastRatio(button.color, button.background) >= 4.5,
                  `${context}: ${button.label} has readable themed foreground/background`,
                );
              assert.ok(
                button.left >= -1 && button.right <= width + 1,
                `${context}: ${button.label} fits`,
              );
              const overlap =
                Math.min(button.right, record.identity.right) -
                Math.max(button.left, record.identity.left);
              assert.ok(
                overlap <= 1 ||
                  button.bottom <= record.identity.top ||
                  button.top >= record.identity.bottom,
                `${context}: ${button.label} does not overlap identity`,
              );
            }
            assert.ok(
              record.stage.top >= record.toolbar.bottom - 1,
              `${context}: canvas begins below header`,
            );
            assert.equal(record.canvasRetained, true, `${context}: stable canvas DOM`);
            assert.equal(record.draftRetained, true, `${context}: stable review draft DOM`);
            if (surface === 'authoring')
              assert.equal(
                record.cameraRetained,
                true,
                `${context}: actual editor retains the camera scale and world center through layout changes`,
              );
            if (surface === 'authoring')
              assert.equal(
                record.acceptedEditRetained,
                true,
                `${context}: accepted bundle and selection survive`,
              );
            if (surface !== 'authoring') {
              assert.equal(record.draft, 'Pending review draft', context);
              await page.evaluate(() => {
                document.querySelector('#fixture').dataset.planrRailOpen = 'true';
              });
              await settle(page);
              const rail = await page.locator('.planr-review-rail').boundingBox();
              assert.ok(
                rail && rail.y >= record.toolbar.bottom - 1,
                `${context}: existing rail starts below the natural header`,
              );
              await page.evaluate(() => {
                document.querySelector('#fixture').dataset.planrRailOpen = 'false';
              });
              await settle(page);
            }
          }
        }
      }
      await page.setViewportSize({ width: 375, height: 900 });
      await textSize(page, 1);
      await settle(page);
      const trigger =
        surface === 'authoring'
          ? page.getByRole('button', { name: 'More', exact: true })
          : page.getByRole('button', { name: 'Export', exact: true });
      const beforeMenuCamera =
        surface === 'authoring'
          ? await page.evaluate(() =>
              JSON.stringify(window.__identity.session.getState().view.camera),
            )
          : null;
      await trigger.click();
      const item = page.getByRole('menuitem', {
        name: surface === 'design' ? 'Portable HTML' : 'Export JSON',
        exact: true,
      });
      await item.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('[role=menu]'));
      await page.keyboard.press('Escape');
      await item.waitFor({ state: 'hidden' });
      await page.waitForFunction(
        (selector) => document.querySelector(selector) === document.activeElement,
        surface === 'authoring' ? '[data-action=more]' : '[data-studio-export-menu]',
      );
      assert.equal(
        await trigger.evaluate((element) => element === document.activeElement),
        true,
        'Escape restores the existing menu trigger',
      );
      const afterMenu = await observe(page);
      assert.equal(afterMenu.canvasRetained, true);
      assert.equal(afterMenu.draftRetained, true);
      if (surface === 'authoring')
        assert.equal(
          await page.evaluate(() =>
            JSON.stringify(window.__identity.session.getState().view.camera),
          ),
          beforeMenuCamera,
          'Actual editor camera remains byte-identical through menu open and Escape',
        );
    },
  );
}

test(
  'diagram stays compact at the tablet boundary with native fallback font metrics',
  options,
  async (t) => {
    const page = await fixture(t, 'diagram');
    const observations = [];
    if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
    t.after(() => {
      if (evidenceRoot)
        writeFileSync(
          join(evidenceRoot, `${browserEngine()}-diagram-fallback-fonts.json`),
          `${JSON.stringify(observations, null, 2)}\n`,
        );
    });
    for (const font of ['Arial', 'Verdana', 'Tahoma']) {
      await page.evaluate((family) => {
        // These are real native fallback fonts: platform metrics must not turn this header into two rows.
        for (const property of ['--planr-font-body', '--planr-font-display'])
          document.documentElement.style.setProperty(property, `"${family}", sans-serif`);
      }, font);
      for (const width of [681, 700, 768]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
          await page.evaluate((value) => {
            document.documentElement.dataset.planrTheme = value;
          }, theme);
          await settle(page);
          const record = { font, width, theme, ...(await observe(page)) };
          observations.push(record);
          if (evidenceRoot && width === 681)
            await page.screenshot({
              path: join(evidenceRoot, `${browserEngine()}-diagram-681-${font}-${theme}.png`),
            });
          const context = `diagram ${width}px ${theme} native ${font}`;
          if (
            (await page.locator('.studio-toolbar').getAttribute('data-studio-layout')) === 'inline'
          )
            assert.equal(record.toolbar.height, 60, `${context}: compact tablet header`);
          assert.equal(record.badge.value, 'Diagram', context);
          assert.ok(
            record.badge.visibleWidth >= record.badge.glyphWidth - 1,
            `${context}: complete type label is visible`,
          );
          assert.equal(record.title.value, title, context);
          assert.ok(record.title.visibleWidth >= 36, `${context}: title retains useful truncation`);
          assert.equal(record.bodyOverflow, false, `${context}: no horizontal page overflow`);
          for (const button of record.buttons) {
            assert.ok(
              button.left >= -1 && button.right <= width + 1,
              `${context}: ${button.label} fits`,
            );
            const overlap =
              Math.min(button.right, record.identity.right) -
              Math.max(button.left, record.identity.left);
            assert.ok(
              overlap <= 1 ||
                button.bottom <= record.identity.top ||
                button.top >= record.identity.bottom,
              `${context}: ${button.label} does not overlap identity`,
            );
          }
          assert.ok(
            record.stage.top >= record.toolbar.bottom - 1,
            `${context}: direct canvas remains below header`,
          );
          assert.equal(record.canvasRetained, true, `${context}: stable canvas DOM`);
          assert.equal(record.draftRetained, true, `${context}: stable review draft DOM`);
          assert.equal(record.draft, 'Pending review draft', context);
        }
      }
    }
  },
);
