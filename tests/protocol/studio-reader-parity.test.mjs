import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDiagramReviewArtifact } from '../../packages/protocol/src/browser-contracts.mjs';
import {
  assertProtocolArtifact,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import {
  assertDiagramData,
  validateDiagramAuthoringArtifact,
} from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import {
  assertEnterpriseRevision,
  ENTERPRISE_ARTIFACT_REVISION_SCHEMA,
} from '../../packages/protocol/src/enterprise-contracts.mjs';
import {
  assertLargeObjectContract,
  assertLargeObjectData,
  LARGE_OBJECT_SCHEMAS,
} from '../../packages/protocol/src/large-object-contracts.mjs';
import {
  assertPreviewBridgeMessage,
  assertSharingSecurityContract,
  ROOM_V3_CAPABILITIES,
  ROOM_V3_GENESIS_HASH,
} from '../../packages/protocol/src/sharing-security-contracts.mjs';
import {
  assertDiagramPresentation,
  assertDiagramReviewBundleV11,
  assertVersionedDiagramAuthoringBundle,
  assertVersionedDiagramEditTransaction,
  normalizeDiagramPresentation,
  versionedDiagramAuthoringBundleDigest,
} from '../../packages/protocol/src/studio-presentation-contracts.mjs';
import { makeBundle, makeTransaction } from './fixtures/diagram-authoring.mjs';
import { makeReviewBundle } from './fixtures/diagram-review.mjs';

const options = { protocolVersion: '1.17.0' };
const id = 'W'.repeat(22);
const digest = '0'.repeat(64);
const timestamp = '2026-10-02T00:00:00.000Z';
const cipher = { iv: 'A'.repeat(16), ciphertext: Buffer.alloc(16).toString('base64url') };
const ownerKey = {
  algorithm: 'ECDSA-P256-SHA256',
  encoding: 'spki-base64url',
  keyId: `sha256:${digest}`,
  value: Buffer.alloc(91).toString('base64url'),
};

function authoringBundle() {
  const value = {
    ...makeBundle(),
    schemaVersion: '1.1.0',
    protocolVersion: '1.17.0',
    studioPresentation: normalizeDiagramPresentation(),
  };
  value.bundleDigest = versionedDiagramAuthoringBundleDigest(value);
  return value;
}

function encryptedManifest() {
  return {
    schemaVersion: '2.0.0',
    kind: 'openplanr-encrypted-resource-manifest',
    workspaceId: id,
    revisionId: 'R'.repeat(22),
    epoch: 1,
    createdAt: timestamp,
    plaintextBytes: 1,
    ciphertextBytes: 17,
    catalog: { offset: 0, encodedBytes: 1, decodedBytes: 1, codec: 'identity' },
    chunks: [{ index: 0, iv: cipher.iv, sha256: digest, byteLength: 17 }],
    signature: 'X'.repeat(86),
  };
}

function roomEvent() {
  return {
    schemaVersion: '3.0.0',
    protocolVersion: '3.0.0',
    roomId: id,
    eventId: 'comment-a',
    sequence: 1,
    predecessor: ROOM_V3_GENESIS_HASH,
    kind: 'pin',
    reviewCommitment: digest,
    authorRole: 'reviewer',
    authorKey: ownerKey,
    capability: 'reviewer-write',
    createdAt: timestamp,
    ...cipher,
    ciphertextDigest: `sha256:${digest}`,
    signature: 'X'.repeat(86),
  };
}

function companyRevision(revisionId = id, parentRevisionId = null) {
  return {
    kind: 'openplanr-enterprise-artifact-revision',
    schemaVersion: '1.1.0',
    protocolVersion: '1.17.0',
    id: revisionId,
    parentRevisionId,
    organizationId: 'company',
    projectId: 'project',
    artifactId: 'design',
    actorId: 'actor',
    contentDigest: `sha256:${digest}`,
    contentType: 'application/json',
    byteLength: 1,
    createdAt: timestamp,
    contentReference: { transport: 'resources-v2', manifestSha256: digest },
  };
}

function cases() {
  const bundle = authoringBundle();
  const manifest = encryptedManifest();
  const catalog = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-resource-catalog',
    bundle: {},
    uniqueHtmlBytes: 1,
    totalDecodedBytes: 1,
    resources: [
      {
        id: 'r0',
        type: 'html-segments',
        offset: 0,
        encodedBytes: 1,
        decodedBytes: 1,
        codec: 'identity',
        sha256: digest,
      },
    ],
    sources: [{ id: 'source-a', resourceId: 'r0', htmlBytes: 1, sha256: digest }],
    viewSources: { home: 'source-a' },
  };
  const receipt = {
    schemaVersion: '2.0.0',
    workspaceId: id,
    operationId: id,
    revisionId: manifest.revisionId,
    manifestSha256: digest,
    status: 'committed',
    version: 1,
    committedAt: timestamp,
  };
  const page = {
    version: 'v3',
    descriptor: {
      schemaVersion: '3.0.0',
      protocolVersion: '3.0.0',
      roomId: id,
      reviewCommitment: digest,
      ownerKey,
      capabilities: ROOM_V3_CAPABILITIES,
      createdAt: timestamp,
    },
    expiresAt: timestamp,
    commentsEnabled: true,
    generation: 0,
    sequence: 0,
    head: ROOM_V3_GENESIS_HASH,
    cursor: 0,
    eventBytes: 2,
    events: [],
    nextCursor: null,
    ...cipher,
  };
  const companyManifest = {
    schemaVersion: '2.0.0',
    kind: 'openplanr-company-resource-manifest',
    organizationId: 'company',
    projectId: 'project',
    artifactId: 'design',
    revisionId: id,
    contentDigest: `sha256:${digest}`,
    contentType: 'application/json',
    byteLength: 1,
    decodedBytes: 1,
    catalog: manifest.catalog,
    chunks: [{ index: 0, byteLength: 1, sha256: digest }],
  };
  const resource = (kind, value, corrupt) => ({
    kind,
    value,
    corrupt,
    direct: (input) => assertLargeObjectContract(input, kind),
  });
  const security = (kind, value, corrupt) => ({
    kind,
    value,
    corrupt,
    direct: (input) => assertSharingSecurityContract(input, kind),
  });
  return [
    resource('enterprise-artifact-revision', companyRevision(), (v) => {
      v.contentReference.transport = 'unknown';
    }),
    {
      kind: 'diagram-authoring-bundle',
      value: bundle,
      direct: assertVersionedDiagramAuthoringBundle,
      corrupt: (v) => {
        v.bundleDigest = `sha256:${digest}`;
      },
    },
    {
      kind: 'diagram-edit-transaction',
      value: { ...makeTransaction(bundle), schemaVersion: '1.1.0', protocolVersion: '1.17.0' },
      direct: assertVersionedDiagramEditTransaction,
      corrupt: (v) => {
        v.operations[0].type = 'arbitrary-patch';
      },
    },
    {
      kind: 'diagram-review-bundle',
      value: {
        ...makeReviewBundle(),
        schemaVersion: '1.1.0',
        presentation: normalizeDiagramPresentation(),
      },
      direct: assertDiagramReviewBundleV11,
      corrupt: (v) => {
        v.scene.items[1].id = v.scene.items[0].id;
      },
    },
    {
      kind: 'diagram-presentation',
      value: normalizeDiagramPresentation(),
      direct: assertDiagramPresentation,
      corrupt: (v) => {
        v.fontFamily = 'Unknown';
      },
    },
    resource('encrypted-resource-manifest', manifest, (v) => {
      v.catalog.offset = 1;
    }),
    resource(
      'encrypted-upload-prepare',
      {
        schemaVersion: '2.0.0',
        workspaceId: id,
        operationId: id,
        expectedVersion: 0,
        epoch: 1,
        ownerPublicKey: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) },
        ownerAuthHash: digest,
        reviewerAuthHash: digest,
        keyring: cipher,
        manifest,
        signature: 'X'.repeat(86),
      },
      (v) => {
        v.manifest.epoch = 2;
      },
    ),
    resource(
      'encrypted-upload-status',
      {
        schemaVersion: '2.0.0',
        workspaceId: id,
        operationId: id,
        revisionId: manifest.revisionId,
        manifestSha256: digest,
        status: 'committed',
        receivedChunks: [],
        receipt,
      },
      (v) => {
        v.receipt.operationId = 'Z'.repeat(22);
      },
    ),
    resource('resource-catalog', catalog, (v) => {
      v.viewSources.home = 'missing';
    }),
    resource('company-resource-manifest', companyManifest, (v) => {
      v.byteLength = 2;
    }),
    resource(
      'company-resource-upload-prepare',
      { schemaVersion: '2.0.0', operationId: id, baseRevisionId: null, manifest: companyManifest },
      (v) => {
        v.manifest.byteLength = 2;
      },
    ),
    security(
      'artifact-room-create-v3',
      {
        schemaVersion: '3.0.0',
        operation: 'create',
        roomId: id,
        creationId: 'A'.repeat(43),
        ttl: '30d',
        reviewCommitment: digest,
        ...cipher,
        ownerKey,
        readCapability: 'A'.repeat(43),
        reviewerCapability: 'B'.repeat(43),
        ownerCapability: 'C'.repeat(43),
        manageCapability: 'D'.repeat(43),
        signature: 'X'.repeat(86),
      },
      (v) => {
        v.readCapability = v.reviewerCapability;
      },
    ),
    security('artifact-room-event-v3', roomEvent(), (v) => {
      v.authorRole = 'owner';
    }),
    security(
      'artifact-room-append-v3',
      { schemaVersion: '3.0.0', operation: 'append', expectedGeneration: 0, record: roomEvent() },
      (v) => {
        v.record.authorRole = 'owner';
      },
    ),
    security('artifact-room-read-page-v3', page, (v) => {
      v.eventBytes = 3;
    }),
    security(
      'artifact-room-management-v3',
      {
        schemaVersion: '3.0.0',
        roomId: id,
        operation: 'pause',
        operationId: id,
        expectedGeneration: 0,
        signature: 'X'.repeat(86),
      },
      (v) => {
        delete v.roomId;
      },
    ),
    security(
      'artifact-paste-v2',
      {
        schemaVersion: '2.0.0',
        operation: 'create',
        id,
        creationId: 'A'.repeat(43),
        ttl: '7d',
        ...cipher,
      },
      (v) => {
        v.ciphertext = 'B'.repeat(22);
      },
    ),
    security(
      'preview-bridge-message',
      {
        schemaVersion: '1.0.0',
        channel: 'A'.repeat(43),
        type: 'state',
        viewId: 'home',
        state: { session: {}, forms: {} },
      },
      (v) => {
        v.state.session.text = 'x'.repeat(8193);
      },
    ),
  ];
}

