import type {
  OperateEvidenceProviderRegistrationV2,
  OperateEvidenceResolverRegistrationV2,
  OperateCapabilityProviderRegistrationV2,
  OperateExecutorRegistrationV2,
  OperateMetricProviderRegistrationV2,
  OperatePolicyProviderRegistrationV2,
  OperateSnapshotProviderRegistrationV2,
  OperateVerificationProviderRegistrationV2,
} from '@openplanr/protocol';

export interface OperateExtensionProvenanceV2 {
  packageName: string;
  packageVersion: string;
  integrity: string;
}

export interface OperateAnalysisRubricV2 {
  requiredQuestions: string[];
  requiredEvidence: string[];
  failureModes: string[];
  artifactQualityBar: string[];
  outOfScope: string[];
}

export interface OperateDomainRegistrationV2 {
  kind: 'operate-domain-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  domainId: string;
  domainVersion: string;
  domainContract?: { apiDomainId: string; id: string; version: string };
  provenance: OperateExtensionProvenanceV2;
  roles: Array<{
    roleId: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    label: string;
    roleVersion: '2.0.0';
    output: { schemaId: 'operating-artifact'; schemaVersion: '2.0.0'; mediaType: 'application/json'; maxBytes: number };
    analysisRubric: OperateAnalysisRubricV2;
    dependencyPolicy: { id: 'none' | 'all-required' | 'threshold'; version: '1.0.0' };
    requirements: string[];
  }>;
  vocabulary: Array<{ term: string; definition: string }>;
  projectionContracts: Array<{ schemaId: string; schemaVersion: string }>;
  actionKinds: Array<{ id: string; version: string }>;
  requestedCapabilities: Array<{ id: string; version: string; reason: string }>;
  requirements: string[];
}

export interface AgentRuntimeManifestV2 {
  kind: 'agent-runtime-manifest';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  runtimeId: string;
  runtimeVersion: string;
  provenance: OperateExtensionProvenanceV2;
  implementation: { packageName: string; packageVersion: string; exportName: string; availability: 'available' | 'unavailable' };
  supportedContracts: Array<{ schemaId: string; schemaVersion: '2.0.0' }>;
  capabilitiesRequested: string[];
  limits: { maxConcurrentAssignments: number; maxOutputBytes: number };
  health: { status: 'conformant'; checkedAt: string; conformanceDigest: string };
  fallback: { kind: 'unavailable' } | { kind: 'runtime'; runtimeId: string; runtimeVersion: string };
}

export interface OperateExtensionRegistryV2 {
  domains: readonly OperateDomainRegistrationV2[];
  agentRuntimeManifests: readonly AgentRuntimeManifestV2[];
  evidenceProviders: readonly OperateEvidenceProviderRegistrationV2[];
  evidenceResolvers: readonly OperateEvidenceResolverRegistrationV2[];
  snapshotProviders: readonly OperateSnapshotProviderRegistrationV2[];
  metricProviders: readonly OperateMetricProviderRegistrationV2[];
  verificationProviders: readonly OperateVerificationProviderRegistrationV2[];
  capabilityProviders: readonly OperateCapabilityProviderRegistrationV2[];
  policyProviders: readonly OperatePolicyProviderRegistrationV2[];
  executors: readonly OperateExecutorRegistrationV2[];
}

export const PUBLIC_OPERATE_DOMAIN_BINDINGS_V2: Readonly<Record<'business' | 'software', {
  apiDomainId: 'business' | 'software';
  id: 'business-domain' | 'software-domain';
  version: '1.0.0';
  projection: { schemaId: 'business-operating-snapshot-projection' | 'software-operating-snapshot-projection'; schemaVersion: '1.0.0' };
}>>;
export const DEFERRED_OPERATE_EXTENSION_KINDS_V2: readonly [];
export class OperatingExtensionRegistryErrorV2 extends Error { code: string; details: Readonly<Record<string, unknown>>; }
export const OPEN_REFERENCE_OPERATE_EXTENSIONS_V2: OperateExtensionRegistryV2;
export function createOperateExtensionRegistryV2(input?: Partial<OperateExtensionRegistryV2> & { allowSyntheticDomains?: boolean }): OperateExtensionRegistryV2;
export function canonicalizeOperateExtensionRegistryV2(registry: OperateExtensionRegistryV2): OperateExtensionRegistryV2;
export function findOperateDomainRegistrationV2(registry: OperateExtensionRegistryV2, domainId: string, options: { domainVersion: string }): OperateDomainRegistrationV2 | null;
export function findAgentRuntimeManifestV2(registry: OperateExtensionRegistryV2, runtimeId: string, options: { runtimeVersion: string }): AgentRuntimeManifestV2 | null;
export function findOperateSnapshotProviderRegistrationV2(registry: OperateExtensionRegistryV2, providerId: string, options: { providerVersion: string }): OperateSnapshotProviderRegistrationV2 | null;
export function findOperateMetricProviderRegistrationV2(registry: OperateExtensionRegistryV2, providerId: string, options: { providerVersion: string }): OperateMetricProviderRegistrationV2 | null;
export function findOperateVerificationProviderRegistrationV2(registry: OperateExtensionRegistryV2, providerId: string, options: { providerVersion: string }): OperateVerificationProviderRegistrationV2 | null;
export function selectAgentRuntimeManifestV2(registry: OperateExtensionRegistryV2, runtimeId: string, options: { runtimeVersion: string }):
  | { status: 'available' | 'fallback'; manifest: AgentRuntimeManifestV2; fallback: { runtimeId: string; runtimeVersion: string } | null }
  | { status: 'unavailable'; manifest: null; fallback: null };
