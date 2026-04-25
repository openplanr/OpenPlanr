/**
 * Zod schemas for validating AI JSON responses.
 *
 * These ensure the AI returned all required fields in the correct
 * format before we pass data to artifact creation.
 */

import { z } from 'zod';

// --- Epic ---

export const aiEpicResponseSchema = z.object({
  title: z.string().min(1),
  owner: z.string().min(1),
  businessValue: z.string().min(1),
  targetUsers: z.string().min(1),
  problemStatement: z.string().min(1),
  solutionOverview: z.string().min(1),
  successCriteria: z.union([
    z.array(z.string().min(1)).min(1),
    // Gracefully handle string format: split by semicolons
    z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
  ]),
  keyFeatures: z.array(z.string().min(1)).min(1),
  dependencies: z.string().default('None'),
  risks: z.string().default('None'),
});

export type AIEpicResponse = z.infer<typeof aiEpicResponseSchema>;

// --- Features ---

export const aiFeatureSchema = z.object({
  title: z.string().min(1),
  overview: z.string().min(1),
  functionalRequirements: z.array(z.string().min(1)).min(1),
  dependencies: z.string().default('None'),
  technicalConsiderations: z.string().default('None'),
  risks: z.string().default('None'),
  successMetrics: z.string().min(1),
});

export const aiFeaturesResponseSchema = z.object({
  features: z.array(aiFeatureSchema).min(1),
});

export type AIFeaturesResponse = z.infer<typeof aiFeaturesResponseSchema>;

// --- Stories ---

export const aiGherkinScenarioSchema = z.object({
  name: z.string().min(1),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});

export const aiStorySchema = z.object({
  title: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().min(1),
  benefit: z.string().min(1),
  additionalNotes: z.string().default(''),
  gherkinScenarios: z.array(aiGherkinScenarioSchema).min(1),
});

export const aiStoriesResponseSchema = z.object({
  stories: z.array(aiStorySchema).min(1),
});

export type AIStoriesResponse = z.infer<typeof aiStoriesResponseSchema>;

// --- Tasks ---

export const aiSubtaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

export const aiTaskGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtasks: z.array(aiSubtaskSchema).default([]),
});

export const aiACMappingSchema = z.object({
  criterion: z.string().min(1),
  sourceStoryId: z.string().min(1),
  taskIds: z.array(z.string().min(1)),
});

export const aiRelevantFileSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
  action: z.enum(['modify', 'create']).default('modify'),
});

export const aiTasksResponseSchema = z.object({
  title: z.string().min(1),
  tasks: z.array(aiTaskGroupSchema).min(1),
  acceptanceCriteriaMapping: z.array(aiACMappingSchema).default([]),
  relevantFiles: z.array(aiRelevantFileSchema).default([]),
});

export type AITasksResponse = z.infer<typeof aiTasksResponseSchema>;

// --- Quick Tasks (standalone, no acceptance criteria mapping) ---

export const aiQuickTasksResponseSchema = z.object({
  title: z.string().min(1),
  tasks: z.array(aiTaskGroupSchema).min(1),
  relevantFiles: z.array(aiRelevantFileSchema).default([]),
});

export type AIQuickTasksResponse = z.infer<typeof aiQuickTasksResponseSchema>;

// --- Estimate ---

const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13, 21] as const;

export const aiEstimateResponseSchema = z.object({
  storyPoints: z
    .number()
    .int()
    .refine((v) => (FIBONACCI_POINTS as readonly number[]).includes(v), {
      message: `Must be a Fibonacci number: ${FIBONACCI_POINTS.join(', ')}`,
    }),
  estimatedHours: z.number().positive(),
  complexity: z.enum(['low', 'medium', 'high']),
  riskFactors: z.array(z.string().min(1)).min(1).max(5),
  reasoning: z.string().min(1),
  assumptions: z.array(z.string().min(1)).default([]),
});

export type AIEstimateResponse = z.infer<typeof aiEstimateResponseSchema>;

// --- Backlog Prioritization ---

export const aiBacklogPrioritizedItemSchema = z.object({
  id: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  impactScore: z.number().int().min(1).max(10),
  effortScore: z.number().int().min(1).max(10),
  reasoning: z.string().min(1),
});

export const aiBacklogPrioritizeResponseSchema = z.object({
  items: z.array(aiBacklogPrioritizedItemSchema).min(1),
  summary: z.string().min(1),
});

export type AIBacklogPrioritizeResponse = z.infer<typeof aiBacklogPrioritizeResponseSchema>;

// --- Sprint Auto-Select ---

export const aiSprintAutoSelectResponseSchema = z.object({
  selectedTaskIds: z.array(z.string().min(1)).min(1),
  totalPoints: z.number().int().min(0),
  reasoning: z.string().min(1),
});

export type AISprintAutoSelectResponse = z.infer<typeof aiSprintAutoSelectResponseSchema>;

// --- Refine ---

export const aiRefineResponseSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1),
  improved: z.record(z.string(), z.unknown()),
  improvedMarkdown: z.string().min(1),
});

export type AIRefineResponse = z.infer<typeof aiRefineResponseSchema>;

