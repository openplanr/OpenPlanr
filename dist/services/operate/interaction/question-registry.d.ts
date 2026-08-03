import type { GuidedQuestion, GuidedQuestionValue, OperatingInitAnswers } from '../types.js';
export type OperatingInitStage = 'foundation' | 'product-charter' | 'review';
export interface OperatingQuestionContext {
    gitUserName?: string;
    detectedRuntime?: 'claude' | 'codex' | 'cursor';
    /**
     * The adapter/host runtime carried by the questionnaire. On the create path
     * this equals the detected coding runtime; on the resume path it is rehydrated
     * from the persisted `session.adapter.runtime`. It lets the registry recover
     * the effective detected runtime so detect-don't-ask stays byte-identical
     * across create and resume even though only `runtime` is persisted.
     */
    runtime?: string;
    timezone: string;
    /**
     * Whether a compatible planr-pipeline is resolvable. When true the
     * `planning-engine` question detects `pipeline-po` as its suggested handoff.
     */
    pipelineInstalled?: boolean;
    /**
     * The `id` of an existing `.planr/operate-profile.json`, when one is already
     * present in the project. When set, the profile question surfaces it as the
     * suggested answer (detect-don't-ask) so the common "I already picked a
     * profile" correction never has to be typed again on re-init.
     */
    existingProfileId?: OperatingInitAnswers['profile'];
}
/**
 * The presentation metadata for a `repeated-text` question, or `undefined` when
 * the question id has none. Single source of truth shared by the questionnaire
 * decorator and the terminal renderer.
 */
export declare function repeatedTextRenderability(questionId: string): {
    itemLabel: string;
    itemPlaceholder: string;
} | undefined;
export interface OperatingInitQuestionDefinition {
    stage: OperatingInitStage;
    question: GuidedQuestion;
    read(answers: OperatingInitAnswers): GuidedQuestionValue | undefined;
    write(answers: OperatingInitAnswers, value: GuidedQuestionValue): OperatingInitAnswers;
}
export declare function operatingInitQuestionRegistry(context: OperatingQuestionContext): readonly OperatingInitQuestionDefinition[];
//# sourceMappingURL=question-registry.d.ts.map