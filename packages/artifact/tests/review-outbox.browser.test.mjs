import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { bundleBrowserEntry } from '../scripts/generate-artifact-shell.mjs';

// A real origin and IndexedDB exercise browser transaction ordering across independent tabs.
test('review custody preserves concurrent operations, immutable retries and rejected entries', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/review-outbox.mjs', { globalName: 'Outbox' });
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
  const context = await browser.newContext();
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const page of pages) {
    await page.goto(url);
    await page.evaluate(() => {
      window.queue = Outbox.createReviewOutbox({
        scope: { workspaceId: 'room', revisionId: 'revision', actorId: 'reviewer' },
        leaseMs: 300,
      });
    });
  }
  await Promise.all(
    pages.map((page, index) =>
      page.evaluate(async (index) => {
        await Promise.all([
          queue.enqueue({
            operationId: `tab-${index}`,
            payload: { ciphertext: `encrypted-${index}` },
          }),
          queue.enqueue({ operationId: 'same-retry', payload: { ciphertext: 'original' } }),
        ]);
      }, index),
    ),
  );
  await pages[1].evaluate(() =>
    queue.enqueue({ operationId: 'same-retry', payload: { ciphertext: 'replacement' } }),
  );
  let entries = await pages[0].evaluate(() => queue.list());
  assert.equal(entries.length, 3);
  assert.equal(
    entries.find((entry) => entry.operationId === 'same-retry').payload.ciphertext,
    'original',
  );
  await pages[0].evaluate(async () => {
    await queue.enqueue({ operationId: 'a-permanent', payload: { ciphertext: 'rejected' } });
    await queue.enqueue({ operationId: 'b-offline', payload: { ciphertext: 'retry-exact' } });
  });
  const delivered = [];
  for (const page of pages) await page.exposeFunction('recordDelivery', (id) => delivered.push(id));
  await Promise.all(
    pages.map((page) =>
      page.evaluate(() =>
        queue.drain(async (entry) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (entry.operationId === 'a-permanent') return { status: 'rejected', code: '409' };
          if (entry.operationId === 'b-offline') return { status: 'retry', code: 'network' };
          await recordDelivery(entry.operationId);
          return { status: 'delivered' };
        }),
      ),
    ),
  );
  assert.deepEqual(delivered.sort(), ['same-retry', 'tab-0', 'tab-1']);
  entries = await pages[1].evaluate(() => queue.list());
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.operationId === 'a-permanent').status, 'quarantined');
  assert.equal(entries.find((entry) => entry.operationId === 'b-offline').attempts, 1);
  await pages[0].reload();
  await pages[0].evaluate(() => {
    window.queue = Outbox.createReviewOutbox({
      scope: { workspaceId: 'room', revisionId: 'revision', actorId: 'reviewer' },
      leaseMs: 300,
    });
  });
  assert.equal(
    (await pages[0].evaluate(() => queue.list())).length,
    2,
    'reload retains terminal and pending custody',
  );
  await pages[0].evaluate(async () => {
    await queue.retry('b-offline');
    await queue.drain(async (entry) => {
      if (entry.payload.ciphertext !== 'retry-exact') throw new Error('Ciphertext changed');
      return { status: 'delivered' };
    });
  });
  assert.equal((await pages[1].evaluate(() => queue.list())).length, 1);
  await pages[1].evaluate(async () => {
    window.other = Outbox.createReviewOutbox({
      scope: { workspaceId: 'room', revisionId: 'other', actorId: 'reviewer' },
    });
  });
  assert.deepEqual(
    await pages[1].evaluate(() => other.list()),
    [],
    'revision identity isolates custody',
  );
  await pages[1].evaluate(() => {
    other.close();
    queue.close();
  });
  await pages[0].evaluate(() => queue.close());
});

