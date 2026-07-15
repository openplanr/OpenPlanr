import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  ARTIFACT_BRIDGE_CHANNEL,
  ARTIFACT_BRIDGE_VERSION,
  ARTIFACT_EXPORT_MAX_EDGE,
  ARTIFACT_LAYOUT_MAX_HEIGHT,
  ARTIFACT_LAYOUT_MAX_WIDTH,
  artifactContentSecurityPolicy,
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
  validateArtifactBridgeMessage,
} from '../../lib/artifact/bridge.mjs';
import { createArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import {
  closeArtifactReviewServers,
  startArtifactReview,
} from '../../lib/artifact/review-server.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const runBrowser = process.env.PLANR_BROWSER_TESTS === '1'
  || process.env.npm_lifecycle_event === 'test:artifact:browser';
const browserEngine = process.env.PLANR_BROWSER_ENGINE || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(browserEngine)) {
  throw new Error(`PLANR_BROWSER_ENGINE must be chromium, firefox, or webkit; received ${browserEngine}.`);
}
if (process.env.PLANR_REQUIRE_BROWSER === '1' && !runBrowser) {
  throw new Error('PLANR_REQUIRE_BROWSER requires the hostile artifact browser test to run.');
}

const homes = new Set();

afterEach(async () => {
  await closeArtifactReviewServers();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
  homes.clear();
});

function isolatedEnv() {
  const home = mkdtempSync(join(tmpdir(), 'planr-hostile-browser-'));
  homes.add(home);
  return { ...process.env, PLANR_HOME: home };
}

function bridgeMessage(nonce, overrides = {}) {
  return {
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    type: 'anchor.result',
    nonce,
    artifactId: 'main',
    requestId: 'request-12345678',
    anchor: {
      planrId: 'checkout.pay',
      screen: 'checkout',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      viewport: { width: 800, height: 600 },
    },
    ...overrides,
  };
}

test('artifact execution copy injects the earliest CSP and rejects bypass markup', () => {
  const nonce = createArtifactBridgeNonce();
  const prepared = prepareArtifactDocument({
    html: '<!doctype html><html><head><meta charset="utf-8"></head><body><button data-planr-id="pay">Pay</button><script>document.body.dataset.ran="yes"</script></body></html>',
    artifactId: 'main',
    nonce,
    parentOrigin: 'http://127.0.0.1:41000',
    scriptNonce: 'A'.repeat(24),
  });

  assert.equal(prepared.csp, artifactContentSecurityPolicy('A'.repeat(24)));
  assert.match(prepared.csp, /connect-src 'none'/);
  assert.match(prepared.csp, /worker-src data: blob:/);
  assert.match(prepared.csp, /form-action 'none'/);
  assert.ok(
    prepared.html.indexOf('Content-Security-Policy') < prepared.html.indexOf('<script'),
    'CSP precedes the injected bridge and every packaged script',
  );
  assert.match(prepared.html, /injectedScript\?\.remove\(\)/);
  assert.match(prepared.html, /nonce="A{24}"/);

  for (const html of [
    '<!doctype html><html><head></head><body><form></form></body></html>',
    '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body></body></html>',
    '<!doctype html><html><head></head><body><iframe srcdoc="x"></iframe></body></html>',
    '<!doctype html><html><head><style>@import "https://evil.test/x.css"</style></head><body></body></html>',
  ]) {
    assert.throws(
      () => prepareArtifactDocument({
        html,
        artifactId: 'main',
        nonce,
        parentOrigin: 'http://127.0.0.1:41000',
      }),
      (error) => error.code === ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
    );
  }
});

