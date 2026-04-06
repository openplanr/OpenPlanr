import { z } from 'zod';

export const targetCLISchema = z.enum(['cursor', 'claude', 'codex']);
export const aiProviderSchema = z.enum(['anthropic', 'openai', 'ollama']);
export const codingAgentSchema = z.enum(['claude', 'cursor', 'codex']);

export const aiConfigSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
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
});

export type ValidatedConfig = z.infer<typeof configSchema>;
