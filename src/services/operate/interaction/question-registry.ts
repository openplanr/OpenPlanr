import type { GuidedQuestion, GuidedQuestionValue, OperatingInitAnswers } from '../types.js';

export type OperatingInitStage = 'foundation' | 'product-charter' | 'review';

export interface OperatingQuestionContext {
  gitUserName?: string;
  detectedRuntime?: 'claude' | 'codex' | 'cursor';
  timezone: string;
  availableSources: string[];
}

export interface OperatingInitQuestionDefinition {
  stage: OperatingInitStage;
  question: GuidedQuestion;
  read(answers: OperatingInitAnswers): GuidedQuestionValue | undefined;
  write(answers: OperatingInitAnswers, value: GuidedQuestionValue): OperatingInitAnswers;
}

const question = (
  questionId: string,
  type: GuidedQuestion['type'],
  label: string,
  explanation: string,
  options: Partial<GuidedQuestion> = {},
): GuidedQuestion => ({
  kind: 'guided-question',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  questionId,
  questionVersion: '1.0.0',
  type,
  label,
  explanation,
  required: false,
  sensitivity: 'internal',
  persistence: 'session',
  valueSemantics: 'none',
  ...options,
});

function scalar<K extends keyof OperatingInitAnswers>(
  stage: OperatingInitStage,
  key: K,
  definition: GuidedQuestion,
): OperatingInitQuestionDefinition {
  return {
    stage,
    question: definition,
    read: (answers) => answers[key] as GuidedQuestionValue | undefined,
    write: (answers, value) => ({ ...answers, [key]: value }),
  };
}

function list<K extends 'sources' | 'evidenceFiles' | 'componentRoots'>(
  stage: OperatingInitStage,
  key: K,
  definition: GuidedQuestion,
): OperatingInitQuestionDefinition {
  return {
    stage,
    question: definition,
    read: (answers) => answers[key],
    write: (answers, value) => ({
      ...answers,
      [key]: Array.isArray(value) ? value : [String(value)],
    }),
  };
}

function charter(
  key: keyof NonNullable<OperatingInitAnswers['charter']>,
  definition: GuidedQuestion,
): OperatingInitQuestionDefinition {
  return {
    stage: 'product-charter',
    question: definition,
    read: (answers) => answers.charter?.[key] as GuidedQuestionValue | undefined,
    write: (answers, value) => ({
      ...answers,
      charter: {
        ...answers.charter,
        [key]: value,
      },
    }),
  };
}

