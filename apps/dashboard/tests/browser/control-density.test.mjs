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
    'design-system/components/artifact-row.css',
    'design-system/components/chip-menu.css',
    'design-system/components/governed-controls.css',
    'features/planning/list.css',
    'features/planning/overview.css',
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
        import { Button, CardHeader, DataTable, IconButton, Input, Select, Switch, Tabs } from './src/design-system/components/console-core.tsx';
        import { ArtifactRowCopy, ArtifactRowMeta, ArtifactRowTitle, artifactRowStyle } from './src/design-system/components/artifact-row.tsx';
        import { SegmentedControl } from './src/design-system/components/planr-console.tsx';
        import { DependencyGraph, WorkItemChip } from './src/design-system/components/console-planr.tsx';
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
            <section id="touch-recipes" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr)',gap:32,padding:32,maxWidth:960}}>
              <div data-hit-group="card" style={{padding:24}}>
                <CardHeader title="Targets" description="Card target details" href="#/list" count={2} />
              </div>
              <div data-hit-group="metadata" style={{padding:24}}>
                <span className="pc-artifact-row__meta-group" style={{width:'max-content'}}>
                  <ArtifactRowMeta label="First metric">1</ArtifactRowMeta>
                  <span><ArtifactRowMeta label="Second metric">2</ArtifactRowMeta></span>
                </span>
              </div>
              <div data-hit-group="dense-metadata" style={{padding:24}}>
                <div className="pc-home__card">
                  <CardHeader title="Dense row" />
                  <ul className="pc-home__rows" style={artifactRowStyle(['T-002'])}>
                    <li className="pc-home__row pc-artifact-row" data-mobile-layout="stacked">
                      <a className="pc-artifact-row__link" href="#/detail/T-002">
                        <span className="pc-artifact-row__id"><WorkItemChip type="task" id="T-002" /></span>
                        <ArtifactRowTitle>Compact metadata and copy</ArtifactRowTitle>
                      </a>
                      <span className="pc-artifact-row__meta-group">
                        <ArtifactRowMeta label="Dense first metric">1</ArtifactRowMeta>
                        <span className="pc-home__dependencies"><ArtifactRowMeta label="Dense second metric">2</ArtifactRowMeta></span>
                      </span>
                      <ArtifactRowCopy id="T-002" command="openplanr status T-002 --md" onCopy={async () => undefined} />
                    </li>
                  </ul>
                </div>
              </div>
              <div data-hit-group="tabs" style={{padding:24}}>
                <Tabs label="Touch recipe tabs" variant="pill" value="alpha" onChange={() => undefined}
                  tabs={[{id:'alpha',label:'Alpha'},{id:'beta',label:'Beta'}]} />
              </div>
              <div data-hit-group="table" className="pc-list" style={{padding:24,'--pc-list-gutter':'0px','--id-col':'92px'}}>
                <div className="pc-list__window">
                  <DataTable columns={[{key:'id',label:'ID',sortable:true},{key:'title',label:'Title',sortable:true}]}
                    rows={[{id:'T-001',title:'Open item'}]} onSort={() => undefined} onRowClick={() => undefined} />
                </div>
              </div>
              <div data-hit-group="utilities" style={{display:'flex',alignItems:'center',gap:32,padding:24}}>
                <details><summary className="pc-touch-target" style={{width:72,height:24}}>Options</summary></details>
                <button type="button" className="pc-touch-target" aria-label="Sprint track"
                  style={{width:120,height:6,padding:0,border:0,background:'var(--pc-accent)'}} />
              </div>
            </section>
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
  const visualBounds = new Map();
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
        assert.deepEqual(measurements.segmented, [mode.touch ? 52 : 38], label);
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
        const disabledLabel = control.locator('..').locator('.pc-switch__label');
        await disabledLabel.scrollIntoViewIfNeeded();
        const labelBounds = await disabledLabel.boundingBox();
        assert(labelBounds, 'The disabled switch label remains visible');
        // Locator clicks wait for the label's disabled native input to become enabled.
        await page.mouse.click(
          labelBounds.x + labelBounds.width / 2,
          labelBounds.y + labelBounds.height / 2,
        );
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
      for (const group of [
        { id: 'card', selector: '.pc-card__info, .pc-card__see-all', heights: [28, 28] },
        { id: 'metadata', selector: '.pc-artifact-row__meta', heights: [24, 24] },
        {
          id: 'dense-metadata',
          selector: '.pc-artifact-row__meta, .pc-command-hint__copy',
          heights: [24, 24, 28],
        },
        { id: 'tabs', selector: '.pc-tabs__tab', heights: [34, 34] },
        { id: 'table', selector: '.pc-table__sort', heights: [36, 36] },
        { id: 'utilities', selector: '.pc-touch-target', heights: [24, 6] },
      ]) {
        const region = page.locator(`[data-hit-group="${group.id}"]`);
        await region.scrollIntoViewIfNeeded();
        const targets = await region.evaluate(
          (region, selector) =>
            [...region.querySelectorAll(selector)].map((element) => {
              const box = element.getBoundingClientRect();
              const visual = {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                height: box.height,
              };
              const style = getComputedStyle(element);
              const pseudo = getComputedStyle(
                element,
                element.matches('.pc-command-hint__copy') ? '::after' : '::before',
              );
              const transform = new DOMMatrixReadOnly(
                pseudo.transform === 'none' ? undefined : pseudo.transform,
              );
              const width = pseudo.content === 'none' ? box.width : parseFloat(pseudo.width);
              const height = pseudo.content === 'none' ? box.height : parseFloat(pseudo.height);
              const left =
                box.left +
                (pseudo.content === 'none'
                  ? 0
                  : parseFloat(style.borderLeftWidth) + parseFloat(pseudo.left) + transform.e);
              const top =
                box.top +
                (pseudo.content === 'none'
                  ? 0
                  : parseFloat(style.borderTopWidth) + parseFloat(pseudo.top) + transform.f);
              const hit = { left, top, right: left + width, bottom: top + height, width, height };
              const center = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              const points = [left + 1, left + width / 2, left + width - 1].flatMap((x) =>
                [top + 1, top + height / 2, top + height - 1].map((y) => {
                  const reached = document.elementFromPoint(x, y);
                  return {
                    owned: reached === element || element.contains(reached),
                    added: x < box.left || x > box.right || y < box.top || y > box.bottom,
                  };
                }),
              );
              const bounds = region.getBoundingClientRect();
              const row = region.querySelector('tbody tr')?.getBoundingClientRect();
              return {
                visual,
                hit,
                points,
                pseudoContent: pseudo.content,
                centerOwned: center === element || element.contains(center),
                group: {
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                },
                rowTop: row?.top,
              };
            }),
          group.selector,
        );
        assert.equal(targets.length, group.heights.length, group.id);
        targets.forEach((target, index) => {
          const label = `${mode.name}: ${group.id} target ${index}`;
          assert.equal(
            target.visual.height,
            group.heights[index],
            label + ' keeps its visual height',
          );
          const key = `${group.id}:${index}`;
          if (!mode.touch) visualBounds.set(key, target.visual);
          assert(
            Math.abs(target.visual.width - visualBounds.get(key).width) < 0.5,
            label + ' keeps its visual width',
          );
          if (mode.touch) {
            assert(
              target.hit.width >= 44 && target.hit.height >= 44,
              label + ' has a 44px hit area',
            );
            assert(
              target.points.some((point) => point.added && point.owned),
              label + ' reaches the added area',
            );
            assert(
              target.points.every((point) => point.owned),
              label + ' owns every hit-area sample',
            );
          } else {
            assert.equal(target.pseudoContent, 'none', label + ' has no expanded desktop target');
          }
          assert(target.centerOwned, label + ' owns its native center');
          assert(
            target.hit.left >= target.group.left && target.hit.right <= target.group.right,
            label + ' stays within its group',
          );
          assert(
            target.hit.top >= target.group.top && target.hit.bottom <= target.group.bottom,
            label + ' stays within its group',
          );
          if (target.rowTop !== undefined)
            assert(target.hit.bottom <= target.rowTop, label + ' does not cover the row action');
          for (const neighbor of targets.slice(index + 1)) {
            assert(
              target.hit.right <= neighbor.hit.left ||
                neighbor.hit.right <= target.hit.left ||
                target.hit.bottom <= neighbor.hit.top ||
                neighbor.hit.bottom <= target.hit.top,
              label + ' does not overlap a neighboring target',
            );
          }
        });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    } finally {
      await context.close();
    }
  }
});
