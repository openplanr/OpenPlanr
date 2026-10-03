import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderPrototypeStateBootstrap } from '../lib/artifact/ui/prototype-state.mjs';
import { bundleBrowserEntry } from '../scripts/generate-artifact-shell.mjs';

async function waitForAliasRestore(view, count = 1) {
  const body = await view.locator('body').elementHandle();
  const frame = await body.ownerFrame();
  try {
    await frame.waitForFunction((expected) => window.aliasCount >= expected, count, {
      timeout: 8000,
    });
  } catch (error) {
    const observed = await frame.evaluate(() => ({
      aliasCount: window.aliasCount,
      sessionFields: Object.keys(window.__OPENPLANR_PROTOTYPE_STATE__?.get() ?? {}),
      formLengths: [...document.querySelectorAll('input')].map(({ id, value }) => ({
        id,
        length: value.length,
      })),
    }));
    throw new Error(`Alias restore ${count} did not arrive: ${JSON.stringify(observed)}`, {
      cause: error,
    });
  } finally {
    await body.dispose();
  }
}

test('opaque prototype forms and bounded session state survive frame eviction', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/prototype-state.mjs', {
    globalName: 'State',
  });
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
      framesByView.push({
        frame,
        screenId: 'form',
        viewId: 'form-wide',
        nonce: 'n'.repeat(43),
      });
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
  await page.frames()[1].evaluate(() =>
    __OPENPLANR_PROTOTYPE_STATE__.set({
      selection: 'approved',
      localStep: 2,
    }),
  );
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

