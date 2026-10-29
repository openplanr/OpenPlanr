import assert from 'node:assert/strict';
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { prepareDesignDocument } from '../lib/design/document.mjs';
import { designUtility } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

const WOFF2 = readFileSync(
  fileURLToPath(new URL('fixtures/fonts/manrope-latin.woff2', import.meta.url)),
);
const CATALOG = 'https://raw.githubusercontent.com/google/fonts/main';
const OFL_TEXT = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.';
const APACHE_TEXT =
  '                                 Apache License\n                           Version 2.0, January 2004';
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F';

function face(subset, family, weight, url, range) {
  return `/* ${subset} */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(${url}) format('woff2');\n  unicode-range: ${range};\n}\n`;
}

/** Google Fonts CSS with cyrillic, latin-ext and latin faces; `variable` shares one latin file. */
function googleCss(family, slug, weights, { variable = false } = {}) {
  return weights
    .map((weight) => {
      const file = variable ? 'var' : weight;
      return [
        face(
          'cyrillic',
          family,
          weight,
          `https://fonts.gstatic.com/s/${slug}/cyrillic-${file}.woff2`,
          'U+0301, U+0400-045F',
        ),
        face(
          'latin-ext',
          family,
          weight,
          `https://fonts.gstatic.com/s/${slug}/latin-ext-${file}.woff2`,
          'U+0100-02BA',
        ),
        face(
          'latin',
          family,
          weight,
          `https://fonts.gstatic.com/s/${slug}/latin-${file}.woff2`,
          LATIN,
        ),
      ].join('');
    })
    .join('');
}

function cssUrl(family, weights) {
  return `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@${weights.join(';')}&display=swap`;
}

function catalog() {
  return new Map([
    [`${CATALOG}/ofl/inter/METADATA.pb`, 'name: "Inter"\nlicense: "OFL"\ncategory: "SANS_SERIF"\n'],
    [`${CATALOG}/ofl/inter/OFL.txt`, OFL_TEXT],
    [cssUrl('Inter', [400, 600]), googleCss('Inter', 'inter', [400, 600], { variable: true })],
    [`${CATALOG}/apache/chewy/METADATA.pb`, 'name: "Chewy"\nlicense: "APACHE2"\n'],
    [`${CATALOG}/apache/chewy/LICENSE.txt`, APACHE_TEXT],
    [cssUrl('Chewy', [400]), googleCss('Chewy', 'chewy', [400])],
    ['https://fonts.gstatic.com/s/inter/latin-var.woff2', WOFF2],
    ['https://fonts.gstatic.com/s/chewy/latin-400.woff2', WOFF2],
  ]);
}

/** A fetch double serving `routes`; unknown URLs are 404 and every request is recorded. */
function fakeFetch(routes = catalog(), { fail = new Map() } = {}) {
  const requests = [];
  const redirects = new Map();
  const fetchImpl = async (url, init) => {
    requests.push(url);
    redirects.set(url, init.redirect);
    assert.ok(init.signal instanceof AbortSignal, `${url} is requested without a timeout signal`);
    if (fail.has(url)) {
      const failure = fail.get(url);
      if (failure instanceof Error) throw failure;
      return new Response('error', { status: failure });
    }
    return routes.has(url)
      ? new Response(routes.get(url))
      : new Response('Not Found', { status: 404 });
  };
  return { fetchImpl, requests, redirects };
}

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'planr-font-fetch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, dest: join(root, 'source/assets/fonts') };
}

function run(args, fetchImpl) {
  return designUtility(['fonts', 'fetch', ...args], { fetchImpl, stdout: () => {} });
}

