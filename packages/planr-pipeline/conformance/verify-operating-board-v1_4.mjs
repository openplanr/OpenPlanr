import assert from 'node:assert/strict';

import {
  assertOperatingDraftApproved,
  assertOperatingRuntimeMatch,
  createOperatingAdapterHandoff,
  createOperatingMandate,
  createOperatingResearchMandate,
  createOperatingRuntimeBinding,
  listProtocolSchemas,
  qualifyOperatingDraftCandidates,
  resolveProtocolSchema,
  validateAgentNativeAdvisorResponse,
} from '../lib/pipeline/index.mjs';

const PROTOCOL = '1.4.0';
const digest = (character) => `sha256:${character.repeat(64)}`;
const revision = 'a'.repeat(40);
const citation = {
  kind: 'repository', path: 'src/index.ts', startLine: 1, endLine: 4, revision,
};

const registered = listProtocolSchemas().filter(({ protocolVersion }) => protocolVersion === PROTOCOL);
assert.ok(registered.length >= 10, 'Protocol v1.4 must publish its additive schema set.');
for (const { kind } of registered) resolveProtocolSchema(kind, { protocolVersion: PROTOCOL });

for (const runtime of ['claude-code', 'codex', 'cursor']) {
  const binding = createOperatingRuntimeBinding(runtime);
  assert.equal(binding.runtime, runtime);
  assert.equal(binding.runtimeBinding, 'required');
  assert.equal(binding.crossRuntimeFallback, false);
  assert.equal(binding.assurance, 'runtime-governed');
}
assert.equal(createOperatingRuntimeBinding('codex').toolIsolation, 'advisory');
assert.throws(
  () => assertOperatingRuntimeMatch(createOperatingRuntimeBinding('codex'), 'claude-code'),
  (error) => error?.code === 'E_OPERATE_RUNTIME_MISMATCH',
);

const research = createOperatingResearchMandate({
  cycleId: 'CYCLE-001', runtime: 'codex', roots: ['.', '.planr'],
});
assert.equal(research.researchMode, 'local');
assert.ok(!('evidence' in research));
assert.ok(!('evidenceIndex' in research));

const mandate = createOperatingMandate('technology-risk', { runtime: 'codex', roots: ['.'] });
assert.equal(mandate.procedure, 'procedures/operate/advisor.md');
assert.equal(mandate.runtimeBinding.runtime, 'codex');
assert.ok(!('evidence' in mandate));
assert.ok(!('evidenceIndex' in mandate));

const response = validateAgentNativeAdvisorResponse({
  outcome: 'actions',
  analysisMarkdown: '## CTO analysis\n\nThe retry boundary needs explicit policy.',
  claims: [{
    id: 'claim-1', statement: 'The service has one retry boundary.',
    epistemicStatus: 'observed', confidence: 4, citations: [citation],
  }],
  actions: [{
    actionKey: 'retry-boundary', title: 'Make retry behavior explicit',
    summary: 'Add bounded retries and failure telemetry.', lane: 'DEV',
    routeKind: 'quick-task', horizon: 'immediate', confidence: 4,
    impact: 4, ease: 3, citations: [citation],
  }],
  gaps: [],
  conflicts: [],
});
assert.match(response.analysisMarkdown, /CTO analysis/);

const handoff = createOperatingAdapterHandoff({
  protocolVersion: PROTOCOL,
  phase: 'advisors',
  state: 'record-required',
  cycleId: 'CYCLE-002',
  evidenceDigest: digest('a'),
  runtime: 'codex',
  idempotencyKey: 'idem-12345678901234567890123456789012',
  lease: 'lease-12345678901234567890123456789012',
  expiresAt: '2026-08-02T12:00:00.000Z',
  roles: [{ roleId: 'strategy-finance', status: 'pending', inputDigest: digest('b') }],
});
assert.equal(handoff.next[0].action, 'harness.record');
assert.equal(handoff.next[0].dispatch.runtime, 'codex');
assert.ok(!JSON.stringify(handoff).toLowerCase().includes('claude'));

const qualified = qualifyOperatingDraftCandidates(response.actions);
assert.equal(qualified.eligible.length, 1);
assert.throws(
  () => assertOperatingDraftApproved({
    kind: 'operating-materialized-draft', schemaVersion: '1.0.0', protocolVersion: PROTOCOL,
    draftId: 'DRAFT-001', cycleId: 'CYCLE-002', actionKey: 'retry-boundary',
    artifactKind: 'quick-task', path: '.planr/quick/QT-001-retry-boundary.md',
    status: 'proposed', artifactDigest: digest('c'),
    causality: { findingIds: ['FND-001'], citationDigests: [digest('d')] },
    reversible: true,
  }),
  (error) => error?.code === 'E_OPERATE_DRAFT_UNAPPROVED',
);

console.log('Protocol v1.4 agent-native Operating Board conformance passed.');
