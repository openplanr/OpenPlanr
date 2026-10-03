import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import { commitWorkspace, prepareWorkspace } from '../../design/lib/design/workspace-client.mjs';
import { uploadChunksFor } from '../lib/artifact/chunked-workspace-client.mjs';
import {
  copyUploadSpool,
  persistPreparedUploadSpool,
  persistUploadSpool,
  preparedUploadChunkReader,
  readPreparedUploadRequest,
} from '../lib/artifact/upload-spool.mjs';

const bundle = {
  schemaVersion: '1.0.0',
  kind: 'openplanr-design-review-bundle',
  revision: 'render-1',
  design: {
    id: 'work',
    title: 'Private',
    screens: [{ id: 'home', title: 'Home' }],
    frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
    variants: [{ id: 'A', label: 'First', status: 'ready' }],
    screenOrder: ['home'],
    selectedVariant: 'A',
    defaultView: 'canvas',
  },
  envelope: {
    schemaVersion: '1.0.0',
    artifacts: [{ id: 'home', html: '<h1>Private</h1>' }],
    viewer: { mode: 'single' },
  },
  entries: [{ artifactId: 'home', screenId: 'home', variantId: 'A', frameId: 'desktop' }],
  state: { positions: {} },
  verification: { status: 'unverified' },
};
function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-transport-boundary-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('private spool export/import preserves exact request and chunks; missing, unsafe and corrupted records fail closed', async (t) => {
  const root = temporary(t),
    custody = await prepareWorkspace(bundle, { transport: '2' });
  await persistUploadSpool(custody, root);
  const body = custody.pendingCreate,
    directory = custody.spoolDirectory,
    exact = canonicalizeJson(body);
  assert.equal(canonicalizeJson(readPreparedUploadRequest(directory)), exact);
  const exported = join(root, 'exported');
  await copyUploadSpool(custody, exported);
  const imported = readPreparedUploadRequest(exported),
    read = preparedUploadChunkReader(exported, imported);
  for (const part of body.manifest.chunks)
    assert.deepEqual(
      await read(part.index),
      await preparedUploadChunkReader(directory, body)(part.index),
    );
  await assert.rejects(copyUploadSpool(custody, exported), /already exists/);
  await assert.rejects(
    persistPreparedUploadSpool(
      { ...body, expectedVersion: 1 },
      uploadChunksFor(custody),
      directory,
    ),
    /will not be overwritten/,
  );
  const missing = join(root, 'missing');
  assert.throws(
    () => readPreparedUploadRequest(missing),
    (error) => error.code === 'ENOENT',
  );
  const chunk = join(exported, '0.bin');
  unlinkSync(chunk);
  await assert.rejects(read(0), (error) => error.code === 'ENOENT');
  const request = join(exported, 'request.json');
  writeFileSync(request, 'private malformed value');
  assert.throws(
    () => readPreparedUploadRequest(exported),
    (error) => !error.message.includes('private malformed value') && error.code !== 'ENOENT',
  );
  unlinkSync(request);
  symlinkSync(join(directory, 'request.json'), request);
  assert.throws(() => readPreparedUploadRequest(exported), /invalid or inaccessible/);
  const bytes = readFileSync(join(directory, '0.bin'));
  bytes[0] ^= 1;
  writeFileSync(join(directory, '0.bin'), bytes);
  await assert.rejects(preparedUploadChunkReader(directory, body)(0), /corrupt/);
});
test('a substituted committed receipt or uploaded chunk is rejected before accepting publication; missing custody never starts network', async (t) => {
  const root = temporary(t),
    original = await prepareWorkspace(bundle, { transport: '2' });
  await persistUploadSpool(original, root);
  const body = original.pendingCreate,
    readChunk = preparedUploadChunkReader(original.spoolDirectory, body),
    hash = sha256Hex(canonicalizeJson(body.manifest));
  let calls = 0;
  const status = {
    schemaVersion: '2.0.0',
    workspaceId: original.id,
    operationId: body.operationId,
    revisionId: body.manifest.revisionId,
    manifestSha256: hash,
    status: 'prepared',
    receivedChunks: [],
  };
  await assert.rejects(
    commitWorkspace(structuredClone(original), {
      fetchImpl: async () => {
        calls++;
        throw new Error('must not run');
      },
    }),
    /Persist the exact/,
  );
  assert.equal(calls, 0);
  const receipt = {
    schemaVersion: '2.0.0',
    workspaceId: original.id,
    operationId: body.operationId,
    revisionId: body.manifest.revisionId,
    manifestSha256: hash,
    status: 'committed',
    version: body.expectedVersion + 2,
    committedAt: '2026-10-02T00:00:00.000Z',
  };
  await assert.rejects(
    commitWorkspace(structuredClone(original), {
      readChunk,
      fetchImpl: async () => {
        calls++;
        return Response.json({ ...status, status: 'committed', receipt });
      },
    }),
    /receipt differs/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    commitWorkspace(structuredClone(original), {
      readChunk,
      fetchImpl: async () => {
        calls++;
        return Response.json({
          ...status,
          receivedChunks: [{ ...body.manifest.chunks[0], iv: undefined, sha256: '0'.repeat(64) }],
        });
      },
    }),
    /chunk identity differs/,
  );
  assert.equal(calls, 2);
  assert.equal(canonicalizeJson(original.pendingCreate), canonicalizeJson(body));
});
