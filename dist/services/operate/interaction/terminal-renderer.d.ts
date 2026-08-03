import type { GuidedQuestion, GuidedQuestionValue, OperatingInitAnswers } from '../types.js';
import { type OperatingQuestionEngineContext } from './question-engine.js';
export declare function detectOperatingQuestionContext(projectRoot: string): Promise<OperatingQuestionEngineContext>;
/**
 * Map a multi-select question's choices to terminal checkbox items, pre-checking
 * a choice when it is either in the proposed/suggested value or carries the
 * additive `preselected: true` schema flag (planr-pipeline >= 0.34.0). Exported so
 * the preselected-to-checked mapping is directly testable.
 */
export declare function operatingCheckboxChoices(question: GuidedQuestion, proposed?: GuidedQuestionValue): Array<{
    name: string;
    value: string;
    checked: boolean;
}>;
export declare function renderOperatingInitQuestions(input: {
    initialAnswers?: OperatingInitAnswers;
    context: OperatingQuestionEngineContext;
}): Promise<OperatingInitAnswers>;
//# sourceMappingURL=terminal-renderer.d.ts.map