test('fetches Latin woff2 files, license files and local CSS for two families', async (t) => {
  const { root, dest } = workspace(t);
  const { fetchImpl, requests, redirects } = fakeFetch();

  const result = await run(
    ['--family', 'Inter:400,600', '--family', 'Chewy:400', '--dest', dest, '--json'],
    fetchImpl,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.families.map(({ family, license, weights }) => [family, license, weights]),
    [
      ['Inter', 'OFL-1.1', [400, 600]],
      ['Chewy', 'Apache-2.0', [400]],
    ],
  );
  assert.deepEqual(result.files.map(({ path }) => path).sort(), [
    'chewy/LICENSE.txt',
    'chewy/chewy-400-latin.woff2',
    'fonts.css',
    'inter/OFL.txt',
    'inter/inter-400-600-latin.woff2',
  ]);
  assert.equal(
    result.totalBytes,
    result.files.reduce((sum, { bytes }) => sum + bytes, 0),
  );
  assert.deepEqual(readFileSync(join(dest, 'inter/inter-400-600-latin.woff2')), WOFF2);
  assert.equal(readFileSync(join(dest, 'inter/OFL.txt'), 'utf8'), OFL_TEXT);
  const css = readFileSync(join(dest, 'fonts.css'), 'utf8');
  assert.match(
    css,
    /font-family: "Inter";[\s\S]*font-weight: 400 600;[\s\S]*url\("inter\/inter-400-600-latin\.woff2"\)/u,
  );
  assert.match(
    css,
    /font-family: "Chewy";[\s\S]*font-weight: 400;[\s\S]*url\("chewy\/chewy-400-latin\.woff2"\)/u,
  );
  assert.equal(requests.filter((url) => url.startsWith('https://fonts.gstatic.com/')).length, 2);
  assert.deepEqual(
    readdirSync(join(root, 'source/assets')),
    ['fonts'],
    'no staging folder is left',
  );
  assert.equal(statSync(dest).mode & 0o777, 0o755);
  for (const url of [
    'https://fonts.gstatic.com/s/inter/latin-var.woff2',
    'https://fonts.gstatic.com/s/chewy/latin-400.woff2',
    `${CATALOG}/ofl/inter/OFL.txt`,
    `${CATALOG}/apache/chewy/LICENSE.txt`,
  ])
    assert.equal(redirects.get(url), 'error', `${url} must not follow redirects`);
});

test('drops every non-Latin subset', async (t) => {
  const { dest } = workspace(t);
  const { fetchImpl, requests } = fakeFetch();

  await run(['--family', 'Chewy:400', '--dest', dest], fetchImpl);

  const fonts = requests.filter((url) => url.startsWith('https://fonts.gstatic.com/'));
  assert.deepEqual(fonts, ['https://fonts.gstatic.com/s/chewy/latin-400.woff2']);
  assert.doesNotMatch(readFileSync(join(dest, 'fonts.css'), 'utf8'), /cyrillic|latin-ext/u);
});

test('refuses families that are not verified as OFL or Apache', async (t) => {
  const cases = [
    [
      'missing from the open-license catalog',
      (routes) => routes.delete(`${CATALOG}/ofl/inter/METADATA.pb`),
      /not an OFL or Apache licensed/u,
    ],
    [
      'metadata declares another license',
      (routes) => routes.set(`${CATALOG}/ofl/inter/METADATA.pb`, 'name: "Inter"\nlicense: "UFL"\n'),
      /not verified as OFL-1\.1.*"UFL"/u,
    ],
    [
      'metadata names another family',
      (routes) =>
        routes.set(`${CATALOG}/ofl/inter/METADATA.pb`, 'name: "Inter Tight"\nlicense: "OFL"\n'),
      /not verified as OFL-1\.1.*"Inter Tight"/u,
    ],
    [
      'license file lacks the license text',
      (routes) => routes.set(`${CATALOG}/ofl/inter/OFL.txt`, 'All rights reserved.'),
      /OFL\.txt does not contain the license text/u,
    ],
  ];
  for (const [name, mutate, message] of cases) {
    const { dest } = workspace(t);
    const routes = catalog();
    mutate(routes);
    const { fetchImpl, requests } = fakeFetch(routes);
    await assert.rejects(
      run(['--family', 'Inter:400,600', '--dest', dest], fetchImpl),
      message,
      name,
    );
    assert.equal(existsSync(dest), false, name);
    assert.ok(
      !requests.some((url) => url.startsWith('https://fonts.gstatic.com/')),
      `${name}: no font is downloaded`,
    );
  }
});

