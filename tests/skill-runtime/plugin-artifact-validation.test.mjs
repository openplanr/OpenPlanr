import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertDirectoryEntries,
  inspectDirectoryEntries,
  PLUGIN_ARTIFACT_LIMITS,
  readDirectoryEntries,
} from '../../scripts/skills/plugin-artifact-validation.mjs';

const entry = (path, content, extra = {}) => ({ path, bytes: Buffer.from(content), ...extra });
const codes = (entries) => inspectDirectoryEntries(entries).findings.map(({ code }) => code);
const png = readFileSync(
  resolve(import.meta.dirname, '../../docs/assets/brand/png/openplanr-mark-16.png'),
);
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('exact UTF-8 bytes accept Unicode, empty files, source modes and relocated paths', () => {
  const entries = [
    entry('runtime/hello.mjs', '#!/usr/bin/env node\nconsole.log("你好 🌍 café");\n', {
      mode: 0o100755,
    }),
    entry('LICENSE', ''),
    entry('references/intro.md', '\ufeff# OpenPlanr\n\tReadable Unicode.\r\n'),
    { path: 'resources/config.json', bytes: new Uint8Array([123, 125]) },
  ];
  const report = assertDirectoryEntries(entries);
  assert.equal(report.passed, true);
  assert.equal(report.fileCount, 4);
  assert.equal(
    report.bytes,
    entries.reduce((total, { bytes }) => total + bytes.length, 0),
  );
  assert.equal(report.files[0].kind, 'text');
});

test('the non-image/font size boundary is strict and measured in bytes', () => {
  const limit = PLUGIN_ARTIFACT_LIMITS.textBytes;
  assertDirectoryEntries([entry('below.mjs', 'x'.repeat(limit - 1))]);
  assert.deepEqual(codes([entry('at.mjs', 'x'.repeat(limit))]), ['text-size']);
  assert.deepEqual(codes([entry('above.mjs', 'x'.repeat(limit + 1))]), ['text-size']);
  const unicode = '🌍'.repeat(limit / 4);
  assert.equal(unicode.length, limit / 2);
  assert.deepEqual(codes([entry('unicode.md', unicode)]), ['text-size']);
});

test('the plugin file-count boundary is inclusive', () => {
  const entries = Array.from({ length: PLUGIN_ARTIFACT_LIMITS.files }, (_, index) =>
    entry(`r/${index}.md`, 'text'),
  );
  assertDirectoryEntries(entries);
  assert.deepEqual(codes([...entries, entry('r/extra.md', '')]), ['file-count']);
});

