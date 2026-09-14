import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { bundleArtifact } from '../../lib/artifact/bundle.mjs';
import { serveStaticFile } from '../../lib/design/path-util.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const roots = [];

after(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function fixture(prefix = 'planr-artifact-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function write(root, path, contents) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    return true;
  };
}

function publicLookup() {
  return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
}

function remoteResponses(entries) {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    requests.push({ url, options });
    const entry = entries[url];
    if (!entry) return new Response('missing', { status: 404 });
    if (entry instanceof Error) throw entry;
    return new Response(entry.body ?? '', {
      status: entry.status ?? 200,
      headers: entry.headers ?? {},
    });
  };
  return { fetchImpl, requests };
}

function createSupportedGraph(root) {
  const pixel = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  write(root, 'assets/pixel.png', pixel);
  write(root, 'assets/pixel-copy.png', pixel);
  write(root, 'assets/font.woff2', Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0x01, 0x02]));
  write(root, 'assets/icons.svg', '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="check"><path d="M0 0h1v1z"/></symbol></svg>');
  write(root, 'styles/nested/base.css', '.base{background-image:url("../../assets/pixel.png")}');
  write(root, 'styles/main.css', '@import "./nested/base.css";@font-face{font-family:Demo;src:url("../assets/font.woff2")}body{font-family:Demo}');
  write(root, 'scripts/dep.js', 'export const message = "bundled module";');
  write(root, 'scripts/module.js', 'import { message } from "./dep.js"; document.documentElement.dataset.message = message;');
  write(root, 'scripts/classic.js', 'window.classicReady = true;');
  write(root, 'index.html', `<!doctype html><html><head>
    <link rel="stylesheet" href="./styles/main.css">
    <style>.inline{background:url('./assets/pixel-copy.png')}</style>
    <script src="./scripts/classic.js"></script>
    <script type="module" src="./scripts/module.js"></script>
  </head><body>
    <img src="./assets/pixel.png" srcset="data:image/png;base64,iVBORw0KGgo= 1x, ./assets/pixel-copy.png 2x">
    <img src="./assets/pixel.png">
    <svg xmlns="http://www.w3.org/2000/svg"><use href="./assets/icons.svg#check"></use><image href="./assets/icons.svg"></image></svg>
  </body></html>`);
}

