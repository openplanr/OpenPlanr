import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
} from '../lib/artifact/bridge.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureSource = `
import { mountArtifactAnnotations } from './packages/artifact/lib/artifact/ui/annotations.mjs';
(async()=>{
const root=document.querySelector('.planr-shell'),frame=document.querySelector('iframe'),viewport={width:800,height:600};
let review={reviewOf:'a'.repeat(64),pins:[]};
const state={status:'ready',artifacts:[{id:'screen',viewport}],activeArtifactId:'screen',reviewMode:'comment'};
const stage={getState:()=>state,dispatch(action){if(action.type==='set-active')state.activeArtifactId=action.artifactId;root.dispatchEvent(new CustomEvent('planr:stage-change'));}};
const controller={getReview:()=>review,getIdentity:()=>({name:'Morgan'}),dispatch(action){if(action.type==='add-pin')review.pins.push({...action.pin,id:'pin-'+(review.pins.length+1),status:'open'});root.dispatchEvent(new CustomEvent('planr:artifact-review-change'));return review;}};
const options=__OPENPLANR_ARTIFACT_STAGE_OPTIONS__;options.bridgeClient.attach({artifact:state.artifacts[0],frame,getState:()=>state});
frame.src=URL.createObjectURL(await options.resolveArtifactSource(state.artifacts[0]));
const annotations=mountArtifactAnnotations({document,window,root,stageController:stage,reviewController:controller});
window.fixture={annotations,controller,frame,stage,review,
 add(){annotations.openComposer({artifactId:'screen',variant:'direction',viewport,region:{x:.55,y:.28,w:.1,h:.06}})},
 update(){review.pins[0].comment='Concurrent reply or metadata update';root.dispatchEvent(new CustomEvent('planr:artifact-review-change'))},
 sample(ms){const original=document.querySelector('.planr-pin'),region=document.querySelector('.planr-pin-region');let samples=[];return new Promise(resolve=>{const end=performance.now()+ms;function tick(){const pin=document.querySelector('.planr-pin'),r=pin.getBoundingClientRect();samples.push({same:pin===original,regionSame:region===document.querySelector('.planr-pin-region'),left:pin.style.left,top:pin.style.top,hidden:pin.hidden,focused:document.activeElement===pin,x:r.x,y:r.y});if(performance.now()<end)requestAnimationFrame(tick);else resolve(samples)}requestAnimationFrame(tick)})}
};
})();`;

async function fixture(t) {
  const browser = await launchBrowser();
  const bundle = await build({
    stdin: { contents: fixtureSource, resolveDir: rootPath },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  });
  const nonce = createArtifactBridgeNonce();
  let origin;
  const server = createServer((req, res) => {
    if (req.url === '/stage.js') {
      res.setHeader('content-type', 'application/javascript');
      return res.end(bundle.outputFiles[0].text);
    }
    if (req.url === '/artifact/screen') {
      res.setHeader('content-type', 'application/octet-stream');
      return res.end(
        prepareArtifactDocument({
          html: '<style>body{margin:0;background:white}#target{position:absolute;left:380px;top:120px;width:200px;height:120px;background:#007d70;color:white;border:0;box-sizing:border-box}</style><button id="target" data-planr-id="application-card">Application progress</button>',
          artifactId: 'screen',
          nonce,
          parentOrigin: origin,
        }).html,
      );
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><html><head><style>body{margin:0}.planr-shell{height:100vh}#canvas{position:absolute;left:40px;top:40px;width:800px;height:600px;transform-origin:top left}iframe{border:0;width:800px;height:600px}.planr-annotation-layer{position:absolute;inset:0;pointer-events:none}.planr-pin{position:absolute;width:24px;height:24px;pointer-events:auto;transform:translate(-50%,-50%)}.planr-pin-region{position:absolute;border:1px solid #007d70;box-sizing:border-box}.planr-annotation-composer{position:fixed;background:white;color:black;margin:0;padding:16px;border:1px solid black}.planr-annotation-composer label{display:block}.planr-annotation-composer textarea{display:block}</style></head><body><main class="planr-shell"><div id="canvas"><iframe data-planr-artifact-frame="screen" sandbox="allow-scripts"></iframe><div class="planr-annotation-layer" data-planr-annotation-layer="screen"></div></div></main><script>${renderArtifactParentRuntime({ artifactBaseUrl: '/artifact/', stageRuntimeUrl: '/stage.js', nonce })}</script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(origin);
  await page.waitForFunction(() => window.fixture?.frame.dataset.planrBridgeTrusted === 'true');
  await page.evaluate(() => fixture.add());
  await page.waitForFunction(
    () => fixture.annotations.snapshotDraft()?.anchor?.planrId === 'application-card',
  );
  await page.locator('[data-planr-composer-comment]').fill('Check the application progress');
  await page.locator('[data-planr-composer-submit]').click();
  await page.waitForFunction(() => document.querySelector('.planr-pin')?.style.left === '60%');
  return page;
}

test('anchored pins retain their nodes and resolved position during refresh, replies and canvas zoom', {
  skip: !enabled,
}, async (t) => {
  const page = await fixture(t);
  await page.locator('.planr-pin').focus();
  const samples = await page.evaluate(async () => {
    const recording = fixture.sample(1100);
    setTimeout(() => fixture.update(), 180);
    setTimeout(() => (document.querySelector('#canvas').style.transform = 'scale(.4)'), 450);
    setTimeout(
      () => (document.querySelector('#canvas').style.transform = 'translate(40px,20px) scale(1.1)'),
      750,
    );
    return recording;
  });
  assert.ok(samples.length > 10);
  assert.ok(
    samples.every((sample) => sample.same && sample.regionSame),
    'Polling and feedback must not replace pin or region nodes',
  );
  assert.ok(
    samples.every((sample) => !sample.hidden && sample.focused),
    'Pin visibility and keyboard focus must remain stable',
  );
  assert.ok(
    samples.every((sample) => sample.left === '60%' && sample.top === '31%'),
    'Anchor-relative coordinates must never be rendered as viewport coordinates',
  );
  assert.equal(
    await page.evaluate(() => fixture.frame.contentDocument),
    null,
    'Anchoring must retain the opaque sandbox',
  );
  const product = page.frames().find((frame) => frame !== page.mainFrame());
  await product.locator('#target').evaluate((target) => {
    target.style.left = '480px';
    target.style.top = '200px';
  });
  await page.waitForFunction(() => document.querySelector('.planr-pin').style.left === '72.5%');
  assert.equal(await page.locator('.planr-pin').evaluate((pin) => pin.style.top), '44.3333%');
  await page.evaluate(() => {
    fixture.annotations.destroy();
  });
  assert.equal(await page.locator('.planr-pin').count(), 0);
});
