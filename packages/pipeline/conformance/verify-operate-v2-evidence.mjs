#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_EVIDENCE_KINDS_V2,
  OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  createOperateEvidenceRegistryV2,
  dispatchOperateEvidenceResolverV2,
  prepareOperateEvidenceDispatchV2,
} from 'planr-pipeline/operate/evidence-v2';
import { buildOperatingEvidenceMaterializationV2 } from 'planr-pipeline/operate/evidence-materialization-v2';
import { buildOperatingEvidenceGraphV2 } from 'planr-pipeline/operate/evidence-projections-v2';
import { createEmptyOperatingRuntimeStateV2 } from 'planr-pipeline/operate/runtime-v2';

const VERSION = '2.0.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'operating-runtime-v2');
const evidenceContractKinds = Object.freeze([
  'operating-evidence-candidate',
  'operating-evidence-ref',
  'operating-evidence-resolution',
  'operate-evidence-provider-registration',
  'operate-evidence-resolver-registration',
  'operating-evidence-edge',
  'operating-evidence-graph',
]);
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

const evidenceContracts = fixture('evidence-contracts-valid.json');
const invalidEvidenceContracts = fixture('evidence-contracts-invalid.json');

pass(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size === OPERATE_RUNTIME_CONTRACT_KINDS.length,
  'the canonical catalog exposes unique registry-derived v2 contracts');
pass(
  evidenceContractKinds.every((kind) => OPERATE_RUNTIME_CONTRACT_KINDS.includes(kind)),
  'every evidence contract is compiler-owned and public',
);
pass(
  JSON.stringify(OPERATE_EVIDENCE_KINDS_V2) === JSON.stringify(['filesystem', 'git', 'operate-artifact', 'planr']),
  'the evidence kind vocabulary is finite and local',
);
pass(
  ['SOURCE_UNTRACKED', 'REVISION_NOT_FOUND', 'ANCESTRY_MISMATCH', 'UNSUPPORTED_EVIDENCE_KIND']
    .every((code) => OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2.includes(code)),
  'the resolver error vocabulary retains precise Planr and Git failures',
);

for (const kind of evidenceContractKinds) {
  pass(
    validateProtocolArtifact(kind, evidenceContracts[kind], { protocolVersion: VERSION }).length === 0,
    `${kind}: valid evidence fixture validates`,
  );
  const invalid = clone(evidenceContracts[kind]);
  Object.assign(invalid, invalidEvidenceContracts[kind].patch);
  pass(
    validateProtocolArtifact(kind, invalid, { protocolVersion: VERSION }).length > 0,
    `${kind}: v1, dynamic, untyped, or unsupported shape fails closed`,
  );
}

const registryFixture = fixture('evidence-registry-valid.json');
const registry = createOperateEvidenceRegistryV2(registryFixture);
pass(Object.isFrozen(registry), 'the evidence registry is immutable data');
pass(registry.providers.length === 4 && registry.resolvers.length === 4, 'the registry contains only four local pairs');
pass(
  registry.providers.every(({ effectClass }) => effectClass === 'local-read-only')
    && registry.resolvers.every(({ effectClass }) => effectClass === 'local-read-only'),
  'provider and resolver declarations cannot declare an external effect',
);

const prepared = prepareOperateEvidenceDispatchV2(registry, registryFixture.candidate, {
  scope: registryFixture.scope,
  capabilities: registryFixture.capabilities,
});
pass(prepared.status === 'authorized', 'registered Git evidence needs an exact capability and scope');
const missingCapability = prepareOperateEvidenceDispatchV2(registry, registryFixture.candidate, {
  scope: registryFixture.scope,
  capabilities: [],
});
pass(missingCapability.status === 'rejected' && missingCapability.error.code === 'CAPABILITY_DENIED',
  'registration never grants an evidence capability');

for (const [name, capability] of [
  ['evidence-filesystem-valid.json', 'evidence.filesystem.read'],
  ['evidence-git-valid.json', 'evidence.git.read'],
  ['evidence-planr-valid.json', 'evidence.planr.read'],
  ['evidence-artifact-valid.json', 'evidence.operate-artifact.read'],
]) {
  const sourceFixture = fixture(name);
  pass(
    validateProtocolArtifact('operating-evidence-candidate', sourceFixture.candidate, {
      protocolVersion: VERSION,
    }).length === 0,
    `${name}: resolver input remains a typed v2 candidate`,
  );
  const dispatched = dispatchOperateEvidenceResolverV2(
    OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
    sourceFixture.candidate,
    { scope: sourceFixture.scope, capabilities: [capability] },
  );
  pass(
    dispatched.status === 'unavailable' && dispatched.error.code === 'EVIDENCE_RESOLVER_UNAVAILABLE',
    `${name}: a declared facade never substitutes an unconfigured or connected source`,
  );
}

const resolutionFixture = fixture('evidence-resolution-valid.json');
const graphFixture = fixture('evidence-graph-valid.json');
const invalidGraphFixture = fixture('evidence-graph-invalid.json');
pass(
  validateProtocolArtifact('operating-evidence-candidate', resolutionFixture.candidate, {
    protocolVersion: VERSION,
  }).length === 0,
  'runtime materialization receives only a validated candidate',
);
pass(
  resolutionFixture.claimLinks.every(({ sourceArtifactId, relation }) => (
    sourceArtifactId === resolutionFixture.candidate.sourceArtifactId
      && (relation === 'supportedBy' || relation === 'contradictedBy')
  )),
  'Phase 4 proof links remain Artifact-local support or contradiction only',
);
pass(
  validateProtocolArtifact('operating-evidence-graph', graphFixture, { protocolVersion: VERSION }).length === 0
    && validateProtocolArtifact('operating-evidence-graph', invalidGraphFixture, { protocolVersion: VERSION }).length > 0,
  'the graph accepts only typed legal evidence edges',
);
pass(typeof buildOperatingEvidenceMaterializationV2 === 'function',
  'the materialization builder is a declared runtime export');

const emptyState = createEmptyOperatingRuntimeStateV2('2026-08-09T10:00:00.000Z');
const graph = buildOperatingEvidenceGraphV2(emptyState, {
  scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
}, { generatedAt: '2026-08-09T10:00:00.000Z' });
pass(
  Object.isFrozen(graph)
    && graph.evidenceRefs.length === 0
    && graph.edges.length === 0
    && validateProtocolArtifact('operating-evidence-graph', graph, { protocolVersion: VERSION }).length === 0,
  'the evidence graph is a frozen, rebuildable read-only projection',
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocolVersion: VERSION,
  contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
  evidenceContracts: evidenceContractKinds.length,
  checks,
})}\n`);
