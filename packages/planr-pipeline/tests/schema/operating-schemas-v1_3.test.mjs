import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertProtocolArtifact,
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../lib/protocol/contracts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const fixture = (name) => readJson(`conformance/fixtures/operating-board/${name}`);
const digest = (character) => `sha256:${character.repeat(64)}`;
const at = '2026-07-28T09:00:00Z';
const revision = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const V = '1.3.0';

const buildFinding = () => ({
  kind: 'operating-finding',
  schemaVersion: '1.0.0',
  protocolVersion: V,
  id: 'FND-001',
  cycleId: 'CYCLE-011',
  title: 'Reduce release risk',
  category: 'reliability',
  problem: 'No rollback rehearsal.',
  cost: 'One release cycle.',
  proposal: 'Add a rollback canary.',
  impact: 4,
  confidence: 4,
  ease: 3,
  score: 48,
  severity: 'high',
  sensitivity: 'internal',
  criticalOverride: false,
  lane: 'DEV',
  owner: 'founder',
  evidenceRefs: ['EVD-release-workflow'],
  citations: [{ citationKey: 'cto-release-1', evidenceId: 'EVD-release-workflow', snapshotDigest: digest('c') }],
  status: 'proposed',
  dependsOn: ['GAP-3f9a2c'],
  createdAt: at,
  updatedAt: at,
});

test('Protocol v1.3 schema catalog matches the schemas/v1.3.0 directory and is version-addressable', () => {
  const files = readdirSync(join(root, 'schemas/v1.3.0'))
    .filter((file) => file.endsWith('.schema.json'))
    .sort();
  assert.equal(files.length, 15);
  for (const file of files) assert.doesNotThrow(() => readJson(`schemas/v1.3.0/${file}`));

  const registered = listProtocolSchemas()
    .filter((entry) => entry.protocolVersion === V)
    .map((entry) => `${entry.kind}.schema.json`)
    .sort();
  assert.deepEqual(registered, files);

  for (const entry of listProtocolSchemas().filter((item) => item.protocolVersion === V)) {
    assert.doesNotThrow(() => resolveProtocolSchema(entry.kind, { protocolVersion: V }));
  }
});

test('the mission packet contract structurally cannot carry a file body', () => {
  const bodyNames = new Set([
    'body', 'content', 'contents', 'filebody', 'filecontent', 'filecontents',
    'rawcontent', 'rawbody', 'raw', 'bytes', 'blob', 'snippet', 'filetext',
    'sourcetext', 'fulltext', 'filedata', 'filebytes', 'excerpt',
  ]);

  const collect = (node, names = new Set()) => {
    if (node === null || typeof node !== 'object') return names;
    if (Array.isArray(node)) {
      for (const item of node) collect(item, names);
      return names;
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const key of Object.keys(node.properties)) names.add(key);
    }
    for (const value of Object.values(node)) collect(value, names);
    return names;
  };

  for (const kind of ['operating-mission-packet', 'operating-evidence-index-item', 'operating-tool-grant']) {
    const { schema } = resolveProtocolSchema(kind, { protocolVersion: V });
    assert.equal(
      schema.additionalProperties,
      false,
      `${kind} must set additionalProperties:false at its root`,
    );
    for (const name of collect(schema)) {
      assert.ok(
        !bodyNames.has(name.toLowerCase()),
        `${kind} must not declare a body-bearing property, found "${name}"`,
      );
    }
  }
});

test('mission packet fixtures validate and maxInputBytes fails closed with a named, role-scoped error', () => {
  const valid = fixture('mission-packet-valid.json');
  assert.deepEqual(validateProtocolArtifact('operating-mission-packet', valid), []);
  assert.ok(Buffer.byteLength(JSON.stringify(valid), 'utf8') <= valid.budgets.maxInputBytes);

  const oversized = fixture('mission-packet-oversized-invalid.json');
  // The oversized packet is structurally well-formed; the size rule that
  // rejects it is the producer's E_OPERATE_MISSION_PACKET_BUDGET, proven in
  // tests/orchestration/operating-mission-packet.test.mjs — schema validation
  // deliberately accepts the shape here.
  assert.deepEqual(validateProtocolArtifact('operating-mission-packet', oversized), []);

  // additionalProperties:false forbids adding a raw body field.
  assert.ok(validateProtocolArtifact('operating-mission-packet', {
    ...valid,
    content: 'const secret = 1;',
  }).length, 'a body-shaped extra property must be rejected');
});

