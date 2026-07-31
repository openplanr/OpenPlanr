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
  availableSources: string[];
  /**
   * Whether a compatible planr-pipeline is resolvable. When true the
   * `planning-engine` question detects `pipeline-po` as its suggested handoff.
   */
  pipelineInstalled?: boolean;
}

/** Coding runtimes that a detected/persisted `runtime` can name. */
const KNOWN_CODING_RUNTIMES = ['claude', 'codex', 'cursor'] as const;

/**
 * The Operating Board's standing boundaries, seeded as suggested `guardrails`
 * items so onboarding starts from the invariants the engine already enforces
 * (mirroring the review-boundary explanation and the charter guardrails
 * placeholder) rather than a blank field. The decision owner confirms, edits, or
 * extends them.
 */
const STANDING_GUARDRAILS: readonly string[] = [
  'No external or irreversible action without explicit human authority.',
  'Advisors never start a cycle, call a provider, invoke PLAN, or invoke SHIP automatically.',
  'Commercial and customer facts come from the decision owner, never inferred from source code.',
];

/**
 * Locally collectable evidence sources offered during onboarding. Remote
 * integrations (github/linear) are intentionally absent: they require
 * credentials that cannot be configured in this flow, so offering them would let
 * a chosen source hard-fail availability validation. They return once configurable
 * in-flow. Every offered choice is gated by `availableSources`, so an offered
 * source is always submittable.
 */
const EVIDENCE_SOURCE_CATALOG: readonly { id: string; label: string }[] = [
  { id: 'repository', label: 'Repository files and metadata' },
  { id: 'planr', label: 'OpenPlanr planning and delivery records' },
  { id: 'git', label: 'Git history and working-tree metadata' },
  { id: 'file-import', label: 'Local JSON/CSV files' },
];

const PRODUCT_STAGE_CHOICES: readonly { id: string; label: string; description: string }[] = [
  { id: 'idea', label: 'Idea', description: 'Exploring a problem before a committed build.' },
  { id: 'prototype', label: 'Prototype', description: 'Building toward a first usable release.' },
  { id: 'launched', label: 'Launched', description: 'Live with early adopters and initial usage.' },
  { id: 'growth', label: 'Growth', description: 'Scaling adoption against validated outcomes.' },
  { id: 'mature', label: 'Mature', description: 'Established product in steady-state operation.' },
];

/**
 * The effective detected coding runtime. Prefers the persisted adapter `runtime`
 * when it names a known coding runtime (the value that survives create -> resume),
 * and falls back to the explicit `detectedRuntime` (used by the terminal path,
 * whose `runtime` is the `terminal` surface). Keying off the persisted `runtime`
 * keeps the runtime question's detect-don't-ask shape byte-identical between the
 * create context and the resume context, so a session created inside a detected
 * host still validates its own answer envelope on resume.
 */
function effectiveDetectedRuntime(
  context: OperatingQuestionContext,
): 'claude' | 'codex' | 'cursor' | undefined {
  return (
    KNOWN_CODING_RUNTIMES.find((runtime) => runtime === context.runtime) ?? context.detectedRuntime
  );
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
  // Offer only sources the host actually probed as available, and carry per-choice
  // `preselected` (additive guided-question schema field, planr-pipeline >= 0.34.0)
  // so a native surface can pre-check the same sources named by `suggestedValue`.
  const sourceChoices: { id: string; label: string; preselected?: boolean }[] =
    EVIDENCE_SOURCE_CATALOG.filter((choice) => context.availableSources.includes(choice.id)).map(
      (choice) => ({
        id: choice.id,
        label: choice.label,
        ...(sourceSuggestion.includes(choice.id) ? { preselected: true } : {}),
      }),
    );
  const detectedRuntime = effectiveDetectedRuntime(context);
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
        'Which planning engine turns accepted work into DEV specs?',
        'This records the planning handoff only; it never authorizes PLAN or SHIP, which always stay explicit human actions.',
        {
          required: true,
          // Detect-don't-ask: when a compatible planr-pipeline is installed, the
          // feature-local Pipeline PO handoff is the reachable default, so it is
          // surfaced as a suggestion the owner can confirm or replace.
          ...(context.pipelineInstalled
            ? {
                valueSemantics: 'suggestion' as const,
                suggestedValue: 'pipeline-po',
                suggestionReason:
                  'Suggested because a compatible planr-pipeline is installed; confirm or choose OpenPlanr.',
              }
            : {}),
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
          // Detect-don't-ask: a clearly detected runtime is surfaced as a
          // suggestion only and never a required blocker; the question is
          // required (asked) only when the runtime is ambiguous. Schema shape is
          // unchanged — only whether/how it is surfaced as required.
          required: !detectedRuntime,
          ...(detectedRuntime
            ? {
                valueSemantics: 'suggestion' as const,
                suggestedValue: detectedRuntime,
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
          // Demoted out of the blocking first-run batch: cadence keeps its default
          // (used silently downstream) but is no longer a required question, so it
          // is not asked unless the owner opts to change it via a flag.
          required: false,
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
    // The display timezone is derived silently from the environment (see
    // index.ts / answer-service interaction context and prepareOperatingInitialization)
    // and is no longer asked: it was write-only onboarding friction with no consumer
    // that the environment cannot already supply.
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
        'Sources are collected read-only. Only sources this host verified as available are offered.',
        {
          required: true,
          valueSemantics: 'suggestion',
          suggestedValue: sourceSuggestion,
          suggestionReason: 'Suggested from locally available provider capabilities.',
          validation: { minItems: 1, maxItems: 6 },
          choices: sourceChoices,
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
        'single-select',
        'Current product stage',
        'Stage calibrates evidence expectations and recommendation confidence.',
        { required: true, choices: [...PRODUCT_STAGE_CHOICES] },
      ),
    ),
    charter(
      'businessModel',
      question(
        'business-model',
        'text',
        'Business model',
        'Commercial facts must come from the decision owner and are never inferred from source code.',
        {
          required: true,
          // Deferral default: the owner can accept "Not yet specified" to record the
          // charter without stating commercials yet, instead of guessing them.
          valueSemantics: 'default',
          defaultValue: 'Not yet specified',
          defaultReason: 'Commercial facts can be deferred; advisors never invent them.',
          validation: { minLength: 1, maxLength: 512 },
        },
      ),
    ),
    charter(
      'idealCustomer',
      question(
        'ideal-customer',
        'text',
        'Ideal customer profile',
        'Customer claims are governance context and are never guessed by advisors.',
        {
          required: true,
          // Deferral default: an owner without a stated ICP can accept "Not yet
          // specified" rather than have one inferred.
          valueSemantics: 'default',
          defaultValue: 'Not yet specified',
          defaultReason: 'The ideal customer can be deferred; advisors never guess it.',
          validation: { minLength: 1, maxLength: 1000 },
        },
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
        {
          required: true,
          // Seed the engine's standing boundaries as a suggestion so onboarding
          // starts from the invariants already enforced; the owner edits or extends.
          valueSemantics: 'suggestion',
          suggestedValue: [...STANDING_GUARDRAILS],
          suggestionReason: "Seeded from the Operating Board's standing boundaries.",
          validation: { minItems: 1, maxItems: 50 },
        },
      ),
    ),
    charter(
      'knownUnknowns',
      question(
        'known-unknowns',
        'repeated-text',
        'Known unknowns',
        'Uncertainty is recorded as a gap instead of being filled with generic model advice.',
        // Optional: recording unknowns is encouraged but never blocks reaching the
        // write-free preview.
        { required: false, validation: { minItems: 1, maxItems: 50 } },
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