test('late nonce-bound restores preserve local input, API edits and reset across shared-view navigation', {
  timeout: 30_000,
}, async (t) => {
  const script = bundleBrowserEntry('lib/artifact/ui/prototype-state.mjs', {
    globalName: 'State',
  });
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
  const html = (id, nonce = id.repeat(43)) =>
    `<!doctype html><script>${renderPrototypeStateBootstrap({
      screenId: id,
      viewId: id,
      parentOrigin: url,
      nonce,
    })}</script><h1>${id}</h1><label>Name<input id="name"></label>`;
  await page.evaluate(
    ({ a, b }) => {
      window.updates = [];
      window.saved = [];
      window.framesByView = [];
      window.relay = State.createPrototypeStateRelay({
        contextId: 'revision-one',
        receiveOnly: true,
        frames: () =>
          framesByView.map(({ frame, ...identity }) => ({
            ...identity,
            window: frame.contentWindow,
          })),
      });
      addEventListener('message', (event) => {
        if (event.data?.type === 'openplanr:prototype-state')
          updates.push({
            origin: event.origin,
            source: event.source,
            data: event.data,
          });
      });
      window.openFrame = (id, source, nonce = id.repeat(43)) => {
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts allow-forms';
        frame.srcdoc = source;
        document.body.append(frame);
        framesByView.push({
          frame,
          screenId: id,
          viewId: id,
          nonce,
        });
      };
      openFrame('a', a);
      openFrame('b', b);
      // Hold the canonical host's initial restore, then deliver its exact bytes via native postMessage.
      relay.restore({
        screenId: 'a',
        viewId: 'a',
        nonce: 'a'.repeat(43),
        window: { postMessage: (data) => saved.push(data) },
      });
    },
    { a: html('a'), b: html('b') },
  );
  const a = page.frameLocator('iframe').nth(0),
    b = page.frameLocator('iframe').nth(1);
  await a.locator('#name').fill('Local A');
  await a
    .locator('body')
    .evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ agreed: true, removeLater: 'old' }));
  await page.waitForFunction(() =>
    updates.some((event) => event.data.state.session.agreed === true),
  );
  await a.locator('body').evaluate(() => {
    window.restored = 0;
    addEventListener('openplanr:prototype-state-restored', () => window.restored++);
  });
  await page.evaluate(() => framesByView[0].frame.contentWindow.postMessage(saved[0], '*'));
  await a.locator('body').evaluate(
    () =>
      window.restored ||
      new Promise((resolve) =>
        addEventListener('openplanr:prototype-state-restored', resolve, {
          once: true,
        }),
      ),
  );
  assert.equal(
    await a.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get().agreed),
    true,
    'An actual older restore must not erase a newer local session edit',
  );
  assert.equal(
    await a.locator('#name').inputValue(),
    'Local A',
    'A delayed initial restore preserves unacknowledged fields',
  );
  await a.locator('#name').fill('After delayed restore');
  // Edit B before it has observed A. Changed keys/forms must compose at the shared host.
  await b.locator('#name').fill('Local B');
  await b.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ independent: 'B' }));
  await page.waitForFunction(() =>
    updates.some((event) => event.data.state.session.independent === 'B'),
  );
  await page.evaluate(() => {
    for (const event of updates.splice(0)) relay.receive(event);
  });
  const shared = await page.evaluate(() => relay.snapshot());
  assert.equal(shared.session.agreed, true);
  assert.equal(shared.session.independent, 'B');
  assert.equal(shared.forms.a.name, 'After delayed restore');
  assert.equal(shared.forms.b.name, 'Local B');
  // Waiting for the acknowledgement event is legitimate transport completion, not value polling.
  await a.locator('body').evaluate(
    () =>
      new Promise((resolve) => {
        if (__OPENPLANR_PROTOTYPE_STATE__.get().independent === 'B') return resolve();
        addEventListener('openplanr:prototype-state-restored', resolve, {
          once: true,
        });
      }),
  );
  await a.locator('body').evaluate(() => {
    const next = __OPENPLANR_PROTOTYPE_STATE__.get();
    delete next.removeLater;
    __OPENPLANR_PROTOTYPE_STATE__.set(next);
  });
  await page.waitForFunction(() => updates.length > 0);
  await page.evaluate(() => {
    for (const event of updates.splice(0)) relay.receive(event);
  });
  assert.equal(
    Object.hasOwn((await page.evaluate(() => relay.snapshot())).session, 'removeLater'),
    false,
  );
  // Navigation/recreation uses the same revision's authoritative snapshot and a new nonce.
  await page.evaluate(() => {
    framesByView[1].frame.remove();
    framesByView.pop();
  });
  await page.evaluate(({ source, nonce }) => openFrame('b', source, nonce), {
    source: html('b', 'c'.repeat(43)),
    nonce: 'c'.repeat(43),
  });
  await b.locator('h1').waitFor();
  await b.locator('body').evaluate(() => {
    window.restored = 0;
    addEventListener('openplanr:prototype-state-restored', () => window.restored++);
  });
  await page.evaluate(() =>
    relay.restore({
      ...framesByView[1],
      window: framesByView[1].frame.contentWindow,
    }),
  );
  await b.locator('body').evaluate(
    () =>
      window.restored ||
      new Promise((resolve) =>
        addEventListener('openplanr:prototype-state-restored', resolve, {
          once: true,
        }),
      ),
  );
  assert.equal(
    await b.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get().agreed),
    true,
  );
  assert.equal(await b.locator('#name').inputValue(), 'Local B');
  // A stale restore cannot revive reset state, and the authoritative reset clears every view.
  await b.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.reset());
  await page.waitForFunction(() => updates.length > 0);
  await b.locator('body').evaluate(() => {
    window.delivered = false;
    addEventListener('message', (event) => {
      if (event.data?.type === 'openplanr:prototype-state:restore') window.delivered = true;
    });
  });
  await page.evaluate(() =>
    framesByView[1].frame.contentWindow.postMessage(
      {
        ...saved[0],
        screenId: 'b',
        viewId: 'b',
        nonce: 'c'.repeat(43),
        state: { session: { agreed: true }, forms: { b: { name: 'stale' } } },
      },
      '*',
    ),
  );
  await b
    .locator('body')
    .evaluate(
      () =>
        window.delivered ||
        new Promise((resolve) => addEventListener('message', resolve, { once: true })),
    );
  assert.deepEqual(await b.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get()), {});
  await page.evaluate(() => {
    for (const event of updates.splice(0)) relay.receive(event);
  });
  assert.deepEqual(await page.evaluate(() => relay.snapshot()), {
    session: {},
    forms: {},
  });
  await page.evaluate(() => {
    relay.dispose();
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision-two',
      receiveOnly: true,
      frames: () => [],
    });
  });
  assert.deepEqual(
    await page.evaluate(() => relay.snapshot()),
    { session: {}, forms: {} },
    'new revisions inherit no prior shared state',
  );
});

