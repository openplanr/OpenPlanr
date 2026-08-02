import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertProtocolArtifact,
  listOperatingRoles,
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../lib/protocol/contracts.mjs';
import { createOperatingMissionPacket } from '../lib/operate/mission-packet.mjs';
import { createOperatingMandate } from '../lib/operate/mandate.mjs';
import { createOperatingAdapterHandoff } from '../lib/operate/adapter-handoff.mjs';
import { createOperatingEvent } from '../lib/operate/reducer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const fixture = (name) => readJson(`conformance/fixtures/operating-board/${name}`);

const PROTOCOL = '1.3.0';
const at = '2026-07-28T09:00:00Z';
const digest = (character) => `sha256:${character.repeat(64)}`;
const revision = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

// ── Every additive v1.3.0 schema must resolve through the protocol resolver ──
const EXPECTED_V13_KINDS = [
  'adapter-registry',
  'operating-mission-packet',
  'operating-mandate',
  'operating-evidence-index-item',
  'operating-tool-grant',
  'operating-adapter-handoff',
  'operating-citation',
  'operating-citation-resolution',
  'operating-advisor-response',
  'operating-finding',
  'operating-data-gap',
  'operating-role-registry',
  'operating-route-plan',
  'operating-records-log-entry',
  'operating-migration-record',
  'operating-cadence-status',
  'operating-event',
  'operating-record',
];

const registeredV13 = new Set(
  listProtocolSchemas()
    .filter((entry) => entry.protocolVersion === PROTOCOL)
    .map((entry) => entry.kind),
);
for (const kind of EXPECTED_V13_KINDS) {
  if (!registeredV13.has(kind)) {
    throw new Error(`Protocol v1.3.0 kind ${kind} is not registered in lib/protocol/contracts.mjs.`);
  }
  // Resolving throws for an unregistered or unloadable schema.
  resolveProtocolSchema(kind, { protocolVersion: PROTOCOL });
}
if (registeredV13.size !== EXPECTED_V13_KINDS.length) {
  throw new Error(
    `Expected exactly ${EXPECTED_V13_KINDS.length} v1.3.0 schemas, found ${registeredV13.size}.`,
  );
}

// ── Positive fixtures must validate ──────────────────────────────────────────
assertProtocolArtifact('operating-mission-packet', fixture('mission-packet-valid.json'));
assertProtocolArtifact('operating-mission-packet', fixture('mission-packet-oversized-invalid.json'));
assertProtocolArtifact('operating-citation', fixture('citation-valid.json'));
assertProtocolArtifact('operating-cadence-status', fixture('cadence-weekly-due.json'));
assertProtocolArtifact('operating-cadence-status', fixture('cadence-monthly-due.json'));

// A truncated mission-packet fixture records the drop loudly in its budgets (FR4).
const truncatedFixture = fixture('mission-packet-truncated-valid.json');
assertProtocolArtifact('operating-mission-packet', truncatedFixture);
if (truncatedFixture.budgets.truncatedEvidenceItems !== true
  || typeof truncatedFixture.budgets.evidenceItemsBeforeTruncation !== 'number'
  || truncatedFixture.budgets.evidenceItemsBeforeTruncation <= truncatedFixture.budgets.maxEvidenceItems) {
  throw new Error('The truncated mission-packet fixture must record a loud truncation in budgets.');
}

// A create-epic route validates additively against the v1.3 route-plan schema (FR8).
const epicRoute = fixture('route-epic-valid.json');
assertProtocolArtifact('operating-route-plan', epicRoute, { protocolVersion: PROTOCOL });
if (epicRoute.actions[0].kind !== 'create-epic'
  || !epicRoute.actions[0].targetPath.startsWith('.planr/epics/')) {
  throw new Error('The create-epic fixture must route to a .planr/epics/ target.');
}

// ── Negative citation fixtures must be rejected ──────────────────────────────
for (const name of [
  'citation-fabricated-path-invalid.json',
  'citation-wrong-line-range-invalid.json',
  'citation-stale-revision-invalid.json',
]) {
  let rejected = false;
  try {
    assertProtocolArtifact('operating-citation', fixture(name));
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error(`Negative citation fixture ${name} was accepted; it must fail closed.`);
  }
}

