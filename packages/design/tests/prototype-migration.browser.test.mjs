import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createArtifactReview } from '@openplanr/artifact/review.mjs';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import {
  currentDesign,
  renderDesignDocument,
  standaloneDesignHtml,
} from '../lib/design/document.mjs';
import { importDesignFeedback } from '../lib/design/feedback-import.mjs';
import { readDesignFeedback } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

// These are caller-owned aliases, not a customer-specific runtime or protocol.
const fields = [
  'answer-title',
  'annotation',
  'tags',
  'dataset-name',
  'question',
  'name',
  'org-name',
];
const aliases = { version: 1, restoreType: 'fixture:prototype-state', fields };
test('standard Studio preserves seven legacy prototype fields and explicitly bound offline notes', {
  timeout: 60_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'studio-prototype-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root, { count: 3 });
  const firstSource = join(root, 'source/screen-1.html');
  writeFileSync(
    firstSource,
    readFileSync(firstSource, 'utf8').replace(
      '</main>',
      `<form>${fields.map((field) => `<label>${field}<input id="${field}"></label>`).join('')}<input type="password" id="password"><button type="submit">Continue with values</button></form><script>document.querySelector('form').addEventListener('submit', event => {event.preventDefault();parent.postMessage({type:'fixture:prototype-update',values:{question:'Untrusted legacy update'}},'*');document.querySelector('[data-design-navigate]').click()})</script></main>`,
    ),
  );
  const secondSource = join(root, 'source/screen-2.html');
  writeFileSync(
    secondSource,
    readFileSync(secondSource, 'utf8').replace(
      '</main>',
      `${fields.map((field) => `<p data-fixture-field="${field}"></p>`).join('')}<script>addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='fixture:prototype-state')return;for(const [key,value] of Object.entries(event.data.state))document.querySelectorAll('[data-fixture-field="'+key+'"]').forEach(node=>node.textContent=value)});parent.postMessage({type:'fixture:prototype-request'},'*')</script></main>`,
    ),
  );
  const originalSources = [firstSource, secondSource].map((path) => readFileSync(path));
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const portable = join(root, 'standard-studio.html');
  writeFileSync(
    portable,
    standaloneDesignHtml(current, 'prototype', {
      prototypeStateAliases: Object.fromEntries(
        current.document.screenOrder.map((id) => [id, aliases]),
      ),
    }),
  );
  const browser = await launchBrowser({ engine: browserEngine() });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.migrationMessages = [];
    addEventListener('message', (event) => {
      migrationMessages.push({
        origin: event.origin,
        type: event.data?.type,
        screenId: event.data?.screenId,
        viewId: event.data?.viewId,
        channel: event.data?.channel,
        nonce: event.data?.nonce,
      });
    });
  });
  await page.goto(pathToFileURL(portable).href);
  await page.waitForSelector('[data-design-ready=true]');
  const entry = (screen) =>
    current.entries.find((item) => item.screenId === screen && item.frameId === 'desktop');
  const firstId = entry('screen-1').artifactId;
  const firstElement = page.locator(`[data-planr-artifact-frame="${firstId}"]`);
  const first = page.frameLocator(`[data-planr-artifact-frame="${firstId}"]`);
  const waitForSelection = (screenId, frameId) =>
    page.waitForFunction(
      ({ screenId, frameId }) => {
        const state = __openPlanrDesignStudio.getState();
        const stage = __openPlanrArtifactStage;
        const frame = stage.getFrame(stage.getState().activeArtifactId);
        return (
          state.screenId === screenId &&
          state.frameId === frameId &&
          !document.querySelector('[data-design-screen-loading]') &&
          frame?.dataset.planrFrameState === 'ready' &&
          frame.dataset.planrBridgeTrusted === 'true'
        );
      },
      { screenId, frameId },
    );
  await waitForSelection('screen-1', 'desktop');
  const originalFrameSource = await firstElement.getAttribute('src');
  await page.evaluate((id) => {
    window.originalPrototypeFrame = __openPlanrArtifactStage.getFrame(id);
    window.originalPrototypeWindow = originalPrototypeFrame.contentWindow;
    window.originalPrototypeNonce = originalPrototypeFrame.__openPlanrBridge.getPrototypeNonce();
    window.originalPrototypeGeneration =
      originalPrototypeFrame.__openPlanrBridge.getPrototypeGeneration();
  }, firstId);
  assert.ok(originalFrameSource?.startsWith('blob:'), 'The original authored document is loaded');
  for (const field of fields) await first.locator(`#${field}`).fill(`Edited ${field}`);
  await first.locator('#password').fill('Private field excluded');
  await first.getByRole('button', { name: 'Continue with values', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(() => __openPlanrDesignStudio.getState().screenId === 'screen-2', null, {
      timeout: 8000,
    })
    .catch(async (error) => {
      throw new Error(
        error.message +
          '\n' +
          JSON.stringify(
            await page.evaluate(() => ({
              messages: migrationMessages.map(({ channel, nonce, ...message }) => ({
                ...message,
                channelLength: channel?.length,
                nonceLength: nonce?.length,
              })),
              state: __openPlanrDesignStudio.getState(),
              frames: [...document.querySelectorAll('iframe')].map((frame) => ({
                id: frame.dataset.planrArtifactFrame,
                trusted: frame.dataset.planrBridgeTrusted,
                nonce: !!frame.__openPlanrBridge?.getPrototypeNonce?.(),
              })),
            })),
          ) +
          '\n' +
          errors.join('; '),
      );
    });
  const second = page.frameLocator(`[data-planr-artifact-frame="${entry('screen-2').artifactId}"]`);
  for (const field of fields)
    await second
      .locator(`[data-fixture-field="${field}"]`)
      .getByText(`Edited ${field}`, { exact: true })
      .waitFor();
  await page.locator('[data-design-screen="screen-3"]').click();
  await waitForSelection('screen-3', 'desktop');
  await page.locator('[data-design-frame]').selectOption('mobile');
  await waitForSelection('screen-3', 'mobile');
  await page.waitForFunction((id) => {
    const frame = document.querySelector(`[data-planr-artifact-frame="${id}"]`);
    return (
      frame?.dataset.planrFrameState === 'unloaded' &&
      !frame.hasAttribute('src') &&
      !frame.hasAttribute('srcdoc')
    );
  }, firstId);
  await page.locator('[data-design-screen="screen-1"]').click();
  await waitForSelection('screen-1', 'mobile');
  await page.locator('[data-design-frame]').selectOption('desktop');
  await waitForSelection('screen-1', 'desktop');
  assert.notEqual(
    await firstElement.getAttribute('src'),
    originalFrameSource,
    'The evicted authored document is remounted with a new source URL',
  );
  assert.deepEqual(
    await page.evaluate((id) => {
      const frame = __openPlanrArtifactStage.getFrame(id);
      return {
        sameFrame: frame === originalPrototypeFrame,
        sameWindow: frame.contentWindow === originalPrototypeWindow,
        sameNonce: frame.__openPlanrBridge.getPrototypeNonce() === originalPrototypeNonce,
        freshGeneration:
          frame.__openPlanrBridge.getPrototypeGeneration() !== originalPrototypeGeneration,
      };
    }, firstId),
    { sameFrame: true, sameWindow: true, sameNonce: true, freshGeneration: true },
  );
  const remounted = await (await firstElement.elementHandle()).contentFrame();
  assert.ok(remounted, 'The remounted authored document has a browser frame');
  // Authentication completes before the asynchronous prototype restore is delivered.
  await remounted.waitForFunction(
    (fields) =>
      fields.every((field) => document.getElementById(field)?.value === `Edited ${field}`),
    fields,
    { timeout: 8000 },
  );
  for (const field of fields)
    assert.equal(await first.locator(`#${field}`).inputValue(), `Edited ${field}`);
  assert.equal(
    await first.locator('#password').inputValue(),
    '',
    'Private fields do not survive eviction',
  );
  assert.ok(
    (await page.locator('iframe[src],iframe[srcdoc]').count()) <= 3,
    'Standard bounded frame budget is retained',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [firstSource, secondSource].map((path) => readFileSync(path)),
    originalSources,
  );
  // Legacy notes are kept unchanged. Conversion occurs only in a detached, explicit original-bundle mapping.
  const note = {
    screenId: 'screen-1',
    frameId: 'desktop',
    x: 0.2,
    y: 0.3,
    author: 'Synthetic reviewer',
    comment: 'Keep this offline note.',
  };
  const notesFile = join(root, 'legacy-notes.json');
  writeFileSync(notesFile, JSON.stringify([note]));
  const originalNotes = readFileSync(notesFile);
  const artifact = entry(note.screenId);
  const viewport = current.document.frames.find((frame) => frame.id === note.frameId);
  const time = '2026-10-02T09:00:00.000Z';
  const review = createArtifactReview({
    reviewId: 'explicit-prototype-migration',
    reviewOf: digestArtifactEnvelope(current.envelope),
    decision: 'pending',
    overall: '',
    createdAt: time,
    updatedAt: time,
    pins: [
      {
        id: 'offline-note',
        artifactId: artifact.artifactId,
        author: { name: note.author },
        comment: note.comment,
        region: { x: note.x, y: note.y, w: 0, h: 0 },
        viewport: { width: viewport.width, height: viewport.height },
        intent: 'improve',
        status: 'open',
        createdAt: time,
        updatedAt: time,
        replies: [],
      },
    ],
  });
  const input = join(root, 'canonical-review.json');
  writeFileSync(input, JSON.stringify(review));
  const env = { ...process.env, PLANR_HOME: join(root, 'private-home') };
  await importDesignFeedback(file, { input, revision: current.revision, env });
  await importDesignFeedback(file, { input, revision: current.revision, env });
  const imported = readDesignFeedback(file, env);
  assert.equal(imported.pins.length, 1);
  assert.equal(imported.pins[0].comment, note.comment);
  assert.deepEqual(imported.pins[0].region, review.pins[0].region);
  assert.equal(imported.ledger.reviews[0].review.decision, 'pending');
  assert.deepEqual(readFileSync(notesFile), originalNotes);
});
