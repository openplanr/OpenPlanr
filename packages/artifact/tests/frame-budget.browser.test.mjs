import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '../lib/artifact/ui/shell.mjs';
import { createArtifactBridgeNonce, prepareArtifactDocument, renderArtifactParentRuntime } from '../lib/artifact/bridge.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
const requirePipeline = createRequire(new URL('../../pipeline/package.json', import.meta.url));

for (const transport of ['blob', 'srcdoc']) {
  test(`phone-sized ${transport} frame pool stays bounded through authenticated navigation and disposal`, { skip: !enabled, timeout: 60000 }, async t => {
    const { chromium, webkit } = requirePipeline('playwright');
    const engine = process.env.PLANR_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
    const browser = await engine.launch({ headless: true,
      ...(process.env.PLANR_BROWSER_CHANNEL ? { channel: process.env.PLANR_BROWSER_CHANNEL } : {}),
      ...(process.env.PLANR_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE } : {}),
    });
    const nonce = createArtifactBridgeNonce();
    const artifacts = Array.from({ length: 27 }, (_, i) => ({ id: `screen-${i}`, title: `Screen ${i}`,
      viewport: i % 2 ? { width: 390, height: 844 } : { width: 1440, height: 1024 },
      html: `<style>body{margin:0;background:#f5f8fa;font:16px system-ui}main{padding:24px}.card{padding:16px;margin:12px;background:white;box-shadow:0 12px 40px #0002;border-radius:12px}button{padding:12px}</style><main><h1>Screen ${i}</h1><button onclick="this.textContent='Confirmed'">Product action</button>${Array.from({length:72},(_,j)=>`<section class="card" data-planr-id="card-${j}"><h2>Application ${j}</h2><p>Review the next step before submitting the application.</p></section>`).join('')}</main>`,
    }));
    const envelope = createArtifactEnvelope({ artifacts, viewer: { mode: 'single', activeArtifactId: 'screen-0', presentation: 'canvas' } });
    const bundle = await build({ stdin: { resolveDir: rootPath, contents: `
      import './packages/artifact/lib/artifact/ui/stage.mjs';
      queueMicrotask(()=>{const stage=window.__openPlanrArtifactStage;window.fixture={stage,peaks:[]};document.querySelector('.planr-shell').addEventListener('planr:artifact-frame-state',()=>fixture.peaks.push(document.querySelectorAll('iframe[srcdoc],iframe[src^="blob:"]').length));stage.ready.then(()=>window.fixture.ready=true)});
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    let origin, preparing = 0, peakPreparing = 0;
    const requested = [];
    const server = createServer((req, res) => {
      if (req.url === '/stage.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
      if (req.url.startsWith('/artifact/')) {
        const id = decodeURIComponent(req.url.slice('/artifact/'.length)), artifact = artifacts.find(value => value.id === id);
        if (!artifact) { res.writeHead(404).end(); return; }
        requested.push(id); preparing++; peakPreparing = Math.max(peakPreparing, preparing);
        res.setHeader('content-type', 'application/octet-stream');
        setTimeout(() => { preparing--; res.end(prepareArtifactDocument({ html: artifact.html, artifactId: id, nonce, parentOrigin: origin }).html); }, 5);
        return;
      }
      const html = renderArtifactShellDocument({ envelope }, { stageRuntimeUrl: '/unused.js' })
        .replace('class="planr-shell"', 'class="planr-shell" data-planr-frame-budget="3"')
        .replace('<script src="/unused.js" defer></script>', `<script>${renderArtifactParentRuntime({artifactBaseUrl:'/artifact/',stageRuntimeUrl:'/stage.js',nonce})}</script><script>globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__={...globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__,sourceTransport:${JSON.stringify(transport)}};</script>`);
      res.setHeader('content-type', 'text/html'); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
    origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push({ message:error.message, stack:error.stack })); page.on('crash', () => errors.push('Browser renderer crashed'));
    await page.goto(origin); await page.waitForFunction(() => window.fixture?.ready);
    assert.equal(await page.evaluate(() => fixture.stage.frameBudget), 3);
    assert.deepEqual(requested, ['screen-0'], 'Opening a phone review must not initialize the other 26 documents');
    assert.equal(await page.evaluate(() => fixture.stage.getFrame('screen-0').dataset.planrBridgeTrusted), 'true');
    await page.evaluate(() => { window.firstBridge=fixture.stage.getFrame('screen-0').__openPlanrBridge; });
    for (let i = 1; i < 20; i++) {
      const result = await page.evaluate(async i => {
        const stage=fixture.stage;
        await stage.ensureFrames([`screen-${i-1}`,`screen-${i}`]);
        stage.dispatch({type:'set-active',artifactId:`screen-${i}`});
        const frame=stage.getFrame(`screen-${i}`);
        return {loaded:stage.getLoadedArtifactIds().length,live:document.querySelectorAll('iframe[srcdoc],iframe[src^="blob:"]').length,trusted:frame.dataset.planrBridgeTrusted,sandbox:frame.getAttribute('sandbox')};
      }, i);
      assert.ok(result.loaded <= 3 && result.live <= 3); assert.equal(result.trusted,'true'); assert.equal(result.sandbox,'allow-scripts');
    }
    assert.equal(peakPreparing, 1, 'Heavy source preparation is sequential');
    assert.equal(await page.evaluate(() => fixture.stage.getFrame('screen-0').__openPlanrBridge===undefined), true);
    const returned = await page.evaluate(async () => { await fixture.stage.ensureFrames(['screen-0']); return fixture.stage.getFrame('screen-0').__openPlanrBridge!==window.firstBridge; });
    assert.equal(returned, true, 'Revisiting an evicted screen establishes a fresh bridge');
    await page.evaluate(() => fixture.stage.dispatch({type:'set-active',artifactId:'screen-0'}));
    const product = page.frameLocator('[data-planr-artifact-frame="screen-0"]');
    await product.getByRole('button', {name:'Product action'}).evaluate(button => button.click());
    assert.equal(await product.getByRole('button', {name:'Confirmed'}).count(), 1);
    const disposed = await page.evaluate(async () => {
      const {stage}=fixture; stage.destroy();
      const result = await stage.ensureFrames(['screen-2']).then(()=>'',error=>error.name);
      return {live:document.querySelectorAll('iframe[srcdoc],iframe[src^="blob:"]').length,loaded:stage.getLoadedArtifactIds().length,bridges:[...document.querySelectorAll('iframe')].filter(frame=>frame.__openPlanrBridge).length,result,peak:Math.max(...fixture.peaks)};
    });
    assert.deepEqual(disposed, { live:0, loaded:0, bridges:0, result:'AbortError', peak:3 });
    assert.deepEqual(errors, []);
  });
}
