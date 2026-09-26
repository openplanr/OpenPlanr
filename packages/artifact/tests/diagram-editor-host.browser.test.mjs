import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const editorStyles = readFileSync(
  new URL('../lib/artifact/ui/diagram-editor.css', import.meta.url),
  'utf8',
);
const options = { skip: !enabled, timeout: 90_000 };

// A company-style host: one batch request per save, host wording, a Share action and a Revisions panel.
async function hostedFixture(t, { colorScheme = 'light', capabilities } = {}) {
  const entry = join(
    import.meta.dirname,
    '..',
    'lib',
    'artifact',
    'diagram',
    'editor',
    'index.mjs',
  );
  const compiled = await build({
    stdin: {
      contents: `
        import { createDiagramEditorSession, mountDiagramEditor } from ${JSON.stringify(entry)};
        const basis = bundle => ({ bundleDigest: bundle.bundleDigest, semanticDigest: bundle.document.documentDigest, presentationDigest: bundle.presentation.presentationDigest });
        window.__calls = []; window.__events = { shared: 0, mounts: 0, cleanups: 0 };
        const transport = {
          async read() { return { ok: true, status: 'ready', bundle: window.__bundle }; },
          async saveBatch(batch) {
            window.__calls.push(batch.batchId);
            if (window.__saveMode === 'access') return { ok: false, httpStatus: 401 };
            return { ok: true, status: 'saved', bundle: batch.result, receipt: { batchId: batch.batchId, result: basis(batch.result) } };
          },
        };
        const session = createDiagramEditorSession({ bundle: window.__bundle, acknowledged: true, transport, retainRecoveryOnAccessLoss: true, capabilities: window.__capabilities ?? undefined });
        window.__session = session;
        window.__mountEditor = mountDiagramEditor;
        window.__mount = mountDiagramEditor({ root: document.querySelector('#host-editor'), session, host: {
          brand: false, review: false, colorScheme: 'dark',
          labels: { subtitle: 'Checkout platform · Company diagram', emptyHint: 'Nothing is shared until you save and share a revision.', reviewUnavailable: 'Review is not available for this diagram yet.', readOnly: 'Revision 8 · Read only' },
          saveLabel: state => state.saveState === 'unsaved' ? state.pendingCount + ' unsaved edit' + (state.pendingCount === 1 ? '' : 's') : state.saveState === 'saved' ? 'Saved · revision 8' : null,
          actions: [{ id: 'share', label: 'Share', icon: 'share', disabled: state => state.saveState !== 'saved', onSelect: () => { window.__events.shared += 1; } }],
          panels: [{ id: 'revisions', label: 'Revisions', mount: ({ root }) => {
            window.__events.mounts += 1;
            const item = document.createElement('p'); item.textContent = 'Revision 8 · Latest save'; root.append(item);
            return () => { window.__events.cleanups += 1; };
          } }],
        } });
      `,
      resolveDir: import.meta.dirname,
      sourcefile: 'company-diagram-editor-host.mjs',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.emulateMedia({ colorScheme });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  // Hosts serve the editor from a secure origin, where transaction ids use crypto.randomUUID().
  await page.route('https://company.example/diagram', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Company diagram</title><body style="margin:0"><div id="host-editor" style="height:100vh"></div></body></html>',
    }),
  );
  await page.goto('https://company.example/diagram');
  await page.addStyleTag({ content: editorStyles });
  await page.evaluate(
    ([bundle, granted]) => {
      window.__bundle = bundle;
      window.__capabilities = granted;
    },
    [makeBundle(), capabilities ?? null],
  );
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.locator('[data-editor-svg]').waitFor();
  return page;
}
const saveState = (page) => page.locator('.de-save-state');
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((value) => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const colors = (page, selector) =>
  page.locator(selector).evaluate((element) => {
    const probe = document.createElement('canvas').getContext('2d');
    const rgb = (value) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const style = getComputedStyle(element);
    return { text: rgb(style.color), background: rgb(style.backgroundColor) };
  });

test(
  'a hosted editor shows host wording, a host action and a host panel without local-only chrome',
  options,
  async (t) => {
    const page = await hostedFixture(t);
    assert.equal(
      await page.locator('.de-subtitle').textContent(),
      'Checkout platform · Company diagram',
    );
    assert.equal(await page.locator('.de-mark').count(), 0, 'The host supplies its own brand');
    assert.deepEqual(await page.getByRole('tab').allTextContents(), [
      'Outline',
      'Shapes',
      'Properties',
      'Revisions',
    ]);
    const share = page.getByRole('button', { name: 'Share', exact: true });
    assert.equal(await share.isEnabled(), true);
    await share.click();
    assert.equal(await page.evaluate(() => window.__events.shared), 1);
    assert.equal(
      await saveState(page).textContent(),
      'Saved · revision 8',
      'The host names the saved state',
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.__session.submit({ type: 'rename', id: 'node-a', label: 'Validate order' }),
        )
      ).ok,
      true,
    );
    assert.equal(await share.isDisabled(), true, 'Share waits for a saved revision');
    assert.equal(await saveState(page).textContent(), '1 unsaved edit');
    await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
    await page.locator('.de-save-state[data-state="saved"]').waitFor();
    assert.equal(await page.evaluate(() => window.__calls.length), 1, 'One request per save');
    assert.equal(await share.isEnabled(), true);
    await page.getByRole('tab', { name: 'Revisions', exact: true }).click();
    await page.getByText('Revision 8 · Latest save').waitFor();
    const inset = await page
      .locator('#diagram-revisions-pane')
      .evaluate(
        (pane) =>
          pane.firstElementChild.getBoundingClientRect().left - pane.getBoundingClientRect().left,
      );
    assert.ok(inset >= 12, `Host panel content is inset ${inset}px from the panel edge`);
    await page.getByRole('tab', { name: 'Properties', exact: true }).click();
    await page.getByRole('tab', { name: 'Revisions', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__events.mounts), 1, 'A host panel mounts once');
    assert.equal(await page.evaluate(() => window.__mount.openPanel('revisions')), true);
    assert.equal(await page.evaluate(() => window.__mount.openPanel('missing')), false);
    await page.evaluate(() => window.__mount.dispose());
    assert.equal(
      await page.evaluate(() => window.__events.cleanups),
      1,
      'Dispose releases host panels',
    );
  },
);

