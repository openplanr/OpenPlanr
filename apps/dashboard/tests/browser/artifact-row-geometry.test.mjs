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
        import { artifactRowStyle, DataTable, Input } from './src/design-system/components/index.ts';
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
          <div id="responsive-input" style={{display:'flex',width:280}}>
            <Input ariaLabel="Responsive filter" width={340} value="" onChange={()=>undefined} suffix="/" />
          </div>
          <section className="pc-palette__search" id="palette" style={{width:'min(100%, 650px)'}}>
            <div className="pc-palette__input-row"><div className="pc-palette__query"><input className="pc-palette__input" type="search" aria-label="Geometry query" /></div></div>
            <SearchResults hits={hits} activeHref={null} listId="row-results" onSelect={() => undefined} displayIdForHit={hit => searchHitDisplayId(hit,{planningNodes:paletteNodes})} />
          </section>
          <section className="op-workspace op-planning pc-list" id="list" style={artifactRowStyle(nodes.map(node=>node.id))}>
            <DataTable columns={[{key:'select',label:'Select',width:40},...LIST_COLUMNS]} rows={nodes} caption="Geometry artifacts" />
          </section>
          <section className="op-workspace op-planning pc-list" id="grouped-list" style={artifactRowStyle(nodes.map(node=>node.id))}>
            <div className="pc-list__window">
              <DataTable columns={[{key:'select',label:'Select',width:40},...LIST_COLUMNS]} rows={nodes} groups={[{
                key:'specs',label:'Specifications',rows:nodes,
                header:<div className="pc-list__group-header"><button type="button">Specifications</button><span className="pc-list__group-meta"><span>11 items</span><progress max="11" value="3"/><span>3/11 tasks</span></span></div>
              }]} caption="Grouped geometry artifacts" />
            </div>
          </section>
          <section className="op-workspace op-planning pc-list" id="short-list" style={artifactRowStyle([nodes[0].id])}>
            <div className="pc-list__window">
              <DataTable columns={[{key:'select',label:'Select',width:40},...LIST_COLUMNS]} rows={[nodes[0]]} caption="One geometry artifact" />
            </div>
          </section>
          <div id="board" style={{width:300,height:600}}>
            <BoardColumn group={{key:'in-progress',label:'In progress',nodes}} graph={{nodes,edges:[]}} laneKey="none" collapsed={false} expanded head={null} layout="columns" toggleDone={()=>undefined} expand={()=>undefined} target={null} />
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
      const inputBounds = await page.locator('#responsive-input').evaluate((element) => {
        const parent = element.getBoundingClientRect();
        const field = element.querySelector('.pc-input').getBoundingClientRect();
        const suffix = element.querySelector('.pc-input__suffix').getBoundingClientRect();
        return { edge: parent.right, fieldEdge: field.right, hintEdge: suffix.right };
      });
      assert(inputBounds.fieldEdge <= inputBounds.edge);
      assert(inputBounds.hintEdge <= inputBounds.edge);
      const group = await page.locator('#grouped-list .pc-list__window').evaluate((element) => {
        const band = element.querySelector('.pc-list__group-header').getBoundingClientRect();
        const table = element.querySelector('table').getBoundingClientRect();
        return {
          bandWidth: band.width,
          tableWidth: table.width,
          viewportWidth: element.clientWidth,
        };
      });
      assert(Math.abs(group.bandWidth - Math.min(group.tableWidth, group.viewportWidth)) <= 4);
      const short = await page.locator('#short-list .pc-list__window').evaluate((element) => ({
        windowHeight: element.getBoundingClientRect().height,
        tableHeight: element.querySelector('table').getBoundingClientRect().height,
      }));
      assert(short.windowHeight - short.tableHeight <= 4);
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
                stacked: getComputedStyle(row).gridTemplateRows.trim().split(/\s+/u).length > 1,
                border: Number.parseFloat(getComputedStyle(row).borderTopWidth),
                linkTop: l.top,
                linkBottom: l.bottom,
                tagRight: a.right,
                tagBottom: a.bottom,
                titleTop: b.top,
                rowWidth: r.width,
                merged: Boolean(row.querySelector('[data-merged="true"]')),
                linkWidth: l.width,
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
            if (row.stacked) {
              assert(row.tagBottom <= row.titleTop);
              assert(
                row.titleWidth >=
                  (row.merged ? row.linkWidth : row.rowWidth - (width < 900 ? 32 : 40)) - 1,
              );
            } else {
              assert.equal(row.height - row.border, 44);
              assert(row.tagRight <= row.titleLeft);
            }
            assert(row.linkTop >= row.top && row.linkBottom <= row.bottom + 0.5);
            assert(row.tagFits);
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
        .locator('.pc-home__card .pc-home__row .pc-artifact-row__title')
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
        row: getComputedStyle(element.closest('.pc-artifact-row')).boxShadow,
        link: getComputedStyle(element).outlineStyle,
        children: [...element.querySelectorAll('*')].map(
          (child) => getComputedStyle(child).outlineStyle,
        ),
      }));
      assert.match(rings.row, / 0px 0px 0px 2px inset$/u);
      assert.equal(rings.link, 'none');
      assert(rings.children.every((outline) => outline === 'none'));
      if (width >= 600) {
        const dependency = page.locator('.pc-home__row .pc-home__dependency').first();
        await dependency.focus();
        const outline = await dependency.evaluate((element) => ({
          width: getComputedStyle(element).outlineWidth,
          offset: getComputedStyle(element).outlineOffset,
          style: getComputedStyle(element).outlineStyle,
        }));
        assert.deepEqual(outline, { width: '2px', offset: '2px', style: 'solid' });
      } else {
        assert.equal(
          await page.locator('.pc-home__row .pc-home__waits').first().isVisible(),
          false,
        );
      }
      const eyebrow = await page
        .locator('.pc-home__header .pc-home__eyebrow')
        .evaluate((element) => ({
          size: getComputedStyle(element).fontSize,
          weight: getComputedStyle(element).fontWeight,
          spacing: getComputedStyle(element).letterSpacing,
        }));
      assert.deepEqual(eyebrow, { size: '12px', weight: '600', spacing: '1.68px' });
      if (width === 390) {
        const mobile = await page.locator('.pc-home__card').evaluateAll((cards) =>
          cards.map((card) => {
            const title = card.querySelector('.pc-card__title, .pc-home__sprint-title');
            return {
              overflows: card.scrollWidth > card.clientWidth,
              titleTruncated: title.scrollWidth > title.clientWidth,
              head: card.querySelector('.pc-card__head')?.getBoundingClientRect().height ?? null,
              seeAll:
                card.querySelector('.pc-card__see-all')?.getBoundingClientRect().height ?? null,
              meta: [...card.querySelectorAll('.pc-home__meta')].map(
                (meta) => meta.getBoundingClientRect().width,
              ),
            };
          }),
        );
        for (const card of mobile) {
          assert.equal(card.overflows, false);
          assert.equal(card.titleTruncated, false);
          if (card.head !== null) assert.equal(card.head, 53);
          if (card.seeAll !== null) assert.equal(card.seeAll, 44);
          assert(card.meta.every((meta) => meta > 0));
        }
      }
      await homeLink.click();
      assert.equal(await page.locator('.pc-selection-bar').count(), 1);
      await page.locator('.pc-selection-bar__clear').click();
      assert.equal(await page.locator('.pc-selection-bar').count(), 0);
      if (width === 1440) {
        const home = await page.locator('.pc-home__columns').evaluate((element) => {
          const columns = getComputedStyle(element)
            .gridTemplateColumns.split(' ')
            .map(Number.parseFloat);
          const [attention, context] = [...element.children].map(
            (column) => column.getBoundingClientRect().width,
          );
          const specs = element.querySelector('.pc-home__specs').closest('section');
          return {
            columns,
            attention,
            context,
            align: getComputedStyle(element).alignItems,
            gap: getComputedStyle(element).columnGap,
            specsHeight: specs.getBoundingClientRect().height,
            cardGaps: [...element.children].flatMap((column) => {
              const cards = [...column.querySelectorAll(':scope > .pc-home__card')];
              return cards
                .slice(1)
                .map(
                  (card, index) =>
                    card.getBoundingClientRect().top - cards[index].getBoundingClientRect().bottom,
                );
            }),
          };
        });
        assert.equal(home.columns.length, 12);
        assert(home.columns.every((track) => Math.abs(track - home.columns[0]) < 0.5));
        assert(Math.abs(home.attention - (8 * home.columns[0] + 7 * 24)) < 1);
        assert(Math.abs(home.context - (4 * home.columns[0] + 3 * 24)) < 1);
        assert.equal(home.align, 'start');
        assert.equal(home.gap, '24px');
        assert(Math.abs(home.specsHeight - (2 + 57 + 16 + 5 * 50)) < 1);
        assert(home.cardGaps.every((gap) => Math.abs(gap - 24) < 0.5));
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
      const boardViewport = await page
        .locator('#board .pc-status-board__cards')
        .evaluate((element) => ({
          height: element.clientHeight,
          expected: Math.min(744, innerHeight * 0.7),
          overflow: getComputedStyle(element).overflowY,
        }));
      assert(
        Math.abs(boardViewport.height - boardViewport.expected) <= 1,
        'An expanded Board cell scrolls inside its capped height',
      );
      assert.equal(boardViewport.overflow, 'auto');
      const cards = await page.locator('#board .pc-status-board__card').evaluateAll((elements) =>
        elements.map((element) => {
          const r = element.getBoundingClientRect(),
            t = element.querySelector('.pc-status-board__title').getBoundingClientRect();
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
        assert.equal(card.height, 118);
        assert(card.titleWidth > 200 && card.titleHeight > 0);
        if (index) assert.equal(card.top - cards[index - 1].bottom, 8);
      });
    } finally {
      await context.close();
    }
  }
});