test('supported HTML, JS/module, CSS, image, SVG, font, and srcset graph bundles deterministically', async () => {
  const root = fixture();
  createSupportedGraph(root);
  const first = await bundleArtifact('index.html', { root });
  const second = await bundleArtifact('index.html', { root });

  assert.deepEqual(second, first);
  assert.equal(first.sha256.length, 64);
  assert.equal(first.fileCount, 10);
  assert.equal(first.files.filter((path) => path === 'assets/pixel.png').length, 1, 'duplicate references read once');
  assert.ok(first.assets.length < first.fileCount, 'equal-content files are deduplicated in asset records');
  const inputHashes = new Set(first.files.map((path) => (
    createHash('sha256').update(readFileSync(join(root, path))).digest('hex')
  )));
  assert.ok(first.assets.every(({ sha256 }) => inputHashes.has(sha256)), 'asset records describe decoded graph inputs only');
  assert.doesNotMatch(first.html, /(?:src|href)="\.\//);
  assert.doesNotMatch(first.html, /<link[^>]+stylesheet/i);
  assert.doesNotMatch(first.html, /<script[^>]+src=/i);
  assert.doesNotMatch(first.html, /planr-asset:/);
  assert.match(first.html, /data:image\/png;base64,/);
  assert.match(first.html, /data:font\/woff2;base64,/);
  assert.match(first.html, /data:image\/svg\+xml;base64,[^" ]+#check/);
  assert.match(first.html, /window\.classicReady/);
  assert.match(first.html, /bundled module/);
});

test('bundled bytes are independent of the absolute temporary root path', async () => {
  const left = fixture('planr-artifact-left-');
  const right = fixture('planr-artifact-right-');
  createSupportedGraph(left);
  createSupportedGraph(right);
  const leftResult = await bundleArtifact('index.html', { root: left });
  const rightResult = await bundleArtifact('index.html', { root: right });
  assert.equal(leftResult.html, rightResult.html);
  assert.equal(leftResult.sha256, rightResult.sha256);
  assert.deepEqual(leftResult.files, rightResult.files);
});

test('canonical real roots accept platform aliases and symlinked root paths', async (t) => {
  const parent = fixture();
  const root = join(parent, 'site');
  const alias = join(parent, 'site-alias');
  mkdirSync(root);
  write(root, 'index.html', '<p>safe</p>');
  try {
    symlinkSync(root, alias);
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error.code}`);
    return;
  }
  const result = await bundleArtifact('index.html', { root: alias });
  assert.match(result.html, /<p>safe<\/p>/);
  assert.deepEqual(result.files, ['index.html']);
});

test('static serving follows final realpaths and blocks in-root symlink escape', (t) => {
  const parent = fixture();
  const root = join(parent, 'site');
  mkdirSync(root);
  const outside = write(parent, 'outside.html', '<p>private</p>');
  try {
    symlinkSync(outside, join(root, 'linked.html'));
  } catch (error) {
    t.skip(`symlink unavailable: ${error.code}`);
    return;
  }
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = String(body ?? ''); },
  };
  assert.equal(serveStaticFile(response, root, 'linked.html', { '.html': 'text/html' }), false);
  assert.equal(response.status, 403);
  assert.doesNotMatch(response.body, /private/);
});

test('remote resources can be explicitly rejected while forms and navigation always fail closed', async (t) => {
  const cases = [
    ['remote image', '<img src="https://example.test/a.png">', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['protocol-relative script', '<script src="//example.test/a.js"></script>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['remote CSS', '<style>@import "https://example.test/a.css";</style>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['form', '<form><button>send</button></form>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['frame', '<frameset><frame src="other.html"></frameset>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['srcdoc', '<div srcdoc="<p>hidden</p>"></div>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['anchor navigation', '<a href="other.html">leave</a>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=other.html">', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['template form', '<template><form><button>send</button></form></template>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['template missing dependency', '<template><img src="missing.png"></template>', ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET],
    ['noscript fallback', '<noscript><img src="//evil.test/p.png"></noscript>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['noembed fallback', '<noembed><img src="//evil.test/p.png"></noembed>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
    ['noframes fallback', '<noframes><img src="//evil.test/p.png"></noframes>', ARTIFACT_ERROR_CODES.UNSAFE_HTML],
  ];
  for (const [name, html, code] of cases) {
    await t.test(name, async () => {
      const root = fixture();
      write(root, 'index.html', `<!doctype html>${html}`);
      await assert.rejects(
        bundleArtifact('index.html', { root, remoteAssets: 'reject' }),
        expectCode(code),
      );
    });
  }
});

test('safe HTTPS dependency graphs are fetched, bounded, and vendored into immutable HTML', async () => {
  const root = fixture();
  write(root, 'index.html', `<!doctype html><html><head>
    <style>
      @import url('https://fonts.example.test/css?family=Inter');
      .hero { background-image: url("https://cdn.example.test/hero.png"); }
    </style>
    <script src="https://cdn.example.test/app.js"></script>
  </head><body><img src="https://cdn.example.test/avatar.webp"><div class="hero">Ready</div></body></html>`);
  const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x01, 0x02]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const webp = Buffer.from('RIFFdemoWEBP', 'ascii');
  const { fetchImpl, requests } = remoteResponses({
    'https://fonts.example.test/css?family=Inter': {
      body: '@font-face{font-family:Inter;src:url("https://fonts-cdn.example.test/inter.woff2") format("woff2")}body{font-family:Inter}.shape{filter:url(#arrow)}',
      headers: { 'content-type': 'text/css; charset=utf-8' },
    },
    'https://fonts-cdn.example.test/inter.woff2': {
      body: font,
      headers: { 'content-type': 'font/woff2' },
    },
    'https://cdn.example.test/hero.png': {
      body: png,
      headers: { 'content-type': 'image/png' },
    },
    'https://cdn.example.test/avatar.webp': {
      body: webp,
      headers: { 'content-type': 'image/webp' },
    },
    'https://cdn.example.test/app.js': {
      body: 'window.remoteAssetReady = true;',
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    },
  });

  const result = await bundleArtifact('index.html', {
    root,
    fetchImpl,
    lookupImpl: publicLookup,
  });

  assert.equal(result.remoteAssetCount, 5);
  assert.equal(result.fileCount, 6);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ options }) => options.redirect === 'manual'));
  assert.match(result.html, /data:font\/woff2;base64,/);
  assert.match(result.html, /data:image\/png;base64,/);
  assert.match(result.html, /data:image\/webp;base64,/);
  assert.match(result.html, /window\.remoteAssetReady/);
  assert.doesNotMatch(result.html, /https?:\/\//);
  assert.deepEqual(result.files, ['index.html']);
  assert.ok(result.assets.every((asset) => !('url' in asset)));
});

test('remote redirects are revalidated and content is fetched once per canonical URL', async () => {
  const root = fixture();
  write(root, 'index.html', '<img src="https://assets.example.test/logo">');
  const { fetchImpl, requests } = remoteResponses({
    'https://assets.example.test/logo': {
      status: 302,
      headers: { location: 'https://cdn.example.test/logo.png' },
    },
    'https://cdn.example.test/logo.png': {
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { 'content-type': 'image/png' },
    },
  });
  const result = await bundleArtifact('index.html', {
    root,
    fetchImpl,
    lookupImpl: publicLookup,
  });
  assert.equal(result.remoteAssetCount, 1);
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://assets.example.test/logo',
    'https://cdn.example.test/logo.png',
  ]);
  assert.match(result.html, /data:image\/png;base64,/);
});

test('remote linked stylesheets and module imports retain their dependency graph offline', async () => {
  const root = fixture();
  write(root, 'index.html', `<!doctype html><head>
    <link rel="stylesheet" href="https://cdn.example.test/site.css">
    <script type="module" src="https://cdn.example.test/app.mjs"></script>
  </head><body></body>`);
  const { fetchImpl } = remoteResponses({
    'https://cdn.example.test/site.css': {
      body: '.cover{background:url("./cover.png")}',
      headers: { 'content-type': 'text/css' },
    },
    'https://cdn.example.test/cover.png': {
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { 'content-type': 'image/png' },
    },
    'https://cdn.example.test/app.mjs': {
      body: 'import { message } from "./message.mjs"; document.body.dataset.message = message;',
      headers: { 'content-type': 'text/javascript' },
    },
    'https://cdn.example.test/message.mjs': {
      body: 'export const message = "packaged remote module";',
      headers: { 'content-type': 'text/javascript' },
    },
  });
  const result = await bundleArtifact('index.html', {
    root,
    fetchImpl,
    lookupImpl: publicLookup,
  });
  assert.equal(result.remoteAssetCount, 4);
  assert.match(result.html, /data:image\/png;base64,/);
  assert.match(result.html, /packaged remote module/);
  assert.doesNotMatch(result.html, /https?:\/\//);
});

test('remote vendoring rejects unsafe targets, failures, limits, and runtime network behavior', async (t) => {
  const unsafe = [
    'http://cdn.example.test/a.png',
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://user:pass@cdn.example.test/a.png',
    'https://cdn.example.test:8443/a.png',
    'https://service.local/a.png',
  ];
  for (const url of unsafe) {
    await t.test(`unsafe target ${url}`, async () => {
      const root = fixture();
      write(root, 'index.html', `<img src="${url}">`);
      await assert.rejects(
        bundleArtifact('index.html', {
          root,
          fetchImpl: async () => {
            throw new Error('must not fetch');
          },
          lookupImpl: publicLookup,
        }),
        expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
      );
    });
  }

  await t.test('hostname resolving to a private address', async () => {
    const root = fixture();
    write(root, 'index.html', '<img src="https://cdn.example.test/a.png">');
    await assert.rejects(
      bundleArtifact('index.html', {
        root,
        fetchImpl: async () => new Response('image', { headers: { 'content-type': 'image/png' } }),
        lookupImpl: async () => [{ address: '10.0.0.4', family: 4 }],
      }),
      expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
    );
  });

  await t.test('HTTP failure', async () => {
    const root = fixture();
    write(root, 'index.html', '<img src="https://cdn.example.test/missing.png">');
    await assert.rejects(
      bundleArtifact('index.html', {
        root,
        fetchImpl: async () => new Response('missing', { status: 404 }),
        lookupImpl: publicLookup,
      }),
      expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
    );
  });

  await t.test('remote graph shares the decoded-byte limit', async () => {
    const root = fixture();
    write(root, 'index.html', '<img src="https://cdn.example.test/large.png">');
    await assert.rejects(
      bundleArtifact('index.html', {
        root,
        maxBytes: 100,
        fetchImpl: async () => new Response(Buffer.alloc(200), {
          headers: { 'content-type': 'image/png', 'content-length': '200' },
        }),
        lookupImpl: publicLookup,
      }),
      expectCode(ARTIFACT_ERROR_CODES.BYTE_LIMIT),
    );
  });

  await t.test('downloaded scripts cannot retain network behavior', async () => {
    const root = fixture();
    write(root, 'index.html', '<script src="https://cdn.example.test/app.js"></script>');
    await assert.rejects(
      bundleArtifact('index.html', {
        root,
        fetchImpl: async () => new Response('fetch("https://api.example.test/private")', {
          headers: { 'content-type': 'text/javascript' },
        }),
        lookupImpl: publicLookup,
      }),
      expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
    );
  });
});

test('ambiguous srcset and active embedded SVG data fail closed', async (t) => {
  await t.test('ambiguous data URI candidate list', async () => {
    const root = fixture();
    write(root, 'index.html', '<img srcset="data:image/png;base64,iVBORw0KGgo=,//evil.test/p.png 2x">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.INPUT_INVALID));
  });
  await t.test('base64 SVG containing a remote image', async () => {
    const root = fixture();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/p.png"/></svg>').toString('base64');
    write(root, 'index.html', `<img src="data:image/svg+xml;base64,${svg}">`);
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET));
  });
  await t.test('base64 SVG cannot define a remote xml:base', async () => {
    const root = fixture();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" xml:base="//evil.test/"><use href="#x"/></svg>').toString('base64');
    write(root, 'index.html', `<img src="data:image/svg+xml;base64,${svg}">`);
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
});

test('valid multi-candidate srcset is rewritten once and remains below the output cap', async () => {
  const root = fixture();
  write(root, 'one.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  write(root, 'two.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]));
  write(root, 'index.html', '<img srcset="one.png 1x, two.png 2x">');
  const result = await bundleArtifact('index.html', { root });
  assert.equal((result.html.match(/data:image\/png;base64,/g) ?? []).length, 2);
  assert.match(result.html, / 1x, data:image\/png;base64,[^" ]+ 2x/);
});

test('inert script data is preserved and executable script metadata fails closed', async () => {
  const root = fixture();
  write(root, 'index.html', '<script type="application/json">{"label":"safe"}</script>');
  const result = await bundleArtifact('index.html', { root });
  assert.match(result.html, /type="application\/json">\{"label":"safe"\}<\/script>/);

  write(root, 'unsupported.html', '<script type="importmap">{"imports":{}}</script>');
  await assert.rejects(
    bundleArtifact('unsupported.html', { root }),
    expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE),
  );
});

test('external SVG dependency graphs are inspected and packaged or rejected', async (t) => {
  await t.test('nested local image is packaged', async () => {
    const root = fixture();
    write(root, 'pixel.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="pixel.png"/></svg>');
    write(root, 'index.html', '<img src="icon.svg">');
    const result = await bundleArtifact('index.html', { root });
    const encoded = result.html.match(/data:image\/svg\+xml;base64,([^"#]+)/)?.[1];
    assert.ok(encoded);
    assert.match(Buffer.from(encoded, 'base64').toString('utf8'), /data:image\/png;base64,/);
  });
  await t.test('remote nested image is rejected', async () => {
    const root = fixture();
    write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/pixel.png"/></svg>');
    write(root, 'index.html', '<img src="icon.svg">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET));
  });
  await t.test('embedded SVG script is rejected', async () => {
    const root = fixture();
    write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    write(root, 'index.html', '<img src="icon.svg">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
  await t.test('SMIL cannot mutate a packaged URL attribute', async () => {
    const root = fixture();
    write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image id="target"/><set href="#target" attributeName="href" to="//evil.test/p.png"/></svg>');
    write(root, 'index.html', '<img src="icon.svg">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
  await t.test('inline SMIL is rejected before serialization', async () => {
    const root = fixture();
    write(root, 'index.html', '<svg><image id="target"/><animate href="#target" attributeName="href" values="#safe;//evil.test/p.png"/></svg>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
  await t.test('packaged SVG cannot define a remote xml:base', async () => {
    const root = fixture();
    write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" xml:base="//evil.test/"><use href="#x"/></svg>');
    write(root, 'index.html', '<img src="icon.svg">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
  await t.test('inline SVG cannot define a remote xml:base', async () => {
    const root = fixture();
    write(root, 'index.html', '<svg xml:base="//evil.test/"><use href="#x"></use></svg>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSAFE_HTML));
  });
});

test('traversal, absolute paths, symlink escape, and missing assets use exact errors', async (t) => {
  await t.test('lexical traversal', async () => {
    const parent = fixture();
    const root = join(parent, 'site');
    mkdirSync(root);
    write(parent, 'outside.png', 'outside');
    write(root, 'index.html', '<img src="../outside.png">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL));
  });
  await t.test('absolute dependency', async () => {
    const root = fixture();
    write(root, 'index.html', '<img src="/Users/example/secret.png">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.REDACTION));
  });
  await t.test('missing dependency', async () => {
    const root = fixture();
    write(root, 'index.html', '<img src="./missing.png">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET));
  });
  await t.test('symlink escape', async (st) => {
    const parent = fixture();
    const root = join(parent, 'site');
    mkdirSync(root);
    const outside = write(parent, 'outside.png', 'outside');
    try {
      symlinkSync(outside, join(root, 'linked.png'));
    } catch (error) {
      st.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    write(root, 'index.html', '<img src="./linked.png">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE));
  });
  await t.test('dependency resolving to a directory', async () => {
    const root = fixture();
    mkdirSync(join(root, 'asset.png'));
    write(root, 'index.html', '<img src="asset.png">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET));
  });
  await t.test('entry resolving to a directory', async () => {
    const root = fixture();
    mkdirSync(join(root, 'directory.html'));
    await assert.rejects(bundleArtifact('directory.html', { root }), expectCode(ARTIFACT_ERROR_CODES.INPUT_INVALID));
  });
});

test('bare and nonliteral module imports are rejected', async (t) => {
  await t.test('bare module', async () => {
    const root = fixture();
    write(root, 'main.js', 'import thing from "some-package"; console.log(thing);');
    write(root, 'index.html', '<script type="module" src="./main.js"></script>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
  await t.test('nonliteral dynamic module', async () => {
    const root = fixture();
    write(root, 'main.js', 'const name = "./part.js"; import(name);');
    write(root, 'part.js', 'export default 1;');
    write(root, 'index.html', '<script type="module" src="./main.js"></script>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
  await t.test('new URL import metadata asset', async () => {
    const root = fixture();
    write(root, 'main.js', 'const image = new URL("./pixel.png", import.meta.url); console.log(image);');
    write(root, 'pixel.png', 'image');
    write(root, 'index.html', '<script type="module" src="./main.js"></script>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
  await t.test('async external script timing', async () => {
    const root = fixture();
    write(root, 'main.js', 'window.ready = true;');
    write(root, 'index.html', '<script async src="./main.js"></script>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
  await t.test('CSS data URI import rule', async () => {
    const root = fixture();
    write(root, 'main.css', '@import "data:text/css;base64,QGltcG9ydCAnaHR0cHM6Ly9ldmlsLnRlc3QveC5jc3MnOw==";');
    write(root, 'index.html', '<link rel="stylesheet" href="main.css">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
  await t.test('JavaScript data URI import statement', async () => {
    const root = fixture();
    write(root, 'main.js', 'import "data:text/javascript;base64,ZmV0Y2goJ2h0dHBzOi8vZXZpbC50ZXN0L3gnKQ==";');
    write(root, 'index.html', '<script type="module" src="main.js"></script>');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE));
  });
});

test('static module extension and directory-index resolution are deterministic', async () => {
  const root = fixture();
  write(root, 'lib/value.js', 'export const value = "extension";');
  write(root, 'feature/index.js', 'export const feature = "index";');
  write(root, 'main.js', 'import {value} from "./lib/value"; import {feature} from "./feature"; document.body.dataset.out=value+feature;');
  write(root, 'index.html', '<script type="module" src="./main.js"></script>');
  const result = await bundleArtifact('index.html', { root });
  assert.match(result.html, /extension/);
  assert.match(result.html, /index/);
});

test('JavaScript imports of image, font, and sanitized SVG become bounded data URLs', async () => {
  const root = fixture();
  write(root, 'pixel.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  write(root, 'font.woff2', Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01]));
  write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
  write(root, 'main.js', `
    import image from './pixel.png';
    import font from './font.woff2';
    import icon from './icon.svg';
    document.body.dataset.assets = [image, font, icon].join('|');
  `);
  write(root, 'index.html', '<script type="module" src="main.js"></script>');
  const result = await bundleArtifact('index.html', { root });
  assert.match(result.html, /data:image\/png;base64,/);
  assert.match(result.html, /data:font\/woff2;base64,/);
  assert.match(result.html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(result.html, /planr-asset:\//);
});

test('reserved esbuild placeholder namespace is rejected before bundling', async () => {
  const root = fixture();
  write(root, 'main.css', '.forged{content:"planr-asset:/assets/forged.png"}');
  write(root, 'index.html', '<link rel="stylesheet" href="main.css">');
  await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET));
});

test('esbuild metadata detects a minifier-folded reserved placeholder collision', async () => {
  const root = fixture();
  write(root, 'x.png', 'x');
  write(root, 'main.js', `
    import asset from './x.png';
    document.body.dataset.assets = asset + ('planr-' + 'asset:/assets/LSAMBFUD.png');
  `);
  write(root, 'index.html', '<script type="module" src="main.js"></script>');
  await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET));
});

test('byte and file limits fail before unbounded graph reads', async (t) => {
  await t.test('byte limit counts UTF-8 bytes', async () => {
    const root = fixture();
    write(root, 'index.html', '<p>😀😀😀</p>');
    await assert.rejects(bundleArtifact('index.html', { root, maxBytes: 12 }), expectCode(ARTIFACT_ERROR_CODES.BYTE_LIMIT));
  });
  await t.test('configured file limit trips before the next file read', async () => {
    const root = fixture();
    write(root, 'a.png', 'a');
    write(root, 'b.png', 'b');
    write(root, 'index.html', '<img src="a.png"><img src="b.png">');
    await assert.rejects(bundleArtifact('index.html', { root, maxFiles: 2 }), expectCode(ARTIFACT_ERROR_CODES.FILE_LIMIT));
  });
  await t.test('callers cannot disable or raise hard limits', async () => {
    const root = fixture();
    write(root, 'index.html', '<p>safe</p>');
    for (const options of [{ maxFiles: 0 }, { maxFiles: 1_001 }, { maxBytes: Infinity }, { maxBytes: 10 * 1024 * 1024 + 1 }]) {
      await assert.rejects(bundleArtifact('index.html', { root, ...options }), expectCode(ARTIFACT_ERROR_CODES.INPUT_INVALID));
    }
  });
  await t.test('parallel module reads reserve unique realpaths before awaiting streams', async () => {
    const root = fixture();
    write(root, 'a.js', 'globalThis.a = true;');
    write(root, 'b.js', 'globalThis.b = true;');
    write(root, 'main.js', 'import "./a.js"; import "./b.js";');
    write(root, 'index.html', '<script type="module" src="main.js"></script>');
    await assert.rejects(
      bundleArtifact('index.html', { root, maxFiles: 3 }),
      expectCode(ARTIFACT_ERROR_CODES.FILE_LIMIT),
    );
  });
  await t.test('default 1000-file ceiling rejects the 1001st unique input', { timeout: 30_000 }, async () => {
    const root = fixture();
    const refs = [];
    for (let index = 0; index < 1_000; index++) {
      const name = `asset-${String(index).padStart(4, '0')}.png`;
      write(root, name, Buffer.from([index % 251]));
      refs.push(`<img src="${name}">`);
    }
    write(root, 'index.html', refs.join(''));
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.FILE_LIMIT));
  });
});

test('generated output has an immutable hard cap before final serialization', async () => {
  const root = fixture();
  write(root, 'x.png', Buffer.alloc(10 * 1024, 0xa5));
  write(root, 'index.html', Array.from({ length: 1_000 }, () => '<img src="x.png">').join(''));
  await assert.rejects(
    bundleArtifact('index.html', { root, maxOutputBytes: 100 * 1024 * 1024 }),
    expectCode(ARTIFACT_ERROR_CODES.OUTPUT_LIMIT),
  );
});

test('composite rewrite paths reserve the output budget before materializing amplified strings', async (t) => {
  await t.test('srcset candidates reserve before array join', async () => {
    const root = fixture();
    write(root, 'x.png', Buffer.alloc(10 * 1024, 0xa5));
    const srcset = Array.from({ length: 1_000 }, (_, index) => `x.png ${index + 1}w`).join(', ');
    write(root, 'index.html', `<img srcset="${srcset}">`);
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.OUTPUT_LIMIT));
  });

  await t.test('nested SVG attributes reserve before SVG serialization and outer base64', async () => {
    const root = fixture();
    write(root, 'x.png', Buffer.alloc(10 * 1024, 0xa5));
    const images = Array.from({ length: 1_000 }, () => '<image href="x.png"/>').join('');
    write(root, 'icon.svg', `<svg xmlns="http://www.w3.org/2000/svg">${images}</svg>`);
    write(root, 'index.html', '<img src="icon.svg">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.OUTPUT_LIMIT));
  });

  await t.test('esbuild asset placeholders reserve exact CSS multiplicity before substitution', async () => {
    const root = fixture();
    write(root, 'x.png', Buffer.alloc(10 * 1024, 0xa5));
    const rules = Array.from({ length: 1_000 }, (_, index) => `.x${index}{background:url("./x.png")}`).join('');
    write(root, 'main.css', rules);
    write(root, 'index.html', '<link rel="stylesheet" href="main.css">');
    await assert.rejects(bundleArtifact('index.html', { root }), expectCode(ARTIFACT_ERROR_CODES.OUTPUT_LIMIT));
  });
});

test('privacy scan rejects machine paths, remotes, environment access, secrets, and configured values', async (t) => {
  const cases = [
    ['machine path', '<p>/Users/alice/work/private/file.txt</p>'],
    ['repository remote', '<p>git@example.test:team/private.git</p>'],
    ['git scheme repository remote', '<p>git://example.test/team/private.git</p>'],
    ['git+ssh repository remote', '<p>git+ssh://example.test/team/private.git</p>'],
    ['environment access', '<script>console.log(process.env.SECRET)</script>'],
    ['private key', '<pre>-----BEGIN PRIVATE KEY-----</pre>'],
  ];
  for (const [name, body, code = ARTIFACT_ERROR_CODES.REDACTION] of cases) {
    await t.test(name, async () => {
      const root = fixture();
      write(root, 'index.html', body);
      await assert.rejects(bundleArtifact('index.html', { root }), expectCode(code));
    });
  }
  await t.test('explicit sensitive value', async () => {
    const root = fixture();
    write(root, 'index.html', '<p>super-secret-value</p>');
    await assert.rejects(
      bundleArtifact('index.html', { root, sensitiveValues: ['super-secret-value'] }),
      expectCode(ARTIFACT_ERROR_CODES.REDACTION),
    );
  });
});

test('remote-asset rejection is attribute-scoped, so URL-shaped prose survives', async (t) => {
  // Inert text that mentions a URL cannot trigger a fetch, so it must bundle.
  // The `file://` case is the reported regression: an advisor quoting a command
  // inside an escaped <code> fragment must not read as a remote asset.
  const allowed = [
    ['file:// quoted in escaped <code>', '<p>Run <code>open file://review/report.html</code> to preview.</p>'],
    ['https URL in body text', '<p>See https://example.com for the changelog.</p>'],
    ['protocol-relative text in a comment', '<!-- mirror at //cdn.example.test/app.js --><p>ok</p>'],
    ['ftp URL in body text', '<p>Legacy drop at ftp://example.test/private.txt is retired.</p>'],
    ['websocket URLs in body text', '<p>Sockets ws://example.test/socket and wss://example.test/socket.</p>'],
  ];
  for (const [name, body] of allowed) {
    await t.test(`allowed: ${name}`, async () => {
      const root = fixture();
      write(root, 'index.html', `<!doctype html><html><body>${body}</body></html>`);
      const result = await bundleArtifact('index.html', { root });
      assert.equal(result.remoteAssetCount, 0);
    });
  }

  // Genuine fetchable references stay blocked, in `reject` mode so no network is
  // touched. `file://` in an attribute must still fail — a served review room
  // stays self-contained.
  const blocked = [
    ['remote <img src>', '<img src="https://cdn.example.test/a.png">'],
    ['remote CSS url() in a style attribute', '<div style="background:url(https://cdn.example.test/a.png)">x</div>'],
    ['remote srcset candidate', '<img srcset="https://cdn.example.test/a.png 2x">'],
    ['protocol-relative src', '<img src="//cdn.example.test/a.png">'],
    ['file:// in a src attribute', '<img src="file:///etc/passwd">'],
  ];
  for (const [name, body] of blocked) {
    await t.test(`blocked: ${name}`, async () => {
      const root = fixture();
      write(root, 'index.html', `<!doctype html><html><body>${body}</body></html>`);
      await assert.rejects(
        bundleArtifact('index.html', { root, remoteAssets: 'reject' }),
        expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
      );
    });
  }
});
