// @ts-check
/** Additive Protocol 1.17 revision references for staged company resources. */
import { assertLargeObjectData } from './bounded-json-data.mjs';
import { canonicalizeJson, deepFreeze, sha256Hex } from './canonical-json.mjs';
import {
  assertEnterpriseContractWithSchema,
  assertEnterpriseEvidenceWithSchema,
  assertEnterpriseHandoffWithSchema,
  assertEnterpriseProposalWithSchema,
  assertEnterpriseReviewThreadWithSchema,
  assertEnterpriseSyncWithSchema,
  renderEnterpriseHandoffMarkdownData,
} from './enterprise-contract-validation.mjs';
import {
  assertEnterpriseEvidence,
  assertEnterpriseHandoff,
  assertEnterpriseProposal,
  assertEnterpriseReviewThread,
  assertEnterpriseSync,
  ENTERPRISE_AGENT_HANDOFF_SCHEMA,
  ENTERPRISE_CHANGE_PROPOSAL_SCHEMA,
  ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA,
  ENTERPRISE_REVIEW_ANCHOR_SCHEMA,
  ENTERPRISE_REVIEW_THREAD_SCHEMA,
  ENTERPRISE_SYNC_STATE_SCHEMA,
} from './enterprise-contracts.mjs';

const opaqueRevisionId = { type: 'string', pattern: '^[A-Za-z0-9_-]{22,64}$' };
function copySchema(value) {
  return structuredClone(value);
}
const anchor = copySchema(ENTERPRISE_REVIEW_ANCHOR_SCHEMA);
const revisionId = {
  anyOf: [opaqueRevisionId, anchor.properties.revisionId],
};
const nullableRevisionId = { anyOf: [revisionId, { type: 'null' }] };

function successor(source, name) {
  const value = structuredClone(source);
  value.$id = `https://openplanr.dev/schemas/v1.17.0/${name}.schema.json`;
  value['x-openplanr-contract'] = { id: name, version: '1.17.0' };
  value.properties.schemaVersion = { const: '1.1.0' };
  value.properties.protocolVersion = { const: '1.17.0' };
  value.required.push('protocolVersion');
  return value;
}

export const ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA = deepFreeze({
  ...anchor,
  properties: { ...anchor.properties, revisionId },
});

const thread = successor(ENTERPRISE_REVIEW_THREAD_SCHEMA, 'enterprise-review-thread');
thread.properties.anchor = ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA;
thread.properties.addressedRevisionId = revisionId;
export const ENTERPRISE_REVIEW_THREAD_V11_SCHEMA = deepFreeze(thread);

const proposal = successor(ENTERPRISE_CHANGE_PROPOSAL_SCHEMA, 'enterprise-change-proposal');
proposal.properties.baseRevisionId = revisionId;
proposal.properties.application.properties.revisionId = revisionId;
export const ENTERPRISE_CHANGE_PROPOSAL_V11_SCHEMA = deepFreeze(proposal);

const evidence = successor(ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA, 'enterprise-evidence-reference');
evidence.properties.source.oneOf.find(
  (branch) => branch.properties.kind.const === 'artifact',
).properties.revisionId = revisionId;
export const ENTERPRISE_EVIDENCE_REFERENCE_V11_SCHEMA = deepFreeze(evidence);

const sync = successor(ENTERPRISE_SYNC_STATE_SCHEMA, 'enterprise-sync-state');
sync.properties.items.items.properties.baseRevisionId = nullableRevisionId;
sync.properties.items.items.properties.revisionId = nullableRevisionId;
export const ENTERPRISE_SYNC_STATE_V11_SCHEMA = deepFreeze(sync);

const handoff = successor(ENTERPRISE_AGENT_HANDOFF_SCHEMA, 'enterprise-agent-handoff');
handoff.properties.revisionId = revisionId;
handoff.properties.threads.items = {
  oneOf: [ENTERPRISE_REVIEW_THREAD_SCHEMA, ENTERPRISE_REVIEW_THREAD_V11_SCHEMA],
};
handoff.properties.evidence.items = {
  oneOf: [ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA, ENTERPRISE_EVIDENCE_REFERENCE_V11_SCHEMA],
};
export const ENTERPRISE_AGENT_HANDOFF_V11_SCHEMA = deepFreeze(handoff);

export const ENTERPRISE_RESOURCE_SCHEMAS = deepFreeze({
  'enterprise-review-thread': ENTERPRISE_REVIEW_THREAD_V11_SCHEMA,
  'enterprise-change-proposal': ENTERPRISE_CHANGE_PROPOSAL_V11_SCHEMA,
  'enterprise-evidence-reference': ENTERPRISE_EVIDENCE_REFERENCE_V11_SCHEMA,
  'enterprise-sync-state': ENTERPRISE_SYNC_STATE_V11_SCHEMA,
  'enterprise-agent-handoff': ENTERPRISE_AGENT_HANDOFF_V11_SCHEMA,
});

