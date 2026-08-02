import { type GuidedAnswer, type GuidedAnswerEnvelope, type GuidedSession, type OperatingInitAnswers } from '../types.js';
import { createOperatingInitQuestionnaire, type OperatingQuestionEngineContext } from './question-engine.js';
import { type GuidedSessionBindings } from './session-service.js';
/**
 * The configured Git user name, used as the `decision-owner` suggestion. Shared
 * so the JSON/native init path and the terminal path make the same probe.
 */
export declare function probeGitUserName(projectRoot: string): Promise<string | undefined>;
/** Whether a compatible planr-pipeline is resolvable (drives planning-engine detection). */
export declare function probePipelineInstalled(): boolean;
export interface GuidedSessionProgress {
    session: GuidedSession;
    questionnaire: Awaited<ReturnType<typeof createOperatingInitQuestionnaire>>;
    answers: OperatingInitAnswers;
    status: 'input-required' | 'preview-ready';
}
export declare function persistableOperatingInitAnswers(answers: OperatingInitAnswers, context: OperatingQuestionEngineContext): GuidedAnswer[];
export declare function parseGuidedAnswerEnvelope(raw: string): Promise<GuidedAnswerEnvelope>;
export declare function resumeGuidedSession(input: {
    projectRoot: string;
    sessionId: string;
    bindings: GuidedSessionBindings;
    localRoot?: string;
    now?: Date;
}): Promise<GuidedSessionProgress>;
export declare function submitGuidedAnswers(input: {
    projectRoot: string;
    sessionId: string;
    raw: string;
    bindings: GuidedSessionBindings;
    localRoot?: string;
    now?: Date;
}): Promise<GuidedSessionProgress>;
export declare function persistReplayReceipt(input: {
    projectRoot: string;
    sessionId: string;
    envelope: GuidedAnswerEnvelope;
    localRoot?: string;
}): Promise<void>;
//# sourceMappingURL=answer-service.d.ts.map