import { describe, it, expect } from 'vitest';
import {
  aiEpicResponseSchema,
  aiFeaturesResponseSchema,
  aiStoriesResponseSchema,
  aiTasksResponseSchema,
  aiRefineResponseSchema,
} from '../../src/ai/schemas/ai-response-schemas.js';

describe('aiEpicResponseSchema', () => {
  const validEpic = {
    title: 'Test Epic',
    owner: 'Engineering',
    businessValue: 'High value',
    targetUsers: 'Developers',
    problemStatement: 'Problem',
    solutionOverview: 'Solution',
    successCriteria: ['Criterion 1', 'Criterion 2'],
    keyFeatures: ['Feature 1'],
  };

  it('accepts valid epic with array criteria', () => {
    const result = aiEpicResponseSchema.safeParse(validEpic);
    expect(result.success).toBe(true);
  });

  it('transforms string successCriteria into array', () => {
    const result = aiEpicResponseSchema.parse({
      ...validEpic,
      successCriteria: 'Criterion A; Criterion B',
    });
    expect(result.successCriteria).toEqual(['Criterion A', 'Criterion B']);
  });

  it('defaults dependencies and risks to None', () => {
    const result = aiEpicResponseSchema.parse(validEpic);
    expect(result.dependencies).toBe('None');
    expect(result.risks).toBe('None');
  });

  it('rejects missing title', () => {
    const result = aiEpicResponseSchema.safeParse({ ...validEpic, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty keyFeatures', () => {
    const result = aiEpicResponseSchema.safeParse({ ...validEpic, keyFeatures: [] });
    expect(result.success).toBe(false);
  });
});

describe('aiFeaturesResponseSchema', () => {
  const validFeature = {
    title: 'Feature',
    overview: 'Overview',
    functionalRequirements: ['Req 1'],
    successMetrics: 'Metric',
  };

  it('accepts valid features response', () => {
    const result = aiFeaturesResponseSchema.safeParse({ features: [validFeature] });
    expect(result.success).toBe(true);
  });

  it('rejects empty features array', () => {
    const result = aiFeaturesResponseSchema.safeParse({ features: [] });
    expect(result.success).toBe(false);
  });

  it('defaults optional fields', () => {
    const result = aiFeaturesResponseSchema.parse({ features: [validFeature] });
    expect(result.features[0].dependencies).toBe('None');
    expect(result.features[0].technicalConsiderations).toBe('None');
    expect(result.features[0].risks).toBe('None');
  });
});

describe('aiStoriesResponseSchema', () => {
  const validStory = {
    title: 'Story',
    role: 'developer',
    goal: 'do something',
    benefit: 'productivity',
    gherkinScenarios: [{ name: 'Scenario', given: 'G', when: 'W', then: 'T' }],
  };

  it('accepts valid stories response', () => {
    const result = aiStoriesResponseSchema.safeParse({ stories: [validStory] });
    expect(result.success).toBe(true);
  });

  it('rejects stories without gherkin scenarios', () => {
    const result = aiStoriesResponseSchema.safeParse({
      stories: [{ ...validStory, gherkinScenarios: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults additionalNotes to empty string', () => {
    const result = aiStoriesResponseSchema.parse({ stories: [validStory] });
    expect(result.stories[0].additionalNotes).toBe('');
  });
});

describe('aiTasksResponseSchema', () => {
  const validTasks = {
    title: 'Task List',
    tasks: [{ id: 'T1', title: 'Task 1' }],
  };

  it('accepts valid tasks response', () => {
    const result = aiTasksResponseSchema.safeParse(validTasks);
    expect(result.success).toBe(true);
  });

  it('defaults subtasks to empty array', () => {
    const result = aiTasksResponseSchema.parse(validTasks);
    expect(result.tasks[0].subtasks).toEqual([]);
  });

  it('defaults acceptanceCriteriaMapping to empty array', () => {
    const result = aiTasksResponseSchema.parse(validTasks);
    expect(result.acceptanceCriteriaMapping).toEqual([]);
  });

  it('defaults relevantFiles to empty array', () => {
    const result = aiTasksResponseSchema.parse(validTasks);
    expect(result.relevantFiles).toEqual([]);
  });

  it('accepts full task with subtasks', () => {
    const result = aiTasksResponseSchema.safeParse({
      ...validTasks,
      tasks: [{ id: 'T1', title: 'Task', subtasks: [{ id: 'T1.1', title: 'Sub' }] }],
    });
    expect(result.success).toBe(true);
  });
});

describe('aiRefineResponseSchema', () => {
  it('accepts valid refine response', () => {
    const result = aiRefineResponseSchema.safeParse({
      suggestions: ['Suggestion 1'],
      improved: { title: 'Improved' },
      improvedMarkdown: '# Improved\n\nContent',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty suggestions', () => {
    const result = aiRefineResponseSchema.safeParse({
      suggestions: [],
      improved: {},
      improvedMarkdown: 'content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty improvedMarkdown', () => {
    const result = aiRefineResponseSchema.safeParse({
      suggestions: ['S1'],
      improved: {},
      improvedMarkdown: '',
    });
    expect(result.success).toBe(false);
  });
});
