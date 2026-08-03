import { describe, expect, it } from 'vitest';
import {
  aiEpicResponseSchema,
  aiFeaturesResponseSchema,
  aiRefineResponseSchema,
  aiReviseDecisionSchema,
  aiStoriesResponseSchema,
  aiTasksResponseSchema,
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
  it('accepts valid refine response with structured deltas', () => {
    const result = aiRefineResponseSchema.safeParse({
      suggestions: ['Suggestion 1'],
      improved: { title: 'Improved' },
      frontmatterChanges: { title: 'Better title' },
      bodyChanges: [{ type: 'replaceSection', heading: 'Description', newContent: 'New desc' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid refine response with legacy improvedMarkdown', () => {
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
    });
    expect(result.success).toBe(false);
  });

  it('accepts response with no improvedMarkdown and no deltas (no changes)', () => {
    const result = aiRefineResponseSchema.safeParse({
      suggestions: ['S1'],
      improved: {},
    });
    expect(result.success).toBe(true);
  });
});

describe('aiReviseDecisionSchema', () => {
  // Gherkin scenarios from US-032 -------------------------------------------

  it('accepts a revise decision with revisedMarkdown and evidence (US-032 scenario 1)', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '---\nid: "TASK-007"\n---\n# Updated body',
      rationale: 'Linter config path does not exist; align to report-linter-service.ts.',
      evidence: [
        { type: 'file_absent', ref: 'src/templates/linter/linter-config.json.hbs' },
        { type: 'file_exists', ref: 'src/services/report-linter-service.ts' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('revise');
      expect(result.data.evidence).toHaveLength(2);
      expect(result.data.ambiguous).toEqual([]); // default normalization
    }
  });

  it('rejects a revise decision with no evidence citations (US-032 scenario 2)', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '# body',
      rationale: 'vague',
      evidence: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' | ');
      expect(msg).toContain('evidence citation');
    }
  });

  it('accepts a flag decision with ambiguous entries (US-032 scenario 3)', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'US-022',
      action: 'flag',
      rationale: 'Intent conflict between Gherkin assertion and implementation.',
      evidence: [
        {
          type: 'sibling_artifact',
          ref: 'US-022-gherkin.feature',
          quote: 'flags 90%+ of vague phrases',
        },
      ],
      ambiguous: [
        {
          section: 'Acceptance Criteria',
          reason: 'Is 90% an aspiration or a contract? Linter lacks measurement instrumentation.',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('flag');
      expect(result.data.ambiguous).toHaveLength(1);
    }
  });

  // Additional invariants beyond gherkin ------------------------------------

  it('rejects a revise decision without revisedMarkdown', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      rationale: 'Missing body',
      evidence: [{ type: 'file_absent', ref: 'src/missing.ts' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' | ');
      expect(msg).toContain('revisedMarkdown');
    }
  });

  it('rejects a flag decision with empty ambiguous array', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'US-022',
      action: 'flag',
      rationale: 'something ambiguous',
      evidence: [{ type: 'sibling_artifact', ref: 'US-022' }],
      ambiguous: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' | ');
      expect(msg).toContain('ambiguity');
    }
  });

  it('accepts a clean skip decision (no revisedMarkdown, no ambiguous)', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'EPIC-002',
      action: 'skip',
      rationale: 'No drift detected.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toEqual([]);
      expect(result.data.ambiguous).toEqual([]);
      expect(result.data.revisedMarkdown).toBeUndefined();
    }
  });

  it('rejects a skip decision that includes revisedMarkdown', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'EPIC-002',
      action: 'skip',
      revisedMarkdown: '# should not be here',
      rationale: 'contradicts skip semantics',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' | ');
      expect(msg).toContain("skip' must not include revisedMarkdown");
    }
  });

  it('rejects a skip decision that includes ambiguous entries', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'EPIC-002',
      action: 'skip',
      rationale: 'contradicts skip semantics',
      ambiguous: [{ section: 'Any', reason: 'any' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' | ');
      expect(msg).toContain("skip' must not include ambiguous");
    }
  });

  it('accepts all six evidence types as valid', () => {
    const allTypes = [
      'file_exists',
      'file_absent',
      'grep_match',
      'sibling_artifact',
      'source_quote',
      'pattern_rule',
    ] as const;
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '# body',
      rationale: 'Exercising evidence taxonomy',
      evidence: allTypes.map((type) => ({ type, ref: `ref-${type}` })),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown evidence type', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '# body',
      rationale: 'Bad evidence type',
      evidence: [{ type: 'telepathy', ref: 'src/anywhere.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects evidence with empty ref', () => {
    const result = aiReviseDecisionSchema.safeParse({
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '# body',
      rationale: 'empty ref',
      evidence: [{ type: 'file_exists', ref: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults evidence and ambiguous to empty arrays when omitted', () => {
    const result = aiReviseDecisionSchema.parse({
      artifactId: 'EPIC-002',
      action: 'skip',
      rationale: 'omit arrays',
    });
    expect(result.evidence).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });
});
