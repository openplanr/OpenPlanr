import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { bundleLocalDocument } from '@openplanr/artifact/local-document.mjs';
import { reviewDigest } from '../lib/design/context.mjs';
import { prepareDesignDocument } from '../lib/design/document.mjs';
import * as lint from '../lib/design/lint.mjs';
import { designFixture } from './design-fixture.mjs';

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'planr-props-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const created = designFixture(root, { count: 1, variants: 2, ...options });
  created.document.schemaVersion = '1.1.0';
  created.document.screens[0].props = {
    theme: { type: 'enum', options: ['light', 'dark'], default: 'light' },
    expanded: { type: 'boolean', default: true },
  };
  if (created.document.variants[1])
    created.document.variants[1].props = { 'screen-1': { theme: 'dark', expanded: false } };
  return {
    root,
    ...created,
    save() {
      writeFileSync(created.file, JSON.stringify(created.document));
      return prepareDesignDocument(created.file);
    },
  };
}

function sourceHtml(prepared, variantId, screenId = 'screen-1') {
  const entry = prepared.entries.find(
    (entry) => entry.variantId === variantId && entry.screenId === screenId,
  );
  const artifact = prepared.envelope.artifacts.find(({ id }) => id === entry.artifactId);
  return resolveArtifactHtml(prepared.envelope, artifact);
}

