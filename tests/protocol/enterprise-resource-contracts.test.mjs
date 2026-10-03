import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { protocolAssetUrl } from '../../packages/protocol/src/browser-contracts.mjs';
import { canonicalizeJson, sha256Hex } from '../../packages/protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  assertEnterpriseEvidence,
  assertEnterpriseHandoff,
  assertEnterpriseProposal,
  assertEnterpriseReviewThread,
  assertEnterpriseSync,
  createEnterpriseHandoff,
  ENTERPRISE_SCHEMAS,
  renderEnterpriseHandoffMarkdown,
} from '../../packages/protocol/src/enterprise-contracts.mjs';
import {
  assertEnterpriseResourceContract,
  assertEnterpriseReviewAnchorV11,
  assertVersionedEnterpriseEvidence,
  assertVersionedEnterpriseHandoff,
  assertVersionedEnterpriseProposal,
  assertVersionedEnterpriseReviewThread,
  assertVersionedEnterpriseSync,
  createEnterpriseHandoffV11,
  ENTERPRISE_RESOURCE_SCHEMAS,
  renderVersionedEnterpriseHandoffMarkdown,
} from '../../packages/protocol/src/enterprise-resource-contracts.mjs';
import { assertLargeObjectContract } from '../../packages/protocol/src/large-object-contracts.mjs';
import {
  resourceCases,
  resourceEvidence,
  resourceHandoff,
  resourceProposal,
  resourceSync,
  resourceThread,
} from './fixtures/enterprise-resources.mjs';

const readers = {
  'enterprise-review-thread': assertVersionedEnterpriseReviewThread,
  'enterprise-change-proposal': assertVersionedEnterpriseProposal,
  'enterprise-evidence-reference': assertVersionedEnterpriseEvidence,
  'enterprise-sync-state': assertVersionedEnterpriseSync,
  'enterprise-agent-handoff': assertVersionedEnterpriseHandoff,
};
const oldReaders = {
  'enterprise-review-thread': assertEnterpriseReviewThread,
  'enterprise-change-proposal': assertEnterpriseProposal,
  'enterprise-evidence-reference': assertEnterpriseEvidence,
  'enterprise-sync-state': assertEnterpriseSync,
  'enterprise-agent-handoff': assertEnterpriseHandoff,
};
const failure = (read, value) => {
  try {
    read(value);
  } catch (error) {
    return error.message;
  }
  assert.fail('Expected semantic rejection.');
};
const clone = (value) => structuredClone(value);

test('staged opaque prefixes and retained IDs flow through every successor and generic reader', () => {
  for (const revisionId of [
    '_'.padEnd(22, 'R'),
    '-'.padEnd(22, 'R'),
    '_'.padEnd(64, 'R'),
    '-'.padEnd(64, 'R'),
    'a'.repeat(64),
    'rev_old',
  ]) {
    const anchor = { revisionId, elementId: 'button.primary' };
    assert.equal(assertEnterpriseReviewAnchorV11(anchor), anchor);
    for (const [kind, value] of Object.entries(resourceCases(revisionId))) {
      assert.equal(readers[kind](value), value, kind);
      assert.equal(assertEnterpriseResourceContract(value, kind), value, kind);
      assert.equal(assertLargeObjectContract(value, kind), value, kind);
      assert.deepEqual(
        validateProtocolArtifact(kind, value, { protocolVersion: '1.17.0' }),
        [],
        kind,
      );
      if (/^[_-]/.test(revisionId)) assert.throws(() => oldReaders[kind](value), TypeError, kind);
    }
  }
});

