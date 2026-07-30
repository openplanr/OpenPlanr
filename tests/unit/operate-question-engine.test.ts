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
  availableSources: ['repository', 'planr', 'git', 'file-import'],
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
  sources: ['repository', 'planr', 'git'],
  componentRoots: [],
};

const charter: OperatingInitAnswers['charter'] = {
  purpose: 'Help product teams make cited operating decisions.',
  stage: 'Growth',
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
    expect(result.questions.map((question) => question.questionId)).toContain('component-roots');
  });

  it('advances through Foundation, Product charter, and Review without inferring governance', async () => {
    const product = await evaluateOperatingInitQuestions({
      answers: foundation,
      context,
    });
    expect(product).toMatchObject({ status: 'input-required', stage: 'product-charter' });
    if (product.status !== 'input-required') return;
    expect(product.questions.map((question) => question.questionId)).toEqual([
      'purpose',
      'product-stage',
      'business-model',
      'ideal-customer',
      'goals',
      'success-metrics',
      'guardrails',
      'known-unknowns',
    ]);

    const review = await evaluateOperatingInitQuestions({
      answers: { ...foundation, charter },
      context,
    });
    expect(review).toMatchObject({ status: 'preview-ready', stage: 'review' });
    expect(review.answers).toEqual({ ...foundation, charter });
    expect(review.questions[0]?.questionId).toBe('review-boundary');
  });

  it('enforces conditional profile/import fields, source readiness, paths, and IANA timezones', async () => {
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
        answers: { ...foundation, sources: ['github'] },
        context,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_QUESTIONNAIRE_INVALID' });
    await expect(
      evaluateOperatingInitQuestions({
        answers: { ...foundation, timezone: 'Not/A_Zone' },
        context,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_QUESTIONNAIRE_INVALID' });
    await expect(
      evaluateOperatingInitQuestions({
        answers: {
          ...foundation,
          sources: ['file-import'],
          evidenceFiles: ['../outside.json'],
        },
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
      ['timezone', 'Europe/Istanbul'],
      ['sensitivity-ceiling', 'internal'],
      ['sources', ['repository', 'planr', 'git']],
    ] as const) {
      terminal = applyOperatingInitAnswer(terminal, context, questionId, value);
    }
    const machine = operatingInitAnswersFromOptions({
      profile: 'saas',
      decisionOwner: 'Asem',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'Europe/Istanbul',
      sensitivityCeiling: 'internal',
      sources: ['repository', 'planr', 'git'],
    });
    expect(mergeOperatingInitAnswersIntoOptions({}, terminal)).toEqual(
      mergeOperatingInitAnswersIntoOptions({}, machine),
    );
  });

  it('does not persist Commander empty repeatable defaults as guided answers', () => {
    expect(
      operatingInitAnswersFromOptions({
        source: [],
        component: [],
        evidenceFile: [],
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
});
