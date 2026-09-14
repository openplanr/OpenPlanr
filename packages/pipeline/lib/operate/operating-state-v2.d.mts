import type {
  OperatingActionV2,
  OperatingAssumptionV2,
  OperatingDecisionV2,
  OperatingFindingV2,
  OperatingMetricV2,
  OperatingModelStateV2,
  OperatingObjectiveV2,
  OperatingRiskV2,
} from 'planr-pipeline/protocol';

export interface OperatingModelStateScopeV2 {
  scopeId: string;
  domainId: string;
  domainVersion: string;
}

export interface OperatingModelStateCollectionsV2 {
  objectives: readonly OperatingObjectiveV2[];
  metrics: readonly OperatingMetricV2[];
  findings: readonly OperatingFindingV2[];
  decisions: readonly OperatingDecisionV2[];
  actions: readonly OperatingActionV2[];
  risks: readonly OperatingRiskV2[];
  assumptions: readonly OperatingAssumptionV2[];
}

export const OPERATING_MODEL_STATE_COLLECTIONS_V2: readonly Readonly<{
  field: keyof OperatingModelStateCollectionsV2;
  kind: string;
  id: string;
}>[];

export function deriveOperatingModelStateRuntimeHashV2(state: OperatingModelStateV2): string;
export function assertOperatingModelStateV2(state: OperatingModelStateV2): OperatingModelStateV2;
export function buildOperatingModelStateV2(input: {
  stateId: string;
  snapshotId: string;
  scope: OperatingModelStateScopeV2;
  collections: OperatingModelStateCollectionsV2;
  generatedAt: string;
}): OperatingModelStateV2;
