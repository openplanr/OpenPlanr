import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { parse } from 'parse5';

import { bundleLocalDocument, resolveLocalDocumentFile } from '../lib/artifact/local-document.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-local-document-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function bundle(root, source = { html: 'screen.html' }, options = {}) {
  return bundleLocalDocument({ root, source, screenId: 'overview', ...options });
}

test('bundle resolves imported CSS, fonts, images and classic JavaScript without modifying authored files', (t) => {
  const files = {
    'screen.html':
      '<!doctype html><head><link rel="STYLESHEET" href="css/main.css"></head><body><img src="media/logo.svg"><script src="app.js"></script></body>',
    'css/main.css':
      '@import "nested/tokens.css" screen; body { background: url("../media/background.png") }',
    'css/nested/tokens.css':
      '@font-face { font-family: Brand; src: url("../../media/brand.woff2") }',
    'media/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'media/background.png': Buffer.from([0, 1, 2, 3, 255]),
    'media/brand.woff2': Buffer.from([1, 2, 3, 4, 255]),
    'app.js': 'throw new Error("Only the browser should execute this");',
  };
  const root = fixture(t, files);
  const result = bundle(root);
  assert.match(result.html, /data-planr-screen="overview"/u);
  assert.match(result.html, /@media screen/u);
  assert.match(result.html, /data:font\/woff2;base64,/u);
  assert.match(result.html, /data:image\/png;base64,/u);
  assert.match(result.html, /data:image\/svg\+xml;base64,/u);
  assert.match(result.html, /Only the browser should execute this/u);
  assert.doesNotMatch(result.html, /@import|<script src=|<link rel=/u);
  assert.deepEqual(new Set(result.files), new Set(Object.keys(files)));
  for (const [path, content] of Object.entries(files))
    assert.deepEqual(readFileSync(join(root, path)), Buffer.from(content));
});

