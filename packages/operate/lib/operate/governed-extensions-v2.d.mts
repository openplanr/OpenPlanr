import type {
  OperateCapabilityProviderRegistrationV2,
  OperateExecutorRegistrationV2,
  OperateGovernedEffectClassV2,
  OperatePolicyProviderRegistrationV2,
  OperateTrustedExecutorBindingV2,
  OperateVersionedIdentityV2,
} from '@openplanr/protocol';

export interface OperateGovernedExtensionRegistryV2 {
  capabilityProviders: readonly OperateCapabilityProviderRegistrationV2[];
  policyProviders: readonly OperatePolicyProviderRegistrationV2[];
  executors: readonly OperateExecutorRegistrationV2[];
}

export interface OperateGovernedSelectionBaseV2 {
  protocolVersion: '2.0.0';
  runtimeVersion: string;
  now: string;
  domainId: string;
  actionKind: OperateVersionedIdentityV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
}
export interface OperateCapabilityProviderSelectionV2 extends OperateGovernedSelectionBaseV2 {
  providerId: string; providerVersion: string; capability: OperateVersionedIdentityV2; targetKind: string;
}
export interface OperatePolicyProviderSelectionV2 extends OperateGovernedSelectionBaseV2 {
  providerId: string; providerVersion: string; policyRef?: OperateVersionedIdentityV2;
}
export interface OperateExecutorSelectionV2 extends OperateGovernedSelectionBaseV2 {
  executorId: string; executorVersion: string; capability: OperateVersionedIdentityV2; targetKind: string; operationKind: 'execute' | 'rollback';
}
export type OperateGovernedSelectionResultV2<T> =
  | { readonly status: 'available'; readonly registration: Readonly<T>; readonly reasonCode: 'exact-registration-available'; readonly fallback: null }
  | { readonly status: 'unavailable'; readonly registration: Readonly<T> | null; readonly reasonCode: string; readonly fallback: { readonly kind: 'unavailable'; readonly errorCode: string } };

export interface OperateTrustedExecutorHostV2 {
  executorId: string;
  executorVersion: string;
  implementationId: string;
  connector: OperateVersionedIdentityV2;
  inspect(...args: unknown[]): unknown;
  execute(...args: unknown[]): unknown;
  rollback(...args: unknown[]): unknown;
  reconcile(...args: unknown[]): unknown;
}

export interface OperateContainedExecutorPayloadV2 {
  artifactId: string;
  contentHash: string;
  value: unknown;
}

export interface OperateContainedExecutorInputV2 {
  kind: 'operate-contained-executor-input';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  operation: import('@openplanr/protocol').OperatingGovernedOperationV2;
  payload: OperateContainedExecutorPayloadV2;
  rollbackBaseline: OperateContainedExecutorPayloadV2 | null;
  requestFingerprint: string;
  envelopeHash: string;
}

export const OPERATE_GOVERNED_EFFECT_RANK_V2: Readonly<Record<OperateGovernedEffectClassV2, number>>;
export class OperatingGovernedExtensionErrorV2 extends Error { code: string; context: Readonly<Record<string, unknown>>; }
export const OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2: OperateGovernedExtensionRegistryV2;
export const OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2: string;
export function createOperateGovernedExtensionRegistryV2(input?: Partial<OperateGovernedExtensionRegistryV2>): OperateGovernedExtensionRegistryV2;
export function canonicalizeOperateGovernedExtensionRegistryV2(registry: OperateGovernedExtensionRegistryV2): OperateGovernedExtensionRegistryV2;
export function findOperateCapabilityProviderRegistrationV2(registry: OperateGovernedExtensionRegistryV2, providerId: string, options: { providerVersion: string }): OperateCapabilityProviderRegistrationV2 | null;
export function findOperatePolicyProviderRegistrationV2(registry: OperateGovernedExtensionRegistryV2, providerId: string, options: { providerVersion: string }): OperatePolicyProviderRegistrationV2 | null;
export function findOperateExecutorRegistrationV2(registry: OperateGovernedExtensionRegistryV2, executorId: string, options: { executorVersion: string }): OperateExecutorRegistrationV2 | null;
export function selectOperateCapabilityProviderV2(registry: OperateGovernedExtensionRegistryV2, criteria: OperateCapabilityProviderSelectionV2): OperateGovernedSelectionResultV2<OperateCapabilityProviderRegistrationV2>;
export function selectOperatePolicyProviderV2(registry: OperateGovernedExtensionRegistryV2, criteria: OperatePolicyProviderSelectionV2): OperateGovernedSelectionResultV2<OperatePolicyProviderRegistrationV2>;
export function selectOperateExecutorV2(registry: OperateGovernedExtensionRegistryV2, criteria: OperateExecutorSelectionV2): OperateGovernedSelectionResultV2<OperateExecutorRegistrationV2>;
export function classifyOperateExecutorRecoveryCapabilityV2(executor: OperateExecutorRegistrationV2):
  'intrinsically-idempotent' | 'reconcile-before-redispatch' | 'uncertain-no-redispatch';
export function assertOperateExecutorRegistrationV2(executor: OperateExecutorRegistrationV2, options?: { registry?: OperateGovernedExtensionRegistryV2 }): Readonly<OperateExecutorRegistrationV2>;
export function createTrustedExecutorBindingV2(input: { selection: OperateGovernedSelectionResultV2<OperateExecutorRegistrationV2>; trustedHost: OperateTrustedExecutorHostV2 }): Readonly<OperateTrustedExecutorBindingV2>;
export function assertTrustedExecutorBindingV2(binding: OperateTrustedExecutorBindingV2, input: { executor: OperateExecutorRegistrationV2 }): Readonly<OperateTrustedExecutorBindingV2>;
export function deriveContainedExecutorRequestFingerprintV2(input: {
  operation: import('@openplanr/protocol').OperatingGovernedOperationV2;
  payload: OperateContainedExecutorPayloadV2;
  rollbackBaseline: OperateContainedExecutorPayloadV2 | null;
}): string;
export function deriveContainedExecutorRequestFingerprintFromBindingV2(input: {
  operation: import('@openplanr/protocol').OperatingGovernedOperationV2;
  payload: { artifactId: string; contentHash: string };
  rollbackBaseline: { artifactId: string; contentHash: string } | null;
}): string;
export function createContainedExecutorInputEnvelopeV2(input: {
  operation: import('@openplanr/protocol').OperatingGovernedOperationV2;
  payload: OperateContainedExecutorPayloadV2;
  rollbackBaseline?: OperateContainedExecutorPayloadV2 | null;
}): Readonly<OperateContainedExecutorInputV2>;
export function assertContainedExecutorInputEnvelopeV2(
  envelope: OperateContainedExecutorInputV2,
  input: { operation: import('@openplanr/protocol').OperatingGovernedOperationV2; rollbackPlan?: import('@openplanr/protocol').OperatingRollbackPlanV2 | null },
): Readonly<OperateContainedExecutorInputV2>;