test('late legacy alias messages cannot replace seven edited fields after a canonical restore', {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const keys = ['title', 'question', 'description', 'kind', 'status', 'owner', 'notes'];
  const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'legacy', viewId: 'legacy-wide', parentOrigin: origin, nonce: 'l'.repeat(43) })}</script><h1>Legacy fields</h1>${keys.map((key) => `<label>${key}<input id="${key}"></label>`).join('')}<script>window.aliasCount=0;addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='fixture:restore')return;for(const key of ${JSON.stringify(keys)})document.getElementById(key).value=event.data.state[key]??'';window.aliasCount++})</script>`;
  await page.evaluate(
    ({ html, keys }) => {
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts allow-forms';
      frame.srcdoc = html;
      document.body.append(frame);
      window.frame = frame;
      window.events = [];
      window.saved = [];
      const identity = {
        screenId: 'legacy',
        viewId: 'legacy-wide',
        nonce: 'l'.repeat(43),
        aliases: { version: 1, restoreType: 'fixture:restore', fields: keys },
      };
      window.relay = State.createPrototypeStateRelay({
        contextId: 'legacy-revision',
        receiveOnly: true,
        frames: () => [{ ...identity, window: frame.contentWindow }],
      });
      addEventListener('message', (event) => {
        if (event.data?.type === 'openplanr:prototype-state')
          events.push({ origin: event.origin, source: event.source, data: event.data });
      });
      relay.restore({ ...identity, window: { postMessage: (data) => saved.push(data) } });
    },
    { html, keys },
  );
  const view = page.frameLocator('iframe');
  await view.locator('h1').waitFor();
  await page.evaluate(() => {
    for (const data of saved) frame.contentWindow.postMessage(data, '*');
  });
  await waitForAliasRestore(view);
  for (const key of keys) await view.locator(`#${key}`).fill(`Edited ${key}`);
  await page.evaluate(() => {
    for (const data of saved) frame.contentWindow.postMessage(data, '*');
  });
  await waitForAliasRestore(view, 2);
  for (const key of keys) assert.equal(await view.locator(`#${key}`).inputValue(), `Edited ${key}`);
  const session = await view.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get());
  for (const key of keys) assert.equal(session[key], `Edited ${key}`);
  await page.waitForFunction(() => events.at(-1)?.data.state.session.notes === 'Edited notes');
  await page.evaluate(() => {
    for (const event of events.splice(0)) relay.receive(event);
  });
  for (const key of keys)
    assert.equal((await page.evaluate(() => relay.snapshot())).session[key], `Edited ${key}`);
});

