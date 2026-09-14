import type { OperatingEvidenceGraphV2, OperatingRuntimeStateV2 } from '@openplanr/protocol';

export function buildOperatingEvidenceGraphV2(
  state: OperatingRuntimeStateV2,
  scope: { scopeId: string; domainId: string; domainVersion: string },
  options?: { generatedAt?: string },
): OperatingEvidenceGraphV2;