test('inspection rejects unsupported native, archive and document formats despite renamed extensions', () => {
  const signatures = [
    ['elf', [0x7f, 0x45, 0x4c, 0x46]],
    ['pe', [0x4d, 0x5a]],
    ['webassembly', [0, 0x61, 0x73, 0x6d]],
    ['zip', [0x50, 0x4b, 3, 4]],
    ['gzip', [0x1f, 0x8b]],
    ['pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['icon', [0, 0, 1, 0]],
    ['mach-o', [0xcf, 0xfa, 0xed, 0xfe]],
    ['7zip', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ];
  for (const [kind, bytes] of signatures) {
    const report = inspectDirectoryEntries([entry(`${kind}.js`, bytes)]);
    assert.equal(report.passed, false, kind);
    assert.equal(report.findings[0].code, 'unsupported-binary', kind);
    assert.equal(report.files[0].kind, kind);
  }
  assert.deepEqual(codes([entry('hidden.wasm', 'not a valid wasm file')]), ['unsupported-binary']);
});

test('binary controls and malformed UTF-8 cannot masquerade as readable source', () => {
  for (const bytes of [[0xff], [0xc3, 0x28], [0xf0, 0x80, 0x80, 0x80]])
    assert.deepEqual(codes([entry('source.mjs', bytes)]), ['invalid-text']);
  for (const control of [0, 1, 8, 11, 12, 14, 31, 127])
    assert.deepEqual(codes([entry('source.mjs', [65, control, 66])]), ['binary-text']);
});

test('complete PNG and GIF containers require matching extensions', () => {
  assertDirectoryEntries([entry('brand.png', png), entry('tiny.gif', gif)]);
  assert.deepEqual(codes([entry('brand.jpg', png)]), ['media-extension']);
  assert.deepEqual(codes([entry('tiny.png', gif)]), ['media-extension']);
  assert.deepEqual(codes([entry('brand.png', 'plain text pretending to be an image')]), [
    'malformed-media',
  ]);
  assert.deepEqual(codes([entry('brand.png', png.subarray(0, -1))]), ['malformed-media']);
  assert.deepEqual(codes([entry('tiny.gif', gif.subarray(0, -1))]), ['malformed-media']);
});

test('PNG checksum corruption and trailing bytes fail container inspection', () => {
  const corrupted = Buffer.from(png);
  corrupted[20] ^= 1;
  assert.deepEqual(codes([entry('corrupt.png', corrupted)]), ['malformed-media']);
  assert.deepEqual(codes([entry('trailing.png', Buffer.concat([png, Buffer.from('hidden')]))]), [
    'malformed-media',
  ]);
});

test('declared media with incomplete known headers fails instead of bypassing the text limit', () => {
  for (const [path, bytes] of [
    ['bad.jpg', [0xff, 0xd8, 0xff, 0xd9]],
    ['bad.webp', Buffer.from('RIFF\x0c\x00\x00\x00WEBPVP8L\x00\x00\x00\x00', 'binary')],
    ['bad.woff', Buffer.from('wOFF')],
    ['bad.woff2', Buffer.from('wOF2')],
    ['bad.otf', Buffer.from('OTTO')],
    ['bad.ttf', [0, 1, 0, 0]],
  ])
    assert.ok(codes([entry(path, bytes)]).includes('malformed-media'), path);
});

test('valid font container bounds are checked independently of extension and content size', () => {
  const font = Buffer.alloc(82);
  font.writeUInt32BE(0x00010000);
  font.writeUInt16BE(1, 4);
  font.write('head', 12);
  font.writeUInt32BE(28, 20);
  font.writeUInt32BE(54, 24);
  assertDirectoryEntries([entry('font.ttf', font)]);
  assert.deepEqual(codes([entry('font.otf', font)]), ['media-extension']);
  font.writeUInt32BE(55, 24);
  assert.deepEqual(codes([entry('font.ttf', font)]), ['malformed-media']);
});

test('large font files are exempt from the text limit, but not the absolute plugin-file limit', () => {
  const font = Buffer.alloc(PLUGIN_ARTIFACT_LIMITS.textBytes);
  font.writeUInt32BE(0x00010000);
  font.writeUInt16BE(1, 4);
  font.write('head', 12);
  font.writeUInt32BE(28, 20);
  font.writeUInt32BE(font.length - 28, 24);
  assertDirectoryEntries([entry('large.ttf', font)]);
  const oversized = Buffer.alloc(PLUGIN_ARTIFACT_LIMITS.fileBytes);
  font.copy(oversized, 0, 0, 28);
  oversized.writeUInt32BE(oversized.length - 28, 24);
  assert.deepEqual(codes([entry('oversized.ttf', oversized)]), ['file-size']);
});

test('SVG remains readable text rather than a binary-container exemption', () => {
  assertDirectoryEntries([
    entry('mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"><title>OpenPlanr</title></svg>'),
  ]);
  assert.deepEqual(codes([entry('huge.svg', ' '.repeat(PLUGIN_ARTIFACT_LIMITS.textBytes))]), [
    'text-size',
  ]);
});

test('symlinks and unknown entry types are refused without following their targets', () => {
  for (const extra of [
    { type: 'symlink' },
    { mode: 0o120777 },
    { type: 'directory' },
    { type: 'hardlink' },
  ])
    assert.deepEqual(codes([entry('link.mjs', 'external-secret-file', extra)]), [
      'non-regular-entry',
    ]);
  assert.deepEqual(codes([{ path: 'unread.mjs' }]), ['missing-bytes']);
});

test('paths must remain portable and cannot escape the plugin root', () => {
  for (const path of [
    '',
    '../x',
    '/x',
    'C:/x',
    'a\\b',
    'a/./b',
    'a/../b',
    'a//b',
    'a/CON.txt',
    'a/trailing.',
    'a/trailing ',
    'a:b',
    'a/\0b',
    'a?.md',
    'a*.md',
    'a|b.md',
    'a<b.md',
    'a>b.md',
    'a"b.md',
    'dir?/x.md',
  ])
    assert.deepEqual(codes([entry(path, '')]), ['unsafe-path'], JSON.stringify(path));
  assert.deepEqual(codes([entry('readme.md', ''), entry('README.md', '')]), ['duplicate-path']);
});

test('portable trees reject case and file-versus-directory collisions by path component', () => {
  assert.deepEqual(codes([entry('A/one.js', ''), entry('a/two.js', '')]), ['duplicate-path']);
  assert.deepEqual(codes([entry('x/A/one.js', ''), entry('x/a/b/two.js', '')]), ['duplicate-path']);
  assert.deepEqual(codes([entry('file', ''), entry('file/child.js', '')]), ['path-conflict']);
  assert.deepEqual(codes([entry('file/child.js', ''), entry('file', '')]), ['path-conflict']);
  assert.deepEqual(codes([entry('File', ''), entry('file/child.js', '')]), ['path-conflict']);
  assertDirectoryEntries([
    entry('A/one.js', ''),
    entry('A/two.js', ''),
    entry('A/nested/three.js', ''),
    entry('A.md', ''),
    entry('a-sibling/one.js', ''),
    entry('file.js', ''),
    entry('file/child.js', ''),
  ]);
});

test('system metadata and unresolved LFS pointers are explicit findings', () => {
  for (const path of ['.DS_Store', 'nested/Thumbs.db', '__MACOSX/resource'])
    assert.deepEqual(codes([entry(path, 'metadata')]), ['system-file']);
  assert.deepEqual(
    codes([
      entry('large.js', 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 10\n'),
    ]),
    ['lfs-pointer'],
  );
});

test('direct execution of a substantial encoded payload is identified without flagging ordinary binary assets', () => {
  const payload = Buffer.from('console.log("packed");'.repeat(20)).toString('base64');
  assert.deepEqual(codes([entry('packed.mjs', `eval(atob('${payload}'));`)]), [
    'encoded-execution',
  ]);
  assert.deepEqual(
    codes([entry('packed.cjs', `new Function(Buffer.from('${payload}', 'base64').toString())();`)]),
    ['encoded-execution'],
  );
  assertDirectoryEntries([entry('data.mjs', `const bytes = Buffer.from('${payload}', 'base64');`)]);
  assertDirectoryEntries([entry('example.md', `A quoted example: eval(atob('${payload}'));`)]);
});

test('failures disclose paths, sizes and kinds without copying payloads or claiming security approval', () => {
  const privateValue = 'a-private-credential-value';
  assert.throws(
    () => assertDirectoryEntries([entry('bad.mjs', `${privateValue}\0`)]),
    (error) => {
      assert.equal(error.code, 'E_PLUGIN_ARTIFACT_INVALID');
      assert.match(error.message, /bad\.mjs.*bytes/u);
      assert.doesNotMatch(JSON.stringify(error.report), new RegExp(privateValue, 'u'));
      assert.equal(error.report.findings[0].code, 'binary-text');
      return true;
    },
  );
  assert.throws(() => inspectDirectoryEntries(null), TypeError);
});

test('directory reading reports links and special files without following them', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-directory-entries-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const outside = join(directory, 'outside');
  mkdirSync(join(directory, 'plugin/.claude-plugin'), { recursive: true });
  mkdirSync(join(directory, 'plugin/scripts'));
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'external-secret-value');
  writeFileSync(join(directory, 'plugin/.claude-plugin/plugin.json'), '{"name":"planr"}\n');
  writeFileSync(join(directory, 'plugin/scripts/run.mjs'), 'console.log("ok");\n', {
    mode: 0o755,
  });
  const plugin = join(directory, 'plugin');
  const clean = readDirectoryEntries(plugin);
  assert.deepEqual(
    clean.map(({ path }) => path),
    ['.claude-plugin/plugin.json', 'scripts/run.mjs'],
  );
  assert.equal(clean[1].mode & 0o111, 0o111);
  assertDirectoryEntries(clean);
  symlinkSync(join(outside, 'secret.txt'), join(plugin, 'scripts/linked.txt'));
  symlinkSync(outside, join(plugin, 'linked-directory'));
  const linked = readDirectoryEntries(plugin);
  assert.deepEqual(
    linked
      .filter(({ type }) => type !== 'file')
      .map(({ path, type, bytes }) => [path, type, bytes]),
    [
      ['linked-directory', 'symlink', undefined],
      ['scripts/linked.txt', 'symlink', undefined],
    ],
  );
  assert.deepEqual(codes(linked), ['non-regular-entry', 'non-regular-entry']);
  assert.doesNotMatch(JSON.stringify(inspectDirectoryEntries(linked)), /external-secret-value/u);
  symlinkSync(plugin, join(directory, 'plugin-link'));
  assert.throws(() => readDirectoryEntries(join(directory, 'plugin-link')), /not a link/u);
});

test('generated Studio and stage source units satisfy package text bounds', async () => {
  const { buildDesignSkillResources } = await import('../../scripts/skills/design-resources.mjs');
  const resources = await buildDesignSkillResources({
    repoRoot: resolve(import.meta.dirname, '../..'),
  });
  const report = assertDirectoryEntries(resources.map(({ path, bytes }) => ({ path, bytes })));
  assert.ok(report.fileCount < 200);
  assert.ok(resources.some(({ path }) => path.endsWith('studio/studio.js.sources.json')));
  assert.ok(resources.some(({ path }) => path.endsWith('artifact-review-stage.js.sources.json')));
});

test('directory reading reports oversized files by size without loading them', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-directory-large-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'README.md'), '# OpenPlanr\n');
  // Sparse files report their size without occupying or allocating it.
  writeFileSync(join(directory, 'runtime.js'), '');
  writeFileSync(join(directory, 'limit.js'), '');
  truncateSync(join(directory, 'runtime.js'), 64 * 1024 * 1024);
  truncateSync(join(directory, 'limit.js'), PLUGIN_ARTIFACT_LIMITS.fileBytes);
  const entries = readDirectoryEntries(directory);
  for (const path of ['limit.js', 'runtime.js']) {
    const entry = entries.find((candidate) => candidate.path === path);
    assert.equal(entry.bytes, undefined, path);
  }
  const report = inspectDirectoryEntries(entries);
  assert.deepEqual(
    report.findings.map(({ code, path, size }) => [code, path, size]),
    [
      ['file-size', 'limit.js', PLUGIN_ARTIFACT_LIMITS.fileBytes],
      ['file-size', 'runtime.js', 64 * 1024 * 1024],
    ],
  );
  truncateSync(join(directory, 'runtime.js'), PLUGIN_ARTIFACT_LIMITS.textBytes);
  rmSync(join(directory, 'limit.js'));
  assert.deepEqual(codes(readDirectoryEntries(directory)), ['text-size', 'binary-text']);
});