test('bridge validator requires exact source nonce schema artifact request and bounded geometry', () => {
  const nonce = createArtifactBridgeNonce();
  const source = {};
  const requestId = 'request-12345678';
  const contract = {
    source,
    nonce,
    artifactId: 'main',
    viewport: { width: 800, height: 600 },
    pendingRequestIds: new Set([requestId]),
    pendingChallengeIds: new Set([requestId]),
  };
  const validEvent = { source, origin: 'null', data: bridgeMessage(nonce) };
  const valid = validateArtifactBridgeMessage(validEvent, contract);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.anchor.rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(Object.isFrozen(valid.value.anchor), true);

  const challenge = validateArtifactBridgeMessage({
    source,
    origin: 'null',
    data: {
      channel: ARTIFACT_BRIDGE_CHANNEL,
      schemaVersion: ARTIFACT_BRIDGE_VERSION,
      type: 'bridge.challenge-ack',
      nonce,
      artifactId: 'main',
      requestId,
    },
  }, contract);
  assert.equal(challenge.ok, true);
  assert.equal(challenge.value.authenticated, true);

  const failures = [
    [{ ...validEvent, source: {} }, contract, 'source'],
    [{ ...validEvent, origin: 'http://127.0.0.1:41000' }, contract, 'origin'],
    [{ ...validEvent, data: bridgeMessage('B'.repeat(43)) }, contract, 'nonce'],
    [{ ...validEvent, data: bridgeMessage(nonce, { artifactId: 'other' }) }, contract, 'artifact'],
    [{ ...validEvent, data: { ...bridgeMessage(nonce), extra: true } }, contract, 'schema'],
    [{ ...validEvent, data: bridgeMessage(nonce, { requestId: 'request-missing' }) }, contract, 'request'],
    [validEvent, { ...contract, pendingRequestIds: undefined }, 'request'],
    [{ ...validEvent, data: bridgeMessage(nonce, {
      anchor: { ...bridgeMessage(nonce).anchor, viewport: { width: 801, height: 600 } },
    }) }, contract, 'viewport'],
    [{ ...validEvent, data: bridgeMessage(nonce, {
      anchor: { ...bridgeMessage(nonce).anchor, rect: { x: 750, y: 20, width: 100, height: 40 } },
    }) }, contract, 'geometry'],
    [{ ...validEvent, data: bridgeMessage(nonce, {
      anchor: { ...bridgeMessage(nonce).anchor, rect: { x: Number.NaN, y: 20, width: 100, height: 40 } },
    }) }, contract, 'geometry'],
  ];
  for (const [event, options, reason] of failures) {
    const result = validateArtifactBridgeMessage(event, options);
    assert.deepEqual(
      { ok: result.ok, reason: result.reason, fallback: result.fallback },
      { ok: false, reason, fallback: 'coordinates' },
    );
  }

  const noChallengeSet = validateArtifactBridgeMessage({
    source,
    origin: 'null',
    data: challenge.value && {
      channel: ARTIFACT_BRIDGE_CHANNEL,
      schemaVersion: ARTIFACT_BRIDGE_VERSION,
      type: 'bridge.challenge-ack',
      nonce,
      artifactId: 'main',
      requestId,
    },
  }, { ...contract, pendingChallengeIds: undefined });
  assert.equal(noChallengeSet.ok, false);
  assert.equal(noChallengeSet.reason, 'request');
});