test('enforces family, weight and syntax limits before any request', async (t) => {
  const cases = [
    [
      ['--family', 'Inter:400', '--family', 'Chewy:400', '--family', 'Lora:400'],
      /3 families requested \(Inter, Chewy, Lora\); at most 2/u,
    ],
    [
      ['--family', 'Inter:300,400,500,600'],
      /--family "Inter:300,400,500,600" has 4 weights; at most 3 per family/u,
    ],
    [['--family', 'Inter:450'], /--family "Inter:450" has weight 450/u],
    [['--family', 'Inter'], /--family "Inter" must look like "Inter:400,600"/u],
    [['--family', 'Inter:400', '--family', 'inter:600'], /names a family twice/u],
    [[], /requires at least one --family/u],
  ];
  for (const [args, message] of cases) {
    const { dest } = workspace(t);
    const { fetchImpl, requests } = fakeFetch();
    await assert.rejects(run([...args, '--dest', dest], fetchImpl), message);
    assert.deepEqual(requests, []);
  }
  const { fetchImpl } = fakeFetch();
  await assert.rejects(run(['--family', 'Inter:400'], fetchImpl), /requires --dest/u);
  await assert.rejects(
    designUtility(['fonts', 'list'], { fetchImpl, stdout: () => {} }),
    /fonts fetch --family/u,
  );
  await assert.rejects(
    designUtility(['fonts'], { fetchImpl, stdout: () => {} }),
    /\| design\.mjs fonts fetch --family/u,
  );
  for (const flag of [
    ['--family', 'Inter:400'],
    ['--dest', '/tmp/fonts'],
  ])
    await assert.rejects(
      designUtility(['validate', 'design-document.json', ...flag], { fetchImpl, stdout: () => {} }),
      new RegExp(`Unknown option for validate: ${flag[0]}`, 'u'),
    );
});

test('a family name in the wrong case points to the catalog name', async (t) => {
  const { dest } = workspace(t);
  const { fetchImpl, requests } = fakeFetch();
  await assert.rejects(
    run(['--family', 'inter:400', '--dest', dest], fetchImpl),
    /"inter" is listed as "Inter"; use the catalog name "Inter"\./u,
  );
  assert.equal(existsSync(dest), false);
  assert.ok(!requests.some((url) => url.startsWith('https://fonts.gstatic.com/')));
});

test('a failed or timed-out download leaves no font folder behind', async (t) => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
  for (const [failure, message] of [
    [
      500,
      /Font fetch failed: https:\/\/fonts\.gstatic\.com\/s\/chewy\/latin-400\.woff2: HTTP 500/u,
    ],
    [timeout, /chewy\/latin-400\.woff2: no response within 20 s/u],
  ]) {
    const { root, dest } = workspace(t);
    const { fetchImpl, requests } = fakeFetch(catalog(), {
      fail: new Map([['https://fonts.gstatic.com/s/chewy/latin-400.woff2', failure]]),
    });
    await assert.rejects(
      run(['--family', 'Inter:400,600', '--family', 'Chewy:400', '--dest', dest], fetchImpl),
      message,
    );
    assert.ok(
      requests.includes('https://fonts.gstatic.com/s/inter/latin-var.woff2'),
      'the first family downloaded',
    );
    assert.equal(existsSync(dest), false);
    assert.deepEqual(
      readdirSync(root).filter((name) => name.startsWith('.fonts-fetch-')),
      [],
    );
    assert.equal(existsSync(join(root, 'source/assets')), false);
  }
});

for (const method of ['writeFileSync', 'mkdtempSync', 'renameSync']) {
  for (const existingSource of [false, true]) {
    test(`${method} failure removes only newly created empty parents (existing source: ${existingSource})`, async (t) => {
      const { root, dest } = workspace(t);
      const source = join(root, 'source');
      if (existingSource) mkdirSync(source);
      const failure = Object.assign(new Error(`Injected ${method} failure: disk full`), {
        code: 'ENOSPC',
      });
      t.mock.method(fs, method, () => {
        throw failure;
      });
      syncBuiltinESMExports();
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });

      await assert.rejects(
        run(['--family', 'Chewy:400', '--dest', dest], fakeFetch().fetchImpl),
        (error) => error === failure,
      );

      assert.equal(existsSync(dest), false);
      assert.equal(existsSync(join(source, 'assets')), false);
      assert.equal(existsSync(source), existingSource);
      assert.deepEqual(readdirSync(root), existingSource ? ['source'] : []);
    });
  }
}

