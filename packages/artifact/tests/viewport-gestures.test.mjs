import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import {
  normalizeArtifactViewportPan,
  normalizeArtifactViewportZoom,
} from '../lib/artifact/ui/bridge-tools.mjs';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
  validateArtifactBridgeMessage,
} from '../lib/artifact/bridge.mjs';

const viewport = { width: 800, height: 600 };
test('viewport zoom requires opt-in, exact authenticated identity and bounded coordinates', () => {
  const zoom = { x: 120, y: 230, deltaY: -45 };
  assert.deepEqual(normalizeArtifactViewportZoom(zoom, viewport), zoom);
  for (const value of [
    { ...zoom, x: -1 },
    { ...zoom, y: 601 },
    { ...zoom, deltaY: Infinity },
    { ...zoom, deltaY: 1001 },
    { ...zoom, deltaY: 0 },
    { ...zoom, x: '120' },
    { ...zoom, scale: 1.2 },
  ]) {
    assert.equal(normalizeArtifactViewportZoom(value, viewport), null);
  }
  const getter = { ...zoom };
  Object.defineProperty(getter, 'x', {
    get() {
      throw new Error('Do not execute getters');
    },
  });
  assert.equal(normalizeArtifactViewportZoom(getter, viewport), null);
  const source = {},
    nonce = createArtifactBridgeNonce();
  const data = {
    channel: 'openplanr.artifact-anchor',
    schemaVersion: '1.0.0',
    type: 'viewport.zoom',
    artifactId: 'screen',
    nonce,
    ...zoom,
  };
  const contract = { source, nonce, artifactId: 'screen', viewport, viewportGesturesEnabled: true };
  const event = { source, origin: 'null', data };
  assert.deepEqual(validateArtifactBridgeMessage(event, contract).value.zoom, zoom);
  for (const bad of [
    { ...event, source: {} },
    { ...event, origin: 'https://example.test' },
    { ...event, data: { ...data, nonce: createArtifactBridgeNonce() } },
    { ...event, data: { ...data, artifactId: 'different' } },
    { ...event, data: { ...data, extra: true } },
    { ...event, data: { ...data, deltaY: NaN } },
  ])
    assert.equal(validateArtifactBridgeMessage(bad, contract).ok, false);
  assert.equal(
    validateArtifactBridgeMessage(event, { ...contract, viewportGesturesEnabled: false }).ok,
    false,
  );
  assert.equal(
    validateArtifactBridgeMessage(event, { ...contract, viewportGesturesEnabled: undefined }).ok,
    false,
  );
});

test('viewport pan requires opt-in, exact authenticated identity and bounded deltas', () => {
  const pan = { deltaX: 84, deltaY: -52 };
  assert.deepEqual(normalizeArtifactViewportPan(pan), pan);
  for (const value of [
    { ...pan, deltaX: Infinity },
    { ...pan, deltaY: 1001 },
    { deltaX: 0, deltaY: 0 },
    { ...pan, deltaX: '84' },
    { ...pan, extra: true },
  ]) {
    assert.equal(normalizeArtifactViewportPan(value), null);
  }
  const source = {},
    nonce = createArtifactBridgeNonce();
  const data = {
    channel: 'openplanr.artifact-anchor',
    schemaVersion: '1.0.0',
    type: 'viewport.pan',
    artifactId: 'screen',
    nonce,
    ...pan,
  };
  const contract = { source, nonce, artifactId: 'screen', viewport, viewportGesturesEnabled: true };
  const event = { source, origin: 'null', data };
  assert.deepEqual(validateArtifactBridgeMessage(event, contract).value.pan, pan);
  for (const bad of [
    { ...event, source: {} },
    { ...event, origin: 'https://example.test' },
    { ...event, data: { ...data, nonce: createArtifactBridgeNonce() } },
    { ...event, data: { ...data, artifactId: 'different' } },
    { ...event, data: { ...data, extra: true } },
    { ...event, data: { ...data, deltaY: NaN } },
  ])
    assert.equal(validateArtifactBridgeMessage(bad, contract).ok, false);
  assert.equal(
    validateArtifactBridgeMessage(event, { ...contract, viewportGesturesEnabled: false }).ok,
    false,
  );
});

