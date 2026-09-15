#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_RUNTIME_CONTRACT_KINDS,
  assertProtocolArtifact,
  listProtocolSchemas,
  loadOperateRuntimeContract,
  loadProtocolContract,
} from 'planr-pipeline/protocol';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const removedPaths = [
  'conformance/operating-provider-kit.mjs',
  'conformance/verify-operating-board.mjs',
  'commands/operate.md',
  'docs/protocol/operating-board.md',
  'docs/implementation/operating-board.md',
  'docs/guided-operating-board.md',
  'lib/operate/adapter-handoff.mjs',
  'lib/operate/compatibility-v1_4.d.mts',
  'lib/operate/compatibility-v1_4.mjs',
  'lib/operate/reducer.mjs',
  'lib/operate/records-migration.mjs',
  'registry/operating-providers.json',
  'registry/operating-roles.json',
  'schemas/v2.0.0/business-scope-binding.schema.json',
  'schemas/v2.0.0/operate-v14-compatibility-transaction.schema.json',
  'scripts/generate-operating-assets.mjs',
  'scripts/guided-operate-canary.mjs',
  'scripts/operate-release-canary.mjs',
  'conformance/fixtures/operating-runtime-v2/legacy-operating-record-v1.2-valid.json',
  'conformance/fixtures/operating-runtime-v2/legacy-operating-record-v1.3-valid.json',
  'conformance/fixtures/operating-runtime-v2/legacy-operating-record-v1.4-valid.json',
  'lib/operate/graphify-out',
  'skills/operate',
  'skills/operate-ceo',
  'skills/operate-cto',
  'skills/operate-cpo',
  'skills/operate-cmo',
  'skills/operate-coo',
  'skills/operate-challenger',
  'skills/operate-chair',
  'adapters/codex/skills/planr-operate-ceo',
  'adapters/codex/skills/planr-operate-chair',
  'adapters/cursor/rules/openplanr-operate-ceo.mdc',
  'adapters/cursor/rules/openplanr-operate-chair.mdc',
];
const OPERATE_VALIDATE_NOTE_LINE = /^planr operate validate-note "(<absolute-(?:advisor-output|challenger-output|chair-output|board-report-path)>)" --profile (advisor|challenger|chair|board-report) --contract-version 2\.0\.0 --json$/u;
const VALIDATION_PROFILE_PLACEHOLDERS = new Map([
  ['advisor', '<absolute-advisor-output>'],
  ['challenger', '<absolute-challenger-output>'],
  ['chair', '<absolute-chair-output>'],
  ['board-report', '<absolute-board-report-path>'],
]);
const RETIRED_OPERATE_WIRE_SEMANTICS = /(?:data\.continuation|allowedActions|packetId|assignmentId|resultPath|templatePath|evidence-digest|content-base64|idempotenc(?:y|e)|\b(?:start|resume)\s*\/\s*(?:resume|start)\b|\bgoverned choice\b|\bPlanning (?:lifecycle|machine|wire|state|command|phase)\b)/iu;
function assertClosedOperateCliBoundary(source, label) {
  const commandLines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:planr|planr-pipeline|openplanr|opr)\s+/u.test(line));
  const profiles = [];
  for (const line of commandLines) {
    const match = line.match(OPERATE_VALIDATE_NOTE_LINE);
    assert.ok(match, `${label}: unsupported CLI invocation: ${line}`);
    const [, placeholder, profile] = match;
    assert.equal(
      placeholder,
      VALIDATION_PROFILE_PLACEHOLDERS.get(profile),
      `${label}: ${profile} validation path`,
    );
    profiles.push(profile);
  }
  assert.equal(
    [...source.matchAll(/\bplanr operate\b/gu)].length,
    profiles.length,
    `${label}: every planr operate mention must be one complete validate-note command`,
  );
  assert.equal(
    [...source.matchAll(/--json\b/gu)].length,
    profiles.length,
    `${label}: --json may appear only on an allowed validate-note command`,
  );
  assert.doesNotMatch(
    source,
    /\bplanr\s+(?!operate validate-note\b)[a-z][a-z0-9-]*|\b(?:openplanr|opr)\s+[a-z][a-z0-9-]*|\bnpx\s+(?:planr|openplanr)\b/iu,
    `${label}: other CLI invocations are forbidden`,
  );
  assert.doesNotMatch(
    source,
    /\bplanr-pipeline\s+|\/planr-pipeline:planr-operate\b|commands\/operate\.md|skills\/operate(?:-|\/)/u,
    `${label}: retired pipeline and plugin Operate commands are forbidden`,
  );
  assert.doesNotMatch(source, RETIRED_OPERATE_WIRE_SEMANTICS,
    `${label}: retired start/resume, choice, Planning, and wire semantics are forbidden`);
  assert.deepEqual(
    profiles,
    ['advisor', 'challenger', 'chair', 'board-report'],
    `${label}: exact validation profiles`,
  );
}