test('successors preserve domain invariants, strict dates and exact generic rejection', () => {
  const cases = [
    [
      'enterprise-review-thread',
      resourceThread('rev_a'),
      (v) => v.replies.push({ ...v.replies[0] }),
    ],
    [
      'enterprise-review-thread',
      resourceThread('rev_a'),
      (v) => {
        v.replies[0].createdAt = '2026-09-13T08:00:00.000Z';
      },
    ],
    [
      'enterprise-change-proposal',
      resourceProposal('rev_a'),
      (v) => {
        v.application.revisionId = v.baseRevisionId;
      },
    ],
    [
      'enterprise-change-proposal',
      resourceProposal('rev_a'),
      (v) => v.validation.issues.push({ code: 'unresolved', message: 'Private detail.' }),
    ],
    [
      'enterprise-evidence-reference',
      resourceEvidence('rev_a'),
      (v) => {
        v.source = { kind: 'url', url: 'https://user:password@example.test/' };
      },
    ],
    [
      'enterprise-evidence-reference',
      resourceEvidence('rev_a'),
      (v) => {
        v.source = {
          kind: 'repository',
          repositoryId: 'repo_a',
          path: '../escape',
          commit: 'a'.repeat(40),
        };
      },
    ],
    [
      'enterprise-sync-state',
      resourceSync('rev_a'),
      (v) => {
        v.items[0].revisionId = 'rev_b';
      },
    ],
    [
      'enterprise-sync-state',
      resourceSync('rev_a'),
      (v) => {
        v.items[0].artifactId = 'foreign';
      },
    ],
  ];
  for (const [kind, value, corrupt] of cases) {
    const current = clone(value);
    corrupt(current);
    const old = clone(current);
    old.schemaVersion = '1.0.0';
    delete old.protocolVersion;
    assert.equal(failure(readers[kind], current), failure(oldReaders[kind], old), kind);
    assert.throws(() => assertLargeObjectContract(current, kind), TypeError, kind);
    assert.ok(validateProtocolArtifact(kind, current, { protocolVersion: '1.17.0' }).length, kind);
  }
  for (const [kind, value] of Object.entries(resourceCases('_'.padEnd(22, 'R')))) {
    const invalid = clone(value);
    invalid[
      kind === 'enterprise-sync-state'
        ? 'updatedAt'
        : kind === 'enterprise-agent-handoff'
          ? 'generatedAt'
          : kind === 'enterprise-evidence-reference'
            ? 'capturedAt'
            : 'createdAt'
    ] = '2026-02-30T00:00:00.000Z';
    assert.match(failure(readers[kind], invalid), /Invalid enterprise timestamp/);
    assert.ok(validateProtocolArtifact(kind, invalid, { protocolVersion: '1.17.0' }).length, kind);
  }
});

test('handoffs bind mixed retained feedback to scope, dates and full original content digest', () => {
  const valid = resourceHandoff('_'.padEnd(22, 'R'));
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid.threads[0].anchor));
  const { contentDigest, ...content } = valid;
  assert.equal(contentDigest, sha256Hex(canonicalizeJson(content)));
  assert.match(renderVersionedEnterpriseHandoffMarkdown(valid), /&lt;img src=x&gt;/);
  for (const corrupt of [
    (v) => {
      v.threads[0].projectId = 'foreign';
    },
    (v) => {
      v.evidence[0].projectId = 'foreign';
    },
    (v) => {
      v.generatedAt = '2026-09-13T08:00:00.000Z';
    },
    (v) => {
      v.threads[0].body += 'changed';
    },
    (v) => v.threads.push(clone(v.threads[0])),
  ]) {
    const invalid = clone(valid);
    corrupt(invalid);
    assert.throws(() => assertVersionedEnterpriseHandoff(invalid), TypeError);
    assert.ok(
      validateProtocolArtifact('enterprise-agent-handoff', invalid, { protocolVersion: '1.17.0' })
        .length,
    );
  }
});

