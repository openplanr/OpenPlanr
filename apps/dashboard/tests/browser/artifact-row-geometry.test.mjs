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
    'features/shell/unified-shell.css',
    'features/search/command-palette.css',
    'features/planning/planning.css',
    'features/planning/overview.css',
    'features/planning/list.css',
    'features/planning/board.css',
  ].map((path) =>
    readFileSync(resolve(dashboard, 'src', path), 'utf8').replace(/@import[^;]*;/gu, ''),
  ),
  ...[400, 600].map((weight) => {
    const bytes = readFileSync(
      resolve(
        dashboard,
        `../../node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-${weight}-normal.woff2`,
      ),
    );
    return `@font-face { font-family: "Source Code Pro"; font-weight: ${weight}; src: url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2"); }`;
  }),
].join('\n');

function bundleFixture() {
  return build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { artifactRowStyle, DataTable } from './src/design-system/components/index.ts';
        import { OverviewPage } from './src/features/planning/OverviewPage.tsx';
        import { BoardColumn } from './src/features/planning/BoardColumn.tsx';
        import { LIST_COLUMNS } from './src/features/planning/planning-columns.tsx';
        import { SearchResults } from './src/features/search/SearchResults.tsx';
        import { searchHitDisplayId } from './src/features/search/search-index.ts';
        const nodes = Array.from({length:11}, (_,i) => ({
          id:'SPEC-' + String(i + 1).padStart(3,'0'), type:'spec', status:'in-progress',
          title:'A complete artifact title that must remain visible ' + (i + 1),
          frontmatter:{updated:new Date().toISOString(),created:new Date().toISOString()}
        }));
        const waiting = {
          id:'T-901', type:'task', status:'outstanding', title:'Wait for both dependencies',
          frontmatter:{id:'T-901',created:new Date().toISOString(),dependsOn:['SPEC-001','SPEC-002']}
        };
        window.rowGeometryModel = {graph:{nodes:[...nodes,waiting],edges:[
          {from:waiting.id,to:'SPEC-001',kind:'depends_on'},
          {from:waiting.id,to:'SPEC-002',kind:'depends_on'}
        ]}, binding:{projectId:'row-geometry'},presentation:'ready'};
        const paletteNodes = nodes.map((node, index) => index === 0 ? {...node,id:'BL-431-dashboard-needs-a-complete-artifact-title-without-using-the-file-slug-as-the-display-id',type:'backlog',frontmatter:{...node.frontmatter,id:'BL-431'}} : node);
        const hits = paletteNodes.map(node => ({id:'planning:' + node.id,title:node.title,href:'#/detail/' + node.id,source:'planning',kind:node.type}));
        flushSync(() => createRoot(document.getElementById('root')).render(<>
          <OverviewPage currentBinding={{}} current={{}} />
          <section className="pc-palette__search" id="palette" style={{width:'min(100%, 650px)'}}>
            <div className="pc-palette__input-row"><input className="pc-palette__input" type="search" aria-label="Geometry query" /></div>
            <SearchResults hits={hits} activeHref={null} listId="row-results" onSelect={() => undefined} displayIdForHit={hit => searchHitDisplayId(hit,{planningNodes:paletteNodes})} />
          </section>
          <section className="op-workspace op-planning pc-list" id="list" style={artifactRowStyle(nodes.map(node=>node.id))}>
            <DataTable columns={LIST_COLUMNS} rows={nodes} caption="Geometry artifacts" />
          </section>
          <div id="board" style={{width:300}}>
            <BoardColumn group={{key:'in-progress',nodes}} laneKey="none" collapsed={false} expandDone={()=>undefined} target={null} />
          </div>
        </>));
      `,
      loader: 'tsx',
      resolveDir: dashboard,
      sourcefile: 'artifact-row-fixture.tsx',
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
    plugins: [
      {
        name: 'fixture-workspace',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]planning-workspace\.tsx?$/ }, () => ({
            contents:
              'export function resolvePlanningWorkspace(){return window.rowGeometryModel;} export function PlanningNotice(){return null;} export function PlanningRefusal(){return null;}',
            loader: 'js',
          }));
        },
      },
    ],
  });
}

test('bundles production row surfaces with local font metrics', async () => {
  assert((await bundleFixture()).outputFiles[0].text.length > 0);
  assert.doesNotMatch(styles, /@import\s/u);
});

test('keeps rows, complete tags, titles and copy hit targets inside their geometry', {
  timeout: 60_000,
}, async (t) => {
  const code = (await bundleFixture()).outputFiles[0].text;
  const browser = await launchBrowser();
  t.after(() => browser.close());
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: width < 900,
    });
    try {
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(
        '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>',
      );
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ content: code });
      await page.evaluate(async () => {
        await document.fonts.load('600 12px "Source Code Pro"');
        await document.fonts.ready;
      });
      for (const selector of ['.pc-home__card ul', '#palette .pc-palette__list']) {
        const geometry = await page.locator(selector).evaluateAll((lists) =>
          lists.map((list) =>
            [...list.querySelectorAll(':scope > .pc-artifact-row')].map((row) => {
              const title = row.querySelector('.pc-artifact-row__title');
              const tag = row.querySelector('.pc-artifact-tag');
              const link = row.querySelector('.pc-artifact-row__link');
              if (!title || !tag || !link) throw new Error('Row is missing its title, tag or link');
              const r = row.getBoundingClientRect(),
                l = link.getBoundingClientRect(),
                a = tag.getBoundingClientRect(),
                b = title.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                height: r.height,
                linkTop: l.top,
                linkBottom: l.bottom,
                tagRight: a.right,
                titleLeft: b.left,
                titleWidth: b.width,
                titleHeight: b.height,
                tagFits: tag.clientWidth + 1 >= tag.scrollWidth,
                titleHint: title.title,
              };
            }),
          ),
        );
        for (const rows of geometry) {
          const titleXs = new Set(rows.map((row) => Math.round(row.titleLeft * 10)));
          assert(titleXs.size <= 1, `${selector}: titles have different columns`);
          rows.forEach((row, index) => {
            assert.equal(row.height, 44);
            assert(row.linkTop >= row.top && row.linkBottom <= row.bottom + 0.5);
            assert(row.tagRight <= row.titleLeft && row.tagFits);
            assert(row.titleWidth > 0 && row.titleHeight > 0 && row.titleHint.length > 0);
            if (index) assert(rows[index - 1].bottom <= row.top);
          });
        }
      }
      assert.equal(await page.locator('#palette .pc-artifact-tag').count(), 11);
      assert.equal(await page.locator('#palette .pc-artifact-tag').first().textContent(), 'BL-431');
      await page.locator('#palette input').focus();
      assert.equal(
        await page
          .locator('#palette input')
          .evaluate((element) => getComputedStyle(element).outlineWidth),
        '0px',
      );
      assert.equal(await page.locator('.pc-home__specs > li').count(), 5);
      const homeTitleOffsets = await page
        .locator('.pc-home__card .pc-artifact-row__title')
        .evaluateAll((elements) =>
          elements.map((element) =>
            Math.round(
              10 *
                (element.getBoundingClientRect().left -
                  element.closest('.pc-home__card').getBoundingClientRect().left),
            ),
          ),
        );
      assert.equal(new Set(homeTitleOffsets).size, 1, 'Home titles must align across every card');
      const homeLink = page.locator('.pc-home__row .pc-artifact-row__link').first();
      await homeLink.focus();
      const rings = await homeLink.evaluate((element) => ({
        row: getComputedStyle(element.closest('.pc-artifact-row')).outlineStyle,
        link: getComputedStyle(element).outlineStyle,
        children: [...element.querySelectorAll('*')].map(
          (child) => getComputedStyle(child).outlineStyle,
        ),
      }));
      assert.equal(rings.row, 'solid');
      assert.equal(rings.link, 'none');
      assert(rings.children.every((outline) => outline === 'none'));
      if (width === 390) {
        const mobile = await page.locator('.pc-home__card').evaluateAll((cards) =>
          cards.map((card) => ({
            overflows: card.scrollWidth > card.clientWidth,
            heading: (() => {
              const title = card.querySelector('.pc-card__title');
              return {
                height: title.getBoundingClientRect().height,
                lineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
                overflow: getComputedStyle(title).overflow,
                whiteSpace: getComputedStyle(title).whiteSpace,
              };
            })(),
            meta: [...card.querySelectorAll('.pc-artifact-row__meta')].map((meta) => ({
              width: meta.getBoundingClientRect().width,
              value: getComputedStyle(meta.querySelector('.pc-artifact-row__meta-value')).display,
            })),
          })),
        );
        for (const card of mobile) {
          assert.equal(card.overflows, false);
          assert.equal(card.heading.overflow, 'visible');
          assert.equal(card.heading.whiteSpace, 'normal');
          assert(card.heading.height <= 2 * card.heading.lineHeight + 1);
          assert(card.meta.every((meta) => meta.width >= 24 && meta.value === 'none'));
        }
      }
      const homeCopy = page.locator('.pc-home__specs .pc-command-hint[data-variant="row"]').first();
      await page.mouse.move(0, 0);
      const touch = await page.evaluate(() => matchMedia('(hover: none)').matches);
      assert.equal(
        await homeCopy.evaluate((element) => getComputedStyle(element).opacity),
        touch ? '1' : '0',
      );
      await homeCopy.locator('button').focus();
      assert.equal(await homeCopy.evaluate((element) => getComputedStyle(element).opacity), '1');
      if (width === 1440) {
        const home = await page.locator('.pc-home__columns').evaluate((element) => {
          const columns = getComputedStyle(element)
            .gridTemplateColumns.split(' ')
            .map(Number.parseFloat);
          const specs = element.querySelector('.pc-home__specs').closest('section');
          return {
            columns,
            align: getComputedStyle(element).alignItems,
            gap: getComputedStyle(element).columnGap,
            specsHeight: specs.getBoundingClientRect().height,
          };
        });
        assert.equal(home.columns[0], home.columns[1]);
        assert(home.columns[1] >= 480);
        assert.equal(home.align, 'start');
        assert.equal(home.gap, '24px');
        assert(home.specsHeight <= 280);
      }
      const titles = page.locator('#palette [data-search-result]');
      for (let index = 0; index < (await titles.count()); index++) {
        await titles.nth(index).scrollIntoViewIfNeeded();
        assert(
          await titles.nth(index).evaluate((element) => {
            const r = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
          'Palette row is covered by another control',
        );
      }
      const table = await page.locator('#list').evaluate((element) =>
        [...element.querySelectorAll('tbody tr')].map((row) => {
          const tag = row.querySelector('.pc-artifact-tag').getBoundingClientRect();
          const title = row.querySelector('.pc-list__title').getBoundingClientRect();
          return { tagRight: tag.right, titleLeft: title.left };
        }),
      );
      assert.equal(new Set(table.map((row) => row.titleLeft)).size, 1);
      assert(table.every((row) => row.tagRight <= row.titleLeft));
      const cards = await page.locator('#board .pc-status-board__card').evaluateAll((elements) =>
        elements.map((element) => {
          const r = element.getBoundingClientRect(),
            t = element.querySelector('.pc-artifact-row__title').getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            height: r.height,
            titleWidth: t.width,
            titleHeight: t.height,
          };
        }),
      );
      cards.forEach((card, index) => {
        assert.equal(card.height, 90);
        assert(card.titleWidth > 200 && card.titleHeight > 0);
        if (index) assert.equal(card.top - cards[index - 1].bottom, 10);
      });
    } finally {
      await context.close();
    }
  }
});
