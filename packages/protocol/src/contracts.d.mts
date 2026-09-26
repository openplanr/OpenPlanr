export interface ResolvedProtocolSchema {
  kind: string;
  protocolVersion: string;
  path: string;
  schema: Record<string, unknown>;
}
export interface ProtocolValidationError {
  path: string;
  rule: string;
  detail: string;
}
export declare const PROTOCOL_SCHEMA_REGISTRY: Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
export declare const OPERATE_EXPERIENCE_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATING_DELIVERY_ROUTES_V1: readonly string[];
export declare const OPERATE_ROLE_MANDATES_V2: readonly Readonly<Record<string, unknown>>[];
export declare const OPERATE_EXTENSION_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_EVIDENCE_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_EVIDENCE_KINDS_V2: readonly string[];
export declare const OPERATE_EVIDENCE_EDGE_RELATIONS_V2: readonly string[];
export declare const OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2: readonly string[];
export declare const OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_OPERATING_PROJECTION_IDENTITIES_V2: readonly string[];
export declare const OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2: readonly string[];
export declare const OPERATE_GOVERNED_EFFECT_CLASSES_V2: readonly string[];
export declare const OPERATE_GOVERNED_POLICY_OUTCOMES_V2: readonly string[];
export declare const OPERATE_GOVERNED_POLICY_TIERS_V2: readonly string[];
export declare const OPERATE_GOVERNED_CORE_PROHIBITIONS_V2: readonly Readonly<
  Record<string, unknown>
>[];
export declare const OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2: readonly string[];
export declare const OPERATE_GOVERNED_OPERATION_STATES_V2: readonly string[];
export declare const OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2: readonly string[];
export declare const OPERATE_EXECUTION_VERIFICATION_STATUSES_V2: readonly string[];
export declare const OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2: readonly string[];
export declare const OPERATE_GOVERNED_TOOL_OPERATIONS_V2: readonly string[];
export declare const OPERATE_AUTHORITY_GUARD_IDS_V2: readonly string[];
export declare const OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2: Readonly<Record<string, unknown>>;
export declare function findOperateCoreProhibitionV2(
  values: unknown,
): Readonly<Record<string, unknown>> | null;
export declare function assertOperateIntelligencePlanContractV2<T>(value: T): T;
export declare function loadOperateRoleMandateV2(
  roleId: string,
  options?: { roleVersion?: string },
): Readonly<Record<string, unknown>>;
export declare function assertOperateRoleOutputContractV2<T>(
  roleId: string,
  outputContract: T,
  options?: { roleVersion?: string },
): T;
export declare function listProtocolSchemas(): Array<{
  kind: string;
  protocolVersion: string;
  path: string;
}>;
export declare function resolveProtocolSchema(
  kind: string,
  options?: { protocolVersion?: string },
): ResolvedProtocolSchema;
export declare function resolveOperateExperienceSchemaV2(
  kind: string,
  options?: { protocolVersion?: string },
): ResolvedProtocolSchema;
export declare function validateProtocolArtifact(
  kind: string,
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export declare function validateDashboardBootstrapV1(value: unknown): ProtocolValidationError[];
export declare function assertDashboardBootstrapV1<T>(value: T): T;
export declare function validateOperateExperienceArtifactV2(
  kind: string,
  value: unknown,
): ProtocolValidationError[];
export declare function assertOperateExperienceArtifactV2<T>(kind: string, value: T): T;
export declare function assertProtocolArtifact<T>(
  kind: string,
  value: T,
  options?: { protocolVersion?: string },
): T;
export declare function assertOperateGovernedExtensionRegistrationV2<T>(kind: string, value: T): T;