// ── Mission-packet size is enforced and fails closed with a named error ──────
// Driven through the real producer: the fixture-level probe previously here
// asserted an error name the implementation never throws. The producer measures
// JCS-canonicalized unsigned bytes and throws E_OPERATE_MISSION_PACKET_BUDGET.
{
  const role = listOperatingRoles().find(({ id }) => id === 'strategy-finance');
  const oversizedEvidence = Array.from({ length: 500 }, (_, index) => ({
    id: `EVX-repo-${String(index).padStart(4, '0')}`,
    path: `src/module-${index}/${'segment/'.repeat(6)}file-${index}.mjs`,
    contentHash: `sha256:${'a'.repeat(64)}`,
    source: 'repository',
    classification: 'code',
    freshness: 'fresh',
    sensitivity: 'internal',
    signals: Array.from({ length: 4 }, (_, k) => `signal-${index}-${k}-${'x'.repeat(200)}`),
  }));
  let failedClosed = false;
  try {
    createOperatingMissionPacket('strategy-finance', oversizedEvidence, {
      cycleId: 'CYCLE-001',
      pinnedRevision: 'a'.repeat(40),
      declaredRoots: ['src'],
      charter: { purpose: 'conformance', stage: 'growth', goals: ['gate'] },
      priorCycle: null,
      openDecisions: [],
      openGaps: [],
      pendingOutcomes: [],
      planningStatus: { specs: 0, quickTasks: 0 },
    });
  } catch (error) {
    failedClosed = true;
    if (error.code !== 'E_OPERATE_MISSION_PACKET_BUDGET'
      || !/role strategy-finance/.test(error.message)
      || !new RegExp(`maxInputBytes ${role.budgets.maxInputBytes ?? 262144}`).test(error.message)) {
      throw new Error(`Mission-packet budget error is wrong: ${error.code} ${error.message}`);
    }
  }
  if (!failedClosed) {
    throw new Error('An oversized mission packet was not rejected; maxInputBytes must fail closed.');
  }
}

// ── maxEvidenceItems truncates loudly and rescues an otherwise-oversized index ─
// The same 500-item index that fails closed above assembles successfully once
// maxEvidenceItems caps it, proving truncation is enforced (not merely recorded)
// and that the byte gate is never tripped solely by a large PRE-truncation index.
{
  const oversizedEvidence = Array.from({ length: 500 }, (_, index) => ({
    id: `EVX-repo-${String(index).padStart(4, '0')}`,
    path: `src/module-${index}/${'segment/'.repeat(6)}file-${index}.mjs`,
    contentHash: `sha256:${'a'.repeat(64)}`,
    source: 'repository',
    classification: 'code',
    freshness: 'fresh',
    sensitivity: 'internal',
    signals: Array.from({ length: 4 }, (_, k) => `signal-${index}-${k}-${'x'.repeat(200)}`),
  }));
  const packet = createOperatingMissionPacket('strategy-finance', oversizedEvidence, {
    cycleId: 'CYCLE-001',
    pinnedRevision: 'a'.repeat(40),
    declaredRoots: ['src'],
    charter: {
      productCharter: 'A portable planning and delivery engine for solo founders.',
      currentGoals: ['Enforce mission budgets.'],
    },
    priorCycleSummary: { cycleId: 'CYCLE-000', summary: 'Prior cycle established the mission budget.' },
    planningStatus: { planningEngine: 'openplanr', planning: 'One spec decomposed.', delivery: 'One task shipped.' },
    maxEvidenceItems: 40,
  });
  assertProtocolArtifact('operating-mission-packet', packet, { protocolVersion: PROTOCOL });
  if (packet.evidenceIndex.length !== 40
    || packet.budgets.truncatedEvidenceItems !== true
    || packet.budgets.evidenceItemsBeforeTruncation !== 500) {
    throw new Error('maxEvidenceItems must truncate the index to the cap and record the drop loudly.');
  }
}

// ── The mission-packet contract structurally cannot carry a file body ────────
const BODY_PROPERTY_NAMES = new Set([
  'body',
  'content',
  'contents',
  'filebody',
  'filecontent',
  'filecontents',
  'rawcontent',
  'rawbody',
  'raw',
  'bytes',
  'blob',
  'snippet',
  'filetext',
  'sourcetext',
  'fulltext',
  'filedata',
  'filebytes',
  'excerpt',
]);

