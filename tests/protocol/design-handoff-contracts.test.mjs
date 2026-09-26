import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DESIGN_HANDOFF_AUTHORITY,
  DESIGN_HANDOFF_CHECK_IDS,
  DESIGN_HANDOFF_SCHEMAS,
  assertDesignHandoffContract,
  assertDesignHandoffReadiness,
  assertDesignImplementationHandoff,
  assertDesignPlanningLineage,
  designImplementationHandoffDigest,
} from '../../packages/protocol/src/design-handoff-contracts.mjs';
import {
  listProtocolSchemas,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import {
  PROTOCOL_V111_CONTRACTS,
  protocolAssetUrl,
} from '../../packages/protocol/src/browser-contracts.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const action = (id) => ({ id: `fix-${id}`, label: `Resolve ${id.replaceAll('-', ' ')}` });
const readiness = () => ({
  kind: 'openplanr-design-handoff-readiness',
  schemaVersion: '1.0.0',
  scope: 'design-originated',
  authority: 'none',
  designId: 'checkout',
  sourceRevision: digest('a'),
  selectedVariant: 'calm',
  status: 'ready',
  continuation: { action: 'prepare-plan', available: true },
  checks: DESIGN_HANDOFF_CHECK_IDS.map((id) => ({
    id,
    status: 'pass',
    message: `${id.replaceAll('-', ' ')} is ready.`,
    evidenceRefs: [],
  })),
  evidence: [],
  blockers: [],
  nextActions: [],
});

const draftHandoff = () => {
  const value = {
    kind: 'openplanr-design-implementation-handoff',
    schemaVersion: '1.0.0',
    id: 'handoff-1',
    version: 1,
    status: 'draft',
    authority: 'prepare-plan',
    title: 'Checkout implementation package',
    basis: {
      designId: 'checkout',
      sourceRevision: digest('a'),
      selectedVariant: 'calm',
      readiness: { status: 'ready', digest: digest('b') },
      reviewHandoff: { version: 3, contentDigest: digest('c') },
    },
    sources: [
      {
        id: 'design',
        kind: 'design-revision',
        path: 'design-document.json',
        revision: digest('a'),
        digest: digest('d'),
      },
    ],
    requirements: [
      {
        id: 'REQ-001',
        kind: 'behavior',
        statement: 'Keep the payment retry explicit.',
        sourceRefs: ['design'],
        verification: ['The retry state is visible and keyboard reachable.'],
      },
    ],
    contentDigest: digest('0'),
    markdown: '# Checkout implementation package\n',
  };
  value.contentDigest = designImplementationHandoffDigest(value);
  return value;
};

test('Protocol 1.11 generates three closed handoff contracts and registers exact assets', () => {
  assert.equal(Object.keys(DESIGN_HANDOFF_SCHEMAS).length, 3);
  for (const [name, schema] of Object.entries(DESIGN_HANDOFF_SCHEMAS)) {
    const generated = JSON.parse(
      readFileSync(
        new URL(`../../packages/protocol/schemas/v1.11.0/${name}.schema.json`, import.meta.url),
      ),
    );
    assert.deepEqual(generated, schema);
    assert.equal(schema['x-openplanr-contract'].version, '1.11.0');
    assert.equal(PROTOCOL_V111_CONTRACTS[name], `${name}.schema.json`);
    assert.equal(
      protocolAssetUrl(name, { protocolVersion: '1.11.0' }).pathname.endsWith(
        `${name}.schema.json`,
      ),
      true,
    );
    assert.deepEqual(
      validateProtocolArtifact(
        name,
        name === 'design-handoff-readiness'
          ? readiness()
          : name === 'design-implementation-handoff'
            ? draftHandoff()
            : {
                kind: 'openplanr-design-planning-lineage',
                schemaVersion: '1.0.0',
                handoff: {
                  id: 'handoff-1',
                  version: 1,
                  contentDigest: draftHandoff().contentDigest,
                },
                specId: 'SPEC-014',
                mappings: [
                  {
                    requirementId: 'REQ-001',
                    acceptanceRefs: [{ storyId: 'US-041', acceptanceId: 'AC-001' }],
                    taskIds: ['T-041'],
                  },
                ],
              },
        { protocolVersion: '1.11.0' },
      ),
      [],
    );
  }
  const listed = listProtocolSchemas()
    .filter((item) => item.protocolVersion === '1.11.0')
    .map((item) => item.kind);
  for (const name of Object.keys(DESIGN_HANDOFF_SCHEMAS)) assert.ok(listed.includes(name));
});

test('readiness rejects drift, missing evidence, duplicate checks, and technical user guidance', () => {
  assertDesignHandoffReadiness(readiness());
  const absent = {
    kind: 'openplanr-design-handoff-readiness-absence',
    schemaVersion: '1.0.0',
    status: 'absent',
    reason: 'not-computed',
    message: 'No readiness is available.',
    nextAction: { id: 'inspect-design', label: 'Open the design' },
  };
  assertDesignHandoffReadiness(absent);
  for (const mutate of [
    (value) => {
      value.unknown = true;
    },
    (value) => {
      value.schemaVersion = '2.0.0';
    },
    (value) => {
      value.checks[1].id = value.checks[0].id;
    },
    (value) => {
      value.checks[0].evidenceRefs = ['missing'];
    },
    (value) => {
      value.checks[0] = {
        ...value.checks[0],
        status: 'blocked',
        message: 'Compare the digest.',
        recoveryAction: action(value.checks[0].id),
      };
      value.status = 'blocked';
      value.blockers = [value.checks[0].id];
      value.nextActions = [value.checks[0].recoveryAction];
      value.continuation.available = false;
    },
    (value) => {
      value.checks[0] = {
        ...value.checks[0],
        status: 'blocked',
        recoveryAction: action(value.checks[0].id),
      };
      value.status = 'blocked';
      value.blockers = [value.checks[0].id];
      value.nextActions = [{ ...value.checks[0].recoveryAction, label: 'Different action' }];
      value.continuation.available = false;
    },
  ]) {
    const value = structuredClone(readiness());
    mutate(value);
    assert.throws(() => assertDesignHandoffReadiness(value));
  }
});

test('implementation packages fail closed on hostile paths, duplicate or missing sources, substitution, and excess authority', () => {
  assert.equal(DESIGN_HANDOFF_AUTHORITY, 'prepare-plan');
  assertDesignImplementationHandoff(draftHandoff());
  const paths = [
    '../secret',
    '/tmp/secret',
    'C:/secret',
    'https://example.com/a',
    'design/%2e%2e/secret',
    'design//file',
    'design\\file',
    'design.json?token=x',
  ];
  for (const path of paths) {
    const value = draftHandoff();
    value.sources[0].path = path;
    value.contentDigest = designImplementationHandoffDigest(value);
    assert.throws(() => assertDesignImplementationHandoff(value), path);
  }
  for (const mutate of [
    (value) => {
      value.requirements.push(structuredClone(value.requirements[0]));
    },
    (value) => {
      value.requirements[0].sourceRefs = ['missing'];
    },
    (value) => {
      value.contentDigest = digest('f');
    },
    (value) => {
      value.markdown = '# Substituted implementation brief';
    },
    (value) => {
      value.authority = 'ship';
    },
    (value) => {
      value.execution = { command: 'deploy' };
    },
    (value) => {
      value.sources[0].anchor = { screenId: 'one', reviewId: 'review', pinId: 'pin' };
      value.contentDigest = designImplementationHandoffDigest(value);
    },
  ]) {
    const value = draftHandoff();
    mutate(value);
    assert.throws(() => assertDesignImplementationHandoff(value));
  }

  const approved = draftHandoff();
  approved.status = 'approved';
  approved.approval = {
    actorId: 'owner-1',
    approvedAt: '2026-09-21T10:00:00Z',
    contentDigest: approved.contentDigest,
    authority: 'prepare-plan',
  };
  assertDesignImplementationHandoff(approved);
  approved.basis.readiness.status = 'blocked';
  approved.contentDigest = designImplementationHandoffDigest(approved);
  approved.approval.contentDigest = approved.contentDigest;
  assert.throws(() => assertDesignImplementationHandoff(approved));
});

test('planning lineage binds complete requirements to story-scoped acceptance and task IDs', () => {
  const handoff = draftHandoff();
  handoff.status = 'approved';
  handoff.approval = {
    actorId: 'owner-1',
    approvedAt: '2026-09-21T10:00:00Z',
    contentDigest: handoff.contentDigest,
    authority: 'prepare-plan',
  };
  const lineage = {
    kind: 'openplanr-design-planning-lineage',
    schemaVersion: '1.0.0',
    handoff: { id: handoff.id, version: handoff.version, contentDigest: handoff.contentDigest },
    specId: 'SPEC-014',
    mappings: [
      {
        requirementId: 'REQ-001',
        acceptanceRefs: [{ storyId: 'US-041', acceptanceId: 'AC-001' }],
        taskIds: ['T-041'],
      },
    ],
  };
  assertDesignPlanningLineage(lineage, handoff);
  const duplicate = structuredClone(lineage);
  duplicate.mappings.push(structuredClone(duplicate.mappings[0]));
  assert.throws(() => assertDesignPlanningLineage(duplicate, handoff));
  const incomplete = structuredClone(lineage);
  incomplete.mappings[0].requirementId = 'REQ-002';
  assert.throws(() => assertDesignPlanningLineage(incomplete, handoff));
});

test('existing v1.9 and v1.10 design contract bytes remain unchanged', () => {
  const expected = {
    'v1.9.0/design-document.schema.json':
      'bd84d34b42f9451f9ff836105a7a6c92b2d74209aa82f6a0dd973532edf99422',
    'v1.9.0/design-review-bundle.schema.json':
      '560bbc0f147f20f5b3d65a36b10ae1c4209fd5d9ec0a199f0d23f818684dcba8',
    'v1.9.0/design-review-workspace.schema.json':
      'e09129fd8428c62285a308f23fda8235636d0c0061730761a94eecf7622a580f',
    'v1.9.0/design-workspace-create.schema.json':
      'd385984298db9fd130735ad5a4d59b80f7a4e70818276c0060b86c38fa1d339c',
    'v1.9.0/design-workspace-event.schema.json':
      '3fa3a0e578a54060a7a279de6190afbb77d39d1f04cb1ad2d5f33a6ad76932c4',
    'v1.9.0/design-workspace-revision.schema.json':
      '9cb7cea43bad0b3a51d608e1e5645539ad7e8a4473b036d288cc8f4996b2a04a',
    'v1.10.0/design-review-bundle.schema.json':
      'f7f4c559ac9f394ffbba3dd8b7854ff5c0e5abac9b608dfa62188b7a04ae6767',
    'v1.10.0/design-review-context.schema.json':
      '7a3ac0281880b6226faf52533032471d2bf5384f6f8aa639a12851c529caa78e',
    'v1.10.0/design-review-handoff.schema.json':
      '402b25238f93f8269b98697bf77fa11dda1fd284f44e41d73cdb813f5244a4e0',
    'v1.10.0/design-review-metadata-payload.schema.json':
      'ba8ac124e47e8f8310214445b1752cc6706d3a7265a87c9f9685a7e9df84f0b1',
  };
  for (const [path, value] of Object.entries(expected)) {
    const bytes = readFileSync(new URL(`../../packages/protocol/schemas/${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), value, path);
  }
});