// Inspect the own data descriptor without evaluating a version getter. The
// selected reader then performs its full traversal before accessing fields.
function isLegacy(value) {
  if (!value || typeof value !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
  if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')))
    throw new TypeError('Enterprise data contains a forbidden property.');
  return descriptor?.value === '1.0.0';
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertEnterpriseReviewAnchorV11>} */
export function assertEnterpriseReviewAnchorV11(value) {
  assertLargeObjectData(value);
  return assertEnterpriseContractWithSchema(value, ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertVersionedEnterpriseReviewThread>} */
export function assertVersionedEnterpriseReviewThread(value) {
  if (isLegacy(value)) return assertEnterpriseReviewThread(value);
  assertLargeObjectData(value);
  return assertEnterpriseReviewThreadWithSchema(value, ENTERPRISE_REVIEW_THREAD_V11_SCHEMA);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertVersionedEnterpriseProposal>} */
export function assertVersionedEnterpriseProposal(value) {
  if (isLegacy(value)) return assertEnterpriseProposal(value);
  assertLargeObjectData(value);
  return assertEnterpriseProposalWithSchema(value, ENTERPRISE_CHANGE_PROPOSAL_V11_SCHEMA);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertVersionedEnterpriseEvidence>} */
export function assertVersionedEnterpriseEvidence(value) {
  if (isLegacy(value)) return assertEnterpriseEvidence(value);
  assertLargeObjectData(value);
  return assertEnterpriseEvidenceWithSchema(value, ENTERPRISE_EVIDENCE_REFERENCE_V11_SCHEMA);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertVersionedEnterpriseSync>} */
export function assertVersionedEnterpriseSync(value) {
  if (isLegacy(value)) return assertEnterpriseSync(value);
  assertLargeObjectData(value);
  return assertEnterpriseSyncWithSchema(value, ENTERPRISE_SYNC_STATE_V11_SCHEMA);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').assertVersionedEnterpriseHandoff>} */
export function assertVersionedEnterpriseHandoff(value) {
  if (isLegacy(value)) return assertEnterpriseHandoff(value);
  assertLargeObjectData(value);
  return assertEnterpriseHandoffWithSchema(
    value,
    ENTERPRISE_AGENT_HANDOFF_V11_SCHEMA,
    assertVersionedEnterpriseReviewThread,
    assertVersionedEnterpriseEvidence,
  );
}

/** Exact successor dispatch; old versioned values remain available through their named readers. */
export function assertEnterpriseResourceContract(value, kind) {
  assertLargeObjectData(value);
  if (!Object.hasOwn(ENTERPRISE_RESOURCE_SCHEMAS, kind))
    throw new TypeError('Unknown enterprise resource contract.');
  if (value?.schemaVersion !== '1.1.0')
    throw new TypeError('Unsupported enterprise resource contract version.');
  if (kind === 'enterprise-review-thread') return assertVersionedEnterpriseReviewThread(value);
  if (kind === 'enterprise-change-proposal') return assertVersionedEnterpriseProposal(value);
  if (kind === 'enterprise-evidence-reference') return assertVersionedEnterpriseEvidence(value);
  if (kind === 'enterprise-sync-state') return assertVersionedEnterpriseSync(value);
  return assertVersionedEnterpriseHandoff(value);
}

/** @returns {ReturnType<typeof import('./enterprise-resource-contracts.d.mts').createEnterpriseHandoffV11>} */
export function createEnterpriseHandoffV11(input) {
  assertLargeObjectData(input);
  const {
    organizationId,
    projectId,
    artifactId,
    revisionId: headRevisionId,
    generatedAt,
    threads = [],
    evidence: references = [],
    unresolvedUncertainties = [],
  } = input;
  const content = {
    kind: 'openplanr-enterprise-agent-handoff',
    schemaVersion: '1.1.0',
    protocolVersion: '1.17.0',
    organizationId,
    projectId,
    artifactId,
    revisionId: headRevisionId,
    generatedAt,
    authority: 'feedback-only',
    contentTrust: 'untrusted',
    threads,
    evidence: references,
    unresolvedUncertainties,
  };
  const value = {
    ...JSON.parse(canonicalizeJson(content)),
    contentDigest: sha256Hex(canonicalizeJson(content)),
  };
  assertVersionedEnterpriseHandoff(value);
  return deepFreeze(value);
}

/** @type {typeof import('./enterprise-resource-contracts.d.mts').renderVersionedEnterpriseHandoffMarkdown} */
export function renderVersionedEnterpriseHandoffMarkdown(value) {
  assertVersionedEnterpriseHandoff(value);
  return renderEnterpriseHandoffMarkdownData(value);
}