function collectPropertyNames(node, names = new Set()) {
  if (node === null || typeof node !== 'object') return names;
  if (Array.isArray(node)) {
    for (const item of node) collectPropertyNames(item, names);
    return names;
  }
  if (node.properties && typeof node.properties === 'object') {
    for (const key of Object.keys(node.properties)) names.add(key);
  }
  for (const value of Object.values(node)) collectPropertyNames(value, names);
  return names;
}

for (const kind of [
  'operating-mission-packet',
  'operating-evidence-index-item',
  'operating-tool-grant',
]) {
  const { schema } = resolveProtocolSchema(kind, { protocolVersion: PROTOCOL });
  const names = collectPropertyNames(schema);
  for (const name of names) {
    if (BODY_PROPERTY_NAMES.has(name.toLowerCase())) {
      throw new Error(`Schema ${kind} declares a body-bearing property "${name}"; packets must carry indexes only.`);
    }
  }
  if (schema.additionalProperties !== false) {
    throw new Error(`Schema ${kind} must set additionalProperties:false so no body field can be added silently.`);
  }
}

// ── The operating mandate carries no evidence body and no evidence index ─────
// FR1: the mandate is bounded instruction, not curated input. Its schema is
// additionalProperties:false and declares no evidence/evidenceIndex property, a
// generated mandate for every role validates, and a smuggled evidence body is
// rejected fail-closed.
{
  const { schema: mandateSchema } = resolveProtocolSchema('operating-mandate', { protocolVersion: PROTOCOL });
  if (mandateSchema.additionalProperties !== false) {
    throw new Error('operating-mandate must set additionalProperties:false so no evidence field can be added silently.');
  }
  for (const name of collectPropertyNames(mandateSchema)) {
    if (['evidence', 'evidenceindex'].includes(name.toLowerCase())) {
      throw new Error(`operating-mandate declares a forbidden "${name}" property; the mandate carries no evidence.`);
    }
    if (BODY_PROPERTY_NAMES.has(name.toLowerCase())) {
      throw new Error(`operating-mandate declares a body-bearing property "${name}"; the mandate carries no evidence body.`);
    }
  }
  for (const role of listOperatingRoles()) {
    const mandate = createOperatingMandate(role.id, {
      roots: ['.planr', 'src', 'lib'],
      forbiddenPaths: ['.env', 'secrets'],
      protocolVersion: PROTOCOL,
    });
    assertProtocolArtifact('operating-mandate', mandate, { protocolVersion: PROTOCOL });
    if ('evidence' in mandate || 'evidenceIndex' in mandate) {
      throw new Error(`The generated mandate for ${role.id} leaked an evidence facet.`);
    }
    if (mandate.responseSchema !== 'operating-advisor-response@1.3.0'
      || mandate.citationRequirement.everyClaimCited !== true) {
      throw new Error(`The mandate for ${role.id} must require a cited v1.3 response.`);
    }
    if (!mandate.boundaries.roots.includes('.planr')) {
      throw new Error(`The mandate for ${role.id} must carry the caller's declared roots (a gitignored .planr is citable).`);
    }
  }
  const smuggled = {
    ...createOperatingMandate('strategy-finance', {
      roots: ['src'],
      protocolVersion: PROTOCOL,
    }),
    evidence: [{ id: 'EVD-x' }],
  };
  if (validateProtocolArtifact('operating-mandate', smuggled, { protocolVersion: PROTOCOL }).length === 0) {
    throw new Error('A mandate carrying an evidence body was accepted; additionalProperties:false must reject it.');
  }
}

// ── Every remaining v1.3.0 kind validates a canonical example ────────────────
assertProtocolArtifact('operating-tool-grant', {
  allowed: ['file-read', 'glob', 'content-search', 'git-log', 'git-show', 'git-diff', 'git-blame'],
  roots: ['src', 'lib'],
});

assertProtocolArtifact('operating-evidence-index-item', {
  id: 'EVX-payments-charge',
  path: 'src/payments/charge.mjs',
  contentHash: digest('a'),
  source: 'repository',
  classification: 'code',
  freshness: 'fresh',
  sensitivity: 'internal',
  signals: ['idempotency-key'],
});

