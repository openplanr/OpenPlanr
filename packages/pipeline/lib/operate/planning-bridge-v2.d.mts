import type { OperatingActionV2, OperatingDecisionV2, OperatingRuntimeStateV2 } from 'planr-pipeline/protocol';
import type { OperatingDeliveryEvidenceV1, OperatingDeliveryRouteV1, OperatingOriginV1, OperatingPlanningProposalV1 } from 'planr-pipeline/protocol';

export const OPERATING_DELIVERY_ROUTES_V1: readonly ['contained-execution', 'planning-work', 'human-external', 'observe-only'];
export interface OperatingAcceptedPerspectiveOutputV1 {
  assignmentId: string; artifactId: string; roleId: string; roleKind: 'advisor' | 'challenger' | 'chair';
  /** Ephemeral canonical JSON proof. It is validated then excluded from the returned proposal. */
  sourceArtifactValue: Readonly<Record<string, unknown>>;
  /** Ephemeral exact role-scoped intelligence bundle used to prove issued custody. */
  inputBundleValue: Readonly<Record<string, unknown>>;
}
export function createOperatingDeliveryRouteV1(input: { state: OperatingRuntimeStateV2; action: OperatingActionV2; route: OperatingDeliveryRouteV1['route']; rationale: string; createdAt?: string }): OperatingDeliveryRouteV1;
export function assertOperatingDeliveryRouteRevisionV1(previous: OperatingDeliveryRouteV1, next: OperatingDeliveryRouteV1): OperatingDeliveryRouteV1;
export function buildOperatingPlanningProposalV1(state: OperatingRuntimeStateV2, input: {
  scope: { scopeId: string; domainId: string; domainVersion: string };
  decision: Pick<OperatingDecisionV2, 'decisionId' | 'revision'> & { decisionHash: string };
  action: Pick<OperatingActionV2, 'actionId' | 'revision' | 'actionHash'>;
  deliveryRoute: OperatingDeliveryRouteV1;
  acceptedOutputs: readonly OperatingAcceptedPerspectiveOutputV1[];
  /** Exact runtime-recorded verification-plan Event used only for canonical metric recovery. */
  sourceVerificationPlanEvent?: Readonly<Record<string, unknown>>;
  omissions?: OperatingPlanningProposalV1['omissions'];
  framing: OperatingPlanningProposalV1['framing']; actor: OperatingPlanningProposalV1['actor'] & { accessLevel: 'public' | 'internal' | 'confidential' | 'restricted' };
  createdAt?: string; previewExpiresAt: string;
}): OperatingPlanningProposalV1;
export function assertOperatingPlanningProposalV1(proposal: OperatingPlanningProposalV1): OperatingPlanningProposalV1;
export function confirmOperatingPlanningProposalV1(proposal: OperatingPlanningProposalV1, confirmation: {
  actorId: string; proposalRevision: 1; proposalHash: string; eventHead: OperatingPlanningProposalV1['eventHead']; previewDigest: string; confirmedAt: string;
}): OperatingPlanningProposalV1;
export function createOperatingOriginV1(input: { proposal: OperatingPlanningProposalV1; spec: OperatingOriginV1['spec']; actor: OperatingOriginV1['actor']; transaction: OperatingOriginV1['transaction']; createdAt: string }): OperatingOriginV1;
export function assertOperatingOriginV1(origin: OperatingOriginV1): OperatingOriginV1;
export function buildOperatingDeliveryEvidenceV1(input: Omit<OperatingDeliveryEvidenceV1, 'kind' | 'schemaVersion' | 'protocolVersion' | 'deliveryEvidenceId' | 'correlationId' | 'proposalId' | 'proposalRevision' | 'scopeId' | 'domainId' | 'domainVersion' | 'decision' | 'action' | 'metric' | 'verification' | 'spec' | 'outcomeStatus' | 'deliveryEvidenceHash'> & { origin: OperatingOriginV1 }): OperatingDeliveryEvidenceV1;
export function assertOperatingDeliveryEvidenceV1(evidence: OperatingDeliveryEvidenceV1): OperatingDeliveryEvidenceV1;