test('exact additive reader matches specialized acceptance, identity and semantic rejection', () => {
  for (const { kind, value, direct, corrupt } of cases()) {
    const before = JSON.stringify(value);
    assert.equal(direct(value), value, kind);
    assert.deepEqual(validateProtocolArtifact(kind, value, options), [], kind);
    assert.equal(assertProtocolArtifact(kind, value, options), value, kind);
    assert.equal(JSON.stringify(value), before, `${kind}: no mutation`);
    const invalid = structuredClone(value);
    corrupt(invalid);
    assert.throws(() => direct(invalid), undefined, `${kind}: specialized rejects`);
    assert.ok(validateProtocolArtifact(kind, invalid, options).length, `${kind}: generic rejects`);
    assert.throws(
      () => assertProtocolArtifact(kind, invalid, options),
      {
        code: 'E_PROTOCOL_ARTIFACT_INVALID',
      },
      kind,
    );
  }
});

test('all additive kind names reject root and nested accessors before schema or version reads', () => {
  for (const kind of Object.keys(LARGE_OBJECT_SCHEMAS)) {
    for (const key of ['protocolVersion', 'schemaVersion', 'nested']) {
      let reads = 0;
      const hostile = Object.defineProperty({}, key, {
        enumerable: true,
        get() {
          reads++;
          return key === 'protocolVersion' ? '1.17.0' : { secret: true };
        },
      });
      assert.ok(validateProtocolArtifact(kind, hostile, options).length, `${kind}:${key}`);
      assert.equal(reads, 0, `${kind}:${key}`);
    }
  }
  for (const kind of ['encrypted-upload-prepare', 'diagram-authoring-bundle']) {
    let reads = 0;
    const hostile = Object.defineProperty({}, 'protocolVersion', {
      get() {
        reads++;
        return '1.17.0';
      },
    });
    assert.ok(validateProtocolArtifact(kind, hostile).length, kind);
    assert.equal(reads, 0, kind);
  }
  const manifest = encryptedManifest();
  let reads = 0;
  Object.defineProperty(manifest.chunks[0], 'byteLength', {
    enumerable: true,
    get() {
      reads++;
      return 17;
    },
  });
  assert.ok(validateProtocolArtifact('encrypted-resource-manifest', manifest, options).length);
  assert.equal(reads, 0);
});

