import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { bundleBrowserEntry } from '../scripts/generate-artifact-shell.mjs';

test('stage paste custody survives lost receipt and browser reload, then restores its private receipt without another upload', {
  timeout: 30000,
}, async (t) => {
  const runtime = bundleBrowserEntry('lib/artifact/ui/durable-paste-share.mjs', {
      globalName: 'Durable',
    }),
    share = bundleBrowserEntry('lib/artifact/share-client.mjs', { globalName: 'Share' }),
    outbox = bundleBrowserEntry('lib/artifact/ui/review-outbox.mjs', { globalName: 'Outbox' });
  const body = `<!doctype html><script src="/outbox.js"></script><script src="/share.js"></script><script src="/runtime.js"></script><script>
 window.preparations=0;
 window.scope={workspaceId:'/review/fixture',revisionId:'fixture-review',actorId:'local-paste-owner'};
 window.handler=Durable.createDurablePasteShare({scope:()=>scope,create:request=>{preparations++;return Share.createReviewLink({hello:'Private prototype fixture'},{...request,baseUrl:location.origin,yes:true,short:true});},commit:prepared=>Share.commitArtifactPaste(prepared)});
 window.request={transport:'short',ttl:'7d'};
 window.inspect=async()=>{const queue=Outbox.createReviewOutbox({scope:{...scope,revisionId:'fixture-review:7d'},databaseName:'openplanr-paste-custody-v1'});try{return await queue.list();}finally{queue.close();}};
 </script>`;
  let writes = 0,
    exact,
    privateToken;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v2/pastes') {
      let text = '';
      for await (const bytes of req) text += bytes;
      writes++;
      if (exact) {
        assert.equal(text, exact);
        assert.equal(req.headers['x-openplanr-paste-custody'], privateToken);
      } else {
        exact = text;
        privateToken = req.headers['x-openplanr-paste-custody'];
      }
      const value = JSON.parse(text);
      assert.ok(!text.includes('Private prototype fixture'));
      assert.equal(typeof privateToken, 'string');
      assert.ok(!text.includes(privateToken));
      if (writes === 1) {
        req.socket.destroy();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          schemaVersion: '2.0.0',
          operation: 'created',
          id: value.id,
          creationId: value.creationId,
          deletionToken: privateToken,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      return;
    }
    const scripts = { '/runtime.js': runtime, '/share.js': share, '/outbox.js': outbox };
    res.setHeader('content-type', scripts[req.url] ? 'text/javascript' : 'text/html');
    res.end(scripts[req.url] ?? body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const failed = await page.evaluate(async () => {
    try {
      await handler.run(request);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(failed, true);
  assert.equal(writes, 1);
  const pending = await page.evaluate(() => inspect());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].payload.kind, 'prepared-paste');
  assert.equal(pending[0].payload.prepared.custodyToken, privateToken);
  await page.reload();
  const created = await page.evaluate(() => handler.run(request));
  assert.equal(writes, 2);
  assert.equal(await page.evaluate(() => preparations), 0);
  assert.ok(!created.url.includes(privateToken));
  await page.reload();
  const restored = await page.evaluate(() => handler.run(request));
  assert.equal(restored.url, created.url);
  assert.equal(writes, 2);
  assert.equal(await page.evaluate(() => preparations), 0);
  const retained = await page.evaluate(() => inspect());
  assert.equal(retained.length, 1);
  assert.equal(retained[0].payload.kind, 'paste-receipt');
  assert.equal(retained[0].status, 'quarantined');
  await page.evaluate(() => handler.close());
});
