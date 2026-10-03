import {
  assertVersionedEnterpriseReviewThread,
  createEnterpriseHandoffV11,
  DESIGN_HANDOFF_PROTOCOL_VERSION,
  type EnterpriseAgentHandoffV11,
  PROTOCOL_V16_CONTRACTS,
  PROTOCOL_V111_CONTRACTS,
  PROTOCOL_V113_CONTRACTS,
  PROTOCOL_V115_CONTRACTS,
  protocolAssetUrl,
  type VersionedEnterpriseReviewThread,
  validateDiagramAuthoringBundle,
  validateDiagramReviewArtifact,
} from '@openplanr/protocol';
import * as nodeContracts from '@openplanr/protocol/contracts';
import { renderVersionedEnterpriseHandoffMarkdown } from '@openplanr/protocol/enterprise-resource-contracts';

const contracts: Readonly<Record<string, string>> = PROTOCOL_V16_CONTRACTS;
const sourceUrl: URL = protocolAssetUrl('skill-source', { protocolVersion: '1.6.0' });
const handoffContracts: Readonly<Record<string, string>> = PROTOCOL_V111_CONTRACTS;
const handoffUrl: URL = protocolAssetUrl('design-handoff-readiness', {
  protocolVersion: DESIGN_HANDOFF_PROTOCOL_VERSION,
});

// The Node contract-validation subpath does not own browser contract tables.
// @ts-expect-error PROTOCOL_V16_CONTRACTS is intentionally root/browser-only.
nodeContracts.PROTOCOL_V16_CONTRACTS;

void contracts;
void sourceUrl;
void handoffContracts;
void handoffUrl;

const authoringContracts: Readonly<Record<string, string>> = PROTOCOL_V113_CONTRACTS;
const authoringUrl: URL = protocolAssetUrl('diagram-authoring-bundle', {
  protocolVersion: '1.13.0',
});
const authoringIssues: { path: string; rule: string; detail: string }[] =
  validateDiagramAuthoringBundle({});
void authoringContracts;
void authoringUrl;
void authoringIssues;

const reviewContracts: Readonly<Record<string, string>> = PROTOCOL_V115_CONTRACTS;
const reviewUrl: URL = protocolAssetUrl('diagram-review-bundle', { protocolVersion: '1.15.0' });
const reviewIssues: { path: string; rule: string; detail: string }[] =
  validateDiagramReviewArtifact('diagram-review-bundle', {});
void reviewContracts;
void reviewUrl;
void reviewIssues;

const retainedFeedback: VersionedEnterpriseReviewThread = assertVersionedEnterpriseReviewThread({});
const resourceHandoff: EnterpriseAgentHandoffV11 = createEnterpriseHandoffV11({
  organizationId: 'org_a',
  projectId: 'project_a',
  artifactId: 'diagram_a',
  revisionId: '_'.padEnd(22, 'R'),
  generatedAt: '2026-09-13T09:01:00.000Z',
  threads: [retainedFeedback],
});
const exactVersion: '1.1.0' = resourceHandoff.schemaVersion;
const resourceMarkdown: string = renderVersionedEnterpriseHandoffMarkdown(resourceHandoff);
void exactVersion;
void resourceMarkdown;
