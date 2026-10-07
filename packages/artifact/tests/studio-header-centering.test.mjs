import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { ARTIFACT_SHELL_CSS } from '../lib/artifact/ui/shell.mjs';
import { loadArtifactTheme, renderArtifactThemeCss } from '../lib/artifact/ui/tokens.mjs';

const options = { skip: process.env.PLANR_BROWSER_TESTS !== '1', timeout: 60_000 };
const { build } = createRequire(new URL('../package.json', import.meta.url))('esbuild');

test(
  'view controls bind to the host midpoint while title, status and actions vary',
  options,
  async (t) => {
    const bundle = await build({
      stdin: {
        contents: `
        import { createElement as h, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { StudioToolbar, StudioButton, StudioMenu, StudioStatus } from ${JSON.stringify(new URL('../lib/artifact/ui/studio-shell-components.mjs', import.meta.url).pathname)};
        function App() {
          const [state, update] = useState({ title: 'Workspace', status: 'Saved', action: 'Share' });
          window.updateChrome = update;
          return h(StudioToolbar, { kind: 'design', title: state.title, className: 'design-toolbar',
            hierarchy: [{label:'Organization / a project with a long name'}],
            leading: h(StudioButton, { 'aria-label':'Screens' }, '☰'),
            viewPicker: h('fieldset', {className:'planr-segment design-view-picker', 'aria-label':'Design view'},
              ...['Canvas','Prototype','Walkthrough'].map(label => h(StudioButton, {key:label, 'aria-label':label}, h('span',{'aria-hidden':true},'◈'),h('span',{className:'design-button-label'},label)))),
            status: h(StudioStatus, {label:state.status}),
            actions: h('div', {style:{display:'flex',gap:8}},
              h(StudioButton, null, state.action),
              h(StudioMenu, {label:'Actions',items:[{id:'long',label:'A menu entry much wider than the entire action group'}]}))
          });
        }
        window.chromeRoot = createRoot(document.querySelector('#chrome'));
        chromeRoot.render(h(App));
      `,
        resolveDir: import.meta.dirname,
        sourcefile: 'studio-centering-fixture.mjs',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    });
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(async () => {
      await browser.close();
      assert.deepEqual(errors, []);
    });
    await page.setContent(
      '<!doctype html><html lang="en"><title>Toolbar geometry fixture</title><body style="margin:0"><div id="host" style="width:calc(100% - 38px);margin-left:19px"><div id="chrome"></div></div><iframe title="Retained authored frame"></iframe><textarea aria-label="Annotation draft">Unsent note</textarea></body></html>',
    );
    await page.addStyleTag({
      content: renderArtifactThemeCss(loadArtifactTheme()) + ARTIFACT_SHELL_CSS,
    });
    await page.evaluate(() => {
      window.toolbarObservers = new Set();
      for (const name of ['ResizeObserver', 'MutationObserver']) {
        const Original = window[name];
        window[name] = class extends Original {
          observe(target, options) {
            if (target.matches?.('.studio-toolbar')) toolbarObservers.add(this);
            return super.observe(target, options);
          }
          disconnect() {
            toolbarObservers.delete(this);
            return super.disconnect();
          }
        };
      }
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: 'Canvas', exact: true }).waitFor();
    await page.evaluate(() => {
      window.retained = {
        frame: document.querySelector('iframe'),
        draft: document.querySelector('textarea'),
      };
    });
    const geometry = () =>
      page.evaluate(() => {
        const rect = (element) => {
          const b = element.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
        const toolbar = document.querySelector('.studio-toolbar');
        return {
          host: rect(document.querySelector('#host')),
          toolbar: rect(toolbar),
          center: rect(document.querySelector('.studio-toolbar-center')),
          layout: toolbar.dataset.studioLayout,
          controls: [...toolbar.querySelectorAll('button')]
            .filter((node) => !node.closest('.studio-menu-content'))
            .map(rect),
          title: rect(toolbar.querySelector('strong')),
          overflow: document.documentElement.scrollWidth > innerWidth,
          retained:
            retained.frame === document.querySelector('iframe') &&
            retained.draft === document.querySelector('textarea') &&
            retained.draft.value === 'Unsent note',
        };
      });
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.planrTheme = value;
        }, theme);
        for (const state of [
          { title: 'Workspace', status: 'Saved', action: 'Share' },
          {
            title: 'A very long retained title that cannot move the three workspace views',
            status: 'Saving the latest accepted changes',
            action: 'Share design',
          },
        ]) {
          await page.evaluate((value) => window.updateChrome(value), state);
          await settle();
          const before = await geometry();
          const context = `${width}px ${theme} ${state.status}`;
          assert.ok(
            Math.abs(
              before.center.x + before.center.width / 2 - (before.host.x + before.host.width / 2),
            ) <= 1,
            `${context}: parent midpoint ${JSON.stringify(before)}`,
          );
          assert.equal(before.overflow, false, `${context}: no page overflow`);
          assert.equal(before.retained, true, `${context}: authored state retains DOM`);
          assert.ok(before.title.width >= 36, `${context}: useful title truncation`);
          for (const control of before.controls) {
            assert.ok(
              control.x >= before.host.x - 1 &&
                control.x + control.width <= before.host.x + before.host.width + 1,
              `${context}: reachable control`,
            );
            if (width === 390)
              assert.ok(control.width >= 44 && control.height >= 44, `${context}: mobile target`);
          }
          await page.getByRole('button', { name: 'Actions', exact: true }).press('ArrowDown');
          await page.getByRole('menu').waitFor();
          await settle();
          const opened = await geometry();
          assert.equal(
            opened.layout,
            before.layout,
            `${context}: menu does not select another layout`,
          );
          assert.deepEqual(opened.center, before.center, `${context}: menu does not move views`);
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
        }
      }
    }
    assert.equal(
      await page.evaluate(() => toolbarObservers.size),
      2,
      'one retained pair of toolbar observers',
    );
    await page.evaluate(() => chromeRoot.unmount());
    assert.equal(
      await page.evaluate(() => toolbarObservers.size),
      0,
      'toolbar observers disconnect on teardown',
    );
  },
);

