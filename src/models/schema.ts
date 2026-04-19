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
});

export type ValidatedConfig = z.infer<typeof configSchema>;