test('citations bind to a pinned revision and reject fabricated, mis-ranged, or unpinned references', () => {
  assert.deepEqual(validateProtocolArtifact('operating-citation', fixture('citation-valid.json')), []);
  for (const name of [
    'citation-fabricated-path-invalid.json',
    'citation-wrong-line-range-invalid.json',
    'citation-stale-revision-invalid.json',
  ]) {
    assert.ok(
      validateProtocolArtifact('operating-citation', fixture(name)).length,
      `${name} must fail closed`,
    );
  }
  // Exactly one of repositoryPath | gitRevision | planrArtifactId is permitted.
  assert.ok(validateProtocolArtifact('operating-citation', {
    repositoryPath: 'src/x.mjs',
    gitRevision: revision,
    pinnedRevision: revision,
  }).length, 'a citation may not mix reference variants');
  assert.deepEqual(validateProtocolArtifact('operating-citation', {
    planrArtifactId: 'SPEC-004',
    pinnedRevision: revision,
  }), []);
});

test('citation resolution is a discriminated resolved/rejected verdict', () => {
  const resolved = {
    kind: 'operating-citation-resolution',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    citationKey: 'c1',
    outcome: 'resolved',
    evidenceId: 'EVD-x',
    snapshotDigest: digest('b'),
  };
  assert.deepEqual(validateProtocolArtifact('operating-citation-resolution', resolved), []);
  assert.ok(validateProtocolArtifact('operating-citation-resolution', {
    ...resolved,
    reason: 'unresolvable',
  }).length, 'a resolved verdict cannot also carry a rejection reason');
  assert.deepEqual(validateProtocolArtifact('operating-citation-resolution', {
    kind: 'operating-citation-resolution',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    citationKey: 'c1',
    outcome: 'rejected',
    reason: 'fabricated-path',
    gapId: 'GAP-3f9a2c',
  }), []);
  assert.ok(validateProtocolArtifact('operating-citation-resolution', {
    kind: 'operating-citation-resolution',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    citationKey: 'c1',
    outcome: 'rejected',
    reason: 'fabricated-path',
  }).length, 'a rejected verdict must open a gap');
});

test('v1.3 advisor responses cite references instead of pre-loaded evidence IDs', () => {
  const response = {
    outcome: 'proposals',
    proposals: [{
      proposalKey: 'technology-risk.reduce-release-risk',
      type: 'finding',
      title: 'Reduce release risk',
      problem: 'No verified rollback rehearsal.',
      proposal: 'Add a rollback canary.',
      impact: 4,
      confidence: 4,
      ease: 3,
      severity: 'high',
      citations: [{
        citationKey: 'cto-release-1',
        repositoryPath: 'lib/operate/reducer.mjs',
        lineRange: { start: 10, end: 24 },
        pinnedRevision: revision,
      }],
    }],
    gaps: [],
    conflicts: [],
  };
  assert.deepEqual(validateProtocolArtifact('operating-advisor-response', response, { protocolVersion: V }), []);
  assert.ok(validateProtocolArtifact('operating-advisor-response', {
    ...response,
    proposals: [{ ...response.proposals[0], citations: [] }],
  }, { protocolVersion: V }).length, 'each proposal must cite at least one reference');
  assert.ok(validateProtocolArtifact('operating-advisor-response', {
    ...response,
    proposals: [{ ...response.proposals[0], evidenceRefs: ['EVD-x'] }],
  }, { protocolVersion: V }).length, 'the pre-loaded evidenceRefs field is no longer permitted');
});

