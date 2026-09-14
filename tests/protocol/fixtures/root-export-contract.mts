import { PROTOCOL_V16_CONTRACTS, protocolAssetUrl } from '@openplanr/protocol';
import * as nodeContracts from '@openplanr/protocol/contracts';

const contracts: Readonly<Record<string, string>> = PROTOCOL_V16_CONTRACTS;
const sourceUrl: URL = protocolAssetUrl('skill-source', { protocolVersion: '1.6.0' });

// The Node contract-validation subpath does not own browser contract tables.
// @ts-expect-error PROTOCOL_V16_CONTRACTS is intentionally root/browser-only.
nodeContracts.PROTOCOL_V16_CONTRACTS;

void contracts;
void sourceUrl;
