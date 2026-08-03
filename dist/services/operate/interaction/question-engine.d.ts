import { type GuidedQuestion, type GuidedQuestionnaire, type GuidedQuestionValue, type OperatingInitAnswers } from '../types.js';
import { type OperatingQuestionContext } from './question-registry.js';
export interface OperatingQuestionEngineContext extends OperatingQuestionContext {
    projectRoot: string;
    projectIdentity?: `sha256:${string}`;
    runtime?: string;
    interaction?: 'native' | 'chat' | 'terminal' | 'none';
    projectHead?: `sha256:${string}`;
    configHead?: `sha256:${string}`;
    now?: string;
}
export type OperatingQuestionEngineResult = {
    status: 'input-required';
    stage: 'foundation' | 'product-charter';
    answers: OperatingInitAnswers;
    questions: GuidedQuestion[];
} | {
    status: 'preview-ready';
    stage: 'review';
    answers: OperatingInitAnswers;
    questions: GuidedQuestion[];
};
export declare function operatingInitAnswersFromOptions(options: Record<string, unknown>): OperatingInitAnswers;
export declare function mergeOperatingInitAnswersIntoOptions(options: Record<string, unknown>, answers: OperatingInitAnswers): Record<string, unknown>;
export declare function evaluateOperatingInitQuestions(input: {
    answers?: OperatingInitAnswers;
    context: OperatingQuestionEngineContext;
    requireCharter?: boolean;
}): Promise<OperatingQuestionEngineResult>;
export declare function applyOperatingInitAnswer(answers: OperatingInitAnswers, context: OperatingQuestionContext, questionId: string, value: GuidedQuestionValue): OperatingInitAnswers;
export declare function createOperatingInitQuestionnaire(input: {
    context: OperatingQuestionEngineContext;
    questions: GuidedQuestion[];
    stage: 'foundation' | 'product-charter' | 'review';
    sessionId?: string;
    createdAt?: string;
    expiresAt?: string;
}): Promise<GuidedQuestionnaire>;
//# sourceMappingURL=question-engine.d.ts.map