test('new bootstraps preserve old-host snapshot compatibility without downgrading an ordered host', {
  timeout: 30_000,
}, async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'legacy', viewId: 'legacy', parentOrigin: origin, nonce: 'x'.repeat(43) })}</script><input id="name"><script>window.restored=0;addEventListener('openplanr:prototype-state-restored',()=>window.restored++)</script>`;
  await page.evaluate((html) => {
    const f = document.createElement('iframe');
    f.sandbox = 'allow-scripts allow-forms';
    f.srcdoc = html;
    document.body.append(f);
    window.frame = f;
  }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('#name').fill('Local');
  await frame.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ agreed: true }));
  const base = {
    type: 'openplanr:prototype-state:restore',
    version: 1,
    nonce: 'x'.repeat(43),
    screenId: 'legacy',
    viewId: 'legacy',
  };
  await page.evaluate((data) => frame.contentWindow.postMessage(data, '*'), {
    ...base,
    state: { session: { legacy: 'remote' }, forms: { legacy: { name: 'Legacy host' } } },
  });
  await frame
    .locator('body')
    .evaluate(
      () =>
        window.restored ||
        new Promise((resolve) =>
          addEventListener('openplanr:prototype-state-restored', resolve, { once: true }),
        ),
    );
  assert.deepEqual(
    await frame.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get()),
    { legacy: 'remote' },
  );
  assert.equal(await frame.locator('#name').inputValue(), 'Legacy host');
  await page.evaluate((data) => frame.contentWindow.postMessage(data, '*'), {
    ...base,
    revision: 1,
    acknowledgedSequence: 0,
    state: { session: { ordered: true }, forms: { legacy: { name: 'Ordered host' } } },
  });
  await frame
    .locator('body')
    .evaluate(
      () =>
        window.restored >= 2 ||
        new Promise((resolve) =>
          addEventListener('openplanr:prototype-state-restored', resolve, { once: true }),
        ),
    );
  await frame.locator('body').evaluate(() => {
    window.delivered = false;
    addEventListener('message', () => (window.delivered = true));
  });
  await page.evaluate((data) => frame.contentWindow.postMessage(data, '*'), {
    ...base,
    state: { session: { legacy: 'downgrade' }, forms: { legacy: { name: 'Downgrade' } } },
  });
  await frame
    .locator('body')
    .evaluate(
      () =>
        window.delivered ||
        new Promise((resolve) => addEventListener('message', resolve, { once: true })),
    );
  assert.deepEqual(
    await frame.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get()),
    { ordered: true },
  );
  assert.equal(await frame.locator('#name').inputValue(), 'Ordered host');
});

test('first delayed alias configuration promotes earlier native input even after form acknowledgement', {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'early', viewId: 'early', parentOrigin: origin, nonce: 'e'.repeat(43) })}</script><input id="question"><script>window.aliasCount=0;addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='fixture:restore'){document.getElementById('question').value=event.data.state.question??'';aliasCount++}})</script>`;
  await page.evaluate((html) => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts allow-forms';
    frame.srcdoc = html;
    document.body.append(frame);
    window.frame = frame;
    window.events = [];
    window.saved = [];
    const identity = {
      screenId: 'early',
      viewId: 'early',
      nonce: 'e'.repeat(43),
      aliases: { version: 1, restoreType: 'fixture:restore', fields: ['question'] },
    };
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision',
      receiveOnly: true,
      frames: () => [],
    });
    relay.restore({ ...identity, window: { postMessage: (data) => saved.push(data) } });
    window.identity = identity;
    addEventListener('message', (event) => {
      if (event.data?.type === 'openplanr:prototype-state')
        events.push({ origin: event.origin, source: event.source, data: event.data });
    });
  }, html);
  const view = page.frameLocator('iframe');
  await view.locator('#question').fill('Typed before configuration');
  await page.waitForFunction(() => events.length > 0);
  const inputSequence = await page.evaluate(() => events.at(-1).data.sequence);
  // Deliver an authentic acknowledgement of the form while its aliases remain unknown.
  await page.evaluate((sequence) => {
    frame.contentWindow.postMessage(
      {
        ...saved[0],
        aliases: undefined,
        revision: 1,
        acknowledgedSequence: sequence,
        state: { session: {}, forms: { early: { question: 'Typed before configuration' } } },
      },
      '*',
    );
  }, inputSequence);
  await view.locator('body').evaluate(() => {
    window.nextRestore = new Promise((resolve) =>
      addEventListener('openplanr:prototype-state-restored', resolve, { once: true }),
    );
  });
  await page.evaluate((sequence) => {
    frame.contentWindow.postMessage(
      {
        ...saved[0],
        revision: 2,
        acknowledgedSequence: sequence,
        state: { session: {}, forms: { early: { question: 'Typed before configuration' } } },
      },
      '*',
    );
    frame.contentWindow.postMessage(saved[1], '*');
  }, inputSequence);
  await view.locator('body').evaluate(() => window.nextRestore);
  await waitForAliasRestore(view);
  assert.equal(await view.locator('#question').inputValue(), 'Typed before configuration');
  assert.equal(
    await view.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get().question),
    'Typed before configuration',
  );
  await page.waitForFunction(() =>
    events.some((event) => event.data.state.session.question === 'Typed before configuration'),
  );
  const promoted = await page.evaluate(
    () =>
      events.find((event) => event.data.state.session.question === 'Typed before configuration')
        .data,
  );
  assert.ok(promoted.sequence > inputSequence, 'Alias promotion uses a fresh local sequence');
  await page.evaluate(() => {
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision',
      receiveOnly: true,
      frames: () => [{ ...identity, window: frame.contentWindow }],
    });
    for (const event of events.splice(0)) relay.receive(event);
  });
  assert.equal(
    (await page.evaluate(() => relay.snapshot())).session.question,
    'Typed before configuration',
  );
});

