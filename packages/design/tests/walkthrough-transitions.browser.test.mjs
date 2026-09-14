import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';

async function settled(page, screenId) {
  await page.waitForFunction(id => {
    const studio = window.__openPlanrDesignStudio;
    return studio?.getState().screenId === id && !document.querySelector('[data-design-transition]')
      && document.querySelectorAll('.planr-artifact-panel:not([hidden])').length === 1;
  }, screenId);
}

async function activeFrame(page) {
  return (await page.locator('.planr-artifact-panel:not([hidden]) iframe').elementHandle()).contentFrame();
}

// Observe real browser frames, rather than asserting the controller's final state
// alone. A fade that briefly hides both screens, moves the shell or leaves a live
// outgoing product frame must fail even when navigation eventually succeeds.
async function observeNavigation(page, steps, expectedScreen, { cancelToView = null } = {}) {
  return page.evaluate(async ({ steps, expectedScreen, cancelToView }) => {
    const root = document.querySelector('.planr-shell');
    const selectors = ['.design-toolbar', '.planr-stage-scroll', '.design-walkthrough-caption'];
    const geometry = () => selectors.map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const artboardGeometry = panel => {
      const rect = panel.querySelector('.planr-frame').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const baseline = geometry();
    const artboardBaseline = artboardGeometry(document.querySelector('.planr-artifact-panel:not([hidden])'));
    const frameCount = document.querySelectorAll('.planr-artifact-panel iframe').length;
    const samples = [];
    let complete = false;
    let stable = 0;
    const started = performance.now();
    const observed = new Promise((resolve, reject) => {
      function sample() {
        const mode = root.getAttribute('data-design-transition');
        const visible = [...document.querySelectorAll('.planr-artifact-panel:not([hidden])')];
        const painted = visible.filter(panel => {
          const frame = panel.querySelector('iframe');
          const rect = frame.getBoundingClientRect();
          const style = getComputedStyle(frame);
          return rect.width > 100 && rect.height > 100 && style.visibility !== 'hidden'
            && Number(style.opacity) > 0.01;
        });
        const outgoing = [...document.querySelectorAll('[data-design-transition-outgoing]')];
        const transitionAnimations = [...document.querySelectorAll('[data-design-transition-visual]')]
          .flatMap(element => element.getAnimations());
        samples.push({ elapsed: performance.now() - started, mode,
          painted: painted.length, visible: visible.length,
          frameCount: document.querySelectorAll('.planr-artifact-panel iframe').length,
          opacity: painted.reduce((sum, panel) => sum + Number(getComputedStyle(panel.querySelector('iframe')).opacity), 0),
          outgoing: outgoing.length,
          outgoingInert: outgoing.every(panel => panel.inert || Boolean(panel.closest('[inert]'))),
          motionDuration: Math.max(0, ...transitionAnimations.map(animation => Number(animation.effect?.getTiming().duration) || 0)),
          geometry: geometry(),
          artboards: visible.map(artboardGeometry) });
        const state = window.__openPlanrDesignStudio.getState();
        const final = state.screenId === expectedScreen && (!cancelToView || state.view === cancelToView);
        stable = complete && !mode && final ? stable + 1 : 0;
        if (stable >= 3) return resolve({ baseline, artboardBaseline, frameCount, samples });
        if (performance.now() - started > 5000)
          return reject(new Error(`Walkthrough did not settle: ${JSON.stringify({ state, mode })}`));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    for (const step of steps) {
      document.querySelector(`[data-design-step-change="${step}"]`).click();
      await new Promise(resolve => setTimeout(resolve, 24));
    }
    if (cancelToView) window.__openPlanrDesignStudio.setView(cancelToView);
    complete = true;
    return observed;
  }, { steps, expectedScreen, cancelToView });
}

function assertContinuousTransition(result, label, { animated = true } = {}) {
  assert.ok(result.samples.length >= 3, `${label}: observed real animation frames`);
  for (const sample of result.samples) {
    assert.ok(sample.painted >= 1, `${label}: no blank frame at ${sample.elapsed.toFixed(1)} ms`);
    assert.ok(sample.opacity >= 0.9, `${label}: retain a painted screen through the transition`);
    assert.ok(sample.visible <= 2, `${label}: at most the current and outgoing screen are visible`);
    assert.equal(sample.frameCount, result.frameCount, `${label}: transitions do not create additional live product frames`);
    assert.ok(sample.outgoing <= 1, `${label}: rapid navigation does not accumulate outgoing screens`);
    assert.ok(sample.outgoingInert, `${label}: outgoing product cannot receive clicks or keyboard focus`);
    assert.deepEqual(sample.geometry, result.baseline, `${label}: stage, toolbar and caption remain fixed`);
    for (const artboard of sample.artboards) {
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(artboard[key] - result.artboardBaseline[key]) <= 0.25,
          `${label}: artboard ${key} remains fixed during navigation`);
      }
    }
  }
  const running = result.samples.filter(sample => sample.mode === 'running');
  if (animated) {
    assert.ok(running.length >= 2, `${label}: transition has a visible intermediate animation`);
    assert.ok(running.some(sample => sample.motionDuration >= 200), `${label}: motion is not an abrupt swap`);
    assert.ok(result.samples.at(-1).elapsed < 1400, `${label}: transition remains responsive`);
  } else assert.equal(running.length, 0, `${label}: reduced motion skips the animated transition`);
  const last = result.samples.at(-1);
  assert.equal(last.mode, null, `${label}: no stale transition state`);
  assert.equal(last.outgoing, 0, `${label}: outgoing screen released after settling`);
  assert.equal(last.visible, 1, `${label}: one focused screen at rest`);
}

test(`walkthrough navigation stays painted, preserves product state and handles interruption (${engine})`, { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-walkthrough-transitions-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, { count: 4, frames: [
      { id: 'desktop', label: 'Desktop', width: 1000, height: 720 },
    ] });
    document.screens[1].description = Array.from({ length: 6 }, () =>
      'Review the detailed permissions, ownership boundaries, validation rules, responsive behavior and empty states before continuing. Keep this implementation guidance outside the product screen so reviewers can explore the working journey without losing its context.').join(' ');
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    const rendered = await renderDesignDocument(file);
    session = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') }, port: 0 });
    browser = await engines[engine].launch({ headless: true,
      ...(engine === 'chromium' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
    });
    const errors = [];
    for (const [host, url] of [['portable', pathToFileURL(rendered.views.canvas).href], ['local', session.url]]) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => errors.push(`${host}: ${error.message}`));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('[data-design-ready="true"]');
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-design-opening'));
      await page.locator('[data-design-view="walkthrough"]').click();
      await settled(page, 'screen-1');
      const first = await activeFrame(page);
      await first.getByRole('textbox', { name: 'Workspace name' }).fill('Keep my product draft');
      await first.getByRole('button', { name: 'Save workspace', exact: true }).focus();
      await page.keyboard.press('Enter');
      await first.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      await page.evaluate(() => {
        window.__walkthroughFrames = [...document.querySelectorAll('.planr-artifact-panel iframe')]
          .map(frame => ({ frame, window: frame.contentWindow, src: frame.getAttribute('src'), srcdoc: frame.getAttribute('srcdoc'), loads: 0 }));
        for (const record of window.__walkthroughFrames) record.frame.addEventListener('load', () => record.loads++);
      });

      assertContinuousTransition(await observeNavigation(page, [1], 'screen-2'), `${host}/next`);
      assertContinuousTransition(await observeNavigation(page, [-1], 'screen-1'), `${host}/previous`);
      assert.equal(await (await activeFrame(page)).getByRole('textbox', { name: 'Workspace name' }).inputValue(), 'Keep my product draft');
      assert.equal(await (await activeFrame(page)).getByRole('button', { name: 'Saved', exact: true }).count(), 1,
        'returning to a screen retains its authored interaction state');

      const rapid = await observeNavigation(page, [1, 1, -1], 'screen-2');
      assertContinuousTransition(rapid, `${host}/rapid next and previous`);
      const beforeCancel = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      await observeNavigation(page, [1], 'screen-3', { cancelToView: 'prototype' });
      await settled(page, 'screen-3');
      assert.equal(await page.locator('[data-design-transition-outgoing]').count(), 0, 'view switch clears outgoing panels');
      assert.equal(await page.locator('.planr-artifact-panel:not([hidden])').count(), 1);
      assert.equal((await page.evaluate(() => window.__openPlanrDesignStudio.getState())).view, 'prototype');
      assert.deepEqual((await page.evaluate(() => window.__openPlanrDesignStudio.getState())).positions, beforeCancel.positions,
        'transitions never rewrite the freeform canvas arrangement');

      await page.locator('[data-design-view="walkthrough"]').click();
      await settled(page, 'screen-3');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assertContinuousTransition(await observeNavigation(page, [-1], 'screen-2'), `${host}/reduced motion`, { animated: false });
      assert.deepEqual(await page.evaluate(() => window.__walkthroughFrames.map(record => ({
        sameNode: record.frame.isConnected,
        sameWindow: record.frame.contentWindow === record.window,
        sameSource: record.frame.getAttribute('src') === record.src && record.frame.getAttribute('srcdoc') === record.srcdoc,
        loads: record.loads,
      }))), Array.from({ length: 4 }, () => ({ sameNode: true, sameWindow: true, sameSource: true, loads: 0 })),
      `${host}: transitions preserve existing iframe identities without cloning or reloading`);
      const evidence = process.env.OPENPLANR_WALKTHROUGH_EVIDENCE_DIR;
      if (evidence) {
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, `${host}-walkthrough-${engine}.png`) });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('[data-design-step-change="1"]').click();
        await page.waitForFunction(() => document.querySelector('[data-design-transition-visual]')?.getAnimations().length > 0);
        await page.evaluate(() => {
          for (const animation of document.querySelector('[data-design-transition-visual]').getAnimations()) {
            animation.pause();
            animation.currentTime = 70;
          }
        });
        await page.screenshot({ path: join(evidence, `${host}-walkthrough-mid-transition-${engine}.png`) });
        await page.evaluate(() => {
          for (const animation of document.querySelector('[data-design-transition-visual]')?.getAnimations() || []) animation.play();
        });
        await settled(page, 'screen-3');
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await session?.close(); await rm(root, { recursive: true, force: true }); }
});
