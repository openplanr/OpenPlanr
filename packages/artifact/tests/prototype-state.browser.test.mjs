import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderPrototypeStateBootstrap } from '../lib/artifact/ui/prototype-state.mjs';
import { bundleBrowserEntry } from '../scripts/generate-artifact-shell.mjs';

test('opaque prototype forms and bounded session state survive frame eviction', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/prototype-state.mjs', { globalName: 'State' });
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/runtime.js' ? 'text/javascript' : 'text/html');
    res.end(
      req.url === '/runtime.js' ? script : '<!doctype html><script src="/runtime.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const bootstrap = renderPrototypeStateBootstrap({
    screenId: 'form',
    viewId: 'form-wide',
    parentOrigin: url,
    nonce: 'n'.repeat(43),
  });
  const html = `<!doctype html><script>${bootstrap}</script><label>Name<input id="name"></label><input id="secret" type="password"><input id="hidden" type="hidden" value="private"><input id="private" data-planr-state-private value="private"><input id="agreed" type="checkbox">`;
  await page.evaluate((html) => {
    window.framesByView = [];
    window.relay = State.createPrototypeStateRelay({
      contextId: 'document:revision',
      frames: () =>
        framesByView.map(({ frame, ...identity }) => ({
          ...identity,
          window: frame.contentWindow,
        })),
    });
    window.openFrame = () => {
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts allow-forms';
      frame.srcdoc = html;
      document.body.append(frame);
      framesByView.push({ frame, screenId: 'form', viewId: 'form-wide', nonce: 'n'.repeat(43) });
    };
    openFrame();
  }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('#name').fill('Persisted person');
  await frame.locator('#agreed').check();
  await frame.locator('#secret').fill('excluded');
  await page.waitForFunction(
    () => relay.snapshot().forms['form-wide']?.name === 'Persisted person',
  );
  await page
    .frames()[1]
    .evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ selection: 'approved', localStep: 2 }));
  await page.waitForFunction(() => relay.snapshot().session.selection === 'approved');
  const state = await page.evaluate(() => relay.snapshot());
  assert.deepEqual(Object.keys(state.forms['form-wide']).sort(), ['agreed', 'name']);
  await page.evaluate(() => {
    framesByView[0].frame.remove();
    framesByView.length = 0;
    openFrame();
  });
  await page.waitForFunction(() => framesByView[0].frame.contentWindow !== null);
  await frame.locator('#name').waitFor();
  await page.waitForFunction(() => relay.snapshot().session.selection === 'approved');
  assert.equal(await frame.locator('#name').inputValue(), 'Persisted person');
  assert.equal(await frame.locator('#agreed').isChecked(), true);
  assert.equal(
    await page.frames()[1].evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get().localStep),
    2,
  );
  await page.evaluate(() => relay.dispose());
});