test('a fresh host snapshot retries bounded rejected edits without another local input', {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const html = (id) =>
    `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: id, viewId: id, parentOrigin: origin, nonce: id.repeat(43) })}</script><h1>${id}</h1>`;
  await page.evaluate(
    ({ a, b }) => {
      window.framesByView = [];
      window.processed = [];
      window.includeB = false;
      window.relay = State.createPrototypeStateRelay({
        contextId: 'revision',
        receiveOnly: true,
        frames: () =>
          framesByView
            .filter((entry) => includeB || entry.viewId === 'a')
            .map(({ frame, ...identity }) => ({
              ...identity,
              window: frame.contentWindow,
            })),
      });
      for (const [id, source] of [
        ['a', a],
        ['b', b],
      ]) {
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts allow-forms';
        frame.srcdoc = source;
        document.body.append(frame);
        framesByView.push({ frame, screenId: id, viewId: id, nonce: id.repeat(43) });
      }
      addEventListener('message', (event) => {
        if (event.data?.type !== 'openplanr:prototype-state') return;
        if (event.data.screenId === 'b') window.includeB = true;
        const accepted = relay.receive(event);
        processed.push({ screenId: event.data.screenId, sequence: event.data.sequence, accepted });
      });
    },
    { a: html('a'), b: html('b') },
  );
  const a = page.frameLocator('iframe').nth(0),
    b = page.frameLocator('iframe').nth(1);
  await a.locator('h1').waitFor();
  await b.locator('h1').waitFor();
  // B's loaded frame is registered only for its first actual state message,
  // preserving its older local snapshot without intercepting native child events.
  await a
    .locator('body')
    .evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ a: 'x'.repeat(8192) }));
  await page.waitForFunction(() =>
    processed.some((entry) => entry.screenId === 'a' && entry.accepted),
  );
  await b
    .locator('body')
    .evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ b: 'y'.repeat(8192) }));
  await page.waitForFunction(() =>
    processed.some((entry) => entry.screenId === 'b' && !entry.accepted),
  );
  await a.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({}));
  await page.waitForFunction(() =>
    processed.some((entry) => entry.screenId === 'b' && entry.accepted),
  );
  assert.equal((await page.evaluate(() => relay.snapshot())).session.b, 'y'.repeat(8192));
  assert.equal(
    (await page.evaluate(() => processed.filter((entry) => entry.screenId === 'b'))).length,
    2,
    'One fresh restore retries the same local sequence once, without a timer',
  );
});