test('bridge validator bounds authenticated PNG export responses', () => {
  const nonce = createArtifactBridgeNonce();
  const source = {};
  const requestId = 'request-export-1';
  const options = {
    source,
    nonce,
    artifactId: 'main',
    viewport: { width: 800, height: 600 },
    pendingRequestIds: new Set([requestId]),
    pendingChallengeIds: new Set(),
  };
  const data = {
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    type: 'export.result',
    nonce,
    artifactId: 'main',
    requestId,
    dataUrl: 'data:image/png;base64,aA==',
    width: 800,
    height: 600,
    label: 'checkout',
  };
  const valid = validateArtifactBridgeMessage({ source, origin: 'null', data }, options);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.label, 'checkout');
  assert.equal(Object.isFrozen(valid.value), true);
  for (const [change, reason] of [
    [{ dataUrl: 'data:text/html;base64,aA==' }, 'export'],
    [{ width: ARTIFACT_EXPORT_MAX_EDGE + 1 }, 'export'],
    [{ label: '' }, 'export'],
    [{ requestId: 'request-other' }, 'request'],
    [{ extra: true }, 'schema'],
  ]) {
    const result = validateArtifactBridgeMessage({
      source, origin: 'null', data: { ...data, ...change },
    }, options);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test('bridge validator accepts only nonce-bound document layout measurements within hard ceilings', () => {
  const nonce = createArtifactBridgeNonce();
  const source = {};
  const options = {
    source,
    nonce,
    artifactId: 'main',
    viewport: { width: 800, height: 600 },
    pendingRequestIds: new Set(),
    pendingChallengeIds: new Set(),
  };
  const data = {
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    type: 'layout.measurement',
    nonce,
    artifactId: 'main',
    layout: { width: 1440, height: 48_000 },
  };
  const valid = validateArtifactBridgeMessage({ source, origin: 'null', data }, options);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.layout, { width: 1440, height: 48_000 });
  assert.equal(valid.value.authenticated, true);

  for (const malformed of [
    { ...data, nonce: 'B'.repeat(43) },
    { ...data, layout: { width: ARTIFACT_LAYOUT_MAX_WIDTH + 1, height: 100 } },
    { ...data, layout: { width: 100, height: ARTIFACT_LAYOUT_MAX_HEIGHT + 1 } },
    { ...data, layout: { width: 100, height: Number.NaN } },
    { ...data, layout: { width: 100, height: 200 }, extra: true },
  ]) {
    assert.equal(validateArtifactBridgeMessage({ source, origin: 'null', data: malformed }, options).ok, false);
  }
});

test('parent runtime sends nonce-free challenges and keeps the nonce closure-private', () => {
  const nonce = createArtifactBridgeNonce();
  const runtime = renderArtifactParentRuntime({
    artifactBaseUrl: '/r/session/token/artifacts/',
    stageRuntimeUrl: '/r/session/token/stage.js',
    nonce,
  });
  assert.doesNotThrow(() => new Function(runtime));
  assert.match(runtime, /type:'bridge\.challenge',artifactId:artifact\.id,requestId:id/);
  assert.doesNotMatch(runtime, /type:'bridge\.challenge'[^}]*nonce/);
  assert.match(runtime, /pendingChallenge/);
  assert.match(runtime, /exportPng:target/);
  assert.match(runtime, /type!=='export\.result'/);
  assert.match(runtime, /frame\.setAttribute\('csp'/);
  assert.doesNotMatch(runtime, /globalThis\.[A-Za-z0-9_]*nonce/i);
});

function mainArtifactHtml(probeUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui}button{padding:8px}</style></head><body>
  <button id="dynamic" data-planr-id="main-anchor">Run <span id="count">0</span></button><button id="external-self">External self navigation</button><button id="download">Download</button><div id="editable" contenteditable="true">editable</div>
  <script>
  (()=>{
    const results={};const record=(key,value)=>{results[key]=String(value);document.body.dataset[key]=String(value)};
    addEventListener('message',event=>{if(event.data?.type==='bridge.challenge'){record('challengeNonce',Object.hasOwn(event.data,'nonce'));record('challengeKeys',Object.keys(event.data).sort().join(','))}});
    document.querySelector('#dynamic').addEventListener('click',()=>{const count=document.querySelector('#count');count.textContent=String(Number(count.textContent)+1)});
    try{parent.document;record('parent','open')}catch(error){record('parent',error.name)}
    try{localStorage.setItem('x','1');record('localStorage','open')}catch(error){record('localStorage',error.name)}
    try{sessionStorage.setItem('x','1');record('sessionStorage','open')}catch(error){record('sessionStorage',error.name)}
    try{document.cookie='x=1';record('cookie',document.cookie.includes('x=1')?'open':'blocked')}catch(error){record('cookie',error.name)}
    try{void indexedDB;record('indexedDb','open')}catch(error){record('indexedDb',error.name)}
    try{void caches;record('caches','open')}catch(error){record('caches',error.name)}
    try{void navigator.serviceWorker;record('serviceWorker','open')}catch(error){record('serviceWorker',error.name)}
    try{void navigator.clipboard;record('clipboard','open')}catch(error){record('clipboard',error.name)}
    try{record('popup',open('about:blank')===null?'blocked':'open')}catch(error){record('popup',error.name)}
    try{document.execCommand('copy');record('copy','open')}catch(error){record('copy',error.name)}
    try{document.querySelector('#editable').focus();document.execCommand('insertText',false,'safe');record('benignExec','allowed')}catch(error){record('benignExec',error.name)}
    const copyEvent=new Event('copy',{cancelable:true});document.dispatchEvent(copyEvent);record('copyEvent',copyEvent.defaultPrevented);
    const form=document.createElement('form');form.action=${JSON.stringify(probeUrl)};document.body.append(form);try{form.requestSubmit();record('form','open')}catch(error){record('form',error.name)}form.remove();
    Promise.resolve().then(async()=>{try{await fetch(${JSON.stringify(probeUrl)});record('fetch','open')}catch(error){record('fetch',error.name)}});
    try{new XMLHttpRequest();record('xhr','open')}catch(error){record('xhr',error.name)}
    try{new WebSocket('ws://127.0.0.1:9');record('websocket','open')}catch(error){record('websocket',error.name)}
    try{new EventSource(${JSON.stringify(probeUrl)});record('eventSource','open')}catch(error){record('eventSource',error.name)}
    try{new RTCPeerConnection();record('rtc','open')}catch(error){record('rtc',error.name)}
    try{record('beacon',navigator.sendBeacon(${JSON.stringify(probeUrl)},'x'))}catch(error){record('beacon',error.name)}
    try{top.location.href=${JSON.stringify(probeUrl)};record('topNavigation','attempted')}catch(error){record('topNavigation',error.name)}
    const imageProbe=new Promise(resolve=>{const image=new Image();image.onload=()=>{record('image','open');resolve()};image.onerror=()=>{record('image','blocked');resolve()};image.src=${JSON.stringify(`${probeUrl}?image`)};document.body.append(image)});
    document.querySelector('#external-self').addEventListener('click',()=>{location.href=${JSON.stringify(`${probeUrl}?self`)}});
    document.querySelector('#download').addEventListener('click',()=>{const link=document.createElement('a');link.href=${JSON.stringify(`${probeUrl}?download`)};link.download='artifact.txt';document.body.append(link);link.click();link.remove();record('download','attempted')});
    const opfs=Promise.resolve().then(async()=>{try{await navigator.storage.getDirectory();record('opfs','open')}catch(error){record('opfs',error.name)}});
    const runWorker=(source,options,message)=>new Promise(resolve=>{
      const sourceUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      let worker,settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);try{worker?.terminate()}catch{}URL.revokeObjectURL(sourceUrl);resolve(value)};const timer=setTimeout(()=>finish('timeout'),5000);
      try{worker=new Worker(sourceUrl,options);record(options?.type==='module'?'moduleInstance':'workerInstance',worker instanceof Worker);worker.onmessage=event=>finish(event.data);worker.onerror=event=>{event.preventDefault();finish('error')};worker.postMessage(message)}catch(error){if(options?.type==='module')record('moduleInstance',false);finish(error.name)}
    });
    const exerciseWorkerLimit=()=>{const sourceUrl=URL.createObjectURL(new Blob(['setInterval(()=>{},1000)'],{type:'text/javascript'}));const workers=[];let limit='open',reuse='blocked';try{for(let index=0;index<32;index+=1)workers.push(new Worker(sourceUrl,{name:'bounded-'+index}));try{new Worker(sourceUrl);limit='open'}catch(error){limit=error.name}}finally{for(const worker of workers)worker.terminate()}try{const worker=new Worker(sourceUrl);reuse=worker instanceof Worker?'allowed':'blocked';worker.terminate()}catch(error){reuse=error.name}URL.revokeObjectURL(sourceUrl);record('workerLimit',limit);record('workerReuse',reuse)};
    Promise.all([
      runWorker('onmessage=event=>postMessage(event.data*2)',{name:'planr-compute'},21),
      runWorker('fetch('+JSON.stringify(${JSON.stringify(probeUrl)})+').then(()=>postMessage("open"),error=>postMessage(error.name))',{name:'planr-network'}),
      runWorker('postMessage(7)',{type:'module',name:'planr-module'}),
      opfs,
      imageProbe,
    ]).then(([compute,network,moduleValue])=>{record('workerCompute',compute);record('workerNetwork',network);record('moduleWorker',moduleValue);record('workerName',Worker.name);exerciseWorkerLimit();record('done',true)});
    record('bridgeSourceVisible',document.documentElement.innerHTML.includes('openplanr.'+'artifact-anchor'));
  })();
  </script></body></html>`;
}

function navigationArtifactHtml(probeUrl) {
  const navigated = `<!doctype html><html><body><img src=${JSON.stringify(`${probeUrl}?passive`)}>navigated<script>fetch(${JSON.stringify(probeUrl)}).catch(()=>{});document.body.dataset.hostile='ran'</script></body></html>`;
  const embeddedNavigated = JSON.stringify(navigated).replaceAll('</script', '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><button id="navigate-blob" data-planr-id="navigation-anchor">Blob navigate</button><button id="navigate-about">About navigate</button><button id="document-open">Document open</button><script>
  document.querySelector('#navigate-blob').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([${embeddedNavigated}],{type:'text/html'}));location.href=url});
  document.querySelector('#navigate-about').addEventListener('click',()=>{location.href='about:blank'});
  document.querySelector('#document-open').addEventListener('click',()=>{try{document.open();document.write(${embeddedNavigated});document.close();document.documentElement.dataset.documentOpen='open'}catch(error){document.documentElement.dataset.documentOpen=error.name}});
  </script></body></html>`;
}

