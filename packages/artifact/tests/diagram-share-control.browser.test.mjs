import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';

const { build } = createRequire(new URL('../../protocol/package.json', import.meta.url))('esbuild');
const options = { skip: process.env.PLANR_BROWSER_TESTS !== '1', timeout: 30000 };
const revision = 'a'.repeat(64);
const initial = {
  ok: true,
  shared: false,
  title: 'Order handover',
  localRevision: revision,
  sourceDigest: `sha256:${'b'.repeat(64)}`,
  destination: 'https://share.test/',
  contents: { elements: 4, connections: 3, sourceKind: 'manifest' },
};
const confirmed = {
  ...initial,
  shared: true,
  hasUpdate: false,
  pendingAction: null,
  url: 'https://share.test/diagram/confirmed',
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(t, respond) {
  const entry = join(import.meta.dirname, '../lib/artifact/ui/diagram-share-control.mts');
  const built = await build({
    stdin: {
      contents: `import {mountDiagramShareControl} from ${JSON.stringify(entry)};window.__shareControl=mountDiagramShareControl({root:document.querySelector('#owner'),apiBase:'/api/share'});`,
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const requests = [];
  await page.route('https://owner.test/owner', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="owner"><button data-action="share-diagram">Share diagram</button></div>',
    }),
  );
  await page.route('https://owner.test/api/share', async (route) => {
    const request = route.request();
    const observed = {
      method: request.method(),
      ...(request.method() === 'POST' ? { body: request.postDataJSON() } : {}),
    };
    requests.push(observed);
    const response = await respond(observed);
    await route.fulfill({
      status: response.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
  await page.goto('https://owner.test/owner');
  await page.addScriptTag({ content: built.outputFiles[0].text });
  return {
    page,
    requests,
    dialog: page.getByRole('dialog', { name: 'Share diagram', exact: true }),
  };
}
async function assertOnlyPendingAction(dialog, action) {
  await dialog.getByRole('button', { name: `Retry ${action}`, exact: true }).waitFor();
  assert.deepEqual(await dialog.getByRole('button').allTextContents(), ['×', `Retry ${action}`]);
  assert.equal(await dialog.locator('input').count(), 0, 'Unconfirmed access is not displayed');
  assert.equal(
    await dialog.getByRole('button', { name: 'Publish revision', exact: true }).count(),
    0,
  );
  assert.equal(
    await dialog.getByRole('button', { name: 'Copy access token', exact: true }).count(),
    0,
  );
}

test(
  'interrupted creation refreshes custody and retries the exact action and revision once while busy',
  options,
  async (t) => {
    let status = initial,
      posts = 0;
    const retryStarted = deferred(),
      finishRetry = deferred();
    t.after(() => finishRetry.resolve());
    const { page, dialog, requests } = await fixture(t, async (request) => {
      if (request.method === 'GET') return { body: status };
      posts++;
      if (posts === 1) {
        status = {
          ...confirmed,
          pendingAction: 'create',
          hasUpdate: true,
          url: 'https://share.test/diagram/not-created',
        };
        return {
          status: 503,
          body: { ok: false, message: 'Creation could not be confirmed. Retry the same action.' },
        };
      }
      retryStarted.resolve();
      await finishRetry.promise;
      status = confirmed;
      return { body: confirmed };
    });
    await page.getByRole('button', { name: 'Share diagram', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create shared review', exact: true }).click();
    await assertOnlyPendingAction(dialog, 'create');
    assert.match(
      await dialog.getByRole('status').textContent(),
      /Creation could not be confirmed/u,
    );
    assert.equal(requests.filter((request) => request.method === 'GET').length, 2);
    await page.evaluate(() => {
      window.__retryButton = [...document.querySelectorAll('.diagram-share-dialog button')].find(
        (button) => button.textContent === 'Retry create',
      );
    });
    await dialog.getByRole('button', { name: 'Retry create', exact: true }).click();
    await retryStarted.promise;
    assert.equal(
      await dialog.getByRole('button', { name: 'Retry create', exact: true }).isDisabled(),
      true,
    );
    await page.evaluate(() => {
      [...document.querySelectorAll('.diagram-share-dialog button')]
        .find((button) => button.textContent === 'Retry create')
        .click();
      window.__retryButton.onclick();
      window.__retryButton.onclick();
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      posts,
      2,
      'Disabled controls and queued clicks do not submit a duplicate operation',
    );
    finishRetry.resolve();
    await dialog.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
    assert.deepEqual(
      requests.filter((request) => request.method === 'POST').map((request) => request.body),
      [
        { action: 'create', expectedRevision: revision },
        { action: 'create', expectedRevision: revision },
      ],
    );
    assert.equal(
      await dialog.getByRole('textbox', { name: 'Shared diagram link', exact: true }).inputValue(),
      confirmed.url,
    );
    assert.equal(
      await dialog.getByRole('button', { name: 'Retry create', exact: true }).count(),
      0,
    );
  },
);

test(
  'reopening a pending creation hides the unconfirmed link, token and publication controls',
  options,
  async (t) => {
    const pending = {
      ...confirmed,
      pendingAction: 'create',
      hasUpdate: true,
      url: 'https://share.test/diagram/not-created',
    };
    const { page, dialog, requests } = await fixture(t, () => ({ body: pending }));
    for (let opening = 0; opening < 2; opening++) {
      await page.getByRole('button', { name: 'Share diagram', exact: true }).click();
      await assertOnlyPendingAction(dialog, 'create');
      assert.match(await dialog.getByRole('status').textContent(), /Pending create/u);
      await dialog.getByRole('button', { name: 'Close share diagram', exact: true }).click();
    }
    assert.deepEqual(
      requests.map((request) => request.method),
      ['GET', 'GET'],
      'Opening Share only previews custody',
    );
  },
);

test(
  'pending rotation takes priority over local edits and restores publication controls after confirmation',
  options,
  async (t) => {
    const editedRevision = 'c'.repeat(64);
    let status = {
      ...confirmed,
      localRevision: editedRevision,
      hasUpdate: true,
      pendingAction: 'rotate',
    };
    const { page, dialog, requests } = await fixture(t, (request) => {
      if (request.method === 'POST') status = { ...status, pendingAction: null };
      return { body: status };
    });
    await page.getByRole('button', { name: 'Share diagram', exact: true }).click();
    await assertOnlyPendingAction(dialog, 'rotate');
    assert.match(await dialog.getByRole('status').textContent(), /Pending rotate/u);
    await dialog.getByRole('button', { name: 'Retry rotate', exact: true }).click();
    await dialog.getByRole('button', { name: 'Publish revision', exact: true }).waitFor();
    assert.equal(
      await dialog.getByRole('button', { name: 'Copy link', exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await dialog.getByRole('button', { name: 'Copy access token', exact: true }).isVisible(),
      true,
    );
    assert.match(
      await dialog.getByRole('status').textContent(),
      /Local changes are not published/u,
    );
    assert.deepEqual(
      requests.filter((request) => request.method === 'POST').map((request) => request.body),
      [{ action: 'rotate', expectedRevision: editedRevision }],
    );
  },
);

test(
  'a failed status preview offers Retry and refreshes without publishing',
  options,
  async (t) => {
    let reads = 0;
    const { page, dialog, requests } = await fixture(t, () =>
      ++reads === 1
        ? { status: 503, body: { ok: false, message: 'The local share status is unavailable.' } }
        : { body: initial },
    );
    await page.getByRole('button', { name: 'Share diagram', exact: true }).click();
    await dialog.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    assert.match(await dialog.getByRole('status').textContent(), /status is unavailable/u);
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create shared review', exact: true }).waitFor();
    assert.deepEqual(
      requests.map((request) => request.method),
      ['GET', 'GET'],
    );
  },
);