test('reset and newer explicit API keys retire pre-configuration native alias edits', {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  for (const action of ['reset', 'set', 'remote-clear']) {
    const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'form', viewId: 'form', parentOrigin: origin, nonce: 'r'.repeat(43) })}</script><input id="question"><script>window.aliasCount=0;addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='fixture:restore'){document.getElementById('question').value=event.data.state.question??'';aliasCount++}})</script>`;
    await page.evaluate((html) => {
      document.querySelector('iframe')?.remove();
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts allow-forms';
      frame.srcdoc = html;
      document.body.append(frame);
      window.frame = frame;
      window.saved = [];
      window.latestSequence = 0;
      addEventListener('message', (event) => {
        if (
          event.source === frame.contentWindow &&
          event.data?.type === 'openplanr:prototype-state'
        )
          window.latestSequence = event.data.sequence;
      });
      const relay = State.createPrototypeStateRelay({
        contextId: 'revision',
        receiveOnly: true,
        frames: () => [],
      });
      relay.restore({
        screenId: 'form',
        viewId: 'form',
        nonce: 'r'.repeat(43),
        aliases: { version: 1, restoreType: 'fixture:restore', fields: ['question'] },
        window: { postMessage: (data) => saved.push(data) },
      });
    }, html);
    const view = page.frameLocator('iframe');
    await view.locator('#question').fill('Earlier native text');
    await view.locator('body').evaluate((_element, action) => {
      if (action === 'reset') __OPENPLANR_PROTOTYPE_STATE__.reset();
      else if (action === 'set')
        __OPENPLANR_PROTOTYPE_STATE__.set({ question: 'Newer explicit API' });
    }, action);
    await page.waitForFunction(() => latestSequence > 0);
    await page.evaluate((action) => {
      for (const data of saved)
        frame.contentWindow.postMessage(
          action === 'remote-clear' && data.type === 'openplanr:prototype-state:restore'
            ? { ...data, revision: 2, acknowledgedSequence: latestSequence }
            : data,
          '*',
        );
    }, action);
    await waitForAliasRestore(view);
    assert.deepEqual(
      await view.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get()),
      action !== 'set' ? {} : { question: 'Newer explicit API' },
    );
    assert.equal(
      await view.locator('#question').inputValue(),
      action !== 'set' ? '' : 'Newer explicit API',
    );
  }
});

test('unsupported alias promotion preserves valid local form custody and can recover when capacity is freed', {
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
  page.setDefaultTimeout(8000);
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'form', viewId: 'form', parentOrigin: origin, nonce: 'f'.repeat(43) })}</script><input id="question"><input id="other"><input id="padding"><script>window.aliasCount=0;addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='fixture:restore'){document.getElementById('question').value=event.data.state.question??'';aliasCount++}})</script>`;
  await page.evaluate((html) => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts allow-forms';
    frame.srcdoc = html;
    document.body.append(frame);
    window.frame = frame;
    window.events = [];
    window.saved = [];
    const identity = {
      screenId: 'form',
      viewId: 'form',
      nonce: 'f'.repeat(43),
      aliases: { version: 1, restoreType: 'fixture:restore', fields: ['question'] },
    };
    window.identity = identity;
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision',
      receiveOnly: true,
      frames: () => [],
    });
    relay.restore({ ...identity, window: { postMessage: (data) => saved.push(data) } });
    addEventListener('message', (event) => {
      if (event.data?.type === 'openplanr:prototype-state')
        events.push({ origin: event.origin, source: event.source, data: event.data });
    });
  }, html);
  const view = page.frameLocator('iframe');
  await view.locator('#question').fill('q'.repeat(4000));
  await view.locator('#other').fill('o'.repeat(8192));
  await view.locator('#padding').fill('p'.repeat(500));
  await page.waitForFunction(() => events.at(-1)?.data.state.forms.form.padding?.length === 500);
  const before = await page.evaluate(() => events.at(-1).data.state);
  assert.ok(new TextEncoder().encode(JSON.stringify(before)).byteLength < 16_384);
  assert.ok(
    new TextEncoder().encode(JSON.stringify({ ...before, session: { question: 'q'.repeat(4000) } }))
      .byteLength > 16_384,
  );
  await page.evaluate(() => {
    for (const data of saved) frame.contentWindow.postMessage(data, '*');
  });
  await waitForAliasRestore(view);
  assert.equal(
    await view.locator('#question').inputValue(),
    'q'.repeat(4000),
    'Bound rejection must retain the valid local form',
  );
  assert.equal(await view.locator('#other').inputValue(), 'o'.repeat(8192));
  assert.deepEqual(
    await view.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get()),
    {},
    'The unsupported combined alias snapshot is not accepted',
  );
  await view.locator('#other').fill('');
  await page.evaluate(() => {
    frame.contentWindow.postMessage({ ...saved[0], revision: 1 }, '*');
    frame.contentWindow.postMessage(saved[1], '*');
  });
  await waitForAliasRestore(view, 2);
  assert.equal(await view.locator('#question').inputValue(), 'q'.repeat(4000));
  assert.equal(
    await view.locator('body').evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.get().question),
    'q'.repeat(4000),
  );
  await page.waitForFunction(() =>
    events.some((event) => event.data.state.session.question?.length === 4000),
  );
  await page.evaluate(() => {
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision',
      receiveOnly: true,
      frames: () => [{ ...identity, window: frame.contentWindow }],
    });
    for (const event of events.splice(0)) relay.receive(event);
  });
  assert.equal((await page.evaluate(() => relay.snapshot())).session.question, 'q'.repeat(4000));
});

