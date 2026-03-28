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
    z.string().min(1).transform((s) => s.split(';').map((item) => item.trim()).filter(Boolean)),
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
});

export const aiTasksResponseSchema = z.object({
  title: z.string().min(1),
  tasks: z.array(aiTaskGroupSchema).min(1),
  acceptanceCriteriaMapping: z.array(aiACMappingSchema).default([]),
  relevantFiles: z.array(aiRelevantFileSchema).default([]),
});

export type AITasksResponse = z.infer<typeof aiTasksResponseSchema>;

// --- Refine ---

export const aiRefineResponseSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1),
  improved: z.record(z.string(), z.unknown()),
  improvedMarkdown: z.string().min(1),
});

export type AIRefineResponse = z.infer<typeof aiRefineResponseSchema>;