for (const relativePath of removedPaths) {
  assert.equal(existsSync(join(root, relativePath)), false, `removed path remains: ${relativePath}`);
}

for (const hostile of [
  'planr operate status --json',
  'planr operate validate-note "<absolute-advisor-output>" --profile owner --json',
  'planr operate validate-note "<absolute-advisor-output>" --profile advisor --json --force',
  'planr pipeline operate status --json',
  '/planr-pipeline:planr-operate',
  'planr doctor --json',
  'Use the governed choice from the start/resume Planning phase.',
]) {
  assert.throws(
    () => assertClosedOperateCliBoundary(hostile, 'hostile fixture'),
    assert.AssertionError,
    hostile,
  );
}

for (const version of ['v1.2.0', 'v1.3.0', 'v1.4.0']) {
  const directory = join(root, 'schemas', version);
  const residual = readdirSync(directory)
    .filter((name) => /^operating-.+\.schema\.json$/.test(name));
  assert.deepEqual(residual, [], `${version} still publishes an Operate v1 schema`);
}

const runtimeDirectory = join(root, 'lib', 'operate');
assert.deepEqual(
  readdirSync(runtimeDirectory).sort(),
  [
    'action-verification-v2.d.mts',
    'action-verification-v2.mjs',
    'approvals-v2.d.mts',
    'approvals-v2.mjs',
    'assignment-contract-v2.mjs',
    'authorization-v2.d.mts',
    'authorization-v2.mjs',
    'contracts',
    'cycle-closure-v2.d.mts',
    'cycle-closure-v2.mjs',
    'evidence-artifact-v2.mjs',
    'evidence-filesystem-v2.mjs',
    'evidence-git-v2.mjs',
    'evidence-materialization-v2.d.mts',
    'evidence-materialization-v2.mjs',
    'evidence-planr-v2.mjs',
    'evidence-projections-v2.d.mts',
    'evidence-projections-v2.mjs',
    'evidence-registry-v2.d.mts',
    'evidence-registry-v2.mjs',
    'evidence-v2.d.mts',
    'evidence-v2.mjs',
    'execution-verification-v2.d.mts',
    'execution-verification-v2.mjs',
    'executive-board-compatibility-v2.d.mts',
    'executive-board-compatibility-v2.mjs',
    'executive-board-materialization-v2.d.mts',
    'executive-board-materialization-v2.mjs',
    'executive-board-projection-v2.mjs',
    'experience-projection-v2.d.mts',
    'experience-projection-v2.mjs',
    'extensions-v2.d.mts',
    'extensions-v2.mjs',
    'governed-execution-v2.d.mts',
    'governed-execution-v2.mjs',
    'governed-extensions-v2.d.mts',
    'governed-extensions-v2.mjs',
    'governed-recovery-v2.d.mts',
    'governed-recovery-v2.mjs',
    'intelligence-input-bundle-v2.mjs',
    'intelligence-ledger-v2.mjs',
    'intelligence-output-identities-v2.mjs',
    'intelligence-replay-v2.mjs',
    'intelligence-result-validator-v2.mjs',
    'intelligence-router-v2.d.mts',
    'intelligence-router-v2.mjs',
    'operating-delta-v2.d.mts',
    'operating-delta-v2.mjs',
    'operating-domains-v2.d.mts',
    'operating-domains-v2.mjs',
    'operating-intelligence-state-v2.d.mts',
    'operating-intelligence-state-v2.mjs',
    'operating-signal-providers-v2.d.mts',
    'operating-signal-providers-v2.mjs',
    'operating-snapshots-v2.d.mts',
    'operating-snapshots-v2.mjs',
    'operating-state-v2.d.mts',
    'operating-state-v2.mjs',
    'operating-triggers-v2.d.mts',
    'operating-triggers-v2.mjs',
    'persistent-work-projections-v2.d.mts',
    'persistent-work-projections-v2.mjs',
    'persistent-work-v2.d.mts',
    'persistent-work-v2.mjs',
    'planning-bridge-v2.d.mts',
    'planning-bridge-v2.mjs',
    'policy-v2.d.mts',
    'policy-v2.mjs',
    'reference-governed-executors-v2.d.mts',
    'reference-governed-executors-v2.mjs',
    'result-packet-v2.d.mts',
    'result-packet-v2.mjs',
    'review-bound-submission-v2.d.mts',
    'review-bound-submission-v2.mjs',
    'runtime-event-reducer-v2.mjs',
    'runtime-foundation',
    'runtime-foundation.d.mts',
    'runtime-foundation.mjs',
    'scheduler-v2.d.mts',
    'scheduler-v2.mjs',
    'trace-matrix-v2.d.mts',
    'trace-matrix-v2.mjs',
  ],
  'only the Runtime 2.0 implementation, scheduler, narrow extension registry, and compiler-owned assets may remain reachable',
);
assert.deepEqual(
  readdirSync(join(runtimeDirectory, 'runtime-foundation')).sort(),
  ['authority.mjs', 'evidence-state.mjs', 'execution.mjs', 'intelligence.mjs', 'protocol.mjs'],
  'the Runtime foundation may expose only its five explicit internal dependency facades',
);