test('keeps one plain row meta with its full sentence on touch and fine pointers', {
  timeout: 60_000,
}, async (t) => {
  const code = (await bundleFixture()).outputFiles[0].text;
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const sentence = '0 open tasks wait on this. It waits on SPEC-001, SPEC-002.';
  for (const theme of ['dark', 'light']) {
    for (const coarse of [true, false]) {
      for (const width of [390, 1440]) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          hasTouch: coarse,
          isMobile: coarse && width === 390,
          reducedMotion: 'reduce',
        });
        try {
          await context.route('**/*', (route) => route.abort());
          const page = await context.newPage();
          await page.setContent(
            `<!doctype html><html data-theme="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>`,
          );
          await page.addStyleTag({ content: styles });
          await page.addScriptTag({ content: code });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          });
          const report = JSON.stringify({ theme, coarse, width });
          const row = page.locator('[data-attention="waiting"] .pc-home__row').first();
          await row.scrollIntoViewIfNeeded();
          assert.equal(await row.locator('.pc-home__meta').count(), 1, report);
          assert.equal(await row.locator('.pc-home__meta').getAttribute('title'), sentence, report);
          const description = await row
            .locator('.pc-artifact-row__link')
            .evaluate(
              (link) =>
                document.getElementById(link.getAttribute('aria-describedby') ?? '')?.textContent,
            );
          assert.equal(description, sentence, report);
          assert.equal(await row.getByRole('button').count(), 0, report);
          const dependency = row.locator('.pc-home__dependency');
          if (width < 600) {
            assert.equal(await dependency.isVisible(), false, report);
            continue;
          }
          assert.equal(await dependency.textContent(), 'SPEC-001', report);
          const bounds = await dependency.evaluate((element) => {
            const link = element
              .closest('.pc-artifact-row')
              .querySelector('.pc-artifact-row__link')
              .getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return { overlapsLink: rect.left < link.right && rect.right > link.left };
          });
          assert.equal(bounds.overlapsLink, false, report);
        } finally {
          await context.close();
        }
      }
    }
  }
});
