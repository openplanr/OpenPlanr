import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchBrowser } from '../../../../tests/support/browser-launcher.mjs';

const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const styles = [
  readFileSync(resolve(dashboard, '../../node_modules/tailwindcss/preflight.css'), 'utf8'),
  ...[
    'design-system/tokens.css',
    'design-system/typography.css',
    'design-system/planr-console-tokens.css',
    'design-system/components/planr-console.css',
    'design-system/components/chip-menu.css',
    'design-system/components/governed-controls.css',
  ].map((path) =>
    readFileSync(resolve(dashboard, 'src', path), 'utf8').replace(/@import[^;]*;/gu, ''),
  ),
].join('\n');

async function fixture() {
  const result = await build({
    stdin: {
      contents: `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { Button, IconButton, Input, Select, Switch } from './src/design-system/components/console-core.tsx';
        import { SegmentedControl } from './src/design-system/components/planr-console.tsx';
        import { DependencyGraph } from './src/design-system/components/console-planr.tsx';
        import { GovernedButton } from './src/design-system/components/governed-button.tsx';
        function Fixture() {
          const [value, setValue] = useState('one');
          const [disabled, setDisabled] = useState(false);
          const [switches, setSwitches] = useState({sm:false,md:false});
          window.densityFixture = { setDisabled: (next) => flushSync(() => setDisabled(next)) };
          return <>
            {['sm','md','lg'].map(size => <div key={size}>
              <IconButton size={size} icon="plus" label={'Icon ' + size} disabled={disabled} />
              <Button size={size} disabled={disabled}>Action {size}</Button>
              <Input size={size} ariaLabel={'Input ' + size} value={value} onChange={setValue} disabled={disabled} />
              <Select size={size} ariaLabel={'Select ' + size} options={['one','two']}
                value={value} onChange={setValue} disabled={disabled} />
            </div>)}
            {['sm','md'].map(size => <div key={'switch-' + size}>
              <Switch size={size} label={'Setting ' + size} checked={switches[size]}
                disabled={disabled} disabledReason={disabled ? 'Setting unavailable' : undefined}
                onChange={checked => setSwitches(previous => ({...previous,[size]:checked}))} />
            </div>)}
            <SegmentedControl label="View" options={[{key:'one',label:'One'},{key:'two',label:'Two'}]}
              value={value} onChange={setValue} />
            <GovernedButton disabled={disabled} disabledReason={disabled ? 'Unavailable' : undefined}
              onInvoke={() => undefined}>Governed action</GovernedButton>
            <DependencyGraph nodes={[{id:'item',type:'task',label:'Item'}]} edges={[]} />
          </>;
        }
        flushSync(() => createRoot(document.getElementById('root')).render(<Fixture />));
      `,
      loader: 'tsx',
      resolveDir: dashboard,
      sourcefile: 'density-fixture.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

test('bundles real controls without network assets', async () => {
  assert((await fixture()).length > 0);
  assert.doesNotMatch(styles, /@import\s/u);
});

test('renders compact desktop controls and keeps touch targets through state changes', {
  timeout: 60_000,
}, async (t) => {
  const code = await fixture();
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const mode of [
    { name: 'desktop', width: 1440, hasTouch: false, touch: false },
    { name: 'mobile', width: 390, hasTouch: false, touch: true },
    { name: 'touch desktop', width: 1440, hasTouch: true, touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: mode.width, height: 1000 },
      hasTouch: mode.hasTouch,
    });
    try {
      const requests = [];
      context.on('request', (request) => requests.push(request.url()));
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>',
      );
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ content: code });
      for (const disabled of [false, true]) {
        await page.evaluate((disabled) => window.densityFixture.setDisabled(disabled), disabled);
        const measurements = await page.evaluate(() => {
          const heights = (selector) =>
            [...document.querySelectorAll(selector)].map(
              (element) => element.getBoundingClientRect().height,
            );
          return {
            icons: heights('.pc-icon-button'),
            actions: heights('.pc-button'),
            fields: heights('.pc-chip[role="combobox"]'),
            inputs: heights('.pc-input__field'),
            inputWrappers: heights('.pc-input'),
            wrappers: heights('.pc-chip-menu'),
            segments: heights('.pc-segmented__option'),
            segmented: heights('.pc-segmented'),
            graph: heights('.pc-graph-controls button'),
            governed: heights('.op-governed-button'),
          };
        });
        const label = `${mode.name}, disabled=${disabled}`;
        assert.deepEqual(measurements.icons, mode.touch ? [44, 44, 44] : [30, 34, 34], label);
        assert.deepEqual(measurements.actions, mode.touch ? [44, 44, 44] : [34, 36, 36], label);
        assert.deepEqual(
          measurements.fields,
          [mode.touch ? 44 : 32, mode.touch ? 44 : 32, mode.touch ? 44 : 32],
          label,
        );
        assert.deepEqual(measurements.wrappers, measurements.fields, label);
        assert.deepEqual(
          measurements.inputs,
          [mode.touch ? 44 : 36, mode.touch ? 44 : 36, mode.touch ? 44 : 36],
          label,
        );
        assert.deepEqual(measurements.inputWrappers, measurements.inputs, label);
        assert(
          measurements.segments.every((height) => height === (mode.touch ? 44 : 30)),
          label,
        );
        assert.deepEqual(measurements.segmented, [mode.touch ? 48 : 34], label);
        assert(
          measurements.graph.every((height) => height === (mode.touch ? 44 : 30)),
          label,
        );
        assert.deepEqual(measurements.governed, [mode.touch ? 44 : 36], label);
      }
      await page.evaluate(() => window.densityFixture.setDisabled(false));
      for (const size of ['sm', 'md']) {
        const control = page.getByRole('switch', { name: 'Setting ' + size });
        await control.scrollIntoViewIfNeeded();
        const target = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          const track = element.nextElementSibling;
          const thumb = track.firstElementChild;
          return {
            width: rect.width,
            height: rect.height,
            reachable: hit === element,
            trackPointerEvents: getComputedStyle(track).pointerEvents,
            thumbPointerEvents: getComputedStyle(thumb).pointerEvents,
          };
        });
        assert.equal(target.width, mode.touch ? 44 : size === 'sm' ? 30 : 34);
        assert.equal(target.height, mode.touch ? 44 : 30);
        assert.equal(target.reachable, true, mode.name + ': the input owns its hit target');
        assert.equal(target.trackPointerEvents, 'none');
        assert.equal(target.thumbPointerEvents, 'none');
        assert.equal(await control.isChecked(), false);
        await control.click();
        assert.equal(await control.isChecked(), true, 'Pointer activation toggles the switch');
        await control.focus();
        await page.keyboard.press('Space');
        assert.equal(await control.isChecked(), false, 'Space toggles the focused switch');
        const ring = await control.evaluate((element) => {
          const style = getComputedStyle(element.nextElementSibling);
          return { width: style.outlineWidth, offset: style.outlineOffset };
        });
        assert.deepEqual(ring, { width: '2px', offset: '2px' });
        await control.locator('..').locator('.pc-switch__label').click();
        assert.equal(await control.isChecked(), true, 'The label still activates the switch');
        await page.evaluate(() => window.densityFixture.setDisabled(true));
        assert.equal(await control.isDisabled(), true);
        await control.locator('..').locator('.pc-switch__label').click();
        assert.equal(await control.isChecked(), true, 'Disabled labels cannot change state');
        await page.evaluate(() => window.densityFixture.setDisabled(false));
        await control.click();
        assert.equal(await control.isChecked(), false);
      }
      await page.getByRole('button', { name: 'Two', exact: true }).click();
      assert.equal(
        await page.getByRole('button', { name: 'Two', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      await page.getByRole('combobox', { name: /^Select sm:/u }).focus();
      await page.keyboard.press('ArrowDown');
      const focus = await page
        .locator('.pc-chip[role="combobox"]')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            width: style.outlineWidth,
            offset: style.outlineOffset,
            color: style.outlineColor,
          };
        });
      assert.deepEqual(focus, { width: '2px', offset: '2px', color: 'rgb(94, 234, 212)' });
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    } finally {
      await context.close();
    }
  }
});