assert.equal(
  new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size,
  OPERATE_RUNTIME_CONTRACT_KINDS.length,
  'the registry-derived Protocol 2.0 catalog must contain unique identities',
);
const registered = listProtocolSchemas();
assert.deepEqual(
  registered.filter(({ kind, protocolVersion }) => kind.startsWith('operating-') && protocolVersion !== '2.0.0'),
  [],
  'the protocol registry must not retain v1 Operate schemas',
);
assert.deepEqual(
  registered.filter(({ protocolVersion }) => protocolVersion === '2.0.0').map(({ kind }) => kind).sort(),
  [...OPERATE_RUNTIME_CONTRACT_KINDS].sort(),
);

assert.throws(
  () => loadProtocolContract('operating-state', { protocolVersion: '1.4.0' }),
  { code: 'E_SCHEMA_UNKNOWN' },
);
for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
  assert.equal(loadOperateRuntimeContract(kind, { protocolVersion: '2.0.0' }).kind, kind);
}

const fixtures = JSON.parse(readFileSync(
  join(root, 'conformance/fixtures/operating-runtime-v2/all-contracts-valid.json'),
  'utf8',
));
const mixedCheckpoint = structuredClone(fixtures['operating-checkpoint']);
mixedCheckpoint.eventHead.protocolVersions = ['1.4.0', '2.0.0'];
assert.throws(
  () => assertProtocolArtifact('operating-checkpoint', mixedCheckpoint, { protocolVersion: '2.0.0' }),
  { code: 'E_PROTOCOL_ARTIFACT_INVALID' },
  'a v2 checkpoint must reject a mixed legacy event history',
);

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.exports['./operate/compatibility-v1_4'], undefined);
assert.equal(manifest.scripts['generate:operating-assets'], undefined);
assert.equal(manifest.scripts['canary:operate-release'], undefined);

process.stdout.write(`${JSON.stringify({
  ok: true,
  contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
  removedPaths: removedPaths.length,
})}\n`);