export function operatingInitQuestionRegistry(
  context: OperatingQuestionContext,
): readonly OperatingInitQuestionDefinition[] {
  const sourceSuggestion = context.availableSources.filter((source) =>
    ['repository', 'planr', 'git'].includes(source),
  );
  return [
    scalar(
      'foundation',
      'profile',
      question(
        'profile',
        'single-select',
        'Operating profile',
        'The profile selects bounded advisory lenses, evidence budgets, and attention caps.',
        {
          required: true,
          valueSemantics: 'default',
          defaultValue: 'saas',
          defaultReason: 'SaaS is the balanced first-use profile.',
          choices: [
            {
              id: 'saas',
              label: 'SaaS',
              description: 'Balanced product, growth, risk, and operations.',
            },
            { id: 'product', label: 'Product', description: 'Activation and customer outcomes.' },
            {
              id: 'engineering',
              label: 'Engineering',
              description: 'Delivery, reliability, and risk.',
            },
            {
              id: 'custom',
              label: 'Custom',
              description: 'A validated project-contained profile file.',
            },
          ],
        },
      ),
    ),
    scalar(
      'foundation',
      'profileFile',
      question(
        'profile-file',
        'path',
        'Validated custom profile file',
        'Custom profiles must be bounded JSON files contained by the product workspace.',
        {
          required: true,
          validation: { minLength: 1, maxLength: 4096 },
          visibleWhen: [{ questionId: 'profile', operator: 'equals', value: 'custom' }],
        },
      ),
    ),
    scalar(
      'foundation',
      'decisionOwner',
      question(
        'decision-owner',
        'text',
        'Who owns final operating decisions?',
        'This human is the final authority for governance decisions; advisors cannot supply this answer.',
        {
          required: true,
          validation: { minLength: 1, maxLength: 160 },
          ...(context.gitUserName
            ? {
                valueSemantics: 'suggestion' as const,
                suggestedValue: context.gitUserName,
                suggestionReason:
                  'Suggested from the configured Git user name; confirm or replace it.',
              }
            : {}),
        },
      ),
    ),
    scalar(
      'foundation',
      'planningEngine',
      question(
        'planning-engine',
        'single-select',
        'Which engine creates accepted DEV specs?',
        'This selects the planning handoff only; it never authorizes PLAN or SHIP.',
        {
          required: true,
          choices: [
            { id: 'openplanr', label: 'OpenPlanr', description: 'Dedicated planning CLI.' },
            {
              id: 'pipeline-po',
              label: 'Pipeline PO',
              description: 'Feature-local planning through an explicit native PLAN handoff.',
            },
          ],
        },
      ),
    ),
    scalar(
      'foundation',
      'runtime',
      question(
        'runtime',
        'single-select',
        'Preferred coding runtime',
        'The runtime presents questions and dispatches advisors; it receives no additional authority.',
        {
          required: true,
          ...(context.detectedRuntime
            ? {
                valueSemantics: 'suggestion' as const,
                suggestedValue: context.detectedRuntime,
                suggestionReason: 'Suggested from a detected compatible runtime.',
              }
            : {
                valueSemantics: 'default' as const,
                defaultValue: 'auto',
                defaultReason:
                  'Auto preserves runtime routing until a compatible runtime is selected.',
              }),
          choices: [
            { id: 'auto', label: 'Auto-detect' },
            { id: 'claude', label: 'Claude Code' },
            { id: 'codex', label: 'Codex' },
            { id: 'cursor', label: 'Cursor' },
          ],
        },
      ),
    ),
    scalar(
      'foundation',
      'cadence',
      question(
        'cadence',
        'single-select',
        'Operating cadence',
        'Cadence controls display and reminders only; cycles still start only when requested.',
        {
          required: true,
          valueSemantics: 'default',
          defaultValue: 'manual',
          defaultReason: 'Manual cadence avoids implying background or scheduled execution.',
          choices: [
            { id: 'manual', label: 'Manual' },
            { id: 'weekly', label: 'Weekly' },
            { id: 'monthly', label: 'Monthly' },
          ],
        },
      ),
    ),
    scalar(
      'foundation',
      'timezone',
      question(
        'timezone',
        'text',
        'Display timezone (IANA)',
        'Persisted timestamps remain UTC; this IANA zone controls human-readable display.',
        {
          required: true,
          valueSemantics: 'suggestion',
          suggestedValue: context.timezone,
          suggestionReason: 'Suggested from the current environment.',
          validation: { minLength: 1, maxLength: 128 },
        },
      ),
    ),
    scalar(
      'foundation',
      'sensitivityCeiling',
      question(
        'sensitivity-ceiling',
        'single-select',
        'Highest evidence class allowed',
        'Evidence above this ceiling is excluded before collection or provider use.',
        {
          required: true,
          valueSemantics: 'default',
          defaultValue: 'internal',
          defaultReason:
            'Internal permits normal project evidence without allowing restricted material.',
          choices: [
            { id: 'public', label: 'Public only' },
            { id: 'internal', label: 'Internal' },
            { id: 'confidential', label: 'Confidential' },
            { id: 'restricted', label: 'Restricted' },
          ],
        },
      ),
    ),
    list(
      'foundation',
      'sources',
      question(
        'sources',
        'multi-select',
        'Evidence sources',
        'Sources are collected read-only. Unavailable integrations must be configured or left disabled.',
        {
          required: true,
          valueSemantics: 'suggestion',
          suggestedValue: sourceSuggestion,
          suggestionReason: 'Suggested from locally available provider capabilities.',
          validation: { minItems: 1, maxItems: 6 },
          choices: [
            { id: 'repository', label: 'Repository files and metadata' },
            { id: 'planr', label: 'OpenPlanr planning and delivery records' },
            { id: 'git', label: 'Git history and working-tree metadata' },
            { id: 'github', label: 'GitHub (read-only)' },
            { id: 'linear', label: 'Linear (read-only)' },
            { id: 'file-import', label: 'Local JSON/CSV files' },
          ],
        },
      ),
    ),
    list(
      'foundation',
      'evidenceFiles',
      question(
        'evidence-files',
        'repeated-text',
        'Workspace-contained JSON/CSV evidence paths',
        'Every import is resolved beneath a configured workspace component before collection.',
        {
          required: true,
          validation: { minItems: 1, maxItems: 50 },
          visibleWhen: [{ questionId: 'sources', operator: 'contains', value: 'file-import' }],
        },
      ),
    ),
    list(
      'foundation',
      'componentRoots',
      question(
        'component-roots',
        'repeated-text',
        'Read-only component repository paths',
        'The current repository remains the control repository; additional component roots are evidence-only.',
        { validation: { maxItems: 50 } },
      ),
    ),
    charter(
      'purpose',
      question(
        'purpose',
        'text',
        'What product outcome does this workspace exist to create?',
        'Purpose anchors advisor relevance and does not authorize any route.',
        { required: true, validation: { minLength: 1, maxLength: 1000 } },
      ),
    ),
    charter(
      'stage',
      question(
        'product-stage',
        'text',
        'Current product stage',
        'Stage calibrates evidence expectations and recommendation confidence.',
        { required: true, validation: { minLength: 1, maxLength: 256 } },
      ),
    ),
    charter(
      'businessModel',
      question(
        'business-model',
        'text',
        'Business model',
        'Commercial facts must come from the decision owner and are never inferred from source code.',
        { required: true, validation: { minLength: 1, maxLength: 512 } },
      ),
    ),
    charter(
      'idealCustomer',
      question(
        'ideal-customer',
        'text',
        'Ideal customer profile',
        'Customer claims are governance context and are never guessed by advisors.',
        { required: true, validation: { minLength: 1, maxLength: 1000 } },
      ),
    ),
    charter(
      'goals',
      question(
        'goals',
        'repeated-text',
        'Current goals',
        'Goals bound the operating cycle to outcomes the owner explicitly chose.',
        { required: true, validation: { minItems: 1, maxItems: 50 } },
      ),
    ),
    charter(
      'successMetrics',
      question(
        'success-metrics',
        'repeated-text',
        'Success metrics',
        'Metrics need explicit units and observation meaning before they can support an outcome.',
        { required: true, validation: { minItems: 1, maxItems: 50 } },
      ),
    ),
    charter(
      'guardrails',
      question(
        'guardrails',
        'repeated-text',
        'Human authority and product guardrails',
        'Guardrails define what advisors and routes must not do without new human authority.',
        { required: true, validation: { minItems: 1, maxItems: 50 } },
      ),
    ),
    charter(
      'knownUnknowns',
      question(
        'known-unknowns',
        'repeated-text',
        'Known unknowns',
        'Uncertainty is recorded as a gap instead of being filled with generic model advice.',
        { required: true, validation: { minItems: 1, maxItems: 50 } },
      ),
    ),
    {
      stage: 'review',
      question: question(
        'review-boundary',
        'informational',
        'Review exact writes before initialization',
        'Review is write-free. Applying this preview initializes only the Operating Board and never starts a cycle, calls a provider, invokes PLAN, or invokes SHIP.',
        { persistence: 'none' },
      ),
      read: () => undefined,
      write: (answers) => answers,
    },
  ];
}
