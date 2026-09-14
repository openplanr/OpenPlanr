import type {
  OperatingActionVerificationPlanV2,
  OperatingArtifactV2,
  OperatingMetricObservationV2,
  OperatingMetricV2,
  OperatingModelStateV2,
  OperatingOutcomeV2,
  OperatingSnapshotV2,
} from 'planr-pipeline/protocol';
import type { OperateExtensionRegistryV2 } from './extensions-v2.d.mts';

export const OPEN_REFERENCE_OPERATING_SIGNAL_PROVIDER_IDENTITIES_V2: Readonly<{
  snapshot: { providerId: 'open-reference-snapshot-provider'; providerVersion: '1.0.0'; implementationId: 'open-reference-snapshot-provider-v2' };
  metric: { providerId: 'open-reference-metric-provider'; providerVersion: '1.0.0'; implementationId: 'open-reference-metric-provider-v2' };
  verification: { providerId: 'open-reference-verification-provider'; providerVersion: '1.0.0'; implementationId: 'open-reference-verification-provider-v2' };
}>;

export class OperatingSignalProviderErrorV2 extends Error { code: string; details: Readonly<Record<string, unknown>>; }

export type OperatingSignalProviderSelectionV2 =
  | { status: 'selected'; provider: Readonly<Record<string, unknown>>; error: null }
  | { status: 'unavailable'; provider: null; error: { code: 'OPERATING_PROVIDER_UNAVAILABLE'; retryable: false; context: Readonly<Record<string, string | null>> } };

export function selectOperatingSnapshotProviderV2(registry: OperateExtensionRegistryV2 | undefined, request: { providerId: string; providerVersion: string; domainContract: { apiDomainId: string; id: string; version: string } }): OperatingSignalProviderSelectionV2;
export function selectOperatingMetricProviderV2(registry: OperateExtensionRegistryV2 | undefined, request: { providerId: string; providerVersion: string; domainContract: { apiDomainId: string; id: string; version: string } }): OperatingSignalProviderSelectionV2;
export function selectOperatingVerificationProviderV2(registry: OperateExtensionRegistryV2 | undefined, request: { providerId: string; providerVersion: string; domainContract: { apiDomainId: string; id: string; version: string } }): OperatingSignalProviderSelectionV2;

export function createOperatingSnapshotCandidateV2(input: { registry?: OperateExtensionRegistryV2; providerId: string; providerVersion: string; snapshot: OperatingSnapshotV2; state: OperatingModelStateV2; acceptedArtifacts: readonly OperatingArtifactV2[] }): OperatingSignalProviderSelectionV2 | { status: 'candidate'; provider: Readonly<Record<string, unknown>>; candidate: OperatingSnapshotV2 };
export function createOperatingMetricObservationCandidateV2(input: { registry?: OperateExtensionRegistryV2; providerId: string; providerVersion: string; metric: OperatingMetricV2; observation: OperatingMetricObservationV2; snapshot: OperatingSnapshotV2; acceptedArtifacts: readonly OperatingArtifactV2[] }): OperatingSignalProviderSelectionV2 | { status: 'candidate'; provider: Readonly<Record<string, unknown>>; candidate: OperatingMetricObservationV2 };
export function createOperatingVerificationCandidateV2(input: { registry?: OperateExtensionRegistryV2; providerId: string; providerVersion: string; verificationPlan: OperatingActionVerificationPlanV2; outcome: OperatingOutcomeV2; acceptedArtifacts: readonly OperatingArtifactV2[] }): OperatingSignalProviderSelectionV2 | { status: 'candidate'; provider: Readonly<Record<string, unknown>>; candidate: OperatingOutcomeV2 };
