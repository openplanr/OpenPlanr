import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../../utils/logger.js';
import { promptCheckbox, promptConfirm, promptMultiText, promptSecret, promptSelect, promptText, } from '../../prompt-service.js';
import { probeGitUserName, probePipelineInstalled } from './answer-service.js';
import { applyOperatingInitAnswer, evaluateOperatingInitQuestions, } from './question-engine.js';
import { repeatedTextRenderability } from './question-registry.js';
const execFileAsync = promisify(execFile);
async function commandAvailable(command) {
    return execFileAsync('sh', ['-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command]).then(() => true, () => false);
}
export async function detectOperatingQuestionContext(projectRoot) {
    const [gitUserName, claude, codex, cursor] = await Promise.all([
        probeGitUserName(projectRoot),
        commandAvailable('claude'),
        commandAvailable('codex'),
        commandAvailable('cursor'),
    ]);
    return {
        projectRoot,
        ...(gitUserName ? { gitUserName } : {}),
        detectedRuntime: claude ? 'claude' : codex ? 'codex' : cursor ? 'cursor' : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        pipelineInstalled: probePipelineInstalled(),
        runtime: 'terminal',
        interaction: 'terminal',
    };
}
/**
 * Map a multi-select question's choices to terminal checkbox items, pre-checking
 * a choice when it is either in the proposed/suggested value or carries the
 * additive `preselected: true` schema flag (planr-pipeline >= 0.34.0). Exported so
 * the preselected-to-checked mapping is directly testable.
 */
export function operatingCheckboxChoices(question, proposed) {
    const suggested = new Set(Array.isArray(proposed) ? proposed : []);
    return (question.choices ?? []).map((choice) => ({
        name: choice.description ? `${choice.label} — ${choice.description}` : choice.label,
        value: choice.id,
        checked: suggested.has(choice.id) || choice.preselected === true,
    }));
}
function proposedValue(question) {
    return question.valueSemantics === 'suggestion'
        ? question.suggestedValue
        : question.valueSemantics === 'default'
            ? question.defaultValue
            : undefined;
}
async function promptQuestion(question) {
    logger.dim(question.explanation);
    let proposed = proposedValue(question);
    if (question.valueSemantics === 'suggestion' &&
        typeof question.suggestedValue === 'string' &&
        ['text', 'path'].includes(question.type)) {
        if (question.suggestionReason)
            logger.dim(question.suggestionReason);
        const disposition = await promptSelect(`Review draft for ${question.label}`, [
            { name: 'Accept this cited draft', value: 'accept' },
            { name: 'Replace it with my own answer', value: 'replace' },
            { name: 'Skip this draft and answer without it', value: 'skip' },
        ], 'accept');
        if (disposition === 'accept')
            return question.suggestedValue;
        proposed = undefined;
    }
    switch (question.type) {
        case 'informational':
            logger.dim(question.label);
            return undefined;
        case 'single-select': {
            const preselected = (question.choices ?? []).find((choice) => choice.preselected === true)?.id;
            return promptSelect(question.label, (question.choices ?? []).map((choice) => ({
                name: choice.description ? `${choice.label} — ${choice.description}` : choice.label,
                value: choice.id,
            })), (typeof proposed === 'string' ? proposed : undefined) ?? preselected);
        }
        case 'multi-select':
            return promptCheckbox(question.label, operatingCheckboxChoices(question, proposed));
        case 'confirmation':
            return promptConfirm(question.label, typeof proposed === 'boolean' ? proposed : false);
        case 'repeated-text': {
            // Present each entry with the question's renderability contract (item noun
            // and example) so the terminal prompt matches what a native runtime shows,
            // instead of an unlabelled comma-separated field.
            const renderability = repeatedTextRenderability(question.questionId) ??
                (question.itemLabel
                    ? { itemLabel: question.itemLabel, itemPlaceholder: question.itemPlaceholder ?? '' }
                    : undefined);
            const hint = renderability
                ? `comma-separated ${renderability.itemLabel.toLowerCase()}${renderability.itemPlaceholder ? `; e.g. ${renderability.itemPlaceholder}` : ''}`
                : 'comma-separated';
            return promptMultiText(question.label, hint);
        }
        case 'secret':
            return promptSecret(question.label);
        case 'path':
        case 'text':
            return promptText(question.label, typeof proposed === 'string' ? proposed : undefined);
    }
}
export async function renderOperatingInitQuestions(input) {
    logger.heading('OpenPlanr Operating Board');
    logger.dim('Configure one product workspace. Component repositories remain read-only.');
    let answers = structuredClone(input.initialAnswers ?? {});
    for (;;) {
        const state = await evaluateOperatingInitQuestions({
            answers,
            context: input.context,
            requireCharter: true,
        });
        answers = state.answers;
        if (state.status === 'preview-ready')
            return answers;
        logger.heading(state.stage === 'foundation' ? 'Foundation' : 'Product charter');
        for (const question of state.questions) {
            const value = await promptQuestion(question);
            if (value === undefined)
                continue;
            answers = applyOperatingInitAnswer(answers, input.context, question.questionId, value);
        }
    }
}
//# sourceMappingURL=terminal-renderer.js.map