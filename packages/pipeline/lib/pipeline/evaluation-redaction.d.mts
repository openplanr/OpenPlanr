export type EvaluationRedactionDeclaration =
  | 'absolutePathsExcluded' | 'credentialMaterialExcluded' | 'modelOutputExcluded'
  | 'rawPromptsExcluded' | 'screenshotsExcluded' | 'tracesExcluded';

export declare const EVALUATION_REDACTION_POLICY_VERSION: '1.0.0';
export declare const EVALUATION_PUBLISH_FORBIDDEN_KEYS: readonly string[];
export declare const EVALUATION_REDACTION_DECLARATIONS: readonly EvaluationRedactionDeclaration[];

export declare function evaluationCarriesPrivateMaterial(text: unknown): boolean;
export declare function assertEvaluationNoPrivateMaterial<T extends string>(text: T, label: string): T;
export declare function assertEvaluationPublishSafe<T>(value: T, label?: string): T;
export declare function assertEvaluationRedactionDeclaration<T>(value: T, label?: string): T;
export declare function assertEvaluationAggregatePublishable<T>(report: T, label?: string): T;