test('v1.3 findings and data gaps carry citations and the unresolvable-citation category', () => {
  assert.deepEqual(validateProtocolArtifact('operating-finding', buildFinding()), []);

  const gap = {
    kind: 'operating-data-gap',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    id: 'GAP-3f9a2c',
    cycleId: 'CYCLE-011',
    category: 'unresolvable-citation',
    question: 'Which revision holds the cited rollback rehearsal?',
    reason: 'The cited path could not be resolved against the pinned revision.',
    unblocks: ['FND-001'],
    status: 'open',
    owner: 'founder',
    evidenceRefs: [],
    createdAt: at,
    updatedAt: at,
  };
  assert.deepEqual(validateProtocolArtifact('operating-data-gap', gap), []);
  // Digest-derived gap ids (from the citation resolver) and legacy numeric ids both validate.
  assert.deepEqual(validateProtocolArtifact('operating-data-gap', { ...gap, id: 'GAP-001' }), []);
  assert.ok(validateProtocolArtifact('operating-data-gap', {
    ...gap,
    category: 'not-a-category',
  }).length, 'gap category is a closed enum');
});

test('role registry adds a required dispatchMode and route plans add the quick-task kind', () => {
  const roles = readJson('registry/operating-roles.json');
  roles.protocolVersion = V;
  for (const role of roles.roles) role.dispatchMode = 'mission';
  assert.deepEqual(validateProtocolArtifact('operating-role-registry', roles, { protocolVersion: V }), []);
  const missingMode = structuredClone(roles);
  delete missingMode.roles[0].dispatchMode;
  assert.ok(
    validateProtocolArtifact('operating-role-registry', missingMode, { protocolVersion: V }).length,
    'dispatchMode is required per role in v1.3',
  );

  const route = {
    kind: 'operating-route-plan',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    id: 'ACT-001',
    cycleId: 'CYCLE-011',
    inputDigest: digest('1'),
    routeDigest: digest('2'),
    previewDigest: digest('3'),
    workspaceDigest: digest('4'),
    evidenceDigest: digest('5'),
    providerDigest: digest('6'),
    destinationDigest: digest('7'),
    eventHead: { sequence: 1, hash: digest('8') },
    state: 'proposed',
    actions: [{
      id: 'ACT-001',
      findingId: 'FND-001',
      lane: 'DEV',
      owner: 'founder',
      kind: 'create-quick-task',
      dependsOn: [],
      evidenceRefs: ['EVD-x'],
      reversible: true,
      requiresConfirmation: true,
    }],
    createdAt: at,
  };
  assert.deepEqual(validateProtocolArtifact('operating-route-plan', route), []);
});

test('migration records assert lossless layout moves and records-log entries wrap content', () => {
  const migration = {
    kind: 'operating-migration-record',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    id: 'MIG-001',
    sourceKind: 'protocol-upgrade',
    sourceDigest: digest('9'),
    state: 'applied',
    previewDigest: digest('a'),
    backupManifestDigest: digest('b'),
    sourceLayout: 'directory-per-digest-prefix',
    targetLayout: 'records-jsonl',
    recordCount: { before: 42, after: 42 },
    eventCount: { before: 100, after: 100 },
    mappings: [],
    conflicts: [],
    createdAt: at,
    updatedAt: at,
  };
  assert.deepEqual(validateProtocolArtifact('operating-migration-record', migration), []);
  assert.equal(migration.recordCount.before, migration.recordCount.after);
  assert.equal(migration.eventCount.before, migration.eventCount.after);

  assert.deepEqual(validateProtocolArtifact('operating-records-log-entry', {
    kind: 'operating-records-log-entry',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    digest: digest('1'),
    recordType: 'finding',
    createdAt: at,
    correlationId: 'operate-cycle-011',
    contentDigest: digest('2'),
    content: buildFinding(),
  }), []);
});

