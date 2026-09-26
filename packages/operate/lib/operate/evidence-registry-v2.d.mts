import type {
  OperateEvidenceProviderRegistrationV2,
  OperateEvidenceResolverRegistrationV2,
  OperatingEvidenceCandidateV2,
} from '@openplanr/protocol';

export interface OperateEvidenceScopeBindingV2 {
  scopeId: string;
  domainId: string;
  domainVersion: string;
}

export interface OperateEvidenceRegistryV2 {
  readonly protocolVersion: '2.0.0';
  readonly providers: readonly OperateEvidenceProviderRegistrationV2[];
  readonly resolvers: readonly OperateEvidenceResolverRegistrationV2[];
}

export type OperateEvidenceDispatchPreparationV2 =
  | {
      readonly status: 'authorized';
      readonly provider: OperateEvidenceProviderRegistrationV2;
      readonly resolver: OperateEvidenceResolverRegistrationV2;
      readonly error: null;
    }
  | {
      readonly status: 'rejected';
      readonly provider: null;
      readonly resolver: null;
      readonly error: {
        readonly code: string;
        readonly retryable: false;
        readonly context: Readonly<Record<string, string>>;
      };
    };

export class OperatingEvidenceRegistryErrorV2 extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export const BUILT_IN_EVIDENCE_PROVIDER_IDS_V2: readonly string[];
export const BUILT_IN_EVIDENCE_RESOLVER_IDS_V2: readonly string[];
export const OPEN_REFERENCE_EVIDENCE_PROVIDERS_V2: readonly OperateEvidenceProviderRegistrationV2[];
export const OPEN_REFERENCE_EVIDENCE_RESOLVERS_V2: readonly OperateEvidenceResolverRegistrationV2[];
export const OPEN_REFERENCE_EVIDENCE_REGISTRY_V2: OperateEvidenceRegistryV2;

export function createOperateEvidenceRegistryV2(input?: {
  providers?: readonly OperateEvidenceProviderRegistrationV2[];
  resolvers?: readonly OperateEvidenceResolverRegistrationV2[];
}): OperateEvidenceRegistryV2;
export function findOperateEvidenceProviderRegistrationV2(
  registry: OperateEvidenceRegistryV2,
  providerId: string,
  options: { providerVersion: string },
): OperateEvidenceProviderRegistrationV2 | null;
export function findOperateEvidenceResolverRegistrationV2(
  registry: OperateEvidenceRegistryV2,
  resolverId: string,
  options: { resolverVersion: string },
): OperateEvidenceResolverRegistrationV2 | null;
export function prepareOperateEvidenceDispatchV2(
  registry: OperateEvidenceRegistryV2,
  candidate: OperatingEvidenceCandidateV2,
  context: { scope: OperateEvidenceScopeBindingV2; capabilities?: readonly string[] },
): OperateEvidenceDispatchPreparationV2;
