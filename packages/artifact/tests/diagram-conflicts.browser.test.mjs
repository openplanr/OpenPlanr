import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const playwright = requireProtocol('playwright');

test('two real owner pages compare base, current and pending edits without overwriting the other author', { skip: !enabled, timeout: 60_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-conflict-')));
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  await store.initialize(makeBundle('process'), { transactionId: 'conflict-fixture' });
  const owner = await startDiagramOwner({ root, slug: 'checkout', noOpen: true, env: { ...process.env, PLANR_HOME: join(root, 'home') } });
  const engine = process.env.PLANR_BROWSER_ENGINE ?? 'chromium';
  assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
  const errors = [];
  let browser;
  t.after(async () => { await browser?.close(); await owner.close(); await rm(root, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  browser = await playwright[engine].launch({ headless: true, ...(process.env.PLANR_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE } : {}) });
  const pages = await Promise.all([browser.newPage({ viewport: { width: 1440, height: 900 } }), browser.newPage({ viewport: { width: 1440, height: 900 } })]);
  for (const page of pages) {
    page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(owner.baseUrl); await page.locator('[data-editor-svg]').waitFor();
  }
  const [pending, current] = pages;
  async function rename(page, label) {
    await page.locator('[data-editor-svg] [data-element-id="node-b"]').click();
    await page.getByLabel('Label', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  }
  await rename(pending, 'My pending change');
  await rename(current, 'Another author confirmed');
  await current.getByRole('button', { name: 'Save diagram', exact: true }).click();
  await current.getByText('Saved', { exact: true }).waitFor();
  const authoritative = (await store.read()).bundle;
  await pending.getByRole('button', { name: 'Save diagram', exact: true }).click();
  await pending.getByText(/Conflict.*Unsaved/u).first().waitFor();
  const panel = pending.getByRole('dialog', { name: /compare|conflict/iu });
  await panel.waitFor();
  for (const text of ['Done', 'Another author confirmed', 'My pending change']) assert.ok((await panel.textContent()).includes(text), `Comparison shows ${text}`);
  assert.deepEqual((await store.read()).bundle, authoritative, 'A rejected stale save retains the current store revision');
  await panel.getByRole('button', { name: 'Keep my draft', exact: true }).click();
  assert.equal(await pending.locator('[data-editor-svg] [data-element-id="node-b"]').getAttribute('aria-label'), 'My pending change');
  await pending.reload(); await pending.locator('[data-editor-svg]').waitFor();
  assert.equal(await pending.locator('[data-editor-svg] [data-element-id="node-b"]').getAttribute('aria-label'), 'My pending change', 'Refresh retains the pending draft while another revision exists');
  assert.deepEqual((await store.read()).bundle, authoritative);
  await pending.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  await panel.waitFor();
  await panel.getByRole('button', { name: 'Use current revision…', exact: true }).click();
  await panel.getByRole('button', { name: 'Replace local draft', exact: true }).click();
  await pending.getByText('Saved', { exact: true }).waitFor();
  assert.equal(await pending.locator('[data-editor-svg] [data-element-id="node-b"]').getAttribute('aria-label'), 'Another author confirmed');
  assert.deepEqual((await store.read()).bundle, authoritative, 'Explicit draft disposal does not add or mutate a stored revision');
});
