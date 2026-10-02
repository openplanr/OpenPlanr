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
  const first = page.frameLocator(`[data-planr-artifact-frame="${entry('screen-1').artifactId}"]`);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].some(
      (frame) => frame.dataset.planrBridgeTrusted === 'true',
    ),
  );
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
  await page.locator('[data-design-frame]').selectOption('mobile');
  await page.locator('[data-design-screen="screen-1"]').click();
  await page.locator('[data-design-frame]').selectOption('desktop');
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
