import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMissionToolGrant,
  createOperatingMissionPacket,
  MISSION_READ_ONLY_TOOLS,
} from '../../lib/operate/mission-packet.mjs';
import { listOperatingRoles, validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { canonicalizeJson, sha256Jcs } from '../../lib/protocol/jcs.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const revision = '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f';

// Body-shaped property names that must never appear on an evidence-index item.
// Mirrors the schema-level scan in tests/schema/operating-schemas-v1_3.test.mjs.
const BODY_NAMES = new Set([
  'body', 'content', 'contents', 'filebody', 'filecontent', 'filecontents',
  'rawcontent', 'rawbody', 'raw', 'bytes', 'blob', 'snippet', 'filetext',
  'sourcetext', 'fulltext', 'filedata', 'filebytes', 'excerpt',
]);

const runtimeContext = {
  cycleId: 'CYCLE-011',
  pinnedRevision: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
  charter: {
    productCharter: 'A portable planning and delivery engine for solo founders.',
    currentGoals: ['Protect payment idempotency before the next release.'],
  },
  priorCycleSummary: {
    cycleId: 'CYCLE-010',
    summary: 'Prior cycle accepted one finding and left one gap open on rollback rehearsal.',
    openDecisions: ['DEC-004'],
    openGaps: ['GAP-3f9a2c'],
    pendingOutcomes: ['OUT-002'],
  },
  planningStatus: {
    planningEngine: 'openplanr',
    planning: 'Two specs decomposed; one awaiting PLAN review.',
    delivery: 'One task shipped; QA gate green.',
  },
  declaredRoots: ['docs', 'lib', 'src'],
  maxEvidenceItems: 200,
};

const repoItem = {
  id: 'EVX-payments-charge',
  path: 'src/payments/charge.mjs',
  contentHash: digest('2'),
  source: 'repository',
  classification: 'code',
  freshness: 'fresh',
  sensitivity: 'internal',
  signals: ['idempotency-key', 'retry-loop'],
};

const gitItem = {
  id: 'EVX-release-history',
  revision,
  contentHash: digest('3'),
  source: 'git',
  classification: 'change-history',
  freshness: 'fresh',
  sensitivity: 'confidential',
  signals: ['rollback-absent'],
};

test('an under-budget packet validates against the v1.3 schema and is digest-bound', () => {
  // Deliberately pass out of (source, path) order to prove deterministic sort.
  const packet = createOperatingMissionPacket('technology-risk', [repoItem, gitItem], runtimeContext);

  assert.deepEqual(
    validateProtocolArtifact('operating-mission-packet', packet, { protocolVersion: '1.3.0' }),
    [],
  );
  assert.equal(packet.kind, 'operating-mission-packet');
  assert.equal(packet.protocolVersion, '1.3.0');
  assert.equal(packet.roleId, 'technology-risk');
  assert.equal(packet.role.output.schema, 'operating-advisor-response@1.3.0');

  // packetDigest binds the unsigned packet exactly.
  const { packetDigest, ...unsigned } = packet;
  assert.equal(packetDigest, sha256Jcs(unsigned));

  // Evidence is sorted by (source, path): 'git' precedes 'repository'.
  assert.deepEqual(packet.evidenceIndex.map(({ source }) => source), ['git', 'repository']);

  // The assembled packet stays within the role's declared input budget.
  const role = listOperatingRoles().find(({ id }) => id === 'technology-risk');
  assert.equal(packet.budgets.maxInputBytes, role.budgets.maxInputBytes);
  assert.ok(Buffer.byteLength(canonicalizeJson(unsigned), 'utf8') <= role.budgets.maxInputBytes);
});

test('the tool grant is bounded read-only — no write, execute, network, or environment capability', () => {
  const packet = createOperatingMissionPacket('technology-risk', [repoItem, gitItem], runtimeContext);
  assert.deepEqual(packet.toolGrant.allowed, [...MISSION_READ_ONLY_TOOLS]);
  assert.deepEqual(packet.toolGrant.roots, ['docs', 'lib', 'src']);
  assert.deepEqual(packet.declaredRoots, ['docs', 'lib', 'src']);
  for (const tool of packet.toolGrant.allowed) {
    assert.doesNotMatch(tool, /write|edit|exec|run|shell|spawn|network|http|fetch|env|delete|remove/i);
  }
  assert.deepEqual(createMissionToolGrant(['b', 'a', 'a']), {
    allowed: [...MISSION_READ_ONLY_TOOLS],
    roots: ['a', 'b'],
  });
});

test('no evidence-index item in an assembled packet carries a body-shaped field', () => {
  // A real-sized index array: many pointer-only items, still under budget.
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: `EVX-repo-${String(index).padStart(4, '0')}`,
    path: `src/module-${index}/handler.mjs`,
    contentHash: digest('a'),
    source: index % 2 === 0 ? 'repository' : 'planr',
    classification: 'code',
    freshness: 'fresh',
    sensitivity: 'internal',
    signals: [`signal-${index}`],
  }));

  const packet = createOperatingMissionPacket('technology-risk', items, runtimeContext);
  assert.equal(packet.evidenceIndex.length, 60);
  for (const item of packet.evidenceIndex) {
    for (const key of Object.keys(item)) {
      assert.ok(
        !BODY_NAMES.has(key.toLowerCase()),
        `evidence-index item must not carry a body-shaped field, found "${key}"`,
      );
    }
    // Structurally a pointer: it references content but never inlines it.
    assert.ok('path' in item || 'revision' in item);
    assert.ok('contentHash' in item);
  }
});

test('the permitted-evidence-kinds filter drops sources the role may not read', () => {
  // The chair reconciles verified advisor results and permits none of the six
  // repository evidence sources, so every candidate item is filtered out.
  const chair = createOperatingMissionPacket('chair', [repoItem, gitItem], runtimeContext);
  assert.deepEqual(chair.evidenceIndex, []);
  assert.deepEqual(
    validateProtocolArtifact('operating-mission-packet', chair, { protocolVersion: '1.3.0' }),
    [],
  );
});

test('maxInputBytes fails closed with a named, role-scoped error and never truncates', () => {
  const role = listOperatingRoles().find(({ id }) => id === 'strategy-finance');
  const oversized = Array.from({ length: 500 }, (_, index) => ({
    id: `EVX-repo-${String(index).padStart(4, '0')}`,
    path: `src/module-${index}/${'segment/'.repeat(6)}file-${index}.mjs`,
    contentHash: digest('a'),
    source: 'repository',
    classification: 'code',
    freshness: 'fresh',
    sensitivity: 'internal',
    signals: Array.from({ length: 4 }, (_, k) => `signal-${index}-${k}-${'x'.repeat(200)}`),
  }));

  assert.throws(
    () => createOperatingMissionPacket('strategy-finance', oversized, runtimeContext),
    (error) => {
      assert.equal(error.code, 'E_OPERATE_MISSION_PACKET_BUDGET');
      assert.match(error.message, /role strategy-finance/);
      assert.match(error.message, new RegExp(`exceeding maxInputBytes ${role.budgets.maxInputBytes}`));
      return true;
    },
  );
});

test('mission packets are only defined for Protocol v1.3', () => {
  assert.throws(
    () => createOperatingMissionPacket('technology-risk', [repoItem], {
      ...runtimeContext,
      protocolVersion: '1.2.0',
    }),
    (error) => {
      assert.equal(error.code, 'E_OPERATE_MISSION_PACKET_VERSION');
      return true;
    },
  );
});
