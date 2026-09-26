/** Runtime-state readers and envelope constructors shared by the Operate client and its services. */
import { createHash } from 'node:crypto';
import { OperateClientError } from './client-error.js';
import type {
  OperateActorV2,
  OperateAllowedActionV2,
  OperateApiSuccessV2,
  OperateToolNameV2,
  OperateToolResponseMapV2,
} from './client-types.js';
import type { JsonRecord } from './composition.js';
import type { OperateStoredRuntime } from './store.js';

export const PROTOCOL_VERSION = '2.0.0';

export type RuntimeState = JsonRecord & {
  eventHead: { sequence: number; hash: string | null };
  eventReplayIndex: JsonRecord[];
  cycles: JsonRecord[];
  inputBindings: JsonRecord[];
  assignments: JsonRecord[];
  submissions: JsonRecord[];
  artifacts: JsonRecord[];
  evidenceRefs: JsonRecord[];
  evidenceResolutions: JsonRecord[];
  reviews: JsonRecord[];
  findings: JsonRecord[];
  decisions: JsonRecord[];
  actions: JsonRecord[];
  outcomes: JsonRecord[];
  learnings: JsonRecord[];
  operatingSnapshots: JsonRecord[];
  operatingModelStates: JsonRecord[];
  deltas: JsonRecord[];
  intelligencePlans: JsonRecord[];
  decisionLedgers: JsonRecord[];
  verificationPlans: JsonRecord[];
  actionPolicies: JsonRecord[];
  policyEvaluations: JsonRecord[];
  approvalRequirements: JsonRecord[];
  approvalRecords: JsonRecord[];
  capabilityAvailability: JsonRecord[];
  capabilityGrants: JsonRecord[];
  governedOperations: JsonRecord[];
  executionResults: JsonRecord[];
  rollbackPlans: JsonRecord[];
  rollbackResults: JsonRecord[];
};

export type ReplaySafeIssue = Readonly<{
  id(prefix: string): string;
  stableId(prefix: string, value: string): string;
  timestamp(): string;
}>;

export type CreateEvent = (
  runtime: OperateStoredRuntime,
  input: {
    type: string;
    entityId: string;
    cycleId: string;
    payload: unknown;
    correlationId: string;
    timestamp?: string;
    actor?: { kind: 'engine' | 'runtime' | 'human'; id: string };
    causationId?: string | null;
    requestHash?: string;
  },
) => Promise<JsonRecord>;

export type Commit = (
  runtime: OperateStoredRuntime,
  nextState: JsonRecord,
  events: JsonRecord[],
) => Promise<OperateStoredRuntime>;

export function timestamp(): string {
  return new Date().toISOString();
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

export function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The accepted lifecycle result is not a JSON object.',
      false,
    );
  }
  return value as JsonRecord;
}

export function state(runtime: OperateStoredRuntime): RuntimeState {
  return runtime.state as RuntimeState;
}

export function findBy(entries: JsonRecord[], key: string, value: string): JsonRecord | undefined {
  return entries.find((entry) => entry[key] === value);
}

function cycleReadAction(cycleId: string): OperateAllowedActionV2 {
  return {
    tool: 'operate.cycle.get',
    arguments: { cycleId },
    label: 'Inspect the current cycle',
    effect: 'read-only',
  };
}

export function cycleReadActions(
  cycleId: string,
  _actor?: OperateActorV2,
): OperateAllowedActionV2[] {
  return [cycleReadAction(cycleId)];
}

export function operateSuccess<Operation extends OperateToolNameV2>(
  operation: Operation,
  data: OperateToolResponseMapV2[Operation],
  allowedActions: unknown[] = [],
): OperateApiSuccessV2<Operation> {
  return { ok: true, operation, data, allowedActions };
}
