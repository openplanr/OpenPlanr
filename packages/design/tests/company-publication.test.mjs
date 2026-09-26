import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256Hex } from '@openplanr/protocol/canonical-json';
import { assertCompanyDesignBundle } from '@openplanr/protocol/design-publication-contracts';
import {
  createCompanyDesignSourceReader,
  prepareCompanyDesignPublication,
} from '../lib/design/company-publication.mjs';
import { emptyReviewContext } from '../lib/design/context.mjs';
import { designFixture } from './design-fixture.mjs';

function fixture(t, options) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'planr-company-design-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, ...designFixture(root, options) };
}
function save(file, document) {
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

test('publishes all screens, frames and ready variants deterministically without render cache writes', (t) => {
  const { root, file, document } = fixture(t, { variants: 2 });
  const context = emptyReviewContext(document);
  context.brief.purpose = 'Review the order confirmation screens.';
  save(join(root, 'review-context.json'), context);
  const names = readdirSync(root),
    first = prepareCompanyDesignPublication(file),
    second = prepareCompanyDesignPublication(file);
  assert.equal(first.content, second.content);
  assert.equal(first.bundle.entries.length, 8);
  assert.deepEqual([first.screenCount, first.frameCount, first.variantCount], [2, 2, 2]);
  assert.equal(first.byteLength, Buffer.byteLength(first.content));
  assert.equal(first.sourceDigests['design-document.json'], sha256Hex(readFileSync(file)));
  assert.ok(first.sourceFiles.includes('review-context.json'));
  assert.deepEqual(readdirSync(root), names);
  assert.ok(!first.content.includes(root));
  assert.ok(!first.content.includes('source/screen-1.html'));
  assertCompanyDesignBundle(first.bundle);
});

test('company preparation never reads untrusted local render cache state', (t) => {
  const { root, file } = fixture(t, { count: 1 });
  mkdirSync(join(root, '.design'));
  writeFileSync(join(root, '.cache-sentinel'), 'This deliberately is not JSON.');
  symlinkSync(join(root, '.cache-sentinel'), join(root, '.design/current.json'));
  const publication = prepareCompanyDesignPublication(file);
  assert.equal(publication.screenCount, 1);
  assert.ok(publication.sourceFiles.every((path) => !path.startsWith('.design/')));
  assert.doesNotMatch(publication.content, /cache-sentinel|deliberately/);
});

test('embeds linked CSS, nested imports, images and fonts while omitting authored scripts and handlers', (t) => {
  const { root, file, document } = fixture(t, { count: 1 });
  mkdirSync(join(root, 'source/assets'));
  writeFileSync(
    join(root, 'source/assets/logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0h20v20H0z"/></svg>',
  );
  writeFileSync(
    join(root, 'source/assets/font.woff2'),
    Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2]),
  );
  writeFileSync(
    join(root, 'source/nested.css'),
    '@font-face{font-family:Test;src:url("assets/font.woff2")}main{background-image:url("assets/logo.svg")}',
  );
  writeFileSync(join(root, 'source/linked.css'), '@import "nested.css";h1{color:#123456}');
  writeFileSync(join(root, 'source/runtime.js'), 'window.authorScript = true;');
  document.screens[0].source.scripts = ['source/runtime.js'];
  save(file, document);
  const source = join(root, 'source/screen-1.html');
  writeFileSync(
    source,
    readFileSync(source, 'utf8')
      .replace(
        '</head>',
        '<link rel="stylesheet" href="linked.css"><script type="module" src="runtime.js"></script></head>',
      )
      .replace(
        '</body>',
        '<img src="assets/logo.svg" alt="ACME"><script>window.inline = true;</script></body>',
      ),
  );
  const publication = prepareCompanyDesignPublication(file),
    html = publication.bundle.envelope.artifacts[0].html;
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.match(html, /data:font\/woff2;base64/);
  assert.match(html, /data-planr-id="action-1"/);
  assert.match(html, /data-planr-screen="screen-1"/);
  assert.doesNotMatch(html, /<script|onclick=|authorScript|window\.inline/);
  for (const name of [
    'source/linked.css',
    'source/nested.css',
    'source/assets/logo.svg',
    'source/assets/font.woff2',
    'source/runtime.js',
  ])
    assert.ok(publication.sourceFiles.includes(name));
  assert.deepEqual(publication.mediaKinds, ['font/woff2', 'image/svg+xml']);
  assert.match(publication.warnings.join(' '), /passive.*scripts/);
});

test('rejects unsafe dependencies before their contents can be bundled', (t) => {
  for (const [name, path, setup, expected] of [
    ['traversal', '../../outside.css', () => {}, /outside|escapes/],
    ['external', 'https://example.invalid/style.css', () => {}, /local relative/],
    [
      'secret',
      '.env.local',
      (root) => writeFileSync(join(root, 'source/.env.local'), 'TOKEN=secret'),
      /secrets|internal/,
    ],
    [
      'internal',
      '.local/data.css',
      (root) => {
        mkdirSync(join(root, 'source/.local'));
        writeFileSync(join(root, 'source/.local/data.css'), 'body{}');
      },
      /secrets|internal/,
    ],
    [
      'symlink',
      'linked.css',
      (root) => symlinkSync(join(root, 'source/style.css'), join(root, 'source/linked.css')),
      /symbolic/,
    ],
    ['missing', 'missing.css', () => {}, /ENOENT/],
  ]) {
    const { root, file } = fixture(t, { count: 1 });
    setup(root);
    const source = join(root, 'source/screen-1.html');
    writeFileSync(
      source,
      readFileSync(source, 'utf8').replace(
        '</head>',
        `<link rel="stylesheet" href="${path}"></head>`,
      ),
    );
    assert.throws(() => prepareCompanyDesignPublication(file), expected, name);
  }
});

