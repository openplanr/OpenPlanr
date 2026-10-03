import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