test('a failed write preserves newly created parents that gained other files', async (t) => {
  const { root, dest } = workspace(t);
  const assets = join(root, 'source/assets');
  const write = fs.writeFileSync;
  const failure = new Error('Injected write failure: disk full');
  t.mock.method(fs, 'writeFileSync', () => {
    write(join(assets, 'keep.txt'), 'concurrent file');
    throw failure;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  await assert.rejects(
    run(['--family', 'Chewy:400', '--dest', dest], fakeFetch().fetchImpl),
    (error) => error === failure,
  );

  assert.deepEqual(readdirSync(assets), ['keep.txt']);
  assert.equal(readFileSync(join(assets, 'keep.txt'), 'utf8'), 'concurrent file');
});

test('removes only staging sibling directories older than ten minutes', async (t) => {
  const { root, dest } = workspace(t);
  const assets = join(root, 'source/assets');
  mkdirSync(assets, { recursive: true });
  const old = new Date(Date.now() - 11 * 60_000);
  const recent = new Date(Date.now() - 9 * 60_000);
  const stale = join(assets, '.fonts-fetch-old');
  const fresh = join(assets, '.fonts-fetch-recent');
  const unrelated = join(assets, 'other-folder');
  const elsewhere = join(root, '.fonts-fetch-elsewhere');
  for (const directory of [stale, fresh, unrelated, elsewhere]) {
    mkdirSync(directory);
    writeFileSync(join(directory, 'keep.txt'), 'existing content');
    utimesSync(directory, old, old);
  }
  utimesSync(fresh, recent, recent);
  const file = join(assets, '.fonts-fetch-file');
  writeFileSync(file, 'ordinary file');
  utimesSync(file, old, old);
  const link = join(assets, '.fonts-fetch-link');
  symlinkSync(elsewhere, link, 'dir');

  await run(['--family', 'Chewy:400', '--dest', dest], fakeFetch().fetchImpl);

  assert.equal(existsSync(stale), false);
  assert.ok(existsSync(join(dest, 'fonts.css')));
  for (const directory of [fresh, unrelated, elsewhere, link])
    assert.equal(readFileSync(join(directory, 'keep.txt'), 'utf8'), 'existing content');
  assert.equal(readFileSync(file, 'utf8'), 'ordinary file');
});

test('stale staging cleanup preserves an empty destination named like a staging folder', async (t) => {
  const { root } = workspace(t);
  const dest = join(root, '.fonts-fetch-destination');
  mkdirSync(dest);
  const old = new Date(Date.now() - 11 * 60_000);
  utimesSync(dest, old, old);
  const failure = new Error('Injected staging creation failure');
  t.mock.method(fs, 'mkdtempSync', () => {
    throw failure;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  await assert.rejects(
    run(['--family', 'Chewy:400', '--dest', dest], fakeFetch().fetchImpl),
    (error) => error === failure,
  );

  assert.ok(existsSync(dest));
  assert.deepEqual(readdirSync(dest), []);
});

test('rejects non-woff2 bytes and a missing Latin weight', async (t) => {
  const routes = catalog();
  routes.set('https://fonts.gstatic.com/s/chewy/latin-400.woff2', Buffer.from('<html>'));
  const { dest } = workspace(t);
  await assert.rejects(
    run(['--family', 'Chewy:400', '--dest', dest], fakeFetch(routes).fetchImpl),
    /not woff2/u,
  );
  assert.equal(existsSync(dest), false);

  const latinExtOnly = catalog();
  latinExtOnly.set(
    cssUrl('Chewy', [400]),
    face('latin-ext', 'Chewy', 400, 'https://fonts.gstatic.com/s/chewy/x.woff2', 'U+0100-02BA'),
  );
  await assert.rejects(
    run(['--family', 'Chewy:400', '--dest', dest], fakeFetch(latinExtOnly).fetchImpl),
    /"Chewy" has no Latin woff2 face for weight 400/u,
  );
});

test('refuses a destination that already holds files', async (t) => {
  const { dest } = workspace(t);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'keep.txt'), 'mine');
  const { fetchImpl, requests } = fakeFetch();
  await assert.rejects(
    run(['--family', 'Chewy:400', '--dest', dest], fetchImpl),
    /already exists and is not empty/u,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(readdirSync(dest), ['keep.txt']);
});

test('the generated CSS renders as inlined data URIs in a design', async (t) => {
  const { root, dest } = workspace(t);
  const { file } = designFixture(root, { count: 1 });
  await run(['--family', 'Inter:400,600', '--dest', dest], fakeFetch().fetchImpl);
  const stylesheet = join(root, 'source/style.css');
  writeFileSync(
    stylesheet,
    `@import "assets/fonts/fonts.css";\n${readFileSync(stylesheet, 'utf8').replace('font:16px/1.5 system-ui', 'font:16px/1.5 "Inter",system-ui')}`,
  );

  const { envelope } = prepareDesignDocument(file);
  const html = resolveArtifactHtml(envelope, envelope.artifacts[0]);

  assert.match(html, /url\(\\?"?data:font\/woff2;base64,d09GMg/u);
  assert.ok(
    !html.includes('inter-400-600-latin.woff2'),
    'the relative font URL must not survive the render',
  );
  const references = [...html.matchAll(/url\(\s*\\?["']?([^"')\\\s]+)/gu)].map(
    ([, value]) => value,
  );
  assert.deepEqual(
    references.filter((value) => !value.startsWith('data:')),
    [],
  );
});
