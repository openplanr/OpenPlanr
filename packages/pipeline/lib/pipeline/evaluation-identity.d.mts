export type EvaluationContractKind =
  | 'evaluation-scenario'
  | 'evaluation-corpus'
  | 'evaluation-fixture'
  | 'evaluation-host-profile'
  | 'evaluation-host-profile-registry'
  | 'evaluation-grader-registration'
  | 'evaluation-grader-registry'
  | 'evaluation-budget'
  | 'evaluation-gate-policy'
  | 'evaluation-observation'
  | 'evaluation-run-result'
  | 'evaluation-aggregate-report'
  | 'evaluation-waiver'
  | 'skill-certification-receipt';

export interface EvaluationIdentityBinding {
  prefix: string;
  width: 32 | 64;
  idField: string;
  digestField: string;
}
export type EvaluationEvidenceInput =
  | 'budgetDigest'
  | 'fixtureSetDigest'
  | 'graderRegistrationDigest'
  | 'hostProfileDigest'
  | 'packageDigest'
  | 'scenarioDigest'
  | 'sourceDigest';
export type EvaluationEvidenceInvalidationReason = 'input-digest-changed' | 'scenario-absent';
export interface EvaluationEvidenceBinding {
  scenarioId: string;
  inputs: Record<EvaluationEvidenceInput, string>;
}
export interface EvaluationEvidenceInvalidation {
  scenarioId: string;
  reason: EvaluationEvidenceInvalidationReason;
  changedInputs: readonly EvaluationEvidenceInput[];
}
export interface EvaluationEvidenceReuse {
  reusable: readonly string[];
  invalidated: readonly EvaluationEvidenceInvalidation[];
  unevaluated: readonly string[];
}
export interface EvaluationDerivedIdentity {
  id: string;
  digest: string;
  idField: string;
  digestField: string;
}
export interface EvaluationScenarioIdentity {
  scenarioId: string;
  scenarioDigest: string;
  record: Record<string, unknown>;
}

export declare const EVALUATION_IDENTITY_BINDINGS: Readonly<
  Record<EvaluationContractKind, Readonly<EvaluationIdentityBinding>>
>;
export declare const EVALUATION_EVIDENCE_INPUTS: readonly EvaluationEvidenceInput[];
export declare const EVALUATION_EVIDENCE_INVALIDATION_REASONS: readonly EvaluationEvidenceInvalidationReason[];

export declare function evaluationContentDigest(
  bytes: string | ArrayBuffer | ArrayBufferView,
): string;
export declare function evaluationPayloadDigest(
  value: unknown,
  omitFields?: readonly string[],
): string;
export declare function evaluationSelfDigest(value: unknown, kind: EvaluationContractKind): string;
export declare function evaluationIdentityFrom(
  digest: string,
  kind: EvaluationContractKind,
): string;
export declare function deriveEvaluationIdentity(
  value: unknown,
  kind: EvaluationContractKind,
): Readonly<EvaluationDerivedIdentity>;
export declare function assertEvaluationIdentity<T>(value: T, kind: EvaluationContractKind): T;
export declare function assertUniqueJsonKeys(text: string, label?: string): string;
export declare function evaluationScenarioIdentityFromSource(
  sourceText: string,
  label?: string,
): Readonly<EvaluationScenarioIdentity>;
export declare function evaluationEvidenceReuse(
  priorEvidence: readonly EvaluationEvidenceBinding[],
  currentInputs: readonly EvaluationEvidenceBinding[],
): Readonly<EvaluationEvidenceReuse>;
