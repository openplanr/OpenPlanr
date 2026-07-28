import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertProtocolArtifact,
  canonicalizeJson,
  computeOperatingProviderPolicyDigest,
  createOperatingAdvisorBrief,
  listOperatingProviders,
  listOperatingRoles,
  sha256Jcs,
} from '../lib/pipeline/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const adapters = readJson('registry/adapters.json');
const roleRegistry = readJson('registry/operating-roles.json');
const providerRegistry = readJson('registry/operating-providers.json');
const roleResultSchema = readJson('schemas/v1.2.0/operating-role-result.schema.json');
assertProtocolArtifact('adapter-registry', adapters);
assertProtocolArtifact('operating-role-registry', roleRegistry);
assertProtocolArtifact('operating-provider-registry', providerRegistry);

const deliveryRoles = readJson('registry/roles.json');
if (deliveryRoles.roles.length !== 9) throw new Error('Canonical delivery role registry no longer contains exactly nine roles.');
const operatingIds = new Set(listOperatingRoles().map((role) => role.id));
const proposalTypes = new Set(
  roleResultSchema.properties.proposals.items.properties.type.enum,
);
for (const role of listOperatingRoles()) {
  if (!role.minimumEvidence?.requirements?.length) {
    throw new Error(`Operating role ${role.id} has no machine-evaluable minimum evidence requirement.`);
  }
  if (role.id === 'chair' && role.minimumEvidence.requirements.some((entry) => entry.source !== 'advisor-results')) {
    throw new Error('Chair readiness must be based only on verified advisor results.');
  }
  for (const proposalType of role.allowedProposalTypes) {
    if (!proposalTypes.has(proposalType)) {
      throw new Error(`Operating role ${role.id} advertises invalid proposal type ${proposalType}.`);
    }
  }
  const brief = createOperatingAdvisorBrief(role.id);
  if (brief.role.mandate !== role.mandate || brief.output.maximumProposals !== role.budgets.maxProposals) {
    throw new Error(`Operating advisor brief ${role.id} drifted from the canonical role registry.`);
  }
}
for (const role of deliveryRoles.roles) {
  if (operatingIds.has(role.id)) throw new Error(`Operating role ${role.id} contaminated registry/roles.json.`);
}
if (listOperatingProviders().some((provider) => provider.readOnly !== true)) {
  throw new Error('Every launch operating provider must be read-only.');
}
for (const adapter of adapters.adapters) {
  if (!adapter.capabilities.operatingBoard || !adapter.entrypoints.operate) {
    throw new Error(`Adapter ${adapter.id} lacks Protocol v1.2 operating capability metadata.`);
  }
}

const vectors = readJson('conformance/fixtures/operating-board/jcs-vectors.json');
for (const vector of vectors.vectors) {
  if (canonicalizeJson(vector.value) !== vector.canonical) throw new Error(`JCS canonical mismatch: ${vector.name}`);
  if (sha256Jcs(vector.value) !== vector.sha256) throw new Error(`JCS digest mismatch: ${vector.name}`);
}

const dashboardState = readJson('conformance/fixtures/operating-dashboard/.planr/operate/projections/state.json');
assertProtocolArtifact('operating-state', dashboardState);
const preview = readFileSync(join(root, 'templates/operating-dashboard-preview.html'), 'utf8');
for (const marker of [
  'data-planr-operating-preview="1.0.0"',
  'data-preview-state="quiet"',
  'data-preview-state="partial"',
  'data-preview-state="blocked"',
  dashboardState.eventHead.hash,
]) {
  if (!preview.includes(marker)) {
    throw new Error(`Operating dashboard preview is missing canonical marker ${marker}.`);
  }
}
for (const [productionAsset, marker] of [
  ['lib/dashboard/app/main.js', "import('./views/operate.js')"],
  ['lib/dashboard/app/shell.js', "label: 'Operating'"],
]) {
  if (!readFileSync(join(root, productionAsset), 'utf8').includes(marker)) {
    throw new Error(`${productionAsset} did not integrate the approved Operating Board preview.`);
  }
}
const readiness = readJson('conformance/fixtures/operating-board/evidence-readiness.json');
assertProtocolArtifact('operating-evidence-readiness', readiness);
const validEvent = readJson('conformance/fixtures/operating-board/event-valid.json');
const invalidEvent = readJson('conformance/fixtures/operating-board/event-invalid.json');
assertProtocolArtifact('operating-event', validEvent);
let invalidEventRejected = false;
try {
  assertProtocolArtifact('operating-event', invalidEvent);
} catch {
  invalidEventRejected = true;
}
if (!invalidEventRejected) {
  throw new Error('The invalid operating-event fixture bypassed strict payload validation.');
}
const evidence = readJson('conformance/fixtures/operating-board/evidence-bundle.json');
assertProtocolArtifact('operating-evidence', evidence);
for (const item of evidence.items.filter(({ source }) => source === 'repository')) {
  if (!item.repository?.componentId || !item.repository?.canonicalRemote) {
    throw new Error(`Repository evidence ${item.id} is missing structured repository provenance.`);
  }
}
const providerManifest = readJson('conformance/fixtures/operating-board/provider-manifest.json');
assertProtocolArtifact('operating-provider-manifest', providerManifest);
if (
  providerManifest.endpoint.redacted !== true
  || providerManifest.endpoint.display.includes('@')
  || providerManifest.endpoint.display.includes('?')
  || providerManifest.endpoint.display.includes('#')
) {
  throw new Error('Provider manifests must expose only a safe, redacted endpoint display.');
}
if (JSON.stringify(providerManifest).match(/password|secret/i)) {
  throw new Error('Provider manifest fixture contains credential-like fields.');
}
if (computeOperatingProviderPolicyDigest(providerManifest) !== providerManifest.policyDigest) {
  throw new Error('Provider manifest policy digest does not bind the declared consented policy.');
}

process.stdout.write(`Operating Board conformance passed (${roleRegistry.roles.length} roles, ${providerRegistry.providers.length} providers, ${vectors.vectors.length} JCS vectors, readiness and provider-policy fixtures valid).\n`);
