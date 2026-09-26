import type {
  OperatingArtifactV2,
  OperatingEventV2,
  OperatingExecutionResultV2,
  OperatingGovernedOperationV2,
  OperatingRuntimeStateV2,
} from '@openplanr/protocol';
import type { OperatingArtifactByteStoreV2 } from './evidence-materialization-v2.d.mts';
import type { OperateGovernedExtensionRegistryV2 } from './governed-extensions-v2.d.mts';
import type {
  ContainedEffectReceiptV2,
  ContainedTargetAdapterV2,
  ReferenceExecutorHostV2,
} from './reference-governed-executors-v2.d.mts';

export interface OperatingGovernedExecutionPayloadV2 {
  artifactId: string;
  contentHash: string;
  value: unknown;
}

export interface OperatingGovernedExecutionRequestV2 {
  actionId: string;
  payload: OperatingGovernedExecutionPayloadV2;
  rollbackBaseline: OperatingGovernedExecutionPayloadV2 | null;
}

export interface OperatingGovernedExecutionEventIdsV2 {
  assignmentCreated: string;
  assignmentClaimed: string;
  assignmentStarted: string;
  availabilityRecorded: string;
  capabilityGranted: string;
  intentRecorded: string;
  submitted: string;
  artifactCreated: string;
  validated: string;
  resultRecorded: string;
}

export interface OperatingGovernedExecutionTerminalIdentityV2 {
  resultId: string;
  resultArtifactId: string;
  submissionId: string;
  eventIds: Pick<
    OperatingGovernedExecutionEventIdsV2,
    'submitted' | 'artifactCreated' | 'validated' | 'resultRecorded'
  >;
}

export interface OperatingGovernedExecutionDraftV2 {
  assignmentId: string;
  submissionId: string;
  operationId: string;
  grantId: string;
  resultId: string;
  resultArtifactId: string;
  claimId: string;
  preparedAt: string;
  completedAt: string;
  grantExpiresAt: string;
  availabilityExpiresAt: string;
  correlationId: string;
  eventIds: OperatingGovernedExecutionEventIdsV2;
  uncertainty: OperatingGovernedExecutionTerminalIdentityV2;
}

export interface OperatingGovernedExecutionEnvironmentV2 {
  trustedHost: ReferenceExecutorHostV2;
  targetAdapter: ContainedTargetAdapterV2;
}

export interface OperatingGovernedExecutionRuntimeOptionsV2 {
  initialState: OperatingRuntimeStateV2;
  artifactStore?: OperatingArtifactByteStoreV2;
  checkpointStore: OperatingGovernedExecutionCheckpointStoreV2;
  runtimeVersion?: string;
  runtimeActorId?: string;
  registry?: OperateGovernedExtensionRegistryV2;
}

export interface OperatingGovernedExecutionCheckpointStoreV2 {
  readSnapshot(): Promise<OperatingRuntimeStateV2> | OperatingRuntimeStateV2;
  compareAndSwap(
    input: Readonly<{
      expectedEventHead: OperatingRuntimeStateV2['eventHead'];
      nextState: OperatingRuntimeStateV2;
      phase: 'dispatch-intent' | 'terminal-result' | 'rollback-intent' | 'rollback-result';
      operationId: string;
      requestFingerprint: string;
    }>,
  ):
    | Promise<Readonly<{ committed: boolean; state: OperatingRuntimeStateV2 }>>
    | Readonly<{ committed: boolean; state: OperatingRuntimeStateV2 }>;
}

export interface OperatingGovernedExecutionResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly operation: OperatingGovernedOperationV2;
  readonly result: OperatingExecutionResultV2;
  readonly artifact: OperatingArtifactV2;
  readonly events: readonly OperatingEventV2[];
  readonly response: unknown;
  readonly receipt: ContainedEffectReceiptV2 | null;
  readonly replayed: boolean;
  readonly dispatchCount: 0 | 1;
  readonly effectCount: number;
}

export interface OperatingGovernedExecutionRuntimeV2 {
  execute(
    request: OperatingGovernedExecutionRequestV2,
    draft: OperatingGovernedExecutionDraftV2,
    environment: OperatingGovernedExecutionEnvironmentV2,
  ): Promise<Readonly<OperatingGovernedExecutionResultV2>>;
  checkpoint(): OperatingRuntimeStateV2;
  getState(): OperatingRuntimeStateV2;
  readonly dispatchCount: number;
}

export function createOperatingGovernedExecutionRuntimeV2(
  options: OperatingGovernedExecutionRuntimeOptionsV2,
): Readonly<OperatingGovernedExecutionRuntimeV2>;

export function executeOperatingGovernedActionV2(
  request: OperatingGovernedExecutionRequestV2,
  draft: OperatingGovernedExecutionDraftV2,
  options: OperatingGovernedExecutionRuntimeOptionsV2 & OperatingGovernedExecutionEnvironmentV2,
): Promise<Readonly<OperatingGovernedExecutionResultV2>>;

export const OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2: readonly [
  'blocked',
  'failed',
  'partial',
  'succeeded',
  'uncertain',
];
