import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import {
  ARTIFACT_BRIDGE_CHANNEL,
  prepareArtifactDocument,
  prepareArtifactSourceTemplate,
  prepareHostedArtifactDocument,
  validateArtifactBridgeMessage,
} from '../lib/artifact/browser-sandbox.mjs';

const nonce = Buffer.alloc(32, 11).toString('base64url');
const options = {
  html: '<!doctype html><p>Content</p>',
  artifactId: 'view',
  nonce,
  parentOrigin: 'http://127.0.0.1:45000',
  scriptNonce: Buffer.alloc(18, 7).toString('base64url'),
};
test('browser preparation has no Node dependency and keeps the opaque-frame restrictions', async () => {
  const result = await build({
    entryPoints: [new URL('../lib/artifact/browser-sandbox.mjs', import.meta.url).pathname],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
  });
  assert.ok(Object.keys(result.metafile.inputs).every((path) => !path.startsWith('node:')));
  const document = prepareArtifactDocument(options);
  assert.match(document.csp, /connect-src 'none'/);
  assert.match(document.csp, /form-action 'none'/);
  assert.ok(!document.csp.includes("'unsafe-eval'"));
  const template = prepareArtifactSourceTemplate({ ...options, prototypeState: true });
  assert.equal(template.html.split(template.artifactIdToken).length, 2);
});
test('hosted preparation accepts only exact HTTPS parent origins', () => {
  for (const parentOrigin of [
    'null',
    'http://example.com',
    'https://example.com/path',
    'https://example.com/',
    'https://a:password@example.com',
  ])
    assert.throws(() => prepareHostedArtifactDocument({ ...options, parentOrigin }));
  assert.ok(
    prepareHostedArtifactDocument({ ...options, parentOrigin: 'https://preview.example.com' }).html,
  );
});
test('bridge rejects forged windows, origins, nonces and unsolicited request replies', () => {
  const source = {},
    contract = {
      source,
      nonce,
      artifactId: 'view',
      viewport: { width: 800, height: 600 },
      pendingRequestIds: new Set(['request-123']),
    };
  const data = {
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: '1.0.0',
    nonce,
    artifactId: 'view',
    type: 'bridge.ready',
  };
  assert.equal(validateArtifactBridgeMessage({ source, origin: 'null', data }, contract).ok, true);
  for (const event of [
    { source: {}, origin: 'null', data },
    { source, origin: 'https://forged.example', data },
    { source, origin: 'null', data: { ...data, nonce: 'bad' } },
    { source, origin: 'null', data: { ...data, extra: true } },
    { source, origin: 'null', data: { ...data, type: 'anchor.miss', requestId: 'unsolicited' } },
  ])
    assert.equal(validateArtifactBridgeMessage(event, contract).ok, false);
  assert.equal(
    validateArtifactBridgeMessage(
      { source, origin: 'null', data: { ...data, type: 'anchor.miss', requestId: 'request-123' } },
      contract,
    ).ok,
    true,
  );
});
