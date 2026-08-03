import type { GuidedQuestionnaire } from './operate/types.js';
export interface PipelinePackage {
    root: string;
    version: string;
    binPath: string;
    adapterRegistryPath: string;
    roleRegistryPath: string;
}
export interface GuidedInteractionValidators {
    createGuidedAnswerSubmission(value: unknown): GuidedQuestionnaire['submission'];
    validateGuidedQuestion(value: unknown): unknown[];
    validateGuidedQuestionnaire(value: unknown): unknown[];
    validateGuidedAnswerEnvelope(value: unknown): unknown[];
    validateGuidedSession(value: unknown): unknown[];
    validateGuidedConfirmation(value: unknown): unknown[];
    validateStructuredAction(value: unknown): unknown[];
    validateEvidenceDiagnostic(value: unknown): unknown[];
}
export declare function resolvePipelinePackage(required?: boolean): PipelinePackage | null;
/**
 * Resolve the additive Protocol v1.2 guided-interaction validators without
 * making OpenPlanr depend on private pipeline source paths at compile time.
 */
export declare function resolveGuidedInteractionValidators(): Promise<GuidedInteractionValidators>;
//# sourceMappingURL=pipeline-package-service.d.ts.map