import { describe, expect, it } from 'vitest';
import {
  applyOperatingInitAnswer,
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
  mergeOperatingInitAnswersIntoOptions,
  operatingInitAnswersFromOptions,
} from '../../src/services/operate/interaction/question-engine.js';
import type { OperatingInitAnswers } from '../../src/services/operate/types.js';

const context = {
  projectRoot: process.cwd(),
  gitUserName: 'Asem',
  detectedRuntime: 'codex' as const,
  timezone: 'Europe/Istanbul',
  runtime: 'codex',
  interaction: 'native' as const,
  now: '2026-07-29T12:00:00.000Z',
};

const foundation: OperatingInitAnswers = {
  profile: 'saas',
  decisionOwner: 'Asem',
  planningEngine: 'openplanr',
  runtime: 'codex',
  cadence: 'manual',
  timezone: 'Europe/Istanbul',
  sensitivityCeiling: 'internal',
  componentRoots: [],
};

const charter: OperatingInitAnswers['charter'] = {
  purpose: 'Help product teams make cited operating decisions.',
  stage: 'growth',
  businessModel: 'Subscription SaaS',
  idealCustomer: 'Technical founders',
  goals: ['Reach a trustworthy operating brief quickly'],
  successMetrics: ['Time to first brief under five minutes'],
  guardrails: ['No external effects without explicit approval'],
  knownUnknowns: ['Provider availability'],
};