const product =
  '<style>body{margin:0;height:2500px;background:#fff}button{margin:20px;width:180px;height:60px}</style><button onclick="this.textContent=\'Clicked\'">Product action</button><script>window.productWheels=0;window.productModifiers=0;addEventListener("wheel",event=>{productWheels++;if(event.ctrlKey||event.metaKey)productModifiers++})</script>';
const root = fileURLToPath(new URL('../../../', import.meta.url));
for (const kind of ['local', ...(process.env.PLANR_HOSTED_BRIDGE_SOURCE ? ['hosted'] : [])]) {
  test(`${kind}: real iframe wheel gestures are opt-in, scale-independent and restored after load`, {
    skip: process.env.PLANR_BROWSER_TESTS !== '1',
  }, async (t) => {
    const requirePipeline = createRequire(new URL('../../pipeline/package.json', import.meta.url));
    const { chromium, webkit } = requirePipeline('playwright');
    const browser = await (process.env.PLANR_BROWSER_ENGINE === 'webkit'
      ? webkit
      : chromium
    ).launch({
      headless: true,
      ...(process.env.PLANR_BROWSER_CHANNEL ? { channel: process.env.PLANR_BROWSER_CHANNEL } : {}),
      ...(process.env.PLANR_BROWSER_EXECUTABLE
        ? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE }
        : {}),
    });
    const nonce = createArtifactBridgeNonce();
    let origin;
    const setup = `const artifact={id:'screen',viewport:{width:800,height:600}};const frame=document.createElement('iframe');frame.width=800;frame.height=600;frame.style.cssText='border:0;transform:scale(.6);transform-origin:top left';frame.setAttribute('sandbox','allow-scripts');window.frame=frame;window.zooms=[];window.pans=[];document.body.addEventListener('planr:artifact-viewport-zoom',event=>zooms.push(event.detail));document.body.addEventListener('planr:artifact-viewport-pan',event=>pans.push(event.detail));`;
    let hostedRuntime;
    if (kind === 'hosted') {
      const bundle = await build({
        stdin: {
          resolveDir: root,
          contents: `import {prepareHostedArtifact,createHostedBridgeClient} from ${JSON.stringify(process.env.PLANR_HOSTED_BRIDGE_SOURCE)};${setup}window.cleanup=createHostedBridgeClient(new Map([['screen',${JSON.stringify(nonce)}]])).attach({artifact,frame});document.body.append(frame);frame.src=URL.createObjectURL(new Blob([prepareHostedArtifact(${JSON.stringify(product)},{artifactId:'screen',nonce:${JSON.stringify(nonce)}})],{type:'text/html'}));`,
        },
        alias: {
          '#artifact-bridge-tools': fileURLToPath(
            new URL('../lib/artifact/ui/bridge-tools.mjs', import.meta.url),
          ),
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
      });
      hostedRuntime = bundle.outputFiles[0].text;
    }
    const server = createServer((req, res) => {
      if (req.url === '/stage.js') {
        res.setHeader('content-type', 'application/javascript');
        return res.end(
          `(async()=>{${setup}const options=__OPENPLANR_ARTIFACT_STAGE_OPTIONS__;window.cleanup=options.bridgeClient.attach({artifact,frame});document.body.append(frame);frame.src=URL.createObjectURL(await options.resolveArtifactSource(artifact));})()`,
        );
      }
      if (req.url === '/hosted.js') {
        res.setHeader('content-type', 'application/javascript');
        return res.end(hostedRuntime);
      }
      if (req.url === '/artifact/screen') {
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(
          prepareArtifactDocument({
            html: product,
            artifactId: 'screen',
            nonce,
            parentOrigin: origin,
          }).html,
        );
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100vh;overflow:hidden}</style><body>${kind === 'hosted' ? '<script src="/hosted.js"></script>' : '<script>' + renderArtifactParentRuntime({ artifactBaseUrl: '/artifact/', stageRuntimeUrl: '/stage.js', nonce }) + '</script>'}`,
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page.waitForFunction(() => window.frame?.dataset.planrBridgeTrusted === 'true');
    const child = () => page.frames().find((entry) => entry !== page.mainFrame());
    // Off by default: product scrolling and synthetic product events are untouched.
    await page.mouse.move(180, 150);
    await page.mouse.wheel(0, 60);
    await child().waitForFunction(() => window.productWheels > 0);
    assert.equal(await page.evaluate(() => zooms.length), 0);
    assert.equal(
      await page.evaluate(() => frame.__openPlanrBridge.setViewportGestures('true')),
      false,
    );
    await page.evaluate(() => frame.__openPlanrBridge.setViewportGestures(true));
    await page.waitForTimeout(40);
    const productWheels = await child().evaluate(() => productWheels);
    await page.mouse.move(180, 150);
    await page.mouse.wheel(32, 48);
    await page.waitForFunction(() => pans.length > 0);
    assert.deepEqual(await page.evaluate(() => pans.at(-1)), { deltaX: 32, deltaY: 48 });
    assert.equal(
      await child().evaluate(() => window.productWheels),
      productWheels,
      'Canvas pan must not activate product wheel handlers',
    );
    const before = await child().evaluate(() => productModifiers);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -60);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => zooms.length > 0);
    const zoom = await page.evaluate(() => zooms.at(-1));
    assert.ok(
      Math.abs(zoom.x - 300) < 2 && Math.abs(zoom.y - 250) < 2,
      'Coordinates must use unscaled iframe CSS pixels',
    );
    assert.ok(zoom.deltaY < 0 && zoom.deltaY >= -1000);
    assert.equal(
      await child().evaluate(() => productModifiers),
      before,
      'Camera gestures must not activate product zoom handlers',
    );
    assert.equal(
      await page.evaluate(() => window.visualViewport.scale),
      1,
      'Camera gesture must not zoom browser chrome',
    );
    const count = await page.evaluate(() => zooms.length);
    await child().evaluate(() =>
      dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -50,
          clientX: 50,
          clientY: 50,
          cancelable: true,
        }),
      ),
    );
    await page.evaluate((nonce) => {
      const base = {
        channel: 'openplanr.artifact-anchor',
        schemaVersion: '1.0.0',
        type: 'viewport.zoom',
        artifactId: 'screen',
        nonce,
        x: 10,
        y: 10,
        deltaY: 10,
      };
      for (const [data, source, origin] of [
        [{ ...base, nonce: 'wrong' }, frame.contentWindow, 'null'],
        [base, window, 'null'],
        [base, frame.contentWindow, location.origin],
        [{ ...base, deltaY: 1001 }, frame.contentWindow, 'null'],
        [{ ...base, extra: true }, frame.contentWindow, 'null'],
      ])
        dispatchEvent(new MessageEvent('message', { data, source, origin }));
    }, nonce);
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => zooms.length), count);
    // Reload of the trusted execution copy keeps the caller's explicit opt-in.
    await page.evaluate(() => {
      frame.dataset.planrBridgeTrusted = 'false';
      frame.src = frame.src;
    });
    await page.waitForFunction(() => frame.dataset.planrBridgeTrusted === 'true');
    await page.mouse.move(180, 150);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -50);
    await page.keyboard.up('Control');
    await page.waitForFunction((previous) => zooms.length > previous, count);
    await page.evaluate(() => frame.__openPlanrBridge.setViewportGestures(false));
    await page.waitForTimeout(40);
    const disabledCount = await page.evaluate(() => zooms.length);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 40);
    await page.keyboard.up('Control');
    await child().waitForFunction(() => productModifiers > 0);
    assert.equal(await page.evaluate(() => zooms.length), disabledCount);
    // Destroy also resets child interception, even while the iframe stays mounted.
    await page.evaluate(() => {
      frame.__openPlanrBridge.setViewportGestures(true);
      window.savedBridge = frame.__openPlanrBridge;
      cleanup();
    });
    assert.equal(await page.evaluate(() => savedBridge.setViewportGestures(true)), false);
    assert.equal(await page.evaluate(() => frame.__openPlanrBridge), undefined);
  });
}
