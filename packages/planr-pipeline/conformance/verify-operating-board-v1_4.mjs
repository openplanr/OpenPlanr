import assert from 'node:assert/strict';

import {
  assertOperatingDraftApproved,
  assertOperatingRuntimeMatch,
  createOperatingAdapterHandoff,
  createOperatingAdvisorBrief,
  createOperatingMandate,
  createOperatingResearchMandate,
  createOperatingRuntimeBinding,
  listOperatingAdvisorBriefs,
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

// FR9 / T-008: a v1.4-mandate-capable handoff never offers a legacy pack-style
// role brief. The v1.4 record dispatch resolves a role MANDATE and its
// procedure — never a `rolePack`/`roleBrief` pointer, which is the frozen
// v1.2 pack transport. Prove the exclusion structurally on the generated
// handoff and on the mandate the runtime actually dispatches.
const handoffJson = JSON.stringify(handoff);
assert.ok(!/rolepack/i.test(handoffJson), 'a v1.4 handoff must not reference a legacy role pack.');
assert.ok(!/rolebrief/i.test(handoffJson), 'a v1.4 handoff must not reference a legacy role brief.');
assert.equal(handoff.next[0].dispatch.mandatePointer, '/data/mandates/strategy-finance');
assert.equal(handoff.next[0].dispatch.procedurePointer, '/data/mandates/strategy-finance/procedure');

const v14Mandate = createOperatingMandate('strategy-finance', { runtime: 'codex', roots: ['.'] });
const mandateJson = JSON.stringify(v14Mandate);
assert.equal(v14Mandate.procedure, 'procedures/operate/advisor.md');
assert.ok(!/rolebrief|rolepack|jsonschema|maximumproposals/i.test(mandateJson),
  'a v1.4 mandate must carry no pack-style role-brief field.');

// The pack-style brief is compatibility-only: it is explicitly marked
// `legacy: true`, is stamped at the frozen v1.2 envelope, and is refused
// outright when a v1.4 session tries to select one. A new (non-compatibility)
// workflow therefore cannot accidentally pick up a legacy brief.
for (const brief of listOperatingAdvisorBriefs()) {
  assert.equal(brief.legacy, true, `advisor brief ${brief.role.id} must be marked compatibility-only.`);
  assert.equal(brief.protocolVersion, '1.2.0', `advisor brief ${brief.role.id} must stay on the legacy envelope.`);
}
const legacyBrief = createOperatingAdvisorBrief('strategy-finance', { protocolVersion: '1.3.0' });
assert.equal(legacyBrief.legacy, true);
for (const rejectedVersion of [PROTOCOL, '2.0.0']) {
  assert.throws(
    () => createOperatingAdvisorBrief('strategy-finance', { protocolVersion: rejectedVersion }),
    (error) => error?.code === 'E_OPERATE_LEGACY_BRIEF_UNREACHABLE',
    `Protocol ${rejectedVersion} must not be able to select a legacy pack-style brief.`,
  );
}

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