test('specialized and generic additive readers reject accessors and required hidden fields identically', () => {
  for (const { kind, value, direct } of cases()) {
    const hostile = structuredClone(value);
    const key = Object.keys(hostile)[0];
    const previous = hostile[key];
    let reads = 0;
    Object.defineProperty(hostile, key, {
      enumerable: true,
      get() {
        reads++;
        return previous;
      },
    });
    assert.throws(() => direct(hostile), undefined, `${kind}: direct accessor rejection`);
    assert.ok(validateProtocolArtifact(kind, hostile, options).length, kind);
    assert.equal(reads, 0, `${kind}: no reader executes the accessor`);
    const hidden = structuredClone(value);
    Object.defineProperty(hidden, key, { enumerable: false });
    assert.throws(() => direct(hidden), undefined, `${kind}: hidden required field`);
    assert.ok(validateProtocolArtifact(kind, hidden, options).length, kind);
  }
  const message = { schemaVersion: '1.0.0', type: 'ready', viewId: 'home' };
  Object.defineProperty(message, 'channel', { value: 'wrong', enumerable: false });
  assert.throws(() => assertPreviewBridgeMessage(message));
  assert.throws(() => assertSharingSecurityContract(message, 'preview-bridge-message'));
  assert.ok(validateProtocolArtifact('preview-bridge-message', message, options).length);
});

