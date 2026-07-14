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

test('external resources, forms, and navigation fail closed with named errors', async (t) => {
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
      await assert.rejects(bundleArtifact('index.html', { root }), expectCode(code));
    });
  }
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
    ['FTP URL', '<p>ftp://example.test/private.txt</p>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['file URL', '<p>file:///tmp/private.txt</p>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['WebSocket URL', '<p>ws://example.test/socket</p>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
    ['secure WebSocket URL', '<p>wss://example.test/socket</p>', ARTIFACT_ERROR_CODES.EXTERNAL_ASSET],
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
