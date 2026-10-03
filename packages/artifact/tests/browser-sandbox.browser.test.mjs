import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { assertPreviewBridgeMessage } from '@openplanr/protocol/sharing-security-contracts';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareArtifactDocument } from '../lib/artifact/browser-sandbox.mjs';
import { renderAuthoredDiagramSvg } from '../lib/artifact/diagram/authoring/renderer.mjs';

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

test('opt-in review selection toggles in the same opaque document without changing prototype input', {
  timeout: 30_000,
}, async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Selection host</title>');
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
  page = await browser.newPage({ hasTouch: true });
  const origin = `http://127.0.0.1:${server.address().port}`,
    nonce = Buffer.alloc(32, 14).toString('base64url');
  await page.goto(origin);
  const bundle = makeBundle();
  bundle.document.annotations = [];
  bundle.document.accessibility.readingOrder = bundle.document.accessibility.readingOrder.filter(
    (id) => id !== 'note-a',
  );
  bundle.presentation.elements = bundle.presentation.elements.filter(
    ({ elementId }) => elementId !== 'note-a',
  );
  const rendered = renderAuthoredDiagramSvg(sealBundle(bundle));
  assert.equal(rendered.ok, true);
  const html =
    '<!doctype html><form><input id="answer" data-planr-id="answer" name="answer"><button id="choose" type="button" data-planr-id="choice"><span id="nested">Choose</span></button></form><a id="next" href="#next" data-planr-id="next-link" data-design-target="next-screen" style="display:inline-block;margin-top:24px;padding:12px 16px;line-height:20px">Next</a><script>window.choices=0;window.originalInput=document.querySelector("#answer");window.originalButton=document.querySelector("#choose");document.querySelector("#choose").addEventListener("click",()=>window.choices++);addEventListener("message",event=>{if(event.data?.type==="fixture:barrier")parent.postMessage({type:"fixture:barrier",id:event.data.id},"*")});</script>' +
    rendered.svg +
    '<script>window.originalSvg=document.querySelector("svg");window.diagramClicks=0;originalSvg.addEventListener("click",()=>window.diagramClicks++);</script>';
  const documents = [false, true].map(
    (reviewSelection) =>
      prepareArtifactDocument({
        html,
        artifactId: reviewSelection ? 'selected-view' : 'interact-view',
        nonce,
        parentOrigin: origin,
        allowLocalForms: true,
        prototypeState: true,
        screenId: 'test-screen',
        reviewSelection,
      }).html,
  );
  await page.evaluate(
    ({ documents, origin }) => {
      window.messages = [];
      window.addEventListener('message', (event) => {
        messages.push({ data: event.data, origin: event.origin });
      });
      documents.forEach((html, index) => {
        const frame = document.createElement('iframe');
        frame.id = index ? 'selected' : 'interact';
        frame.sandbox = 'allow-scripts allow-forms';
        frame.srcdoc = html;
        document.body.append(frame);
      });
      const sibling = document.createElement('iframe');
      sibling.id = 'sibling';
      sibling.src = `${origin}/sibling`;
      document.body.append(sibling);
    },
    { documents, origin },
  );
  const interact = page.frameLocator('#interact'),
    selected = page.frameLocator('#selected'),
    command = {
      schemaVersion: '1.0.0',
      type: 'openplanr:review-selection',
      channel: nonce,
      viewId: 'selected-view',
      enabled: true,
    };
  let barrier = 0;
  const control = async (id, commands) => {
    const token = `control-${++barrier}`;
    await page.evaluate(
      ({ id, commands, token }) => {
        const target = document.getElementById(id).contentWindow;
        for (const command of commands) target.postMessage(command, '*');
        target.postMessage({ type: 'fixture:barrier', id: token }, '*');
      },
      { id, commands, token },
    );
    // A later native message acknowledges delivery order, not selection success.
    await page.waitForFunction(
      (token) => messages.some(({ data }) => data.type === 'fixture:barrier' && data.id === token),
      token,
      { timeout: 7_000 },
    );
  };
  await interact.locator('#answer').fill('Unopted input');
  await selected.locator('#answer').fill('Unsaved answer');
  await selected.locator('[data-element-id="node-a"] tspan').click();
  assert.equal(await selected.locator('body').evaluate(() => diagramClicks), 1);
  await selected.locator('#nested').click();
  assert.equal(
    await selected.locator('body').evaluate(() => choices),
    1,
    'an opted-in frame starts in Interact',
  );
  await selected
    .locator('body')
    .evaluate(() => __OPENPLANR_PROTOTYPE_STATE__.set({ agreed: true, draft: 'Unsaved session' }));
  await page.waitForFunction(
    () =>
      messages.some(
        ({ data }) =>
          data.type === 'openplanr:prototype-state' &&
          data.viewId === 'selected-view' &&
          data.state.forms['selected-view']?.answer === 'Unsaved answer' &&
          data.state.session.agreed === true,
      ),
    undefined,
    { timeout: 7_000 },
  );

  await control('interact', [{ ...command, viewId: 'interact-view' }]);
  await interact.locator('#nested').click();
  assert.equal(await interact.locator('body').evaluate(() => choices), 1);
  assert.equal(
    await page.evaluate(() => messages.filter(({ data }) => data.type === 'select').length),
    0,
  );

  await page
    .frameLocator('#sibling')
    .locator('title')
    .waitFor({ state: 'attached', timeout: 7_000 });
  await page
    .frames()
    .find((frame) => frame.url().endsWith('/sibling'))
    .evaluate((command) => {
      parent.document.querySelector('#selected').contentWindow.postMessage(command, '*');
    }, command);
  await control('selected', [
    { ...command, channel: Buffer.alloc(32, 15).toString('base64url') },
    { ...command, viewId: 'stale-view' },
    { ...command, enabled: 'true' },
    { ...command, fetch: 'https://forged.example.com' },
  ]);
  await selected.locator('#nested').click();
  assert.equal(
    await selected.locator('body').evaluate(() => choices),
    2,
    'forged controls cannot acquire selection',
  );
  assert.equal(
    await page.evaluate(() => messages.filter(({ data }) => data.type === 'select').length),
    0,
  );

  await control('selected', [command]);
  await selected.locator('#nested').click();
  await page.waitForFunction(() => messages.some(({ data }) => data.type === 'select'), undefined, {
    timeout: 7_000,
  });
  const emitted = await page.evaluate(() => messages.find(({ data }) => data.type === 'select'));
  assert.equal(emitted.origin, 'null');
  assert.deepEqual(emitted.data, {
    schemaVersion: '1.0.0',
    channel: nonce,
    type: 'select',
    viewId: 'selected-view',
    elementId: 'choice',
  });
  assert.equal(assertPreviewBridgeMessage(emitted.data).type, 'select');
  await selected.locator('[data-element-id="node-a"] tspan').tap();
  await selected.locator('[data-element-id="edge-a"] tspan').click();
  await page.waitForFunction(
    () =>
      ['node-a', 'edge-a'].every((elementId) =>
        messages.some(({ data }) => data.type === 'select' && data.elementId === elementId),
      ),
    undefined,
    { timeout: 7_000 },
  );
  const diagramSelections = await page.evaluate(() =>
    messages.filter(
      ({ data }) => data.type === 'select' && ['node-a', 'edge-a'].includes(data.elementId),
    ),
  );
  assert.deepEqual(
    diagramSelections.map(({ data, origin }) => {
      assertPreviewBridgeMessage(data);
      assert.equal(origin, 'null');
      assert.equal(data.channel, nonce);
      return { viewId: data.viewId, elementId: data.elementId };
    }),
    [
      { viewId: 'selected-view', elementId: 'node-a' },
      { viewId: 'selected-view', elementId: 'edge-a' },
    ],
  );
  assert.equal(await selected.locator('body').evaluate(() => diagramClicks), 1);
  assert.equal(
    await selected.locator('body').evaluate(() => choices),
    2,
    'selection does not execute authored handlers',
  );
  await selected.locator('#next').tap();
  await page.waitForFunction(
    () => messages.some(({ data }) => data.type === 'select' && data.elementId === 'next-link'),
    undefined,
    { timeout: 7_000 },
  );
  assert.equal(
    await page.evaluate(() => messages.filter(({ data }) => data.type === 'navigate').length),
    0,
  );
  await control('selected', [{ ...command, enabled: false, viewId: 'stale-view' }]);
  await selected.locator('#nested').click();
  assert.equal(
    await selected.locator('body').evaluate(() => choices),
    2,
    'a stale disable cannot change the active mode',
  );

  await control('selected', [{ ...command, enabled: false }]);
  await selected.locator('#nested').click();
  await selected.locator('#next').click();
  await page.waitForFunction(
    () => messages.some(({ data }) => data.type === 'navigate'),
    undefined,
    { timeout: 7_000 },
  );
  assert.deepEqual(
    await selected.locator('body').evaluate(() => ({
      choices,
      answer: document.querySelector('#answer').value,
      inputRetained: document.querySelector('#answer') === originalInput,
      buttonRetained: document.querySelector('#choose') === originalButton,
      session: __OPENPLANR_PROTOTYPE_STATE__.get(),
    })),
    {
      choices: 3,
      answer: 'Unsaved answer',
      inputRetained: true,
      buttonRetained: true,
      session: { agreed: true, draft: 'Unsaved session' },
    },
  );
  await selected.locator('[data-element-id="node-a"] tspan').click();
  assert.deepEqual(
    await selected.locator('body').evaluate(() => ({
      clicks: diagramClicks,
      retained: document.querySelector('svg') === originalSvg,
    })),
    { clicks: 2, retained: true },
  );
  assert.equal(
    await page.locator('#selected').getAttribute('sandbox'),
    'allow-scripts allow-forms',
  );
});
