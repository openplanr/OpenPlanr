import { z } from 'zod';

export const targetCLISchema = z.enum(['cursor', 'claude', 'codex']);
export const aiProviderSchema = z.enum(['anthropic', 'openai', 'ollama']);
export const codingAgentSchema = z.enum(['claude', 'cursor', 'codex']);

export const aiConfigSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
});

export const vaguePhraseRuleSchema = z.object({
  pattern: z.string(),
  alternatives: z.array(z.string()),
  hint: z.string().optional(),
});

export const reportLinterRuleConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  minEvidenceLinks: z.number().optional(),
  requireSections: z.array(z.string()).optional(),
});

export const reportLinterConfigSchema = z.object({
  rules: z.array(reportLinterRuleConfigSchema),
  vaguePhrases: z.array(vaguePhraseRuleSchema),
});

export const stakeholderReportsConfigSchema = z.object({
  orgName: z.string().optional(),
  logoUrl: z.string().optional(),
  accentColor: z.string().optional(),
  customSections: z.record(z.string(), z.string()).optional(),
});

export const distributionConfigSchema = z.object({
  slackWebhookUrl: z.string().optional(),
  slackChannel: z.string().optional(),
  emailFrom: z.string().optional(),
  emailSmtpHost: z.string().optional(),
  weeklyRecipientAllowlist: z.array(z.string()).optional(),
});

/**
 * UUIDv4 regex — Linear workflow state ids follow this form. `/i` is defensive
 * against case-normalizing tools (Linear's API emits lowercase canonically).
 */
const LINEAR_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persisted slice of LinearConfig — `planr linear init` writes `teamId` only; other fields are optional. */
export const linearConfigSchema = z.object({
  teamId: z.string().min(1),
  teamKey: z.string().optional(),
  defaultProjectLead: z.string().optional(),
  /**
   * Pull: Linear state name → OpenPlanr status; push legacy: `pending`|`in-progress`|`done` → state id uuid
   * (see `pushStateIds`; both may coexist in one object in older configs).
   */
  statusMap: z.record(z.string(), z.string()).optional(),
  /**
   * Push: OpenPlanr status name → Linear workflow state id (uuid). Validated here
   * so a typo in a UUID fails at config-load time with a clear pointer, not
   * mid-push with a confusing SDK error.
   */
  pushStateIds: z
    .record(
      z.string(),
      z
        .string()
        .regex(LINEAR_UUID_REGEX, 'linear.pushStateIds value must be a Linear workflow state UUID'),
    )
    .optional(),
  /**
   * Target Linear project for `QT-*` / `BL-*` pushes. Must be a valid
   * Linear project UUID — fails fast at config-load time so a typo never
   * reaches the API.
   */
  standaloneProjectId: z
    .string()
    .regex(LINEAR_UUID_REGEX, 'linear.standaloneProjectId must be a Linear project UUID')
    .optional(),
  standaloneProjectName: z.string().optional(),
  /** Pre-pick the mapping strategy to skip the first-push prompt. */
  defaultEpicStrategy: z.enum(['project', 'milestone-of', 'label-on']).optional(),
  /** Override the auto-applied type-label names. Any missing key falls back to the default. */
  typeLabels: z
    .object({
      feature: z.string().min(1).optional(),
      story: z.string().min(1).optional(),
      task: z.string().min(1).optional(),
      quick: z.string().min(1).optional(),
      backlog: z.string().min(1).optional(),
    })
    .optional(),
});

export const configSchema = z.object({
  projectName: z.string().min(1),
  targets: z.array(targetCLISchema).min(1),
  outputPaths: z.object({
    agile: z.string().default('.planr'),
    cursorRules: z.string().default('.cursor/rules'),
    claudeConfig: z.string().default('.'),
    codexConfig: z.string().default('.'),
  }),
  idPrefix: z.object({
    epic: z.string().default('EPIC'),
    feature: z.string().default('FEAT'),
    story: z.string().default('US'),
    task: z.string().default('TASK'),
    quick: z.string().default('QT'),
    backlog: z.string().default('BL'),
    sprint: z.string().default('SPRINT'),
  }),
  ai: aiConfigSchema.optional(),
  defaultAgent: codingAgentSchema.optional(),
  templateOverrides: z.string().optional(),
  author: z.string().optional(),
  createdAt: z.string(),
  reports: stakeholderReportsConfigSchema.optional(),
  distribution: distributionConfigSchema.optional(),
  reportLinter: reportLinterConfigSchema.optional(),
  linear: linearConfigSchema.optional(),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
