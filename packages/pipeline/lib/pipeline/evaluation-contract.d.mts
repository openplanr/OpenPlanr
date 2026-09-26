export type EvaluationPromptClass = 'positive' | 'negative' | 'ambiguous' | 'permission-denied';
export type EvaluationTriggerOutcome = 'invoke' | 'decline' | 'clarify' | 'refuse';
export type EvaluationRiskClass = 'read-only' | 'local-write' | 'destructive' | 'external-effect';
export type EvaluationCapability =
  | 'file-read'
  | 'file-write'
  | 'command-execute'
  | 'network'
  | 'browser'
  | 'credential'
  | 'git'
  | 'publish'
  | 'deploy';
export type EvaluationGraderType =
  | 'deterministic-schema'
  | 'deterministic-behaviour'
  | 'live-model-judgement';
export type EvaluationAbsenceCode =
  | 'grader-missing'
  | 'grader-errored'
  | 'grader-unavailable'
  | 'host-unavailable'
  | 'fixture-unavailable'
  | 'budget-exceeded'
  | 'not-run';
export type EvaluationMetric =
  | 'trigger-precision'
  | 'trigger-recall'
  | 'journey-completion'
  | 'schema-validity'
  | 'asset-parity'
  | 'export-parity'
  | 'package-parity'
  | 'finding-severity-p0'
  | 'finding-severity-p1'
  | 'latency-regression'
  | 'cost-regression';
export type EvaluationUnwaivableMetric =
  | 'schema-validity'
  | 'package-parity'
  | 'finding-severity-p0'
  | 'finding-severity-p1';
export type EvaluationWaivableMetric = Exclude<EvaluationMetric, EvaluationUnwaivableMetric>;
export type EvaluationWaiverReasonCode =
  | 'accepted-risk'
  | 'known-defect'
  | 'environment-limitation'
  | 'deferred-remediation'
  | 'external-dependency';

export interface EvaluationGateThreshold {
  comparator: '>=' | '<=' | '==';
  unit: 'basis-points' | 'count';
  threshold: number;
  waivable: boolean;
  measuredAgainst?: 'frozen-baseline';
}
export interface EvaluationGraderSubject {
  skillId: string;
  skillSourceDigest: string;
}
export interface EvaluationObservationSubject {
  registration: Record<string, unknown>;
  skill: EvaluationGraderSubject;
}

export declare const EVALUATION_PROTOCOL_VERSION: '1.4.0';
export declare const EVALUATION_SCHEMA_VERSION: '1.0.0';
export declare const EVALUATION_PROMPT_CLASSES: readonly EvaluationPromptClass[];
export declare const EVALUATION_TRIGGER_OUTCOMES: readonly EvaluationTriggerOutcome[];
export declare const EVALUATION_RISK_CLASSES: readonly EvaluationRiskClass[];
export declare const EVALUATION_CAPABILITIES: readonly EvaluationCapability[];
export declare const EVALUATION_EFFECTFUL_CAPABILITIES: readonly EvaluationCapability[];
export declare const EVALUATION_GRADER_TYPES: readonly EvaluationGraderType[];
export declare const EVALUATION_ABSENCE_CODES: readonly EvaluationAbsenceCode[];
export declare const EVALUATION_METRICS: readonly EvaluationMetric[];
export declare const EVALUATION_UNWAIVABLE_METRICS: readonly EvaluationUnwaivableMetric[];
export declare const EVALUATION_WAIVABLE_METRICS: readonly EvaluationWaivableMetric[];
export declare const EVALUATION_WAIVER_REASON_CODES: readonly EvaluationWaiverReasonCode[];
export declare const EVALUATION_WAIVER_MAX_HORIZON_DAYS: 90;
export declare const EVALUATION_GATE_THRESHOLDS: Readonly<
  Record<EvaluationMetric, Readonly<EvaluationGateThreshold>>
>;

export declare function assertEvaluationScenario<T>(value: T, label?: string): T;
export declare function assertEvaluationCorpus<T>(
  value: T,
  options?: { sourceDigests?: Record<string, string> | null; label?: string },
): T;
export declare function assertEvaluationFixture<T>(value: T, label?: string): T;
export declare function assertEvaluationHostProfile<T>(value: T, label?: string): T;
export declare function assertEvaluationHostProfileRegistry<T>(value: T, label?: string): T;
export declare function assertEvaluationGraderRegistration<T>(value: T, label?: string): T;
export declare function assertEvaluationGraderRegistry<T>(value: T, label?: string): T;
export declare function assertEvaluationGraderIndependence<T>(
  registration: T,
  subject: EvaluationGraderSubject,
  label?: string,
): T;
export declare function assertEvaluationBudget<T>(value: T, label?: string): T;
export declare function assertEvaluationGatePolicy<T>(value: T, label?: string): T;
export declare function assertEvaluationObservation<T>(
  value: T,
  options?: { subject?: EvaluationObservationSubject | null; label?: string },
): T;
export declare function assertEvaluationRunResult<T>(value: T, label?: string): T;
export declare function assertEvaluationAggregateReport<T>(value: T, label?: string): T;
export declare function assertEvaluationWaiver<T>(value: T, label?: string): T;
export declare function assertEvaluationWaiverApplicable<T>(
  waiver: T,
  options: {
    now: string;
    gatePolicyDigest?: string | null;
    scenarioDigest?: string | null;
    label?: string;
  },
): T;
export declare function assertSkillCertificationReceipt<T>(
  value: T,
  options?: { aggregateReport?: unknown; now?: string | null; label?: string },
): T;
