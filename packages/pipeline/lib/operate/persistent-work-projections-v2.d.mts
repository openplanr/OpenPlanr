import type {
  OperatingActionV2,
  OperatingCycleV2,
  OperatingDecisionV2,
  OperatingFindingV2,
  OperatingRuntimeStateV2,
  OperatingWorkCycleLinkV2,
  OperatingWorkLedgerV2,
} from 'planr-pipeline/protocol';

export interface OperatingCycleWorkViewV2 {
  readonly kind: 'operating-cycle-work-view';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '2.0.0';
  readonly cycleId: string;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
  readonly generatedAt: string;
  readonly findings: readonly OperatingFindingV2[];
  readonly decisions: readonly OperatingDecisionV2[];
  readonly actions: readonly OperatingActionV2[];
  readonly cycleLinks: readonly OperatingWorkCycleLinkV2[];
}

export function buildOperatingWorkLedgerV2(
  state: OperatingRuntimeStateV2,
  scope: Pick<OperatingCycleV2, 'scopeId' | 'domainId' | 'domainVersion'>,
  options?: { generatedAt?: string },
): OperatingWorkLedgerV2;

export function buildOperatingCycleWorkViewV2(
  state: OperatingRuntimeStateV2,
  cycleId: string,
  options?: { generatedAt?: string },
): OperatingCycleWorkViewV2;