test('additive preflight rejects cycles, custom array methods and hidden authority without running them', () => {
  const value = encryptedManifest();
  let calls = 0;
  const prototype = Object.create(Array.prototype, {
    entries: {
      value() {
        calls++;
        return [];
      },
    },
  });
  Object.setPrototypeOf(value.chunks, prototype);
  assert.ok(validateProtocolArtifact('encrypted-resource-manifest', value, options).length);
  assert.equal(calls, 0);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => assertLargeObjectData(cycle));
  assert.throws(() => assertLargeObjectData({ [Symbol('authority')]: true }));
  assert.throws(() => assertLargeObjectData(JSON.parse('{"__proto__":{"authority":true}}')));
  assert.throws(() => assertLargeObjectData(new Array(1)));
  const custom = [1];
  custom.extra = 2;
  assert.throws(() => assertLargeObjectData(custom));
  const nonNumeric = new Array(1);
  nonNumeric['00'] = 1;
  assert.throws(() => assertLargeObjectData(nonNumeric));
  const hiddenIndex = [1];
  Object.defineProperty(hiddenIndex, '0', { enumerable: false });
  assert.throws(() => assertLargeObjectData(hiddenIndex));
  assert.throws(() => assertLargeObjectData(Array.from({ length: 250000 }, () => 0)), RangeError);
  let nested = 0;
  for (let i = 0; i < 41; i++) nested = [nested];
  assert.throws(() => assertLargeObjectData(nested), RangeError);
  const shared = Object.create(null);
  shared.value = 1;
  const safe = { left: shared, right: shared };
  assert.equal(assertLargeObjectData(safe), safe);
});

test('diagram reader retains its own aggregate budget rather than imposing resource limits', () => {
  const bundle = authoringBundle();
  // Inert input between the two aggregate budgets must reach the diagram shape
  // reader, which rejects this array where its summary requires a string.
  bundle.document.summary = Array.from({ length: 250000 }, () => 0);
  assert.equal(assertDiagramData(bundle), bundle);
  const diagnostics = validateProtocolArtifact('diagram-authoring-bundle', bundle, options);
  assert.ok(diagnostics.length);
  assert.ok(
    diagnostics.some((issue) => issue.path === '$.document.summary' && issue.rule === 'type'),
    'shape reader ran after the correct diagram preflight',
  );
});