test('an expired lease is recovered after the sending tab closes', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/review-outbox.mjs', { globalName: 'Outbox' });
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
  const context = await browser.newContext();
  const a = await context.newPage(),
    b = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const page of [a, b]) {
    await page.goto(url);
    await page.evaluate(() => {
      window.queue = Outbox.createReviewOutbox({
        scope: { workspaceId: 'room', revisionId: 'revision', actorId: 'reviewer' },
        leaseMs: 300,
      });
    });
  }
  await a.evaluate(async () => {
    await queue.enqueue({ operationId: 'crash', payload: { ciphertext: 'retained' } });
    void queue.drain(async () => {
      window.claimed = true;
      return new Promise(() => {});
    });
  });
  await a.waitForFunction(() => window.claimed);
  await a.close();
  await b.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)));
  const recovered = await b.evaluate(async () => {
    const result = [];
    await queue.drain(async (entry) => {
      result.push(entry.operationId);
      return { status: 'delivered' };
    });
    return result;
  });
  assert.deepEqual(recovered, ['crash']);
  assert.deepEqual(await b.evaluate(() => queue.list()), []);
  await b.evaluate(() => queue.close());
});

test('malformed persistent custody is quarantined while valid bytes drain and asynchronous callbacks reject', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/review-outbox.mjs', { globalName: 'Outbox' });
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const scope = { workspaceId: 'corrupt-room', revisionId: 'revision', actorId: 'reviewer' };
    window.scope = scope;
    window.queue = Outbox.createReviewOutbox({ scope });
    await queue.enqueue({ operationId: 'valid', payload: { ciphertext: 'exact-immutable-bytes' } });
    const scopeKey = JSON.stringify(Object.values(scope));
    const open = indexedDB.open('openplanr-review-outbox-v1');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite'),
        store = tx.objectStore('operations');
      const row = (id) => ({
        key: JSON.stringify([scopeKey, id]),
        scopeKey,
        operationId: id,
        payload: { ciphertext: 'retained-' + id },
        status: 'pending',
        attempts: 0,
        createdAt: 1,
        nextAttemptAt: 0,
      });
      store.put({ ...row('bad-metadata'), attempts: 'not-a-number' });
      store.put({ ...row('bad-payload'), payload: null });
      store.put({ ...row('unknown-field'), secretUnexpectedMetadata: 'never-render-this-field' });
      const missingScope = row('missing-scope');
      delete missingScope.scopeKey;
      store.put(missingScope);
      store.put({ ...row('bad-lease'), leaseUntil: 100 });
      store.put({ ...row('foreign'), key: 'foreign-key', scopeKey: 'foreign-scope' });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  const rows = await page.evaluate(() => queue.list());
  assert.equal(
    rows.filter((row) => row.errorCode === 'malformed_custody' && row.status === 'quarantined')
      .length,
    5,
  );
  assert(
    !JSON.stringify(rows).includes('never-render-this-field'),
    'Malformed private metadata is retained without being exposed by list',
  );
  assert.equal(
    rows.find((row) => row.operationId === 'valid').payload.ciphertext,
    'exact-immutable-bytes',
  );
  const delivered = await page.evaluate(async () => {
    const received = [];
    await queue.drain(async (entry) => {
      received.push(entry.payload);
      return { status: 'delivered' };
    });
    await queue.retry('bad-payload');
    return received;
  });
  assert.deepEqual(delivered, [{ ciphertext: 'exact-immutable-bytes' }]);
  assert.equal(
    (await page.evaluate(() => queue.list())).filter((row) => row.status === 'quarantined').length,
    5,
    'Malformed custody cannot be retried into an unsafe pending state',
  );
  await page.evaluate(async () => {
    await queue.enqueue({ operationId: 'after-corruption', payload: { ciphertext: 'after' } });
    window.broken = Outbox.createReviewOutbox({
      scope,
      now: () => {
        throw Error('clock unavailable');
      },
    });
  });
  await assert.rejects(
    page.evaluate(() =>
      Promise.race([
        broken.drain(async () => ({ status: 'delivered' })),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error('callback did not settle')), 1500),
        ),
      ]),
    ),
    /clock unavailable/,
  );
  await page.evaluate(async () => {
    broken.close();
    await queue.drain(async () => ({ status: 'delivered' }));
    queue.close();
  });
});
