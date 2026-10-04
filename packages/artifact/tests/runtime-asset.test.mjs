import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readRuntimeAsset } from '../lib/artifact/internal/runtime-asset.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fragmentedRuntime(run) {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-runtime-fragments-'));
  const file = join(directory, 'stage.js');
  const pieces = [Buffer.from('const ready = true;\n'), Buffer.from('// exact UTF-8: café\n')];
  const bytes = Buffer.concat(pieces);
  const manifest = {
    schemaVersion: '1.0.0',
    sha256: digest(bytes),
    parts: pieces.map((piece, index) => {
      const name = `stage.js.part-${String(index + 1).padStart(3, '0')}`;
      writeFileSync(join(directory, name), piece);
      return { name, sha256: digest(piece) };
    }),
  };
  const save = () => writeFileSync(`${file}.parts.json`, JSON.stringify(manifest));
  save();
  try {
    run({ file, bytes, manifest, save, directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('raw and directory-fragment runtimes preserve exact bytes for path and URL consumers', () => {
  fragmentedRuntime(({ file, bytes }) => {
    assert.deepEqual(readRuntimeAsset(file), bytes);
    assert.deepEqual(readRuntimeAsset(pathToFileURL(file)), bytes);
    writeFileSync(file, bytes);
    assert.deepEqual(readRuntimeAsset(file), bytes);
  });
});

test('fragmented runtimes reject altered bytes, root digests and traversal identities', () => {
  fragmentedRuntime(({ file, directory, manifest, save }) => {
    writeFileSync(join(directory, manifest.parts[0].name), 'altered');
    assert.throws(() => readRuntimeAsset(file), /integrity verification/u);
  });
  fragmentedRuntime(({ file, manifest, save }) => {
    manifest.sha256 = '0'.repeat(64);
    save();
    assert.throws(() => readRuntimeAsset(file), /integrity verification/u);
  });
  fragmentedRuntime(({ file, manifest, save }) => {
    manifest.parts[0].name = '../stage.js.part-001';
    save();
    assert.throws(() => readRuntimeAsset(file), /identity is invalid/u);
  });
});

function sourcedRuntime(run) {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-runtime-sources-'));
  const file = join(directory, 'stage.js');
  const units = [
    '\n  const ready = true;',
    '\n  const label = "café";',
    '\n  globalThis.ready = ready;',
  ];
  const scopes = [
    { id: 'bundle', parent: null, open: '"use strict";\n(() => {', close: '\n})();\n' },
    { id: 'factory', parent: 'bundle', open: '\n  function factory() {', close: '\n  }' },
  ];
  const sources = units.map((text, index) => ({
    path: `stage.js.sources/0${index + 1}-unit.js`,
    scope: index === 1 ? 'factory' : 'bundle',
    bytes: Buffer.byteLength(text),
    sha256: digest(text),
  }));
  const bytes = Buffer.from(
    `${scopes[0].open}${units[0]}${scopes[1].open}${units[1]}${scopes[1].close}${units[2]}${scopes[0].close}`,
  );
  const manifest = {
    kind: 'openplanr-runtime-asset-sources',
    schemaVersion: '1.0.0',
    asset: 'stage.js',
    bytes: bytes.length,
    sha256: digest(bytes),
    scopes,
    sources,
  };
  mkdirSync(join(directory, 'stage.js.sources'));
  for (const [index, text] of units.entries())
    writeFileSync(join(directory, sources[index].path), text);
  const save = () => writeFileSync(`${file}.sources.json`, JSON.stringify(manifest));
  save();
  try {
    run({ file, bytes, manifest, save, directory, units });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('readable source units reassemble their declared scopes into exact bytes', () => {
  sourcedRuntime(({ file, bytes }) => {
    assert.deepEqual(readRuntimeAsset(file), bytes);
    assert.deepEqual(readRuntimeAsset(pathToFileURL(file)), bytes);
  });
});

test('readable source units reject altered units, scopes and declared totals', () => {
  sourcedRuntime(({ directory, file, manifest }) => {
    writeFileSync(join(directory, manifest.sources[0].path), '\n  const ready = TRUE;');
    assert.throws(() => readRuntimeAsset(file), /integrity verification/u);
  });
  sourcedRuntime(({ file, manifest, save }) => {
    manifest.scopes[1].close = '\n  ;';
    save();
    assert.throws(() => readRuntimeAsset(file), /integrity verification/u);
  });
  sourcedRuntime(({ file, manifest, save }) => {
    manifest.bytes -= 1;
    save();
    assert.throws(() => readRuntimeAsset(file), /exceed their declared size/u);
  });
  sourcedRuntime(({ file, manifest, save }) => {
    manifest.sources.push({ ...manifest.sources[1], path: 'stage.js.sources/04-unit.js' });
    save();
    assert.throws(() => readRuntimeAsset(file), /not contiguous/u);
  });
});

test('readable source identities cannot traverse, alias or exceed their bounds', () => {
  for (const path of [
    '../stage.js.sources/01-unit.js',
    'stage.js.sources/../01-unit.js',
    '/tmp/01-unit.js',
    'other.js.sources/01-unit.js',
    'stage.js.sources/01-unit.mjs',
  ])
    sourcedRuntime(({ file, manifest, save }) => {
      manifest.sources[0].path = path;
      save();
      assert.throws(() => readRuntimeAsset(file), /identity is invalid/u, path);
    });
  sourcedRuntime(({ file, manifest, save }) => {
    manifest.sources[0].bytes = 256 * 1024;
    save();
    assert.throws(() => readRuntimeAsset(file), /identity is invalid/u);
  });
  sourcedRuntime(({ file, manifest, save }) => {
    manifest.scopes[1].parent = 'factory';
    save();
    assert.throws(() => readRuntimeAsset(file), /scope is invalid/u);
  });
});

test('readable source manifests, directories and units are never read through links', () => {
  sourcedRuntime(({ directory, file, manifest }) => {
    const unit = join(directory, manifest.sources[1].path);
    const outside = join(directory, 'outside.js');
    writeFileSync(outside, readFileSync(unit));
    rmSync(unit);
    symlinkSync(outside, unit);
    assert.throws(() => readRuntimeAsset(file), /regular file, not a link/u);
  });
  sourcedRuntime(({ directory, file }) => {
    renameSync(join(directory, 'stage.js.sources'), join(directory, 'real-sources'));
    symlinkSync(join(directory, 'real-sources'), join(directory, 'stage.js.sources'));
    assert.throws(() => readRuntimeAsset(file), /must not be a link/u);
  });
  sourcedRuntime(({ directory, file }) => {
    renameSync(`${file}.sources.json`, join(directory, 'manifest.json'));
    symlinkSync(join(directory, 'manifest.json'), `${file}.sources.json`);
    assert.throws(() => readRuntimeAsset(file), /regular file, not a link/u);
  });
});

test('readable source sizes are enforced before any unit or manifest is loaded', () => {
  sourcedRuntime(({ directory, file, manifest }) => {
    writeFileSync(join(directory, manifest.sources[0].path), '\n  const ready = false;');
    assert.throws(() => readRuntimeAsset(file), /is 23 bytes; expected 22\./u);
  });
  sourcedRuntime(({ directory, file, manifest }) => {
    // A sparse file reports a large size without occupying or allocating that much.
    truncateSync(join(directory, manifest.sources[1].path), 64 * 1024 * 1024);
    assert.throws(() => readRuntimeAsset(file), /is 67108864 bytes; expected \d+\./u);
  });
  sourcedRuntime(({ file }) => {
    truncateSync(`${file}.sources.json`, 64 * 1024 * 1024);
    assert.throws(() => readRuntimeAsset(file), /manifest is 67108864 bytes; expected at most/u);
  });
  fragmentedRuntime(({ file }) => {
    truncateSync(`${file}.parts.json`, 64 * 1024 * 1024);
    assert.throws(() => readRuntimeAsset(file), /manifest is 67108864 bytes/u);
  });
  fragmentedRuntime(({ directory, file, manifest }) => {
    truncateSync(join(directory, manifest.parts[0].name), 128 * 1024 + 1);
    assert.throws(() => readRuntimeAsset(file), /fragment is 131073 bytes; expected at most/u);
  });
});