test(
  'the host color scheme overrides the operating system and keeps hover text readable',
  options,
  async (t) => {
    const page = await hostedFixture(t, { colorScheme: 'light' });
    const editor = '.planr-diagram-editor';
    assert.equal(await page.locator(editor).getAttribute('data-color-scheme'), 'dark');
    assert.ok(
      luminance((await colors(page, editor)).background) < 0.05,
      'Dark host scheme applies on a light operating system',
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.__session.submit({ type: 'rename', id: 'node-a', label: 'Hover check' }),
        )
      ).ok,
      true,
    );
    const saveButton = page.getByRole('button', { name: 'Save diagram', exact: true });
    await saveButton.hover();
    await saveButton.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const hovered = await colors(page, '[data-action="save"]');
    const [text, background] = [luminance(hovered.text), luminance(hovered.background)];
    assert.ok(text > background, 'Hovered primary text stays lighter than its fill');
    assert.ok(
      (text + 0.05) / (background + 0.05) >= 4.5,
      `Hover contrast is ${((text + 0.05) / (background + 0.05)).toFixed(2)}:1`,
    );
    await page.evaluate(() => window.__mount.setColorScheme('light'));
    assert.equal(await page.locator(editor).getAttribute('data-color-scheme'), 'light');
    assert.ok(luminance((await colors(page, editor)).background) > 0.8);
    await page.evaluate(() => window.__mount.setColorScheme(null));
    assert.equal(
      await page.locator(editor).getAttribute('data-color-scheme'),
      null,
      'Null follows the operating system again',
    );
  },
);