// --- Revise ---

export const aiReviseActionSchema = z.enum(['revise', 'skip', 'flag']);

export const aiReviseEvidenceTypeSchema = z.enum([
  'file_exists',
  'file_absent',
  'grep_match',
  'sibling_artifact',
  'source_quote',
  'pattern_rule',
]);

export const aiReviseEvidenceSchema = z.object({
  type: aiReviseEvidenceTypeSchema,
  ref: z.string().min(1),
  quote: z.string().optional(),
});

export const aiReviseAmbiguitySchema = z.object({
  section: z.string().min(1),
  reason: z.string().min(1),
});

/**
 * Schema for a single revise agent decision.
 *
 * Action-specific invariants (enforced via `superRefine`):
 * - `revise` → non-empty `revisedMarkdown` AND at least one `evidence` entry
 * - `flag`   → at least one `ambiguous` entry (evidence encouraged but not required)
 * - `skip`   → no `revisedMarkdown`, no `ambiguous` entries
 *
 * The TS shape in `ReviseDecision` (src/models/types.ts) is the consumer-facing
 * view; this schema is what the AI response is validated against before it
 * reaches the post-flight verifier.
 */
export const aiReviseDecisionSchema = z
  .object({
    artifactId: z.string().min(1),
    action: aiReviseActionSchema,
    revisedMarkdown: z.string().optional(),
    rationale: z.string().min(1),
    evidence: z.array(aiReviseEvidenceSchema).default([]),
    ambiguous: z.array(aiReviseAmbiguitySchema).default([]),
  })
  .superRefine((decision, ctx) => {
    if (decision.action === 'revise') {
      if (!decision.revisedMarkdown || decision.revisedMarkdown.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: "action 'revise' requires non-empty revisedMarkdown",
          path: ['revisedMarkdown'],
        });
      }
      if (decision.evidence.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: "action 'revise' requires at least one evidence citation",
          path: ['evidence'],
        });
      }
    }
    if (decision.action === 'flag' && decision.ambiguous.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action 'flag' requires at least one ambiguity entry",
        path: ['ambiguous'],
      });
    }
    if (decision.action === 'skip') {
      if (decision.revisedMarkdown && decision.revisedMarkdown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: "action 'skip' must not include revisedMarkdown",
          path: ['revisedMarkdown'],
        });
      }
      if (decision.ambiguous.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: "action 'skip' must not include ambiguous entries",
          path: ['ambiguous'],
        });
      }
    }
  });

export type AIReviseDecisionResponse = z.infer<typeof aiReviseDecisionSchema>;

// --- Spec-driven decomposition ---
// Schemas for `planr spec decompose <SPEC-id>`. Output matches the
// openplanr-pipeline plugin's specification-agent contract: User Stories
// each containing 1-2 Tasks with explicit file Create/Modify/Preserve lists,
// Type=UI|Tech, agent assignment, and DoD-grade test requirements.

export const aiSpecTaskSchema = z.object({
  title: z.string().min(1),
  /**
   * Per docs/proposals/spec-driven-mode.md and openplanr-pipeline rule R2:
   * task-1 is UI when PNGs present, otherwise Tech. task-2 is always Tech
   * and is only emitted when PNGs were attached to the spec.
   */
  type: z.enum(['UI', 'Tech']),
  /**
   * Free-form agent label. Defaults match openplanr-pipeline subagent names
   * (`frontend-agent`, `backend-agent`) so the pipeline can route directly,
   * but the field is open so other tools (Cursor, Codex) can use their own
   * vocabularies.
   */
  agent: z.string().min(1),
  filesCreate: z.array(z.string().min(1)).default([]),
  filesModify: z.array(z.string().min(1)).default([]),
  filesPreserve: z.array(z.string().min(1)).default([]),
  objective: z.string().min(1),
  technicalSpec: z.string().default(''),
  testRequirements: z.string().default(''),
});

export type AISpecTask = z.infer<typeof aiSpecTaskSchema>;

export const aiSpecStorySchema = z.object({
  title: z.string().min(1),
  /** "As a {role}, I want to {action}" — first half of the User Story sentence. */
  roleAction: z.string().min(1),
  /** "so that {benefit}" — second half. */
  benefit: z.string().min(1),
  scope: z.string().default(''),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  /**
   * 1 task if no PNG attached; 2 tasks if PNG present (UI + Tech).
   * Hard cap at 2 to match openplanr-pipeline rule R2.
   */
  tasks: z.array(aiSpecTaskSchema).min(1).max(2),
});

export type AISpecStory = z.infer<typeof aiSpecStorySchema>;

export const aiSpecDecomposeResponseSchema = z.object({
  /**
   * 1-8 stories. Soft cap at 8 to keep within the taskFeature token budget
   * (32k); larger specs should be split or use --max-stories N to chunk.
   */
  stories: z.array(aiSpecStorySchema).min(1).max(8),
  /** Optional notes from the AI about its decomposition decisions. */
  decompositionNotes: z.string().default(''),
});

export type AISpecDecomposeResponse = z.infer<typeof aiSpecDecomposeResponseSchema>;
