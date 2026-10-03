import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareArtifactDocument } from '../lib/artifact/browser-sandbox.mjs';

test('opaque prototypes initialize bounded state before authored scripts and bind navigation', {
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
  const origin = `http://127.0.0.1:${server.address().port}`,
    nonce = Buffer.alloc(32, 11).toString('base64url');
  await page.goto(origin);
  const html = prepareArtifactDocument({
    html: '<!doctype html><input id="name"><input id="password" type="password"><input id="hidden" type="hidden"><a id="next" data-design-target="next-screen">Next</a><script>window.startedAfterBootstrap=!!__OPENPLANR_PROTOTYPE_STATE__;</script>',
    artifactId: 'test-view',
    nonce,
    parentOrigin: origin,
    allowLocalForms: true,
    prototypeState: true,
    screenId: 'test-screen',
  }).html;
  await page.evaluate((html) => {
    window.messages = [];
    window.addEventListener('message', (e) => messages.push(e.data));
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts allow-forms';
    frame.srcdoc = html;
    document.body.append(frame);
  }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('#name').fill('Alice');
  await frame.locator('#password').fill('private');
  assert.equal(await page.frames()[1].evaluate(() => startedAfterBootstrap), true);
  await frame.locator('#next').click();
  await page.waitForFunction(() => messages.some((x) => x.type === 'navigate'));
  const messages = await page.evaluate(() => messages);
  assert.deepEqual(
    messages.find((x) => x.type === 'navigate'),
    {
      schemaVersion: '1.0.0',
      channel: nonce,
      type: 'navigate',
      viewId: 'test-view',
      screenId: 'next-screen',
    },
  );
  assert.deepEqual(
    messages.filter((x) => x.type === 'openplanr:prototype-state').at(-1).state.forms['test-view'],
    { name: 'Alice' },
  );
});

test('generated opaque-frame guards preserve worker constructors and controlled denials', {
  timeout: 30_000,
}, async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await launchBrowser();
  let page;
  t.after(async () => {
    try {
      await page?.close();
    } finally {
      await browser.close();
    }
  });
  page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const externalRequests = [];
  page.on('request', (request) => {
    if (/^https?:/u.test(request.url()) && !request.url().startsWith(`${origin}/`))
      externalRequests.push(request.url());
  });
  await page.goto(origin);
  const sharedSupported = await page.evaluate(() => typeof SharedWorker === 'function');
  const html = prepareArtifactDocument({
    artifactId: 'worker-constructors',
    nonce: Buffer.alloc(32, 12).toString('base64url'),
    parentOrigin: origin,
    html: `<!doctype html><body><script>
      (async () => {
        const result = { opaqueOrigin: location.origin === 'null' };
        const outcome = (run) => {
          try { run(); return { name: null, message: null }; }
          catch (error) { return { name: error.name, message: error.message }; }
        };
        result.workerConstructor = outcome(() => Reflect.construct(Object, [], Worker));
        result.workerDenied = outcome(() => new Worker('https://worker-denied.invalid/code.js'));
        const source = URL.createObjectURL(new Blob([
          'onmessage = async event => { let denied; try { await fetch("https://worker-denied.invalid/probe"); } catch (error) { denied = error.name; } postMessage({ value: event.data * 2, denied }); };'
        ], { type: 'text/javascript' }));
        result.workerModuleDenied = outcome(() => new Worker(source, { type: 'module' }));
        result.sharedSupported = typeof SharedWorker === 'function';
        if (result.sharedSupported) {
          result.sharedConstructor = outcome(() => Reflect.construct(Object, [], SharedWorker));
          result.sharedDenied = outcome(() => new SharedWorker('https://worker-denied.invalid/code.js'));
          result.sharedModuleDenied = outcome(() => new SharedWorker(source, { type: 'module' }));
          const sharedSource = 'data:text/javascript,' + encodeURIComponent(
            'onconnect = event => { const port = event.ports[0]; port.onmessage = async message => { let denied; try { await fetch("https://worker-denied.invalid/probe"); } catch (error) { denied = error.name; } port.postMessage({ value: message.data * 2, denied }); close(); }; port.start(); };'
          );
          result.shared = await new Promise(resolve => {
            let worker;
            const finish = value => {
              clearTimeout(timer);
              worker?.port.close();
              resolve(value);
            };
            const timer = setTimeout(() => finish({ error: 'shared-worker-timeout' }), 5_000);
            try {
              worker = new SharedWorker(sharedSource, { name: 'guarded-shared' });
              result.sharedInstance = worker instanceof SharedWorker;
              worker.port.onmessage = event => finish(event.data);
              worker.onerror = event => { event.preventDefault(); finish({ error: 'shared-worker-error', message: event.message, filename: event.filename, lineno: event.lineno }); };
              worker.port.start();
              worker.port.postMessage(21);
            } catch (error) { finish({ constructionError: { name: error.name, message: error.message } }); }
          });
        }
        result.worker = await new Promise(resolve => {
          let worker;
          const finish = value => {
            clearTimeout(timer);
            worker?.terminate();
            resolve(value);
          };
          const timer = setTimeout(() => finish({ error: 'worker-timeout' }), 5_000);
          try {
            worker = new Worker(source, { name: 'guarded-compute' });
            result.workerInstance = worker instanceof Worker;
            worker.onmessage = event => finish(event.data);
            worker.onerror = event => { event.preventDefault(); finish({ error: 'worker-error' }); };
            worker.postMessage(21);
          } catch (error) { finish({ error: error.name }); }
        });
        URL.revokeObjectURL(source);
        document.body.dataset.workerResult = JSON.stringify(result);
      })();
    </script></body>`,
  }).html;
  await page.evaluate((html) => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.srcdoc = html;
    document.body.append(frame);
  }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('body[data-worker-result]').waitFor({ state: 'attached', timeout: 10_000 });
  const result = JSON.parse(await frame.locator('body').getAttribute('data-worker-result'));
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(result.opaqueOrigin, true);
  assert.equal(result.sharedSupported, sharedSupported);
  assert.equal(result.workerConstructor.name, null, JSON.stringify(result.workerConstructor));
  assert.equal(result.workerInstance, true);
  assert.deepEqual(result.worker, { value: 42, denied: 'SecurityError' });
  const controlledDenial = {
    name: 'SecurityError',
    message: 'Blocked by OpenPlanr artifact sandbox',
  };
  assert.deepEqual(result.workerDenied, controlledDenial);
  assert.deepEqual(result.workerModuleDenied, controlledDenial);
  if (result.sharedSupported) {
    assert.equal(result.sharedConstructor.name, null, JSON.stringify(result.sharedConstructor));
    assert.deepEqual(result.sharedDenied, controlledDenial);
    assert.deepEqual(result.sharedModuleDenied, controlledDenial);
    if (result.shared.constructionError) {
      // Chrome and Firefox forbid SharedWorker storage at an opaque origin;
      // WebKit allows it. Preserve native policy without accepting a guard denial.
      assert.equal(result.sharedInstance, undefined);
      assert.equal(result.shared.constructionError.name, 'SecurityError');
      assert.notEqual(result.shared.constructionError.message, controlledDenial.message);
    } else {
      assert.equal(result.sharedInstance, true);
      assert.deepEqual(result.shared, { value: 42, denied: 'SecurityError' });
    }
  }
  assert.deepEqual(externalRequests, []);
});