test('same iframe and frozen nonce reload use trusted generations without accepting queued old-document state or restores', {
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
  page.setDefaultTimeout(8000);
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const html = `<!doctype html><script>${renderPrototypeStateBootstrap({ screenId: 'form', viewId: 'form', parentOrigin: origin, nonce: 'n'.repeat(43) })}</script><input id="question"><input id="long-note"><input id="agreed" type="checkbox"><script>window.restores=[];window.aliasMessages=0;addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='fixture:restore'){document.getElementById('long-note').value=event.data.state.question??'';aliasMessages++}});addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='openplanr:prototype-state:restore')restores.push(event.data)})</script>`;
  await page.evaluate((html) => {
    window.events = [];
    window.hold = false;
    window.loads = 0;
    window.replayPayload = null;
    window.replayResults = [];
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts allow-forms';
    window.frame = frame;
    window.originalWindow = null;
    window.identity = {
      screenId: 'form',
      viewId: 'form',
      nonce: 'n'.repeat(43),
      generation: null,
      aliases: { version: 1, restoreType: 'fixture:restore', fields: ['question'] },
    };
    window.relay = State.createPrototypeStateRelay({
      contextId: 'revision',
      receiveOnly: true,
      frames: () => [{ ...identity, window: frame.contentWindow }],
    });
    addEventListener('message', (event) => {
      if (
        event.source !== frame.contentWindow ||
        !event.data?.type?.startsWith('openplanr:prototype-state')
      )
        return;
      events.push(event);
      if (replayPayload && JSON.stringify(event.data) === JSON.stringify(replayPayload)) {
        replayResults.push({
          sameSource: event.source === frame.contentWindow,
          accepted: relay.receive(event),
        });
        replayPayload = null;
      } else if (!hold) relay.receive(event);
    });
    frame.addEventListener('load', () => {
      identity.generation = `trusted-challenge-${++loads}`;
      if (!hold) relay.restore({ ...identity, window: frame.contentWindow });
    });
    frame.srcdoc = html;
    document.body.append(frame);
  }, html);
  const view = page.frameLocator('iframe');
  await view.locator('#question').fill('Before reload');
  await view.locator('#agreed').check();
  await page.waitForFunction(
    () =>
      relay.snapshot().session.question === 'Before reload' && relay.snapshot().forms.form.agreed,
  );
  const oldRestore = await view
    .locator('body')
    .evaluate(() => restores.find((data) => data.documentId));
  await page.evaluate((html) => {
    window.oldEvent = events
      .filter((event) => event.data.type === 'openplanr:prototype-state' && event.data.generation)
      .at(-1);
    window.originalWindow = frame.contentWindow;
    hold = true;
    identity.generation = null;
    frame.srcdoc = html;
  }, html);
  await page.waitForFunction(() => loads === 2);
  assert.equal(
    await page.evaluate(() => frame.contentWindow === originalWindow),
    true,
    'The actual WindowProxy is reused',
  );
  // A real queued prior restore is delivered to the same target WindowProxy before
  // the new document is configured. Its documentId must prevent initialization.
  await view.locator('#long-note').fill('l'.repeat(5000));
  const unconfiguredAliases = await view.locator('body').evaluate(() => aliasMessages);
  const oldPayload = await page.evaluate(() => oldEvent.data);
  const replayFromCurrentDocument = async (data) => {
    await page.evaluate((data) => {
      window.replayPayload = data;
      window.replayResults = [];
    }, data);
    // Retain the old payload, but send it through the current native document.
    // The sender check must pass before these assertions test generation retirement.
    await view
      .locator('body')
      .evaluate((_element, { data, origin }) => parent.postMessage(data, origin), { data, origin });
    await page.waitForFunction(() => replayResults.length === 1);
    return page.evaluate(() => replayResults[0]);
  };
  assert.deepEqual(
    await replayFromCurrentDocument({
      ...oldPayload,
      type: 'openplanr:prototype-state:ready',
      generation: null,
    }),
    { sameSource: true, accepted: true },
    'A valid configuration request reaches the generation-aware branch',
  );
  await view.locator('body').evaluate((_element, documentId) => {
    if (
      restores.some(
        (data) => data.documentId === documentId && data.generation === 'trusted-challenge-2',
      )
    )
      return;
    return new Promise((resolve) =>
      addEventListener('message', (event) => {
        if (
          event.data?.documentId === documentId &&
          event.data.generation === 'trusted-challenge-2'
        )
          resolve();
      }),
    );
  }, oldPayload.documentId);
  await view
    .locator('body')
    .evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  assert.equal(await view.locator('body').evaluate(() => aliasMessages), unconfiguredAliases);
  assert.equal(
    await view.locator('#long-note').inputValue(),
    'l'.repeat(5000),
    'A targeted configuration cannot leak an untargeted legacy restore',
  );
  await page.evaluate((data) => frame.contentWindow.postMessage(data, '*'), oldRestore);
  await view.locator('#question').fill('Typed before new configuration');
  await view.locator('#agreed').check();
  await page.waitForFunction(() =>
    events.some(
      (event) =>
        event.data.generation === null &&
        event.data.state?.forms.form?.question === 'Typed before new configuration',
    ),
  );
  await page.evaluate(() => {
    const early = events
      .filter(
        (event) =>
          event.data.generation === null &&
          event.data.state?.forms.form?.question === 'Typed before new configuration',
      )
      .at(-1);
    hold = false;
    relay.receive(early);
  });
  await page.waitForFunction(
    () => relay.snapshot().session.question === 'Typed before new configuration',
  );
  assert.equal(await view.locator('#question').inputValue(), 'Typed before new configuration');
  assert.equal(
    await view.locator('#agreed').isChecked(),
    true,
    'Native edits before configuration retain their bounded form custody',
  );
  assert.deepEqual(
    await replayFromCurrentDocument(oldPayload),
    { sameSource: true, accepted: false },
    'An accepted-shape prior payload cannot overwrite new state even with a current native sender',
  );
  assert.deepEqual(
    await replayFromCurrentDocument({
      ...oldPayload,
      generation: undefined,
      documentId: undefined,
    }),
    { sameSource: true, accepted: false },
    'Stripped old fields cannot downgrade modern custody',
  );
  await page.evaluate((data) => frame.contentWindow.postMessage(data, '*'), oldRestore);
  await view
    .locator('body')
    .evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  assert.equal(await view.locator('#question').inputValue(), 'Typed before new configuration');
  assert.equal(
    (await page.evaluate(() => relay.snapshot())).session.question,
    'Typed before new configuration',
  );
});