describe('Operating Board question engine', () => {
  it('keeps authority as an unaccepted suggestion and exposes canonical foundation questions', async () => {
    const result = await evaluateOperatingInitQuestions({ context });
    expect(result.status).toBe('input-required');
    if (result.status !== 'input-required') return;
    expect(result.stage).toBe('foundation');
    const owner = result.questions.find((question) => question.questionId === 'decision-owner');
    expect(owner).toMatchObject({
      suggestedValue: 'Asem',
      valueSemantics: 'suggestion',
      required: true,
    });
    expect(result.answers.decisionOwner).toBeUndefined();
    // Dieted first-run batch: only required-missing plus explicitly flagged
    // (suggestion-bearing) questions ship. The detected runtime is a suggestion,
    // so it is surfaced; cadence (defaulted), component-roots (optional), and the
    // removed timezone question are not dumped into the batch.
    const foundationIds = result.questions.map((question) => question.questionId);
    expect(foundationIds).toEqual(
      expect.arrayContaining([
        'profile',
        'decision-owner',
        'planning-engine',
        'sensitivity-ceiling',
        'runtime',
      ]),
    );
    expect(foundationIds).not.toContain('cadence');
    expect(foundationIds).not.toContain('component-roots');
    expect(foundationIds).not.toContain('timezone');
  });

  it('reaches preview-ready with cadence and component-roots unanswered', async () => {
    const answers: OperatingInitAnswers = {
      profile: 'saas',
      decisionOwner: 'Asem',
      planningEngine: 'openplanr',
      sensitivityCeiling: 'internal',
      // cadence, componentRoots, runtime (detected), and known-unknowns are
      // intentionally omitted — none of them block reaching the write-free preview.
      charter: {
        purpose: 'Help product teams make cited operating decisions.',
        stage: 'growth',
        businessModel: 'Subscription SaaS',
        idealCustomer: 'Technical founders',
        goals: ['Reach a trustworthy operating brief quickly'],
        successMetrics: ['Time to first brief under five minutes'],
        guardrails: ['No external effects without explicit approval'],
      },
    };
    const result = await evaluateOperatingInitQuestions({ answers, context });
    expect(result).toMatchObject({ status: 'preview-ready', stage: 'review' });
  });

  it('advances through Foundation, Product charter, and Review without inferring governance', async () => {
    const product = await evaluateOperatingInitQuestions({
      answers: foundation,
      context,
    });
    expect(product).toMatchObject({ status: 'input-required', stage: 'product-charter' });
    if (product.status !== 'input-required') return;
    // known-unknowns is now optional and no longer part of the required batch.
    expect(product.questions.map((question) => question.questionId)).toEqual([
      'purpose',
      'product-stage',
      'business-model',
      'ideal-customer',
      'goals',
      'success-metrics',
      'guardrails',
    ]);

    const review = await evaluateOperatingInitQuestions({
      answers: { ...foundation, charter },
      context,
    });
    expect(review).toMatchObject({ status: 'preview-ready', stage: 'review' });
    expect(review.answers).toEqual({ ...foundation, charter });
    expect(review.questions[0]?.questionId).toBe('review-boundary');
  });

  it('enforces conditional profile fields and IANA timezones', async () => {
    const custom = await evaluateOperatingInitQuestions({
      answers: { ...foundation, profile: 'custom', profileFile: undefined },
      context,
    });
    expect(custom.status).toBe('input-required');
    if (custom.status === 'input-required') {
      expect(custom.questions.map((question) => question.questionId)).toContain('profile-file');
    }

    await expect(
      evaluateOperatingInitQuestions({
        answers: { ...foundation, timezone: 'Not/A_Zone' },
        context,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_QUESTIONNAIRE_INVALID' });
  });

  it('normalizes terminal and machine answers into byte-equivalent option data', () => {
    let terminal: OperatingInitAnswers = {};
    for (const [questionId, value] of [
      ['profile', 'saas'],
      ['decision-owner', 'Asem'],
      ['planning-engine', 'openplanr'],
      ['runtime', 'codex'],
      ['cadence', 'manual'],
      ['sensitivity-ceiling', 'internal'],
    ] as const) {
      terminal = applyOperatingInitAnswer(terminal, context, questionId, value);
    }
    const machine = operatingInitAnswersFromOptions({
      profile: 'saas',
      decisionOwner: 'Asem',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      sensitivityCeiling: 'internal',
    });
    expect(mergeOperatingInitAnswersIntoOptions({}, terminal)).toEqual(
      mergeOperatingInitAnswersIntoOptions({}, machine),
    );
  });

  it('does not persist Commander empty repeatable defaults as guided answers', () => {
    expect(
      operatingInitAnswersFromOptions({
        component: [],
        goal: [],
        successMetric: [],
        guardrail: [],
        knownUnknown: [],
      }),
    ).toEqual({});
  });

  it('emits a deterministic Protocol-valid questionnaire for a fixed context', async () => {
    const state = await evaluateOperatingInitQuestions({ context });
    if (state.status !== 'input-required') throw new Error('Expected foundation questions.');
    const first = await createOperatingInitQuestionnaire({
      context,
      questions: state.questions,
      stage: state.stage,
    });
    const second = await createOperatingInitQuestionnaire({
      context,
      questions: state.questions,
      stage: state.stage,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: 'guided-questionnaire',
      schemaVersion: '1.1.0',
      protocolVersion: '1.2.0',
      stage: 'foundation',
      step: 1,
      totalSteps: 3,
      submission: {
        kind: 'guided-answer-submission',
        transport: {
          kind: 'stdin-json',
          maxBytes: 65536,
          argv: ['planr', 'operate', 'init', '--resume', first.sessionId, '--stdin', '--json'],
        },
        envelope: {
          fixedFields: {
            sessionId: first.sessionId,
            adapter: first.adapter,
          },
        },
      },
    });
    expect(first.submission.envelope.dynamicFields.answers.items).toEqual(
      first.questions
        .filter((question) => question.type !== 'informational')
        .map((question) => ({
          questionId: question.questionId,
          questionVersion: question.questionVersion,
          sensitivity: question.sensitivity,
          required: question.required,
          valueType:
            question.type === 'confirmation'
              ? 'boolean'
              : ['multi-select', 'repeated-text'].includes(question.type)
                ? 'string-array'
                : 'string',
        })),
    );
    expect(first.submission.envelope.dynamicFields.answers.copyFields).toEqual([
      'questionId',
      'questionVersion',
      'sensitivity',
    ]);
  });

  it('advertises --answers-file as a stdin-parity transport alternate with its exact argv', async () => {
    const state = await evaluateOperatingInitQuestions({ context });
    if (state.status !== 'input-required') throw new Error('Expected foundation questions.');
    const questionnaire = await createOperatingInitQuestionnaire({
      context,
      questions: state.questions,
      stage: state.stage,
    });
    // The stdin transport is unchanged; the file transport rides alongside it so a
    // contract-conformant runtime can discover it instead of assuming stdin only.
    expect(questionnaire.submission.transport.kind).toBe('stdin-json');
    const alternate = questionnaire.submission.transport.alternates?.find(
      (entry) => entry.kind === 'answers-file',
    );
    expect(alternate).toMatchObject({
      kind: 'answers-file',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 65536,
      argv: [
        'planr',
        'operate',
        'init',
        '--resume',
        questionnaire.sessionId,
        '--answers-file',
        '<path>',
        '--json',
      ],
    });
  });

  it('carries repeated-text renderability metadata sufficient to present without improvisation', async () => {
    // Reach the product-charter stage, where goals/success-metrics/guardrails are
    // repeated-text questions that a runtime must be able to lay out.
    const state = await evaluateOperatingInitQuestions({ answers: foundation, context });
    if (state.status !== 'input-required' || state.stage !== 'product-charter') {
      throw new Error('Expected product-charter questions.');
    }
    const questionnaire = await createOperatingInitQuestionnaire({
      context,
      questions: state.questions,
      stage: state.stage,
    });
    const goals = questionnaire.questions.find((question) => question.questionId === 'goals');
    expect(goals?.type).toBe('repeated-text');
    expect(goals).toMatchObject({
      itemLabel: expect.any(String),
      itemPlaceholder: expect.any(String),
    });
    // Every repeated-text question the questionnaire ships carries the metadata.
    for (const question of questionnaire.questions.filter((q) => q.type === 'repeated-text')) {
      expect(typeof question.itemLabel).toBe('string');
      expect(typeof question.itemPlaceholder).toBe('string');
    }
    // Select questions declare their renderability through `choices` (documented
    // contract); no repeated-text renderability leaks onto them.
    const productStage = questionnaire.questions.find(
      (question) => question.questionId === 'product-stage',
    );
    expect(productStage?.type).toBe('single-select');
    expect(Array.isArray(productStage?.choices)).toBe(true);
    expect(productStage).not.toHaveProperty('itemLabel');
  });
});
