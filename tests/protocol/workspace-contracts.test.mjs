import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESIGN_WORKSPACE_SCHEMAS, DESIGN_WORKSPACE_SCHEMA, DESIGN_WORKSPACE_CREATE_SCHEMA, assertWorkspaceContract } from '../../packages/protocol/src/workspace-contracts.mjs';
import { readFileSync } from 'node:fs';

test('workspace schemas are additive generated Protocol contracts', () => {
  for (const [name, schema] of Object.entries(DESIGN_WORKSPACE_SCHEMAS)) {
    assert.deepEqual(JSON.parse(readFileSync(new URL(`../../packages/protocol/schemas/v1.9.0/${name}.schema.json`, import.meta.url))), schema);
    assert.equal(schema.additionalProperties, false);
  }
});
test('persistent workspaces cannot leak auth capabilities or require expiry', () => {
  const metadata = { schemaVersion: '1.0.0', id: 'a'.repeat(24), version: 1, epoch: 1, currentRevision: 'b'.repeat(24), commentsPaused: false, ownerPublicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) }, keyring: { iv: 'a'.repeat(16), ciphertext: 'a'.repeat(32) } };
  assertWorkspaceContract(metadata, DESIGN_WORKSPACE_SCHEMA);
  for (const field of ['token', 'ownerAuth', 'ownerPrivateKey', 'reviewerAuthHash', 'expiresAt']) {
    assert.throws(() => assertWorkspaceContract({ ...metadata, [field]: 'secret' }, DESIGN_WORKSPACE_SCHEMA), /Invalid/);
  }
  assert.throws(() => assertWorkspaceContract({ ...metadata, epoch: 0 }, DESIGN_WORKSPACE_SCHEMA), /Invalid/);
});
test('workspace public key contract rejects private key material', () => {
  const publicKeySchema = DESIGN_WORKSPACE_CREATE_SCHEMA.properties.ownerPublicKey;
  assert.equal(publicKeySchema.additionalProperties, false);
  assert.equal(publicKeySchema.properties.d, undefined);
  assert.equal(DESIGN_WORKSPACE_CREATE_SCHEMA.properties.ownerAuthHash.pattern, '^[a-f0-9]{64}$');
});