test('SVG image payloads omit executable content, bundle referenced assets and reject remote dependencies', (t) => {
  const { root, file } = fixture(t, { count: 1 });
  const svg = join(root, 'source/logo.svg'),
    source = join(root, 'source/screen-1.html');
  writeFileSync(join(root, 'source/pixel.png'), Buffer.from([137, 80, 78, 71]));
  writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><foreignObject><button>Unsafe</button></foreignObject><image href="pixel.png"/></svg>',
  );
  writeFileSync(
    source,
    readFileSync(source, 'utf8').replace('</main>', '<img src="logo.svg" alt="Logo"></main>'),
  );
  const publication = prepareCompanyDesignPublication(file);
  const encoded = /data:image\/svg\+xml;base64,([A-Za-z\d+/=]+)/u.exec(
    publication.bundle.envelope.artifacts[0].html,
  )[1];
  const image = Buffer.from(encoded, 'base64').toString('utf8');
  assert.doesNotMatch(image, /script|onload|foreignObject|bad/);
  assert.match(image, /data:image\/png;base64/);
  assert.ok(publication.sourceFiles.includes('source/pixel.png'));
  writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/private.png"/></svg>',
  );
  assert.throws(() => prepareCompanyDesignPublication(file), /local relative/);
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><image href="logo.svg"/></svg>');
  assert.throws(() => prepareCompanyDesignPublication(file), /Circular/);
});

test('rejects symlink documents and credential-bearing sources even when scripts are omitted', (t) => {
  const { root, file, document } = fixture(t);
  symlinkSync(file, join(root, 'linked-document.json'));
  assert.throws(
    () => prepareCompanyDesignPublication(join(root, 'linked-document.json')),
    /symbolic/,
  );
  writeFileSync(
    join(root, 'source/runtime.js'),
    `const authorization = "Bearer ${'a'.repeat(30)}";`,
  );
  document.screens[0].source.scripts = ['source/runtime.js'];
  save(file, document);
  assert.throws(() => prepareCompanyDesignPublication(file), /credentials/);
});

test('rejects local path leakage, missing anchors and source/output budget overflow', (t) => {
  const { root, file, document } = fixture(t);
  assert.throws(() => prepareCompanyDesignPublication(file, { maxBytes: 500 }), /budget/);
  assert.throws(() => prepareCompanyDesignPublication(file, { maxBytes: 1048577 }), /1 MiB/);
  const source = join(root, 'source/screen-1.html');
  const original = readFileSync(source, 'utf8');
  writeFileSync(
    source,
    original.replace('</main>', '<p>/Users/example/private-project</p></main>'),
  );
  assert.throws(() => prepareCompanyDesignPublication(file), /filesystem/);
  writeFileSync(source, original.replace('data-planr-id="action-1"', ''));
  assert.throws(() => prepareCompanyDesignPublication(file), /missing.*anchor/);
  writeFileSync(source, original + 'x'.repeat(20000));
  document.frames = Array.from({ length: 16 }, (_, i) => ({
    id: `frame${i}`,
    label: `Frame ${i}`,
    width: 1440,
    height: 1024,
  }));
  document.variants = Array.from({ length: 4 }, (_, i) => ({
    id: `V${i}`,
    label: `Variant ${i}`,
    status: 'ready',
  }));
  document.selectedVariant = 'V0';
  save(file, document);
  assert.throws(() => prepareCompanyDesignPublication(file), /budget/);
});

test('source mutation, inode replacement and new symlinks invalidate the prepared snapshot', (t) => {
  const { root, file } = fixture(t);
  const source = join(root, 'source/style.css');
  for (const mutate of [
    () => writeFileSync(source, 'body{color:red}'),
    () => {
      const value = readFileSync(source);
      rmSync(source);
      writeFileSync(source, value);
    },
    () => {
      rmSync(source);
      symlinkSync(file, source);
    },
  ]) {
    const reader = createCompanyDesignSourceReader(file, 1048576);
    reader.readSource('source/style.css', root);
    mutate();
    assert.throws(() => reader.verify(), /changed|symbolic/);
  }
});

test('company publication bounds acyclic import expansion before producing large intermediate CSS', (t) => {
  const { root, file, document } = fixture(t, { count: 1 });
  document.screens[0].source.styles = ['source/level-0.css'];
  save(file, document);
  for (let level = 0; level < 20; level++)
    writeFileSync(
      join(root, `source/level-${level}.css`),
      `@import "level-${level + 1}.css";@import "level-${level + 1}.css";`,
    );
  writeFileSync(join(root, 'source/level-20.css'), `/*${'x'.repeat(1024)}*/`);
  assert.throws(() => prepareCompanyDesignPublication(file), /Stylesheet expansion.*budget/);
});
