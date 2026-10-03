import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { assertPreviewBridgeMessage } from '@openplanr/protocol/sharing-security-contracts';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareArtifactDocument } from '../lib/artifact/browser-sandbox.mjs';
import { ARTIFACT_SHELL_CSS } from '../lib/artifact/ui/shell.mjs';
import { loadArtifactTheme, renderArtifactThemeCss } from '../lib/artifact/ui/tokens.mjs';

const options = { skip: process.env.PLANR_BROWSER_TESTS !== '1', timeout: 30_000 };
const { build } = createRequire(new URL('../../protocol/package.json', import.meta.url))('esbuild');
const nonce = Buffer.alloc(32, 22).toString('base64url');

async function fixture(t) {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const compiled = await build({
    stdin: {
      contents: `
        import { createElement as h, useEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { assertPreviewBridgeMessage } from ${JSON.stringify(new URL('../../protocol/src/sharing-security-contracts.mjs', import.meta.url).pathname)};
        import { StudioToolbar, StudioMenu, StudioButton, StudioPanelDialog } from ${JSON.stringify(new URL('../lib/artifact/ui/studio-shell-components.mjs', import.meta.url).pathname)};
        const operations = [];
        let selected = () => {};
        function App() {
          const [open, setOpen] = useState(false);
          const [actionsOpen, setActionsOpen] = useState(false);
          useEffect(() => {
            selected = () => setActionsOpen(false);
            return () => { selected = () => {}; };
          }, []);
          return h('div', null,
            h(StudioToolbar, { kind: 'design', title: 'Canvas review', actions: h('div', { style: { display: 'flex', gap: 8 } },
              h(StudioMenu, { label: 'Actions', open: actionsOpen, onOpenChange: setActionsOpen, items: [
                { id: 'first', label: 'First action', onSelect: () => operations.push('first') },
                { id: 'disabled', label: 'Disabled action', disabled: true },
                { id: 'last', label: 'Last action', onSelect: () => operations.push('last') },
              ] }),
              h(StudioButton, { 'data-planr-action': 'feedback', onClick: () => setOpen(true) }, 'Open review dialog')) }),
            h(StudioPanelDialog, { open, onOpenChange: setOpen, title: 'Review',
              // Like mountStudioPanelDialogs, this controlled caller owns its stable return target.
              onCloseAutoFocus: event => {
                event.preventDefault();
                document.querySelector('[data-planr-action=feedback]')?.focus({ preventScroll: true });
              },
              children: h('button', null, 'Review action') }),
          );
        }
        window.fixture = { operations, frame: document.querySelector('#preview'), messages: [] };
        document.querySelector('#canvas').addEventListener('click', () => operations.push('canvas'));
        addEventListener('message', event => {
          if (event.source === fixture.frame.contentWindow && event.origin === 'null') {
            fixture.messages.push(event.data);
            // The host dismisses chrome only after its existing bound selection is validated.
            let message;
            try { message = assertPreviewBridgeMessage(event.data); } catch { return; }
            if (message.type === 'select' && message.channel === ${JSON.stringify(nonce)} && message.viewId === 'menu-view' && message.elementId === 'choice') selected();
          }
        });
        createRoot(document.querySelector('#toolbar')).render(h(App));
      `,
      resolveDir: import.meta.dirname,
      sourcefile: 'studio-menu-native-fixture.mjs',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  let page;
  const errors = [];
  t.after(async () => {
    try {
      await page?.close();
    } finally {
      await browser.close();
    }
    assert.deepEqual(errors, []);
  });
  t.diagnostic(`${browserEngine()}: ${browser.version()}`);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    // Observe this gesture's native focus before the prepared selection handler;
    // Firefox may focus the document rather than its clicked button.
    window.nativeChoiceFocus = null;
    addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.closest('#shape'))
          window.nativeChoiceFocus = document.activeElement;
      },
      true,
    );
  });
  page.setDefaultTimeout(7_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${origin}/menu`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Canonical toolbar actions</title><body><div id="toolbar"></div><main style="padding:32px"><button id="canvas">Select canvas shape</button><iframe id="preview" title="Opaque canvas" sandbox="allow-scripts allow-forms" style="display:block;margin-top:24px;width:700px;height:420px;border:0"></iframe></main></body></html>',
    }),
  );
  await page.goto(`${origin}/menu`);
  await page.addStyleTag({
    content: renderArtifactThemeCss(loadArtifactTheme()) + ARTIFACT_SHELL_CSS,
  });
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.getByRole('button', { name: 'Actions', exact: true }).waitFor();
  const html = prepareArtifactDocument({
    artifactId: 'menu-view',
    nonce,
    parentOrigin: origin,
    reviewSelection: true,
    prototypeState: true,
    allowLocalForms: true,
    html: '<!doctype html><input id="answer" aria-label="Canvas answer"><button data-planr-id="choice" id="shape" style="display:block;margin:36px;padding:20px"><span>Select opaque shape</span></button><script>window.originalInput=document.querySelector("#answer");addEventListener("message",event=>{if(event.data?.type==="fixture:barrier")parent.postMessage({type:"fixture:barrier"},"*")});</script>',
  }).html;
  await page.locator('#preview').evaluate((frame, html) => {
    frame.srcdoc = html;
  }, html);
  await page
    .frameLocator('#preview')
    .getByRole('textbox', { name: 'Canvas answer' })
    .fill('Unsaved canvas input');
  await page.evaluate(
    ({ nonce }) => {
      fixture.frame.contentWindow.postMessage(
        {
          schemaVersion: '1.0.0',
          type: 'openplanr:review-selection',
          channel: nonce,
          viewId: 'menu-view',
          enabled: true,
        },
        '*',
      );
      fixture.frame.contentWindow.postMessage({ type: 'fixture:barrier' }, '*');
    },
    { nonce },
  );
  await page.waitForFunction(() =>
    fixture.messages.some((message) => message.type === 'fixture:barrier'),
  );
  return page;
}

async function openMenu(page) {
  await page.getByRole('button', { name: 'Actions', exact: true }).press('ArrowDown');
  await page.getByRole('menu').waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'First action');
}

test(
  'canonical toolbar actions retain Arrow, Enter, Escape and trigger focus',
  options,
  async (t) => {
    const page = await fixture(t);
    await openMenu(page);
    assert.notEqual(
      await page.locator('body').evaluate((body) => body.style.pointerEvents),
      'none',
    );
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Last action');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Actions',
    );
    assert.deepEqual(await page.evaluate(() => fixture.operations), ['last']);
    await openMenu(page);
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Actions',
    );
    assert.deepEqual(await page.evaluate(() => fixture.operations), ['last']);
  },
);

test(
  'one native outside gesture dismisses actions and reaches local and opaque canvas targets',
  options,
  async (t) => {
    const page = await fixture(t);
    await openMenu(page);
    assert.notEqual(
      await page.locator('body').evaluate((body) => body.style.pointerEvents),
      'none',
    );
    await page.getByRole('button', { name: 'Select canvas shape', exact: true }).click();
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.operations), ['canvas']);
    await openMenu(page);
    await page
      .frameLocator('#preview')
      .getByRole('button', { name: 'Select opaque shape' })
      .click();
    await page.waitForFunction(() => fixture.messages.some((message) => message.type === 'select'));
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => document.activeElement === fixture.frame),
      true,
      'trusted canvas dismissal must retain authored-frame focus',
    );
    assert.equal(
      await page
        .frameLocator('#preview')
        .locator('#shape')
        .evaluate(
          () =>
            Boolean(nativeChoiceFocus) &&
            document.hasFocus() &&
            document.activeElement === nativeChoiceFocus,
        ),
      true,
      'closing actions must retain the same native authored focus observed at selection',
    );
    const selections = await page.evaluate(() =>
      fixture.messages.filter((message) => message.type === 'select'),
    );
    assert.equal(selections.length, 1, 'one gesture reaches the semantic target once');
    assert.deepEqual(assertPreviewBridgeMessage(selections[0]), {
      schemaVersion: '1.0.0',
      channel: nonce,
      type: 'select',
      viewId: 'menu-view',
      elementId: 'choice',
    });
    assert.equal(
      await page.evaluate(() => document.querySelector('#preview') === fixture.frame),
      true,
    );
    assert.equal(
      await page
        .frameLocator('#preview')
        .locator('#answer')
        .evaluate((input) => input === originalInput && input.value === 'Unsaved canvas input'),
      true,
    );
    assert.equal(
      await page.locator('#preview').getAttribute('sandbox'),
      'allow-scripts allow-forms',
    );
    assert.equal(
      await page
        .frameLocator('#preview')
        .locator('body')
        .evaluate(() => location.origin),
      'null',
    );
  },
);

test(
  'canonical review dialogs retain modal pointer locking, Tab containment and Escape return',
  options,
  async (t) => {
    const page = await fixture(t);
    await page.getByRole('button', { name: 'Open review dialog' }).click();
    await page.getByRole('dialog', { name: 'Review', exact: true }).waitFor();
    assert.equal(await page.locator('body').evaluate((body) => body.style.pointerEvents), 'none');
    await page.getByRole('button', { name: 'Review action', exact: true }).press('Tab');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Close review',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Open review dialog');
    assert.notEqual(
      await page.locator('body').evaluate((body) => body.style.pointerEvents),
      'none',
    );
  },
);
