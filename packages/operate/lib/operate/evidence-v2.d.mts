import type {
  OperateEvidenceProviderRegistrationV2,
  OperateEvidenceResolverRegistrationV2,
  OperatingEvidenceCandidateV2,
} from '@openplanr/protocol';
import type {
  OperateEvidenceDispatchPreparationV2,
  OperateEvidenceRegistryV2,
  OperateEvidenceScopeBindingV2,
} from './evidence-registry-v2.mjs';

export * from './evidence-registry-v2.mjs';

export interface OperateEvidenceUnavailableDispatchV2 {
  readonly status: 'unavailable';
  readonly provider: OperateEvidenceProviderRegistrationV2;
  readonly resolver: OperateEvidenceResolverRegistrationV2;
  readonly error: {
    readonly code: 'EVIDENCE_RESOLVER_UNAVAILABLE';
    readonly retryable: true;
    readonly context: Readonly<Record<string, string>>;
  };
}

export interface OperateEvidenceByteCaptureV2 {
  readonly contentBase64: string;
  readonly rawHash: string;
  readonly sizeBytes: number;
  readonly classification: 'public' | 'internal' | 'confidential' | 'restricted';
  readonly freshness: 'current' | 'historical' | 'stale';
  readonly locator: OperatingEvidenceCandidateV2['locator'];
  readonly provenance: Readonly<Record<string, string>>;
}

export interface OperateEvidenceArtifactReferenceV2 {
  readonly artifactId: string;
  readonly artifactType: string;
  readonly schemaId: string;
  readonly artifactSchemaVersion: string;
  readonly rawHash: string;
  readonly canonicalHash: string | null;
  readonly sizeBytes: number;
  readonly storageClass: 'machine-local';
  readonly sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  readonly retentionClass: string;
  readonly classification: 'public' | 'internal' | 'confidential' | 'restricted';
  readonly freshness: 'historical';
  readonly locator: OperatingEvidenceCandidateV2['locator'];
  readonly provenance: Readonly<Record<string, string>>;
}

export type OperateEvidenceCaptureV2 =
  | OperateEvidenceByteCaptureV2
  | OperateEvidenceArtifactReferenceV2;

export type OperateEvidenceStaticResolutionV2 =
  | {
      readonly status: 'resolved';
      readonly provider: OperateEvidenceProviderRegistrationV2;
      readonly resolver: OperateEvidenceResolverRegistrationV2;
      readonly error: null;
      readonly capture: OperateEvidenceCaptureV2;
    }
  | {
      readonly status: 'rejected';
      readonly provider: OperateEvidenceProviderRegistrationV2 | null;
      readonly resolver: OperateEvidenceResolverRegistrationV2 | null;
      readonly error: {
        readonly code: string;
        readonly retryable: false;
        readonly context: Readonly<Record<string, string>>;
      };
      readonly capture: null;
    };

export interface OperateGitEvidenceSourceV2 {
  readonly repositoryId: string;
  readonly rootPath: string;
  readonly maxBytes?: number;
  readonly classification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface OperateFilesystemEvidenceRootV2 {
  readonly sourceRootId: string;
  readonly rootPath: string;
  readonly maxBytes?: number;
  readonly classification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface OperatePlanrEvidenceArtifactV2 {
  readonly artifactId: string;
  readonly artifactType: string;
  readonly path: string;
  readonly contentHash: string;
  readonly classification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface OperatePlanrEvidenceProjectV2 {
  readonly projectId: string;
  readonly rootPath: string;
  readonly scope: OperateEvidenceScopeBindingV2;
  readonly artifacts: readonly OperatePlanrEvidenceArtifactV2[];
  readonly maxBytes?: number;
  readonly classification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface OperateAcceptedArtifactEvidenceSourceV2 {
  readonly accepted: true;
  readonly artifact: import('@openplanr/protocol').OperatingArtifactV2;
  readonly access: { readonly requiredCapabilities: readonly string[] };
}

export interface OperateStaticEvidenceResolverContextV2 {
  readonly capabilities?: readonly string[];
  readonly gitRepositories?: readonly OperateGitEvidenceSourceV2[];
  readonly filesystemRoots?: readonly OperateFilesystemEvidenceRootV2[];
  readonly planrProjects?: readonly OperatePlanrEvidenceProjectV2[];
  readonly operateArtifacts?: readonly OperateAcceptedArtifactEvidenceSourceV2[];
  readonly sources?: {
    readonly git?: readonly OperateGitEvidenceSourceV2[];
    readonly filesystem?: readonly OperateFilesystemEvidenceRootV2[];
    readonly planr?: readonly OperatePlanrEvidenceProjectV2[];
    readonly 'operate-artifact'?: readonly OperateAcceptedArtifactEvidenceSourceV2[];
  };
}

export function dispatchOperateEvidenceResolverV2(
  registry: OperateEvidenceRegistryV2,
  candidate: OperatingEvidenceCandidateV2,
  context: { scope: OperateEvidenceScopeBindingV2 } & OperateStaticEvidenceResolverContextV2,
):
  | OperateEvidenceDispatchPreparationV2
  | OperateEvidenceUnavailableDispatchV2
  | OperateEvidenceStaticResolutionV2;

export function resolveLocalGitEvidenceV2(
  candidate: OperatingEvidenceCandidateV2,
  context: OperateStaticEvidenceResolverContextV2 & {
    provider: OperateEvidenceProviderRegistrationV2;
    resolver: OperateEvidenceResolverRegistrationV2;
  },
): OperateEvidenceStaticResolutionV2;

export function resolveLocalFilesystemEvidenceV2(
  candidate: OperatingEvidenceCandidateV2,
  context: OperateStaticEvidenceResolverContextV2 & {
    provider: OperateEvidenceProviderRegistrationV2;
    resolver: OperateEvidenceResolverRegistrationV2;
  },
): OperateEvidenceStaticResolutionV2;

export function resolveLocalPlanrEvidenceV2(
  candidate: OperatingEvidenceCandidateV2,
  context: OperateStaticEvidenceResolverContextV2 & {
    provider: OperateEvidenceProviderRegistrationV2;
    resolver: OperateEvidenceResolverRegistrationV2;
  },
): OperateEvidenceStaticResolutionV2;

export function resolveLocalOperateArtifactEvidenceV2(
  candidate: OperatingEvidenceCandidateV2,
  context: OperateStaticEvidenceResolverContextV2 & {
    provider: OperateEvidenceProviderRegistrationV2;
    resolver: OperateEvidenceResolverRegistrationV2;
  },
): OperateEvidenceStaticResolutionV2;