test('exact reader selection preserves unsupported/unknown codes and historical diagnostics', () => {
  for (const { kind, value } of cases())
    assert.throws(
      () => validateProtocolArtifact(kind, value, { protocolVersion: '1.17.1' }),
      { code: 'E_SCHEMA_VERSION_UNSUPPORTED' },
      kind,
    );
  assert.throws(() => validateProtocolArtifact('unknown-studio-kind', {}, options), {
    code: 'E_SCHEMA_UNKNOWN',
  });
  assert.throws(() => validateProtocolArtifact('constructor', {}, options), {
    code: 'E_SCHEMA_VERSION_UNSUPPORTED',
  });
  for (const unknown of ['unknown-studio-kind', 'constructor', 'toString', '__proto__']) {
    assert.throws(() => assertLargeObjectContract({}, unknown), { name: 'TypeError' });
    assert.throws(() => assertSharingSecurityContract({}, unknown), { name: 'TypeError' });
  }
  for (const value of [makeBundle(), { ...makeBundle(), bundleDigest: `sha256:${digest}` }]) {
    assert.deepEqual(
      validateProtocolArtifact('diagram-authoring-bundle', value, { protocolVersion: '1.13.0' }),
      validateDiagramAuthoringArtifact('diagram-authoring-bundle', value),
    );
  }
  for (const value of [makeReviewBundle(), { ...makeReviewBundle(), unexpected: true }]) {
    assert.deepEqual(
      validateProtocolArtifact('diagram-review-bundle', value, { protocolVersion: '1.15.0' }),
      validateDiagramReviewArtifact('diagram-review-bundle', value),
    );
  }
  assert.ok(
    validateProtocolArtifact('diagram-authoring-bundle', makeBundle(), options).length,
    'explicit1.17 never downgrades to1.13',
  );
  assert.ok(
    validateProtocolArtifact('diagram-review-bundle', makeReviewBundle(), options).length,
    'explicit1.17 never downgrades to1.15',
  );
  assert.deepEqual(
    validateProtocolArtifact('diagram-authoring-bundle', authoringBundle()),
    [],
    'descriptor-based version inference accepts exact1.17 authoring',
  );
});

test('new company revision metadata accepts opaque manifest IDs and retained historical parents without changing1.12', () => {
  const frozen = JSON.stringify(ENTERPRISE_ARTIFACT_REVISION_SCHEMA);
  for (const prefix of ['_', '-']) {
    const revisionId = `${prefix}${'R'.repeat(21)}`;
    const opaqueParent = `${prefix}${'P'.repeat(21)}`;
    for (const parent of [null, opaqueParent, 'rev_a']) {
      const value = companyRevision(revisionId, parent);
      assert.equal(assertLargeObjectContract(value, 'enterprise-artifact-revision'), value);
      assert.deepEqual(
        validateProtocolArtifact('enterprise-artifact-revision', value, options),
        [],
      );
    }
    const {
      contentReference: _reference,
      protocolVersion: _version,
      ...legacy
    } = companyRevision(revisionId);
    legacy.schemaVersion = '1.0.0';
    legacy.contentDigest = digest;
    assert.throws(
      () => assertEnterpriseRevision(legacy),
      'frozen1.12 keeps its original ID format',
    );
    legacy.id = 'rev_a';
    assert.equal(assertEnterpriseRevision(legacy), legacy);
  }
  assert.equal(
    JSON.stringify(ENTERPRISE_ARTIFACT_REVISION_SCHEMA),
    frozen,
    'additive ID normalization never mutates the historical schema',
  );
});

test('additive revision reader preserves historical self-parent and strict calendar invariants', () => {
  for (const corrupt of [
    (value) => {
      value.parentRevisionId = value.id;
    },
    (value) => {
      value.createdAt = '2026-02-30T00:00:00.000Z';
    },
  ]) {
    const value = companyRevision(`_${'R'.repeat(21)}`);
    corrupt(value);
    assert.throws(() => assertLargeObjectContract(value, 'enterprise-artifact-revision'));
    assert.ok(validateProtocolArtifact('enterprise-artifact-revision', value, options).length);
    assert.throws(() => assertProtocolArtifact('enterprise-artifact-revision', value, options), {
      code: 'E_PROTOCOL_ARTIFACT_INVALID',
    });
  }
});
