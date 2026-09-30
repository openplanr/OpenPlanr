import {
  PROTOCOL_V115_CONTRACTS,
  protocolAssetUrl,
  validateDiagramReviewArtifact,
} from '../../../packages/protocol/src/browser-contracts.mjs';
import { makeBundle, sealBundle } from './diagram-authoring.mjs';

export function makeReviewBundle() {
  return {
    kind: 'openplanr-diagram-review-bundle',
    schemaVersion: '1.0.0',
    diagramId: 'campus-handover',
    title: 'Campus handover',
    source: { kind: 'manifest', digest: `sha256:${'a'.repeat(64)}` },
    rendering: { id: 'openplanr-diagram-svg', version: '1.0.0', fontFamily: 'Inter' },
    scene: {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><text x="10" y="20">Campus</text></svg>',
      width: 300,
      height: 100,
      items: [
        { id: 'a', label: 'Applicants', kind: 'Item', x: 10, y: 20 },
        { id: 'b', label: 'Campus', kind: 'Item', x: 200, y: 20 },
      ],
      relations: [{ id: 'handover', from: 'a', to: 'b', label: 'Insert row', kind: 'flow' }],
    },
  };
}
export function reviewContractFixtures() {
  const id = 'a'.repeat(24),
    digest = 'b'.repeat(64);
  const cipher = { iv: 'a'.repeat(16), ciphertext: 'b'.repeat(22) };
  const publicKey = { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) };
  const revision = {
    id,
    epoch: 1,
    reviewOf: digest,
    createdAt: '2026-09-30T12:00:00.000Z',
    ...cipher,
    signature: 'a'.repeat(86),
  };
  return {
    'diagram-review-bundle': makeReviewBundle(),
    'diagram-review-feedback': {
      kind: 'comment',
      commentId: 'comment-a',
      author: 'Reviewer',
      reviewOf: digest,
      createdAt: revision.createdAt,
      body: 'Clarify handover.',
      target: { elementId: 'a', x: 0.2, y: 0.5 },
    },
    'diagram-review-workspace': {
      schemaVersion: '1.0.0',
      id,
      version: 1,
      epoch: 1,
      currentRevision: id,
      commentsPaused: false,
      ownerPublicKey: publicKey,
      keyring: cipher,
    },
    'diagram-workspace-create': {
      schemaVersion: '1.0.0',
      id,
      ownerPublicKey: publicKey,
      ownerAuthHash: digest,
      reviewerAuthHash: digest,
      epoch: 1,
      keyring: cipher,
      revision,
      operationId: id,
      signature: 'a'.repeat(86),
    },
    'diagram-workspace-revision': revision,
    'diagram-workspace-event': {
      id,
      revisionId: id,
      reviewOf: digest,
      epoch: 1,
      ...cipher,
      publicKey,
      signature: 'a'.repeat(86),
    },
  };
}
export function reviewCases() {
  const fixtures = reviewContractFixtures(),
    cases = Object.entries(fixtures).map(([kind, value]) => ({
      name: kind,
      kind,
      value,
      valid: true,
    }));
  const bad = (name, kind, modify) => {
    const value = structuredClone(fixtures[kind]);
    modify(value);
    cases.push({ name, kind, value, valid: false });
  };
  bad('private source path', 'diagram-review-bundle', (v) => {
    v.localPath = '/private/project';
  });
  bad('duplicate scene identity', 'diagram-review-bundle', (v) => {
    v.scene.items[1].id = 'a';
  });
  bad('connection outside scene', 'diagram-review-bundle', (v) => {
    v.scene.relations[0].to = 'unknown';
  });
  bad('unpaired pin coordinates', 'diagram-review-feedback', (v) => {
    delete v.target.y;
  });
  bad('empty author', 'diagram-review-feedback', (v) => {
    v.author = ' ';
  });
  bad('empty comment', 'diagram-review-feedback', (v) => {
    v.body = '\n';
  });
  bad('out of range pin', 'diagram-review-feedback', (v) => {
    v.target.x = 2;
  });
  bad('bad epoch', 'diagram-workspace-revision', (v) => {
    v.epoch = 0;
  });
  bad('owner credentials in response', 'diagram-review-workspace', (v) => {
    v.ownerAuth = 'secret';
  });
  bad('truncated signature', 'diagram-workspace-event', (v) => {
    v.signature = 'a';
  });
  const authored = makeBundle();
  authored.originalSource = null;
  authored.sourceMap = null;
  sealBundle(authored);
  const projection = {
    ...makeReviewBundle(),
    diagramId: authored.diagramId,
    title: authored.document.title,
    source: { kind: 'authoring', digest: authored.bundleDigest },
    authored,
  };
  cases.push({
    name: 'authored projection',
    kind: 'diagram-review-bundle',
    value: projection,
    valid: true,
  });
  const tampered = structuredClone(projection);
  tampered.authored.presentation.elements[0].bounds.x += 5;
  cases.push({
    name: 'tampered authored geometry digest',
    kind: 'diagram-review-bundle',
    value: tampered,
    valid: false,
  });
  const hostile = makeReviewBundle();
  let getterReads = 0;
  Object.defineProperty(hostile, 'protocolVersion', {
    enumerable: true,
    get() {
      getterReads++;
      return '1.15.0';
    },
  });
  cases.push({
    name: 'hostile version accessor',
    kind: 'diagram-review-bundle',
    value: hostile,
    valid: false,
    getterReads: () => getterReads,
  });
  return cases;
}
function snapshotDescriptors(value) {
  if (value === null || typeof value !== 'object') return value;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => [
    key,
    descriptor.enumerable,
    descriptor.writable,
    Object.hasOwn(descriptor, 'value')
      ? snapshotDescriptors(descriptor.value)
      : ['accessor', Boolean(descriptor.get), Boolean(descriptor.set)],
  ]);
}
export function evaluateReviewCases(validate = validateDiagramReviewArtifact) {
  return reviewCases().map(({ name, kind, value, valid, getterReads }) => {
    const before = JSON.stringify(snapshotDescriptors(value));
    const issues = validate(kind, value, { protocolVersion: '1.15.0' });
    return {
      name,
      kind,
      expectedValid: valid,
      valid: issues.length === 0,
      issues,
      getterReads: getterReads?.() ?? 0,
      unchanged: before === JSON.stringify(snapshotDescriptors(value)),
    };
  });
}
export function reviewCatalogProof() {
  const paths = Object.keys(PROTOCOL_V115_CONTRACTS).map(
    (kind) => protocolAssetUrl(kind, { protocolVersion: '1.15.0' }).pathname.split('/schemas/')[1],
  );
  const unsupported = [];
  for (const version of ['1.13.0', '1.15.1', 'constructor']) {
    try {
      protocolAssetUrl('diagram-review-bundle', { protocolVersion: version });
    } catch (error) {
      unsupported.push(error.name);
    }
  }
  return { paths, unsupported };
}