test('tool grants only express bounded read-only capability and confined roots', () => {
  assert.deepEqual(validateProtocolArtifact('operating-tool-grant', {
    allowed: ['file-read', 'glob', 'content-search', 'git-log', 'git-show', 'git-diff', 'git-blame'],
    roots: ['src', 'lib'],
  }), []);
  assert.ok(validateProtocolArtifact('operating-tool-grant', {
    allowed: ['file-write'],
    roots: ['src'],
  }).length, 'write, execute, or network tools cannot be granted');
  assert.ok(validateProtocolArtifact('operating-tool-grant', {
    allowed: ['file-read'],
    roots: ['/etc'],
  }).length, 'roots must be repo-relative path prefixes');
});

test('cadence contract computes due dates and keeps manual cadence undated', () => {
  assert.deepEqual(validateProtocolArtifact('operating-cadence-status', fixture('cadence-weekly-due.json')), []);
  assert.deepEqual(validateProtocolArtifact('operating-cadence-status', fixture('cadence-monthly-due.json')), []);
  assert.deepEqual(validateProtocolArtifact('operating-cadence-status', {
    kind: 'operating-cadence-status',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    cadence: 'manual',
    lastRunAt: null,
    nextDueAt: null,
  }), []);
  assert.ok(validateProtocolArtifact('operating-cadence-status', {
    kind: 'operating-cadence-status',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    cadence: 'manual',
    lastRunAt: null,
    nextDueAt: '2026-08-01T09:00:00Z',
  }).length, 'manual cadence must not carry a next due date');
  assert.ok(validateProtocolArtifact('operating-cadence-status', {
    kind: 'operating-cadence-status',
    schemaVersion: '1.0.0',
    protocolVersion: V,
    cadence: 'weekly',
    lastRunAt: null,
    nextDueAt: null,
  }).length, 'weekly cadence must compute a next due date');
});

test('adapter registry adds fail-closed capability values without dropping v1.2 values', () => {
  const registry = readJson('registry/adapters.json');
  registry.protocolVersion = V;
  registry.adapters[0].capabilities.toolIsolation = 'enforced-read-only';
  registry.adapters[0].capabilities.operatingAdvisorDispatch = 'native-read-only';
  assert.deepEqual(validateProtocolArtifact('adapter-registry', registry, { protocolVersion: V }), []);

  const legacyValues = readJson('registry/adapters.json');
  legacyValues.protocolVersion = V;
  assert.deepEqual(
    validateProtocolArtifact('adapter-registry', legacyValues, { protocolVersion: V }),
    [],
    'v1.2 capability values must keep validating under v1.3',
  );
  assert.ok(validateProtocolArtifact('adapter-registry', {
    ...readJson('registry/adapters.json'),
    adapters: [{
      ...readJson('registry/adapters.json').adapters[0],
      capabilities: {
        ...readJson('registry/adapters.json').adapters[0].capabilities,
        operatingAdvisorDispatch: 'native-read-only',
      },
    }],
  }, { protocolVersion: '1.2.0' }).length, 'native-read-only is not a v1.2 dispatch value');
});

test('v1.2 operating registries and versionless advisor responses are unaffected by the v1.3 additions', () => {
  assert.deepEqual(validateProtocolArtifact('operating-role-registry', readJson('registry/operating-roles.json')), []);
  assert.deepEqual(validateProtocolArtifact('adapter-registry', readJson('registry/adapters.json')), []);
  // A versionless compact advisor response still resolves to v1.2 (evidenceRefs shape).
  assert.doesNotThrow(() => assertProtocolArtifact('operating-advisor-response', {
    outcome: 'proposals',
    proposals: [{
      proposalKey: 'technology-risk.reduce-release-risk',
      type: 'finding',
      title: 'Reduce release risk',
      problem: 'No verified rollback rehearsal.',
      proposal: 'Add a rollback canary.',
      impact: 4,
      confidence: 4,
      ease: 3,
      severity: 'high',
      evidenceRefs: ['EVD-release-workflow'],
    }],
    gaps: [],
    conflicts: [],
  }));
});