async function startProbe() {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.setHeader('access-control-allow-origin', '*');
    response.end('unexpected');
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/probe`,
    hits: () => hits,
    close: () => new Promise((resolveClose, reject) => server.close((error) => (
      error ? reject(error) : resolveClose()
    ))),
  };
}

test('real browser keeps dynamic artifacts useful while hostile capabilities fail closed', {
  skip: !runBrowser,
  timeout: 90_000,
}, async (t) => {
  const playwright = await import('playwright');
  const browserType = playwright[browserEngine];
  const probe = await startProbe();
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const envelope = createArtifactEnvelope({
    artifacts: [
      {
        id: 'main',
        title: 'Hostile capability fixture',
        html: mainArtifactHtml(probe.url),
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
      },
      {
        id: 'navigator',
        title: 'Navigation fixture',
        html: navigationArtifactHtml(probe.url),
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
      },
    ],
    viewer: { mode: 'variants', activeArtifactId: 'main' },
  });
  const review = await startArtifactReview({
    envelope,
    env: isolatedEnv(),
    noOpen: true,
  });
  t.after(async () => {
    await review.close().catch(() => {});
    await context.close();
    await browser.close();
    await probe.close();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(review.url);
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');
  await page.waitForFunction(() => document.querySelector('[data-planr-artifact-frame="main"]')?.dataset.planrBridgeTrusted === 'true');

  const mainFrameElement = page.locator('[data-planr-artifact-frame="main"]');
  assert.equal(await mainFrameElement.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await mainFrameElement.evaluate((frame) => frame.contentDocument), null);
  assert.match(await mainFrameElement.getAttribute('src'), /^blob:/i);
  assert.equal(await mainFrameElement.getAttribute('srcdoc'), null);
  assert.match(await mainFrameElement.getAttribute('csp'), /connect-src 'none'/);
  assert.equal(await mainFrameElement.getAttribute('aria-busy'), null);

  const main = page.frameLocator('[data-planr-artifact-frame="main"]');
  await main.locator('#dynamic').click();
  assert.equal(await main.locator('#count').textContent(), '1', 'packaged main-thread JavaScript remains interactive');
  await main.locator('body[data-done="true"]').waitFor({ timeout: 10_000 });
  const results = await main.locator('body').evaluate((body) => ({ ...body.dataset }));
  assert.equal(results.challengeNonce, 'false', 'parent-to-child challenge never contains the bridge nonce');
  assert.doesNotMatch(results.challengeKeys, /nonce/);
  assert.equal(results.bridgeSourceVisible, 'false', 'self-removing bridge keeps its nonce out of artifact-readable DOM');
  assert.equal(results.parent, 'SecurityError');
  assert.equal(results.localStorage, 'SecurityError');
  assert.equal(results.sessionStorage, 'SecurityError');
  assert.ok(['SecurityError', 'blocked'].includes(results.cookie));
  assert.equal(results.indexedDb, 'SecurityError');
  assert.equal(results.caches, 'SecurityError');
  assert.equal(results.serviceWorker, 'SecurityError');
  assert.equal(results.clipboard, 'SecurityError');
  assert.equal(results.popup, 'blocked');
  assert.equal(results.copy, 'SecurityError');
  assert.equal(results.copyEvent, 'true');
  assert.equal(results.benignExec, 'allowed', 'non-clipboard execCommand behavior is preserved');
  assert.equal(results.form, 'SecurityError');
  assert.equal(results.fetch, 'SecurityError');
  assert.equal(results.xhr, 'SecurityError');
  assert.equal(results.websocket, 'SecurityError');
  assert.equal(results.eventSource, 'SecurityError');
  assert.equal(results.rtc, 'SecurityError');
  assert.equal(results.beacon, 'false');
  assert.ok(['SecurityError', 'attempted'].includes(results.topNavigation));
  assert.ok(
    ['SecurityError', 'TypeError'].includes(results.opfs),
    'OPFS must fail closed whether the engine denies it or omits the API',
  );
  assert.equal(results.image, 'blocked');
  assert.equal(results.workerInstance, 'true');
  assert.equal(results.moduleInstance, 'false');
  assert.equal(results.workerCompute, '42');
  assert.equal(results.workerNetwork, 'SecurityError');
  assert.equal(results.moduleWorker, 'SecurityError', 'opaque-origin module Workers fail deterministically');
  assert.equal(results.workerName, 'Worker');
  assert.equal(results.workerLimit, 'SecurityError');
  assert.equal(results.workerReuse, 'allowed', 'terminate releases the bounded worker slot');

  await main.locator('#external-self').click({ noWaitAfter: true });
  await main.locator('#download').click();
  assert.equal(await main.locator('#dynamic').isVisible(), true, 'blocked external self-navigation keeps the artifact loaded');
  assert.equal(await main.locator('body').getAttribute('data-download'), 'attempted');

  const anchor = await mainFrameElement.evaluate((frame) => frame.__openPlanrBridge.resolve('main-anchor'));
  assert.equal(anchor.artifactId, 'main');
  assert.equal(anchor.planrId, 'main-anchor');
  assert.deepEqual(anchor.viewport, { width: 800, height: 600 });

  const artifactPath = `${new URL(review.url).pathname}artifacts/main`;
  const direct = await context.newPage();
  const directResponse = await direct.goto(`http://127.0.0.1:${review.port}${artifactPath}`);
  assert.equal(directResponse.status(), 404, 'artifact byte endpoint cannot execute as a direct document navigation');
  assert.doesNotMatch(await direct.content(), /Hostile capability fixture|main-anchor|workerCompute/);
  await direct.close();

  await page.locator('[role="tab"][data-artifact-id="navigator"]').click();
  const navigationFrame = page.locator('[data-planr-artifact-frame="navigator"]');
  await navigationFrame.evaluate((frame) => {
    globalThis.__planrNavigationEvents = [];
    frame.addEventListener('planr:artifact-navigation-blocked', (event) => {
      globalThis.__planrNavigationEvents.push(event.detail);
    });
  });
  const navigator = page.frameLocator('[data-planr-artifact-frame="navigator"]');
  await navigator.locator('#document-open').click();
  assert.equal(await navigator.locator('html').getAttribute('data-document-open'), 'SecurityError');
  assert.equal(await navigator.locator('#document-open').isVisible(), true, 'document replacement is blocked');
  for (const selector of ['#navigate-blob', '#navigate-about']) {
    const before = await page.evaluate(() => globalThis.__planrNavigationEvents.length);
    await navigator.locator(selector).click({ noWaitAfter: true });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const after = await page.evaluate(() => globalThis.__planrNavigationEvents.length);
    if (after > before) {
      assert.equal((await page.evaluate(() => globalThis.__planrNavigationEvents.at(-1))).recovered, true);
      await page.waitForFunction(() => document.querySelector('[data-planr-artifact-frame="navigator"]')?.dataset.planrBridgeTrusted === 'true');
    }
    await navigator.locator('#document-open').waitFor();
  }
  const watchdogUrl = await page.evaluate(({ csp, probeUrl }) => {
    const escaped = csp.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escaped}"><img src="${probeUrl}?watchdog"><script>fetch(${JSON.stringify(probeUrl)}).catch(()=>{})<\/script>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    globalThis.__planrWatchdogUrl = url;
    return url;
  }, { csp: await navigationFrame.getAttribute('csp'), probeUrl: probe.url });
  let attempts = (await page.evaluate(() => globalThis.__planrNavigationEvents.at(-1)?.attempts)) ?? 0;
  while (attempts < 2) {
    const before = await page.evaluate(() => globalThis.__planrNavigationEvents.length);
    await navigationFrame.evaluate((frame, url) => {
      frame.removeAttribute('srcdoc');
      frame.src = url;
    }, watchdogUrl);
    await page.waitForFunction((count) => globalThis.__planrNavigationEvents.length > count, before);
    const event = await page.evaluate(() => globalThis.__planrNavigationEvents.at(-1));
    assert.equal(event.recovered, true);
    attempts = event.attempts;
    await page.waitForFunction(() => document.querySelector('[data-planr-artifact-frame="navigator"]')?.dataset.planrBridgeTrusted === 'true');
    await navigator.locator('#document-open').waitFor();
  }
  await navigationFrame.evaluate((frame, url) => {
    frame.removeAttribute('srcdoc');
    frame.src = url;
  }, watchdogUrl);
  await page.waitForFunction(() => globalThis.__planrNavigationEvents?.some((event) => event.failedClosed));
  const finalNavigation = await page.evaluate(() => globalThis.__planrNavigationEvents.at(-1));
  assert.equal(finalNavigation.failedClosed, true);
  assert.equal(finalNavigation.attempts, 3);
  assert.equal(await navigationFrame.getAttribute('aria-busy'), 'true');
  assert.equal(await navigationFrame.getAttribute('data-planr-bridge-trusted'), 'false');
  await page.evaluate(() => URL.revokeObjectURL(globalThis.__planrWatchdogUrl));

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(probe.hits(), 0, 'main thread, workers, forms, and navigated documents never reach the network');
});