test(
  'all leading controls retain useful identity space across fallback metrics and text enlargement',
  options,
  async (t) => {
    const bundle = await build({
      stdin: {
        contents: `
        import {createElement as h, Fragment} from 'react';
        import {createRoot} from 'react-dom/client';
        import {StudioToolbar,StudioButton,StudioStatus} from ${JSON.stringify(new URL('../lib/artifact/ui/studio-shell-components.mjs', import.meta.url).pathname)};
        createRoot(document.querySelector('#fixture')).render(h(StudioToolbar, {
          kind:'diagram',title:'Resource diagram review with a published attachment',
          hierarchy:[{label:'Synthetic review team'}],
          leading:h(Fragment,null,
            h('a',{'aria-label':'Back',href:'#',style:{display:'inline-flex',width:44,height:44,flexShrink:0}},'←'),
            h(StudioButton,{'aria-label':'Navigation',style:{minWidth:100}},'Navigation')),
          status:h(StudioStatus,{label:'Interact · Project access'}),
          actions:h('div',{style:{display:'flex',gap:8}},h(StudioButton,{'aria-label':'Theme'},'◐'),h(StudioButton,null,'Actions'),h(StudioButton,{style:{minWidth:129}},'Account'))
        }));`,
        resolveDir: import.meta.dirname,
        sourcefile: 'leading-controls-fixture.mjs',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    });
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
    t.after(() => browser.close());
    await page.setContent(
      '<!doctype html><html><body style="margin:0"><div id="fixture"></div></body></html>',
    );
    await page.addStyleTag({
      content: renderArtifactThemeCss(loadArtifactTheme()) + ARTIFACT_SHELL_CSS,
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: 'Navigation' }).waitFor();
    for (const font of ['sans-serif', 'monospace']) {
      for (const scale of [1, 2]) {
        await page.evaluate(
          ({ font, scale }) => {
            const toolbar = document.querySelector('.studio-toolbar');
            toolbar.style.fontFamily = font;
            toolbar.style.setProperty('--planr-font-body', font);
            for (const node of toolbar.querySelectorAll('button,a,strong,span,output')) {
              if (!node.dataset.baselineSize)
                node.dataset.baselineSize = parseFloat(getComputedStyle(node).fontSize);
              node.style.fontSize = `${Number(node.dataset.baselineSize) * scale}px`;
            }
            window.dispatchEvent(new Event('resize'));
          },
          { font, scale },
        );
        await page.evaluate(() => document.fonts.ready);
        for (const width of [768, 1440, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForFunction(
            () =>
              document.querySelector('.studio-identity strong').getBoundingClientRect().width >= 36,
          );
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const state = await page.evaluate(() => ({
            layout: document.querySelector('.studio-toolbar').dataset.studioLayout,
            title: document.querySelector('.studio-identity strong').getBoundingClientRect().width,
            overflow: document.documentElement.scrollWidth > innerWidth,
            controls: [...document.querySelectorAll('.studio-toolbar-leading :is(button,a)')].map(
              (n) => n.getBoundingClientRect().toJSON(),
            ),
          }));
          assert.ok(state.title >= 36, `${font} ${scale}x ${width}: title remains useful`);
          assert.equal(state.overflow, false, `${font} ${scale}x ${width}: no overflow`);
          assert.equal(state.controls.length, 2, 'both leading controls remain visible');
          if (width === 1440)
            assert.equal(
              state.layout,
              'inline',
              `${font} ${scale}x: wide layout recovers without oscillation`,
            );
        }
      }
    }
  },
);