test(
  'access lost during a hosted save shows Access changed instead of a stuck Saving state',
  options,
  async (t) => {
    const page = await hostedFixture(t);
    await page.evaluate(() => {
      window.__saveMode = 'access';
    });
    assert.equal(
      (
        await page.evaluate(() =>
          window.__session.submit({ type: 'rename', id: 'node-a', label: 'Pending' }),
        )
      ).ok,
      true,
    );
    await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
    await page.locator('.de-save-state[data-state="access-changed"]').waitFor();
    assert.equal(await saveState(page).textContent(), 'Access changed');
    assert.match(await page.locator('.de-stage-footer').textContent(), /Access changed/u);
  },
);

test(
  'a session without write access shows a read-only view named by the host',
  options,
  async (t) => {
    const page = await hostedFixture(t, { capabilities: { read: true, write: false } });
    assert.equal(await saveState(page).textContent(), 'Revision 8 · Read only');
    for (const name of ['Undo', 'Redo', 'Layout', 'Save diagram']) {
      assert.equal(
        await page.getByRole('button', { name, exact: true }).isVisible(),
        false,
        `${name} is not offered`,
      );
    }
    assert.deepEqual(
      await page.getByRole('tab').allTextContents(),
      ['Outline', 'Properties', 'Revisions'],
      'Shapes is not offered',
    );
    assert.doesNotMatch(
      await page.locator('.de-stage-footer').textContent(),
      /recovery/iu,
      'Viewers have no edits to recover',
    );
    const node = page.getByRole('treeitem', { name: 'Café ☕', exact: true });
    await node.click();
    assert.equal(
      await node.getAttribute('aria-selected'),
      'true',
      'Objects can still be inspected',
    );
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Mermaid copies', exact: true }).click();
    assert.equal(
      await page
        .getByRole('tab', { name: 'Export a copy', exact: true })
        .getAttribute('aria-selected'),
      'true',
      'Mermaid copies opens on export',
    );
  },
);

test('an open drawer keeps host controls outside the editor reachable', options, async (t) => {
  const page = await hostedFixture(t);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    for (const label of ['Switch theme', 'Back to project']) {
      const control = document.createElement('button');
      control.textContent = label;
      document.body.prepend(control);
    }
  });
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.locator('#diagram-outline-panel');
  const focusIn = (locator) => locator.evaluate((node) => node.contains(document.activeElement));
  assert.equal(await focusIn(outline), true);

  const back = page.getByRole('button', { name: 'Back to project', exact: true });
  await back.focus();
  assert.equal(await focusIn(back), true, 'Focus stays on a host control');
  await page.keyboard.press('Tab');
  assert.equal(
    await focusIn(page.getByRole('button', { name: 'Switch theme', exact: true })),
    true,
    'Tab moves between host controls',
  );
  assert.equal(await outline.getAttribute('aria-hidden'), 'false', 'The drawer stays open');
  await page.keyboard.press('Tab');
  assert.equal(await focusIn(outline), true, 'Entering the editor lands in the open drawer');
});

test('invalid host configuration fails with a specific error', options, async (t) => {
  const page = await hostedFixture(t);
  const messages = await page.evaluate(() => {
    const root = document.createElement('div');
    document.body.append(root);
    const attempt = (host) => {
      try {
        window.__mountEditor({ root, session: window.__session, host });
        return 'mounted';
      } catch (error) {
        return `${error.name}: ${error.message}`;
      }
    };
    return [
      attempt({ actions: [{ id: 'Share', label: 'Share', onSelect() {} }] }),
      attempt({ panels: [{ id: 'review', label: 'Review', mount() {} }] }),
      attempt({ labels: { title: 'Wrong' } }),
      attempt({ colorScheme: 'sepia' }),
      attempt({ saveLabel: 'Saved · revision 8' }),
      attempt({ actions: [{ id: 'share', label: 'Share', icon: 'rocket', onSelect() {} }] }),
    ];
  });
  assert.match(messages[0], /^TypeError: Each host action needs a unique lowercase id/u);
  assert.match(messages[1], /^TypeError: Each host panel needs a unique lowercase id/u);
  assert.match(messages[2], /^TypeError: Unknown host label: title/u);
  assert.match(messages[3], /^TypeError: Color scheme must be light, dark or null/u);
  assert.match(messages[4], /^TypeError: Host saveLabel must be a function/u);
  assert.match(messages[5], /^TypeError: Host action share uses an unknown icon: rocket/u);
});