function withoutProps(html) {
  return html.replace(/<body\b[^>]*>/u, (root) =>
    root
      .replace(/ data-prop-[a-z0-9-]+="[^"]*"/gu, '')
      .replace(/\bprop-[a-z0-9-]+-[^\s"]+/gu, '')
      .replace(/ class="\s*"/gu, '')
      .replace(/class="\s+/gu, 'class="')
      .replace(/\s+"/gu, '"'),
  );
}

test('legacy documents retain the pre-change bundled source bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-props-legacy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root);
  const prepared = prepareDesignDocument(file);
  const digest = createHash('sha256')
    .update(JSON.stringify(prepared.envelope.sources.map(({ html }) => html)))
    .digest('hex');
  // Captured from prepareDesignDocument with the unchanged default fixture before props support.
  assert.equal(digest, '028a7fb76ab467e3f5ca43afc2cae36cf9007f259749b9462801b7d64b6afdd9');
});

test('instances use enum and boolean defaults or overrides on one shared authored source', (t) => {
  const state = fixture(t);
  const authored = readFileSync(join(state.root, 'source/screen-1.html'), 'utf8');
  const prepared = state.save();
  const light = sourceHtml(prepared, 'A');
  const dark = sourceHtml(prepared, 'B');
  assert.match(light, /<body\b[^>]*data-planr-screen="screen-1"/u);
  assert.match(light, /data-prop-theme="light"/u);
  assert.match(light, /data-prop-expanded="true"/u);
  assert.match(light, /class="[^"]*\bprop-theme-light\b[^"]*"/u);
  assert.match(light, /class="[^"]*\bprop-expanded-true\b[^"]*"/u);
  assert.match(dark, /data-prop-theme="dark"/u);
  assert.match(dark, /data-prop-expanded="false"/u);
  assert.match(dark, /class="[^"]*\bprop-theme-dark\b[^"]*"/u);
  assert.match(dark, /class="[^"]*\bprop-expanded-false\b[^"]*"/u);
  assert.equal(withoutProps(light), withoutProps(dark));
  assert.equal(readFileSync(join(state.root, 'source/screen-1.html'), 'utf8'), authored);
  assert.deepEqual(
    prepared.sourceFiles.filter((path) => path.endsWith('.html')),
    ['source/screen-1.html'],
  );
});

test('lowercase tokens retain identical attribute and class values', (t) => {
  const state = fixture(t);
  const value = 'high-contrast';
  state.document.screens[0].props.theme = { type: 'enum', options: [value], default: value };
  state.document.variants[1].props['screen-1'].theme = value;
  const html = sourceHtml(state.save(), 'A');
  assert.match(html, /data-prop-theme="high-contrast"/u);
  assert.match(html, /class="[^"]*\bprop-theme-high-contrast\b[^"]*"/u);
});

for (const [label, props, message] of [
  [
    'uppercase name',
    { isDark: { type: 'boolean', default: true } },
    /value "isDark" does not match/u,
  ],
  [
    'space in value',
    { theme: { type: 'enum', options: ['Dark mode'], default: 'Dark mode' } },
    /\$\.screens\[0\]\.props\.theme: matched 0\/2 branches/u,
  ],
  [
    'case pair',
    { theme: { type: 'boolean', default: false }, Theme: { type: 'boolean', default: true } },
    /value "Theme" does not match/u,
  ],
]) {
  test(`invalid prop token ${label} fails rendering and lint`, (t) => {
    const state = fixture(t);
    state.document.screens[0].props = props;
    state.document.variants[1].props = {};
    assert.throws(() => state.save(), message);
    const report = lint.lintDesign('<body>Workspace</body>', { screen: state.document.screens[0] });
    assert.match(
      report.errors.map(({ message }) => message).join('\n'),
      /must be a lowercase token/u,
    );
  });
}

test('declared prototype-named props use their default when the instance omits them', (t) => {
  const state = fixture(t);
  state.document.screens[0].props.constructor = {
    type: 'enum',
    options: ['summary', 'detail'],
    default: 'summary',
  };
  const prepared = state.save();
  for (const variantId of ['A', 'B']) {
    const html = sourceHtml(prepared, variantId);
    assert.match(html, /data-prop-constructor="summary"/u);
    assert.match(html, /class="[^"]*\bprop-constructor-summary\b[^"]*"/u);
  }
  assert.ok(prepared.lint.every(({ ok }) => ok));
});

for (const screenId of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
  for (const name of ['name', 'length']) {
    test(`prototype-named screen ${screenId} resolves prop ${name} by own key`, (t) => {
      const state = fixture(t);
      const screen = state.document.screens[0];
      screen.id = screenId;
      screen.props = { [name]: { type: 'enum', options: ['short', 'long'], default: 'short' } };
      state.document.screenOrder = [screenId];
      state.document.variants[0].props = {};
      state.document.variants[1].props = { [screenId]: { [name]: 'long' } };
      const prepared = state.save();
      const { sourceDigests } = bundleLocalDocument({
        root: state.root,
        source: screen.source,
        screenId,
        screenProps: { [name]: 'short' },
      });
      for (const [variantId, value] of [
        ['A', 'short'],
        ['B', 'long'],
      ]) {
        const html = sourceHtml(prepared, variantId, screenId);
        assert.ok(html.includes(`data-prop-${name}="${value}"`));
        assert.ok(html.includes(`prop-${name}-${value}`));
        for (const frame of state.document.frames) {
          const fingerprint = prepared.fingerprints.find(
            (item) => item.variantId === variantId && item.frameId === frame.id,
          );
          assert.equal(
            fingerprint.contentDigest,
            reviewDigest({
              files: Object.entries(sourceDigests).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              width: frame.width,
              height: frame.height,
              props: { [name]: value },
            }),
          );
        }
      }
      assert.ok(
        prepared.lint.every(({ ok }) => ok),
        JSON.stringify(prepared.lint),
      );
    });
  }
}

test('direct bundling rejects prop tokens without schema validation', (t) => {
  const state = fixture(t);
  for (const screenProps of [
    { isDark: true },
    { theme: 'Dark mode' },
    { theme: false, Theme: true },
    { theme: 'dark\n' },
  ])
    assert.throws(
      () =>
        bundleLocalDocument({
          root: state.root,
          screenId: 'screen-1',
          source: state.document.screens[0].source,
          screenProps,
        }),
      /Screen screen-1 source source\/screen-1\.html has invalid prop/u,
    );
});

test('prop names with overlapping prefixes retain both generated classes', (t) => {
  const state = fixture(t);
  state.document.screens[0].props = {
    'state-detail': { type: 'enum', options: ['expanded'], default: 'expanded' },
    state: { type: 'enum', options: ['active'], default: 'active' },
  };
  state.document.variants[1].props = { 'screen-1': {} };
  const prepared = state.save();
  const html = sourceHtml(prepared, 'A');
  assert.match(html, /data-prop-state-detail="expanded"/u);
  assert.match(html, /data-prop-state="active"/u);
  assert.match(html, /class="[^"]*\bprop-state-detail-expanded\b[^"]*"/u);
  assert.match(html, /class="[^"]*\bprop-state-active\b[^"]*"/u);
  assert.ok(prepared.lint.every(({ ok }) => ok));
});

test('props are scoped by screen and apply to a variant source override', (t) => {
  const state = fixture(t, { count: 2 });
  state.document.screens[1].props = {
    theme: { type: 'enum', options: ['light', 'dark'], default: 'dark' },
  };
  const override = readFileSync(join(state.root, 'source/screen-1.html'), 'utf8').replace(
    '12 active tasks',
    'Override source content',
  );
  writeFileSync(join(state.root, 'source/override.html'), override);
  state.document.variants[1].sources = {
    'screen-1': { html: 'source/override.html', styles: ['source/style.css'] },
  };
  const prepared = state.save();
  assert.match(sourceHtml(prepared, 'B'), /Override source content/u);
  assert.match(sourceHtml(prepared, 'B'), /data-prop-theme="dark"/u);
  assert.match(sourceHtml(prepared, 'A', 'screen-2'), /data-prop-theme="dark"/u);
  assert.doesNotMatch(sourceHtml(prepared, 'B', 'screen-2'), /data-prop-expanded/u);
  assert.ok(
    prepared.lint.every(({ ok }) => ok),
    JSON.stringify(prepared.lint),
  );
});

for (const [label, value, message, lintMessage = message] of [
  ['unknown prop', { missing: 'light' }, /unknown prop 'missing'/u],
  [
    'inherited prop name',
    { toString: 'light' },
    /value "toString" does not match/u,
    /unknown prop 'toString'/u,
  ],
  ['enum outside options', { theme: 'sepia' }, /"sepia" is not an enum option/u],
  ['boolean with string value', { expanded: 'false' }, /expected a boolean, received "false"/u],
  ['enum with boolean value', { theme: false }, /false is not an enum option/u],
]) {
  test(`invalid instance ${label} fails validation and lint`, (t) => {
    const state = fixture(t);
    state.document.variants[1].props['screen-1'] = value;
    assert.throws(() => state.save(), message);
    const report = lint.lintDesign('<body><main>Workspace</main></body>', {
      screen: state.document.screens[0],
      variant: state.document.variants[1],
    });
    assert.match(report.errors.map(({ message }) => message).join('\n'), lintMessage);
  });
}

for (const [label, value, message] of [
  ['enum', 'sepia', /default: 'sepia' is not an enum option/u],
  ['boolean', 'true', /\$\.screens\[0\]\.props\.expanded: matched 0\/2 branches/u],
]) {
  test(`invalid ${label} default cannot be rendered`, (t) => {
    const state = fixture(t);
    const name = label === 'enum' ? 'theme' : 'expanded';
    state.document.screens[0].props[name].default = value;
    assert.throws(() => state.save(), message);
  });
}

for (const authored of [
  '<main><h1>Workspace</h1></main>',
  '<template><body><main>Ignored body</main></body></template>',
  '<script>window.marker = "<body>";</script><main>Workspace</main>',
  '<body><main>First root</main></body><body><main>Second root</main></body>',
]) {
  test(`props reject a source without one authored body: ${authored.slice(0, 25)}`, (t) => {
    const state = fixture(t);
    state.document.screens[0].anchors = [];
    writeFileSync(join(state.root, 'source/screen-1.html'), authored);
    assert.throws(
      () => state.save(),
      (error) => {
        assert.match(error.message, /screen-1/u);
        assert.match(error.message, /source\/screen-1\.html/u);
        assert.match(error.message, /root|body/iu);
        return true;
      },
    );
  });
}

test('body-like text in comments and scripts does not create extra roots', (t) => {
  const state = fixture(t);
  state.document.screens[0].anchors = [];
  writeFileSync(
    join(state.root, 'source/screen-1.html'),
    '<!doctype html><!-- <body> --><body><script>window.marker = "<body>";</script><main>Workspace</main></body>',
  );
  const prepared = state.save();
  assert.match(sourceHtml(prepared, 'A'), /data-prop-theme="light"/u);
  assert.match(sourceHtml(prepared, 'B'), /data-prop-theme="dark"/u);
});

function themeSources(first, second) {
  return [first, second].map((html, index) => ({
    screenId: `screen-${index + 1}`,
    source: {
      html: `source/screen-${index + 1}.html`,
      styles: ['source/shared.css'],
      scripts: ['source/shared.js'],
    },
    html,
  }));
}

test('theme-only lint warns only for root theme markers with otherwise identical bytes', () => {
  for (const attribute of ['data-theme="THEME"', 'class="app theme-THEME"', 'class=theme-THEME']) {
    const first = `<!doctype html><body ${attribute.replace('THEME', 'light')}><main>Workspace</main></body>`;
    const second = first.replace('light', 'dark');
    const warnings = lint.lintThemeOnlySources(themeSources(first, second));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].rule, 'theme-only-source');
    assert.equal(warnings[0].level, 'warn');
    assert.match(warnings[0].message, /screen-1/u);
    assert.match(warnings[0].message, /screen-2/u);
    for (const changed of [
      second.replace('Workspace', 'Settings'),
      second.replace('</body>', '<script>window.theme="dark"</script></body>'),
      second.replace('</body>', '<style>body{color:black}</style></body>'),
      second.replace('<main>', '<main data-theme="dark">'),
      second.replace('<body ', '<body id="other" '),
    ])
      assert.equal(lint.lintThemeOnlySources(themeSources(first, changed)).length, 0);
    const sameScreen = themeSources(first, second);
    sameScreen[1].screenId = sameScreen[0].screenId;
    assert.equal(lint.lintThemeOnlySources(sameScreen).length, 0);
    const otherStyles = themeSources(first, second);
    otherStyles[1].source.styles = ['source/other.css'];
    assert.equal(lint.lintThemeOnlySources(otherStyles).length, 0);
    const otherScripts = themeSources(first, second);
    otherScripts[1].source.scripts = ['source/other.js'];
    assert.equal(lint.lintThemeOnlySources(otherScripts).length, 0);
  }
  assert.equal(
    lint.lintThemeOnlySources(
      themeSources(
        '<body><main data-theme="light">Workspace</main></body>',
        '<body><main data-theme="dark">Workspace</main></body>',
      ),
    ).length,
    0,
  );
});

test('theme-only lint preserves the bytes of non-theme class spacing and quotes', () => {
  const first = '<body class="app theme-light"><main>Workspace</main></body>';
  for (const second of [
    '<body class="app  theme-dark"><main>Workspace</main></body>',
    "<body class='app theme-dark'><main>Workspace</main></body>",
  ]) {
    assert.deepEqual(lint.lintThemeOnlySources(themeSources(first, second)), []);
  }
});

test('bundling includes a theme-only source warning in its lint report', (t) => {
  const state = fixture(t, { count: 2, variants: 1 });
  for (const [index, screen] of state.document.screens.entries()) {
    screen.anchors = [];
    writeFileSync(
      join(state.root, screen.source.html),
      `<!doctype html><body data-theme="${index === 0 ? 'light' : 'dark'}"><main><h1>Workspace</h1></main></body>`,
    );
  }
  const prepared = state.save();
  assert.ok(
    prepared.lint.some(({ warnings }) => warnings.some(({ rule }) => rule === 'theme-only-source')),
  );
});
