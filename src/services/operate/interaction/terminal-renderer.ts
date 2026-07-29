import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../../utils/logger.js';
import {
  promptCheckbox,
  promptConfirm,
  promptMultiText,
  promptSecret,
  promptSelect,
  promptText,
} from '../../prompt-service.js';
import type { GuidedQuestion, GuidedQuestionValue, OperatingInitAnswers } from '../types.js';
import {
  applyOperatingInitAnswer,
  evaluateOperatingInitQuestions,
  type OperatingQuestionEngineContext,
} from './question-engine.js';

const execFileAsync = promisify(execFile);

async function commandAvailable(command: string): Promise<boolean> {
  return execFileAsync('sh', ['-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command]).then(
    () => true,
    () => false,
  );
}

export async function detectOperatingQuestionContext(
  projectRoot: string,
): Promise<OperatingQuestionEngineContext> {
  const [gitUserName, claude, codex, cursor] = await Promise.all([
    execFileAsync('git', ['config', 'user.name'], { cwd: projectRoot })
      .then(({ stdout }) => stdout.trim() || undefined)
      .catch(() => undefined),
    commandAvailable('claude'),
    commandAvailable('codex'),
    commandAvailable('cursor'),
  ]);
  return {
    projectRoot,
    gitUserName,
    detectedRuntime: claude ? 'claude' : codex ? 'codex' : cursor ? 'cursor' : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    availableSources: ['repository', 'planr', 'git', 'file-import'],
    runtime: 'terminal',
    interaction: 'terminal',
  };
}

function proposedValue(question: GuidedQuestion): GuidedQuestionValue | undefined {
  return question.valueSemantics === 'suggestion'
    ? question.suggestedValue
    : question.valueSemantics === 'default'
      ? question.defaultValue
      : undefined;
}

async function promptQuestion(question: GuidedQuestion): Promise<GuidedQuestionValue | undefined> {
  logger.dim(question.explanation);
  let proposed = proposedValue(question);
  if (
    question.valueSemantics === 'suggestion' &&
    typeof question.suggestedValue === 'string' &&
    ['text', 'path'].includes(question.type)
  ) {
    if (question.suggestionReason) logger.dim(question.suggestionReason);
    const disposition = await promptSelect(
      `Review draft for ${question.label}`,
      [
        { name: 'Accept this cited draft', value: 'accept' },
        { name: 'Replace it with my own answer', value: 'replace' },
        { name: 'Skip this draft and answer without it', value: 'skip' },
      ],
      'accept',
    );
    if (disposition === 'accept') return question.suggestedValue;
    proposed = undefined;
  }
  switch (question.type) {
    case 'informational':
      logger.dim(question.label);
      return undefined;
    case 'single-select':
      return promptSelect(
        question.label,
        (question.choices ?? []).map((choice) => ({
          name: choice.description ? `${choice.label} — ${choice.description}` : choice.label,
          value: choice.id,
        })),
        typeof proposed === 'string' ? proposed : undefined,
      );
    case 'multi-select': {
      const checked = new Set(Array.isArray(proposed) ? proposed : []);
      return promptCheckbox(
        question.label,
        (question.choices ?? []).map((choice) => ({
          name: choice.description ? `${choice.label} — ${choice.description}` : choice.label,
          value: choice.id,
          checked: checked.has(choice.id),
        })),
      );
    }
    case 'confirmation':
      return promptConfirm(question.label, typeof proposed === 'boolean' ? proposed : false);
    case 'repeated-text':
      return promptMultiText(question.label, 'comma-separated');
    case 'secret':
      return promptSecret(question.label);
    case 'path':
    case 'text':
      return promptText(question.label, typeof proposed === 'string' ? proposed : undefined);
  }
}

export async function renderOperatingInitQuestions(input: {
  initialAnswers?: OperatingInitAnswers;
  context: OperatingQuestionEngineContext;
}): Promise<OperatingInitAnswers> {
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
    if (state.status === 'preview-ready') return answers;
    logger.heading(state.stage === 'foundation' ? 'Foundation' : 'Product charter');
    for (const question of state.questions) {
      const value = await promptQuestion(question);
      if (value === undefined) continue;
      answers = applyOperatingInitAnswer(answers, input.context, question.questionId, value);
    }
  }
}
