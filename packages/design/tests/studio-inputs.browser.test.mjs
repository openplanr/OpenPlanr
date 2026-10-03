import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

test('direct, portable and local Studio preserve complete input and native file selection without same-origin authority', {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-studio-inputs-'));
  let browser, session, direct;
  try {
    const { file, document } = designFixture(root, {
      count: 2,
      frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
    });
    document.defaultView = 'prototype';
    writeFileSync(file, JSON.stringify(document));
    const sourcePath = join(root, document.screens[0].source.html);
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8').replace(
        '</main>',
        `<label>Question <textarea aria-label="Question"></textarea></label><label>CSV fixture <input type="file" accept=".csv" aria-label="CSV fixture" onchange="document.getElementById('selected-file').textContent=this.files[0]?.name||'No file selected'"></label><p id="selected-file">No file selected</p></main>`,
      ),
    );
    const csv = join(root, 'sample.csv');
    writeFileSync(csv, 'name,value\nexample,42\n');
    const rendered = await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      noOpen: true,
    });
    direct = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(readFileSync(sourcePath));
    });
    await new Promise((resolve) => direct.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser({ engine: 'chromium' });
    const question =
      'Which owners need to review the complete release plan before the scheduled customer rollout?';
    const title = 'Keep this complete edited workspace title';
    for (const [mode, url] of [
      ['direct', `http://127.0.0.1:${direct.address().port}/`],
      ['portable', pathToFileURL(rendered.views.prototype).href],
      ['local', session.url],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(url);
      let product = page;
      if (mode !== 'direct') {
        await page.waitForSelector('[data-design-ready="true"]');
        product = page.frameLocator('.planr-artifact-panel:not([hidden]) iframe');
        assert.equal(
          await page.locator('.planr-artifact-panel:not([hidden]) iframe').getAttribute('sandbox'),
          'allow-scripts allow-forms',
        );
        await page.locator('[data-design-actual-size]').click();
        await page.waitForFunction(
          () => window.__openPlanrDesignStudio.getState().inspectionScale === 'actual',
        );
      }
      const field = product.getByRole('textbox', { name: 'Question', exact: true });
      await field.focus();
      await page.keyboard.type(question);
      assert.equal(await field.inputValue(), question, `${mode}: complete native typing`);
      await field.press('ControlOrMeta+A');
      await page.keyboard.insertText(question);
      await field.press('Tab');
      await page.keyboard.press('Escape');
      assert.equal(await field.inputValue(), question, `${mode}: replacement, Tab and Escape`);
      if (mode !== 'portable') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
          origin: new URL(url).origin,
        });
        await page.evaluate((text) => navigator.clipboard.writeText(text), question);
        await field.focus();
        await field.press('ControlOrMeta+A');
        await field.press('ControlOrMeta+V');
        assert.equal(await field.inputValue(), question, `${mode}: native clipboard paste`);
      }
      const workspace = product.getByRole('textbox', { name: 'Workspace name', exact: true });
      await workspace.fill(title);
      await product.getByRole('button', { name: 'Save workspace', exact: true }).press('Enter');
      await product.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      const chooser = page.waitForEvent('filechooser');
      await product.getByLabel('CSV fixture', { exact: true }).click();
      await (await chooser).setFiles(csv);
      assert.equal(
        await product.locator('#selected-file').textContent(),
        'sample.csv',
        `${mode}: real file chooser reports the file`,
      );
      if (mode !== 'direct') {
        await page.locator('[data-design-screen="screen-2"]').click();
        await page.waitForFunction(
          () => window.__openPlanrDesignStudio.getState().screenId === 'screen-2',
        );
        await page.locator('[data-design-screen="screen-1"]').click();
        await page.waitForFunction(
          () => window.__openPlanrDesignStudio.getState().screenId === 'screen-1',
        );
        assert.equal(await field.inputValue(), question);
        assert.equal(await workspace.inputValue(), title);
        assert.equal(await product.getByRole('button', { name: 'Saved', exact: true }).count(), 1);
        assert.equal(await product.locator('#selected-file').textContent(), 'sample.csv');
        assert.ok((await page.locator('iframe[src], iframe[srcdoc]').count()) <= 3);
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    await session?.close();
    if (direct) await new Promise((resolve) => direct.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
