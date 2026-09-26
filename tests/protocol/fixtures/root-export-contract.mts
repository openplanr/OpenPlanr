import {
  DESIGN_HANDOFF_PROTOCOL_VERSION,
  PROTOCOL_V16_CONTRACTS,
  PROTOCOL_V111_CONTRACTS,
  PROTOCOL_V113_CONTRACTS,
  protocolAssetUrl,
  validateDiagramAuthoringBundle,
} from '@openplanr/protocol';
import * as nodeContracts from '@openplanr/protocol/contracts';

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