test('legacy readers retain identity, diagnostics, schema bytes and escaped renderer output', () => {
  const oldThread = resourceThread('rev_old', true);
  const oldEvidence = resourceEvidence('rev_old', true);
  const legacy = createEnterpriseHandoff({
    organizationId: 'org_a',
    projectId: 'project_a',
    artifactId: 'diagram_a',
    revisionId: 'rev_old',
    generatedAt: '2026-09-13T09:01:00.000Z',
    threads: [oldThread],
    evidence: [oldEvidence],
  });
  const cases = {
    'enterprise-review-thread': oldThread,
    'enterprise-evidence-reference': oldEvidence,
    'enterprise-change-proposal': resourceProposal('rev_old', true),
    'enterprise-sync-state': resourceSync('rev_old', true),
    'enterprise-agent-handoff': legacy,
  };
  for (const [kind, value] of Object.entries(cases)) {
    assert.equal(readers[kind](value), value, kind);
    assert.equal(oldReaders[kind](value), value, kind);
    const invalid = { ...value, unexpected: true };
    assert.equal(failure(readers[kind], invalid), failure(oldReaders[kind], invalid), kind);
  }
  assert.equal(
    renderVersionedEnterpriseHandoffMarkdown(legacy),
    renderEnterpriseHandoffMarkdown(legacy),
  );
  const deep = resourceProposal('rev_old', true);
  deep.status = 'proposed';
  delete deep.application;
  let nested = {};
  for (let i = 0; i < 44; i++) nested = { child: nested };
  deep.operations = [{ op: 'replace-document', content: nested }];
  assert.equal(assertVersionedEnterpriseProposal(deep), deep);
  assert.equal(assertEnterpriseProposal(deep), deep);
  for (const [kind, schema] of Object.entries(ENTERPRISE_SCHEMAS)) {
    assert.deepEqual(
      schema,
      JSON.parse(
        readFileSync(
          new URL(`../../packages/protocol/schemas/v1.12.0/${kind}.schema.json`, import.meta.url),
          'utf8',
        ),
      ),
    );
  }
});

test('successors reject hostile accessors, hidden authority and unsupported versions before dispatch', () => {
  let reads = 0;
  for (const [kind, value] of Object.entries(resourceCases('_'.padEnd(22, 'R')))) {
    const accessor = clone(value);
    Object.defineProperty(accessor, 'schemaVersion', {
      enumerable: true,
      get() {
        reads++;
        return '1.1.0';
      },
    });
    assert.throws(() => readers[kind](accessor), TypeError);
    assert.ok(validateProtocolArtifact(kind, accessor, { protocolVersion: '1.17.0' }).length);
    const hidden = clone(value);
    Object.defineProperty(hidden, 'protocolVersion', { value: '1.17.0', enumerable: false });
    assert.throws(() => readers[kind](hidden), TypeError);
    for (const invalid of [
      { ...value, schemaVersion: '9.0.0' },
      { ...value, protocolVersion: '1.12.0' },
    ])
      assert.throws(() => readers[kind](invalid), TypeError);
  }
  assert.equal(reads, 0);
  const input = {};
  Object.defineProperty(input, 'threads', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  assert.throws(() => createEnterpriseHandoffV11(input), TypeError);
  assert.equal(reads, 0);
  for (const revisionId of ['_short', '-short', '_'.repeat(65), 'invalid\n'])
    assert.throws(
      () => assertEnterpriseReviewAnchorV11({ revisionId, elementId: 'button' }),
      TypeError,
    );
  assert.throws(() => assertEnterpriseResourceContract({}, 'constructor'), TypeError);
});

test('every successor has exact browser asset identity and generated schema parity', () => {
  for (const [kind, schema] of Object.entries(ENTERPRISE_RESOURCE_SCHEMAS)) {
    const asset = protocolAssetUrl(kind, { protocolVersion: '1.17.0' });
    assert.equal(schema.$id, `https://openplanr.dev/schemas/v1.17.0/${kind}.schema.json`);
    assert.deepEqual(JSON.parse(readFileSync(asset, 'utf8')), schema);
    const projection = new URL(
      `../../packages/protocol/projections/pipeline/lib/protocol/enterprise-resource-contracts.mjs`,
      import.meta.url,
    );
    assert.match(readFileSync(projection, 'utf8'), /enterprise-contract-validation\.mjs/);
  }
});
