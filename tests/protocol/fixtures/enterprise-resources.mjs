import {
  assertEnterpriseResourceContract,
  createEnterpriseHandoffV11,
  renderVersionedEnterpriseHandoffMarkdown,
} from '../../../packages/protocol/src/enterprise-resource-contracts.mjs';
import { assertLargeObjectContract } from '../../../packages/protocol/src/large-object-contracts.mjs';

const at = '2026-09-13T09:00:00.000Z';
const later = '2026-09-13T09:01:00.000Z';
const scope = { organizationId: 'org_a', projectId: 'project_a' };
const envelope = (kind, legacy) => ({
  kind: `openplanr-${kind}`,
  schemaVersion: legacy ? '1.0.0' : '1.1.0',
  ...(legacy ? {} : { protocolVersion: '1.17.0' }),
  ...scope,
});
export function resourceThread(revisionId, legacy = false) {
  return {
    ...envelope('enterprise-review-thread', legacy),
    id: legacy ? 'old_thread' : 'thread_a',
    artifactId: 'diagram_a',
    anchor: { revisionId, screenId: 'home', frameId: 'home_desktop', elementId: 'button.primary' },
    category: 'change-request',
    status: 'addressed',
    addressedRevisionId: revisionId,
    authorId: 'user_a',
    body: '<img src=x>\nPlease preserve **the exact feedback**.',
    createdAt: at,
    updatedAt: later,
    replies: [{ id: 'reply_a', authorId: 'user_b', body: 'Reply.', createdAt: later }],
  };
}
export function resourceProposal(revisionId, legacy = false) {
  return {
    ...envelope('enterprise-change-proposal', legacy),
    id: 'proposal_a',
    artifactId: 'diagram_a',
    baseRevisionId: revisionId,
    authorId: 'user_a',
    createdAt: at,
    status: 'applied',
    summary: 'Label the action',
    operations: [
      { op: 'set-field', targetId: 'button.primary', field: 'label', value: 'Continue' },
    ],
    validation: { status: 'passed', issues: [] },
    application: {
      revisionId: `${revisionId.slice(0, -1)}${revisionId.endsWith('B') ? 'C' : 'B'}`,
      appliedAt: later,
      actorId: 'user_a',
    },
  };
}
export function resourceEvidence(revisionId, legacy = false) {
  return {
    ...envelope('enterprise-evidence-reference', legacy),
    id: legacy ? 'old_evidence' : 'evidence_a',
    source: { kind: 'artifact', artifactId: 'diagram_a', revisionId, elementId: 'button.primary' },
    capturedAt: at,
    freshness: 'current',
    label: 'Selected artifact',
  };
}
export function resourceSync(revisionId, legacy = false) {
  return {
    ...envelope('enterprise-sync-state', legacy),
    repositoryId: 'repo_a',
    direction: 'pull',
    status: 'synchronized',
    scope: ['diagram_a'],
    cursor: null,
    operationId: 'operation_a',
    updatedAt: at,
    items: [
      {
        artifactId: 'diagram_a',
        baseRevisionId: revisionId,
        revisionId,
        contentDigest: 'a'.repeat(64),
        action: 'unchanged',
      },
    ],
    issues: [],
  };
}
export function resourceHandoff(revisionId) {
  return createEnterpriseHandoffV11({
    ...scope,
    artifactId: 'diagram_a',
    revisionId,
    generatedAt: later,
    threads: [resourceThread(revisionId), resourceThread('rev_old', true)],
    evidence: [resourceEvidence(revisionId), resourceEvidence('rev_old', true)],
    unresolvedUncertainties: ['Confirm scope before applying.'],
  });
}
export function resourceCases(revisionId) {
  return {
    'enterprise-review-thread': resourceThread(revisionId),
    'enterprise-change-proposal': resourceProposal(revisionId),
    'enterprise-evidence-reference': resourceEvidence(revisionId),
    'enterprise-sync-state': resourceSync(revisionId),
    'enterprise-agent-handoff': resourceHandoff(revisionId),
  };
}

export function enterpriseResourceProof() {
  const cases = [];
  for (const revisionId of ['_'.padEnd(22, 'R'), '-'.padEnd(64, 'R'), 'rev_old']) {
    for (const [kind, value] of Object.entries(resourceCases(revisionId))) {
      const invalid = structuredClone(value);
      invalid.protocolVersion = '1.12.0';
      let rejection;
      try {
        assertEnterpriseResourceContract(invalid, kind);
      } catch (error) {
        rejection = error.message;
      }
      cases.push({
        kind,
        revisionId,
        identity:
          assertEnterpriseResourceContract(value, kind) === value &&
          assertLargeObjectContract(value, kind) === value,
        rejection,
      });
    }
  }
  return {
    cases,
    markdown: renderVersionedEnterpriseHandoffMarkdown(resourceHandoff('_'.padEnd(22, 'R'))),
  };
}