const resolvedCitation = {
  kind: 'operating-citation-resolution',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
  citationKey: 'cto-payment-idempotency-1',
  outcome: 'resolved',
  evidenceId: 'EVD-charge-42',
  snapshotDigest: digest('b'),
};
assertProtocolArtifact('operating-citation-resolution', resolvedCitation);
assertProtocolArtifact('operating-citation-resolution', {
  kind: 'operating-citation-resolution',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
  citationKey: 'cto-fabricated-1',
  outcome: 'rejected',
  reason: 'fabricated-path',
  gapId: 'GAP-3f9a2c',
});

const advisorResponse = {
  outcome: 'proposals',
  proposals: [{
    proposalKey: 'technology-risk.reduce-release-risk',
    type: 'finding',
    title: 'Reduce release risk',
    problem: 'The release path has no verified rollback rehearsal.',
    proposal: 'Add one deterministic rollback canary before the next release.',
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
assertProtocolArtifact('operating-advisor-response', advisorResponse, { protocolVersion: PROTOCOL });
if (validateProtocolArtifact('operating-advisor-response', {
  ...advisorResponse,
  proposals: [{ ...advisorResponse.proposals[0], citations: [] }],
}, { protocolVersion: PROTOCOL }).length === 0) {
  throw new Error('A v1.3 advisor proposal must cite at least one reference.');
}

const finding = {
  kind: 'operating-finding',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
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
};
assertProtocolArtifact('operating-finding', finding);

const dataGap = {
  kind: 'operating-data-gap',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
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
assertProtocolArtifact('operating-data-gap', dataGap);

const routePlan = {
  kind: 'operating-route-plan',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
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
    evidenceRefs: ['EVD-release-workflow'],
    reversible: true,
    requiresConfirmation: true,
  }],
  createdAt: at,
};
assertProtocolArtifact('operating-route-plan', routePlan);

const migrationRecord = {
  kind: 'operating-migration-record',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
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
assertProtocolArtifact('operating-migration-record', migrationRecord);
if (migrationRecord.recordCount.before !== migrationRecord.recordCount.after
  || migrationRecord.eventCount.before !== migrationRecord.eventCount.after) {
  throw new Error('The migration fixture must assert losslessness (before === after).');
}

assertProtocolArtifact('operating-records-log-entry', {
  kind: 'operating-records-log-entry',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
  digest: digest('1'),
  recordType: 'finding',
  createdAt: at,
  correlationId: 'operate-cycle-011',
  contentDigest: digest('2'),
  content: finding,
});

assertProtocolArtifact('operating-adapter-handoff', {
  kind: 'operating-adapter-handoff',
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL,
  phase: 'advisors',
  state: 'prepare-required',
  binding: {
    cycleId: 'CYCLE-011',
    evidenceDigest: digest('e'),
    runtime: 'codex',
    idempotencyKey: 'native-CYCLE-011-advisors',
    lease: 'a'.repeat(43),
    expiresAt: at,
  },
  roles: [{ roleId: 'technology-risk', status: 'awaiting-prepare', inputDigest: null }],
  next: [{
    id: 'adapter.prepare.technology-risk',
    action: 'adapter.prepare',
    effect: 'machine-local-write',
    role: 'technology-risk',
    argv: ['planr', 'operate', 'adapter', 'prepare'],
    dispatch: {
      source: 'adapter.prepare-result',
      agent: 'operating-technology-risk',
      mandatePointer: '/data/mandates/technology-risk',
      declaredRoots: ['src', 'lib'],
      toolGrant: { allowed: ['file-read', 'glob', 'content-search', 'git-log'], roots: ['src', 'lib'] },
      isolation: 'enforced-read-only-bounded',
    },
    stdin: {
      kind: 'stdin-json',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 32768,
      schema: 'https://openplanr.dev/schemas/v1.3.0/operating-advisor-response.schema.json',
      schemaSource: 'adapter.prepare-result',
      schemaPointer: '/data/mandates/technology-risk/role/output/schema',
    },
  }],
  recovery: [],
});

// ── The real adapter-handoff builder dispatches a mandate, never a mission ───
// packet or a role pack, and resolves isolation to exactly two values (FR10):
// enforced-read-only-bounded or unsupported — never a hidden structured-provider
// fallback.
{
  const at1 = '2026-07-28T09:00:00Z';
  const handoff = createOperatingAdapterHandoff({
    phase: 'advisors',
    state: 'record-required',
    protocolVersion: PROTOCOL,
    cycleId: 'CYCLE-011',
    evidenceDigest: digest('e'),
    runtime: 'claude-code',
    idempotencyKey: 'native-CYCLE-011-advisors',
    lease: 'a'.repeat(43),
    expiresAt: at1,
    roles: [{ roleId: 'technology-risk', status: 'pending', inputDigest: digest('a') }],
  });
  const serialized = JSON.stringify(handoff);
  if (/missionPacketPointer|missionPackets|rolePackPointer|rolePacks/.test(serialized)) {
    throw new Error('A v1.3 mandate handoff still emits a mission-packet or role-pack pointer.');
  }
  if (/fail-closed-structured-provider|enforced-empty-tools/.test(serialized)) {
    throw new Error('A v1.3 mandate handoff still emits a retired isolation value.');
  }
  const { dispatch } = handoff.next[0];
  if (dispatch.mandatePointer !== '/data/mandates/technology-risk'
    || dispatch.agent !== 'operating-technology-risk') {
    throw new Error('A v1.3 mandate handoff must point at /data/mandates/<role> and name its operating agent.');
  }
  if (!['enforced-read-only-bounded', 'unsupported'].includes(dispatch.isolation)) {
    throw new Error(`A v1.3 mandate handoff isolation must be enforced-read-only-bounded or unsupported; got ${dispatch.isolation}.`);
  }
  // A runtime that cannot enforce bounded read-only tools is declared unsupported,
  // never silently routed to a structured-provider fallback.
  const unsupported = createOperatingAdapterHandoff({
    phase: 'advisors',
    state: 'record-required',
    protocolVersion: PROTOCOL,
    cycleId: 'CYCLE-011',
    evidenceDigest: digest('e'),
    runtime: 'cursor',
    idempotencyKey: 'native-CYCLE-011-advisors',
    lease: 'a'.repeat(43),
    expiresAt: at1,
    roles: [{ roleId: 'technology-risk', status: 'pending', inputDigest: digest('a') }],
  });
  if (unsupported.next[0].dispatch.isolation !== 'unsupported') {
    throw new Error('A runtime that cannot enforce bounded read-only tools must be declared unsupported.');
  }
}

// Project the current v1.4 registry into the frozen v1.3 compatibility shape:
// investigation mandates remain identical while v1.4 route/action budgets map
// back to the proposal-oriented fields older readers require.
const currentRoleRegistry = readJson('registry/operating-roles.json');
const roleRegistry = {
  ...currentRoleRegistry,
  protocolVersion: PROTOCOL,
  roles: currentRoleRegistry.roles.map((role) => ({
    id: role.id,
    order: role.order,
    displayLabel: role.displayLabel,
    mandate: role.mandate,
    forbiddenRecommendationCategories: role.forbiddenRecommendationCategories,
    permittedEvidenceKinds: role.permittedEvidenceKinds,
    sensitivityCeiling: role.sensitivityCeiling,
    capabilityTier: role.capabilityTier,
    inputSchema: 'operating-advisor-input@1.2.0',
    outputSchema: 'operating-role-result@1.2.0',
    adapterResponseSchema: 'operating-advisor-response@1.2.0',
    readOnly: true,
    writeBoundary: 'none',
    allowedProposalTypes: ['finding', 'decision', 'data-gap'],
    budgets: {
      maxInputBytes: role.budgets.maxInputBytes ?? 262144,
      maxOutputBytes: Math.min(role.budgets.maxOutputBytes, 131072),
      maxProposals: role.budgets.maxProposals ?? role.budgets.maxActions,
    },
    requiredEvidenceFields: ['id', 'digest'],
    investigationMandate: role.investigationMandate,
    failureBehavior: role.failureBehavior,
  })),
};
assertProtocolArtifact('operating-role-registry', roleRegistry, { protocolVersion: PROTOCOL });
for (const role of roleRegistry.roles) {
  if ('minimumEvidence' in role || 'dispatchMode' in role) {
    throw new Error(`Operating role ${role.id} still carries a retired minimumEvidence/dispatchMode field.`);
  }
  if (!role.investigationMandate?.examine?.length) {
    throw new Error(`Operating role ${role.id} has no investigation mandate.`);
  }
}

const adapterRegistry = readJson('registry/adapters.json');
adapterRegistry.protocolVersion = PROTOCOL;
adapterRegistry.adapters = adapterRegistry.adapters.map((adapter) => {
  const capabilities = { ...adapter.capabilities };
  delete capabilities.operatingRuntimePolicy;
  const enforced = adapter.capabilities.toolIsolation === 'enforced';
  capabilities.toolIsolation = enforced ? 'enforced-read-only' : adapter.capabilities.toolIsolation;
  capabilities.operatingAdvisorDispatch = enforced ? 'native-read-only' : 'structured-provider';
  return { ...adapter, capabilities };
});
assertProtocolArtifact('adapter-registry', adapterRegistry, { protocolVersion: PROTOCOL });

// The canonical registry remains valid under its declared current version; the
// explicit projection above proves older readers remain supported.
assertProtocolArtifact('operating-role-registry', readJson('registry/operating-roles.json'));
assertProtocolArtifact('adapter-registry', readJson('registry/adapters.json'));

// ── v1.3 route events/records: a create-quick-task route enters the log ─────
{
  const quickRoute = fixture('route-quick-task-valid.json');
  const quickEvent = createOperatingEvent({
    eventId: 'evt-quick-conf',
    timestamp: '2026-07-31T00:00:00.000Z',
    cycleId: 'CYCLE-001',
    type: 'route.proposed',
    entityId: quickRoute.id ?? 'ACT-001',
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'quick-task-conformance',
    payload: { record: quickRoute },
    protocolVersion: '1.3.0',
  }, { previousEvent: null, sequence: 1 });
  assertProtocolArtifact('operating-event', quickEvent, { protocolVersion: '1.3.0' });
  const quickRecord = fixture('record-route-quick-task-v1-3-valid.json');
  assertProtocolArtifact('operating-record', quickRecord, { protocolVersion: '1.3.0' });
  // Frozen direction: the same content must STILL be rejected at v1.2 —
  // the widening is additive, never retroactive.
  const rejectedAtV12 = validateProtocolArtifact('operating-event', {
    ...quickEvent,
    protocolVersion: '1.2.0',
  });
  if (rejectedAtV12.length === 0) {
    throw new Error('A create-quick-task route validated inside a v1.2 event; the frozen surface leaked.');
  }
}

// ── v1.3 route events: a create-epic route also enters the log additively ─────
{
  const epicRoutePlan = fixture('route-epic-valid.json');
  const epicEvent = createOperatingEvent({
    eventId: 'evt-epic-conf',
    timestamp: '2026-07-31T00:00:00.000Z',
    cycleId: 'CYCLE-011',
    type: 'route.proposed',
    entityId: epicRoutePlan.id ?? 'ACT-021',
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'create-epic-conformance',
    payload: { record: epicRoutePlan },
    protocolVersion: '1.3.0',
  }, { previousEvent: null, sequence: 1 });
  assertProtocolArtifact('operating-event', epicEvent, { protocolVersion: '1.3.0' });
  // The additive widening is never retroactive: the same content must still be
  // rejected at v1.2, where create-epic does not exist.
  const epicRejectedAtV12 = validateProtocolArtifact('operating-event', {
    ...epicEvent,
    protocolVersion: '1.2.0',
  });
  if (epicRejectedAtV12.length === 0) {
    throw new Error('A create-epic route validated inside a v1.2 event; the frozen surface leaked.');
  }
}

process.stdout.write(
  `Operating Board v1.3 conformance passed (${EXPECTED_V13_KINDS.length} additive schemas, `
  + 'operating mandate carries no evidence body or index, mission-packet body-free and '
  + 'size-enforced, adapter handoff dispatches a mandate with isolation in '
  + '{enforced-read-only-bounded, unsupported}, citation resolution fails closed, '
  + 'create-quick-task and create-epic route events enter the log with the v1.2 surface frozen).\n',
);