test('external deferred scripts bind controls after parsing the body and preserve source order', (t) => {
  const root = fixture(t, {
    'screen.html':
      '<head><script src="first.js" defer></script><script src="second.js" defer></script></head><body><button id="action">Save</button><script>order.push("body");</script></body>',
    'first.js': 'document.getElementById("action").ready = true; order.push("first");',
    'second.js': 'order.push("second");',
  });
  const document = parse(bundle(root).html);
  const elements = new Map();
  const context = { document: { getElementById: (id) => elements.get(id) }, order: [] };
  function visit(node) {
    const id = node.attrs?.find((attribute) => attribute.name === 'id')?.value;
    if (id) elements.set(id, {});
    if (node.tagName === 'script')
      new Script(node.childNodes.map(({ value }) => value ?? '').join('')).runInNewContext(context);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  assert.equal(elements.get('action').ready, true);
  assert.deepEqual(context.order, ['body', 'first', 'second']);
});

test('nested deferred scripts keep document order when the HTML hierarchy differs', (t) => {
  const root = fixture(t, {
    'screen.html':
      '<body><section><div><script src="first.js" defer></script></div></section><script src="second.js" defer></script></body>',
    'first.js': 'window.first = true;',
    'second.js': 'window.second = true;',
  });
  const { html } = bundle(root);
  assert.ok(html.indexOf('window.first') < html.indexOf('window.second'));
});

test('local forms and validation attributes remain interactive while submit destinations are rejected', (t) => {
  const root = fixture(t, {
    'screen.html':
      '<form><label>Email<input name="email" type="email" required></label><button type="submit">Continue</button></form>',
  });
  assert.match(bundle(root).html, /<form>/u);
  assert.match(bundle(root).html, /type="email" required/u);
  for (const [attribute, value] of [
    ['action', 'https://example.com'],
    ['action', '/submit'],
    ['target', '_blank'],
  ]) {
    writeFileSync(
      join(root, 'screen.html'),
      `<form ${attribute}="${value}"><input name="email"></form>`,
    );
    assert.throws(() => bundle(root), /local submit handlers/u);
  }
  writeFileSync(
    join(root, 'screen.html'),
    '<form><button formaction="/submit">Continue</button></form>',
  );
  assert.throws(() => bundle(root), /local submit handlers/u);
});

test('SVG image and use references include their local media and preserve symbol fragments', (t) => {
  const root = fixture(t, {
    'screen.html':
      '<svg><image href="media/logo.svg"/><use href="media/logo.svg#mark"/><use href="#local"/></svg>',
    'media/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="mark"></symbol></svg>',
  });
  const result = bundle(root);
  assert.match(result.html, /<image href="data:image\/svg\+xml;base64,/u);
  assert.match(result.html, /<use href="data:image\/svg\+xml;base64,[^"]+#mark"/u);
  assert.match(result.html, /<use href="#local"/u);
  assert.deepEqual(new Set(result.files), new Set(['screen.html', 'media/logo.svg']));
  for (const attribute of ['href', 'xlink:href']) {
    writeFileSync(
      join(root, 'screen.html'),
      `<svg><image ${attribute}="https://example.com/tracker.svg"/></svg>`,
    );
    assert.throws(() => bundle(root), /local relative asset/u);
  }
});

test('relative source escapes, external references, symlink escapes and missing assets fail closed', (t) => {
  const root = fixture(t, { 'screen.html': '<p>Contained</p>' });
  const outside = fixture(t, { 'external.html': '<p>Outside</p>' });
  symlinkSync(join(outside, 'external.html'), join(root, 'escape.html'));
  for (const path of [
    '../external.html',
    join(outside, 'external.html'),
    'https://example.com/screen.html',
    'escape.html',
    'missing.html',
  ]) {
    assert.throws(() => bundle(root, { html: path }), undefined, path);
  }
  assert.throws(() => resolveLocalDocumentFile(root, '.'), /regular file/u);
  writeFileSync(
    join(root, 'screen.html'),
    '<style>body{background:url(https://example.com/image.png)}</style>',
  );
  assert.throws(() => bundle(root), /local relative asset/u);
});

test('style and source order stay explicit and imported stylesheet cycles fail with a diagnosis', (t) => {
  const root = fixture(t, {
    'screen.html': '<style>p { color: red }</style><p>Copy</p>',
    'tokens.css': ':root { --text: black }',
    'project.css': 'p { color: var(--text) }',
    'app.js': 'document.title = "Loaded";',
    'cycle.css': '@import "cycle.css";',
  });
  const html = bundle(
    root,
    { html: 'screen.html', styles: ['project.css'], scripts: ['app.js'] },
    { sharedStyles: ['tokens.css'] },
  ).html;
  assert.ok(html.indexOf('--text: black') < html.indexOf('color: var(--text)'));
  assert.ok(html.indexOf('color: var(--text)') < html.indexOf('color: red'));
  assert.match(html, /document.title = "Loaded"/u);
  assert.throws(
    () => bundle(root, { html: 'screen.html', styles: ['cycle.css'] }),
    /Circular stylesheet import/u,
  );
});

test('budget and unsupported source diagnostics never publish a partial result', (t) => {
  const root = fixture(t, {
    'screen.html': '<p>Content</p>',
    'app.js': 'import thing from "package-name";',
  });
  assert.throws(() => bundle(root, { html: 'screen.html' }, { maxBytes: 1 }), /budget/u);
  assert.throws(
    () => bundle(root, { html: 'screen.html', scripts: ['app.js'] }),
    /self-contained browser JavaScript/u,
  );
  writeFileSync(
    join(root, 'screen.html'),
    '<script type="module">document.title = "Module";</script>',
  );
  assert.throws(() => bundle(root), /Compile module scripts/u);
  writeFileSync(join(root, 'screen.html'), '<iframe src="screen.html"></iframe>');
  assert.throws(() => bundle(root), /Unsupported <iframe>/u);
});

test('repeated acyclic imports fail before allocating exponential CSS output', (t) => {
  const files = { 'screen.html': '<link rel="stylesheet" href="level-0.css"><p>Content</p>' };
  for (let level = 0; level < 20; level++)
    files[`level-${level}.css`] =
      `@import "level-${level + 1}.css";@import "level-${level + 1}.css";`;
  files['level-20.css'] = `/*${'x'.repeat(1024)}*/`;
  const root = fixture(t, files);
  assert.throws(
    () => bundle(root, { html: 'screen.html' }, { maxBytes: 1048576 }),
    /Stylesheet expansion.*budget/,
  );
  // A zero-byte leaf must not permit unbounded traversal either.
  writeFileSync(join(root, 'level-20.css'), '');
  assert.throws(
    () => bundle(root, { html: 'screen.html' }, { maxBytes: 1048576 }),
    /complexity.*budget/,
  );
});
