import { describe, it, expect } from 'vitest';
import {
  buildEpicPrompt,
  buildFeaturesPrompt,
  buildStoriesPrompt,
  buildTasksPrompt,
  buildRefinePrompt,
} from '../../src/ai/prompts/prompt-builder.js';

describe('buildEpicPrompt', () => {
  it('returns system and user messages', () => {
    const messages = buildEpicPrompt('Build an auth system');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes the brief in user message', () => {
    const messages = buildEpicPrompt('Build an auth system');
    expect(messages[1].content).toContain('Build an auth system');
  });

  it('includes existing epics when provided', () => {
    const messages = buildEpicPrompt('New epic', ['Auth System', 'Payments']);
    expect(messages[1].content).toContain('Auth System');
    expect(messages[1].content).toContain('Payments');
    expect(messages[1].content).toContain('do NOT duplicate');
  });

  it('omits existing epics section when empty', () => {
    const messages = buildEpicPrompt('New epic', []);
    expect(messages[1].content).not.toContain('do NOT duplicate');
  });
});

describe('buildFeaturesPrompt', () => {
  it('returns system and user messages', () => {
    const messages = buildFeaturesPrompt('Epic content here');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes epic content', () => {
    const messages = buildFeaturesPrompt('# Auth Epic\n\nDetails here');
    expect(messages[1].content).toContain('# Auth Epic');
  });

  it('includes feature count when specified', () => {
    const messages = buildFeaturesPrompt('Epic', [], 5);
    expect(messages[1].content).toContain('approximately 5 features');
  });

  it('includes existing features when provided', () => {
    const messages = buildFeaturesPrompt('Epic', ['OAuth Login', 'Email Auth']);
    expect(messages[1].content).toContain('OAuth Login');
    expect(messages[1].content).toContain('do NOT duplicate');
  });
});

describe('buildStoriesPrompt', () => {
  it('returns system and user messages', () => {
    const messages = buildStoriesPrompt('Feature content', 'Epic context');
    expect(messages).toHaveLength(2);
  });

  it('includes feature content and epic context', () => {
    const messages = buildStoriesPrompt('Feature: OAuth', 'Epic: Auth System');
    expect(messages[1].content).toContain('Feature: OAuth');
    expect(messages[1].content).toContain('Epic: Auth System');
  });

  it('includes existing stories when provided', () => {
    const messages = buildStoriesPrompt('Feature', 'Epic', ['Login with Google']);
    expect(messages[1].content).toContain('Login with Google');
    expect(messages[1].content).toContain('do NOT duplicate');
  });
});

describe('buildTasksPrompt', () => {
  it('includes user stories section', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Login story content' }],
    });
    expect(messages[1].content).toContain('--- User Stories ---');
    expect(messages[1].content).toContain('[US-001]');
    expect(messages[1].content).toContain('Login story content');
  });

  it('includes gherkin scenarios when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      gherkinScenarios: [{ storyId: 'US-001', content: 'Feature: Login\n  Scenario: ...' }],
    });
    expect(messages[1].content).toContain('--- Gherkin Acceptance Criteria ---');
    expect(messages[1].content).toContain('[Gherkin for US-001]');
  });

  it('includes feature context when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      featureRaw: '# Feature: OAuth Login',
    });
    expect(messages[1].content).toContain('--- Parent Feature Context ---');
    expect(messages[1].content).toContain('# Feature: OAuth Login');
  });

  it('includes epic context when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      epicRaw: '# Epic: Auth System',
    });
    expect(messages[1].content).toContain('--- Parent Epic Context ---');
  });

  it('includes ADRs when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      adrs: [{ id: 'ADR-001', content: 'Use JWT tokens' }],
    });
    expect(messages[1].content).toContain('--- Architecture Decision Records ---');
    expect(messages[1].content).toContain('[ADR-001]');
  });

  it('includes codebase context when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      codebaseContext: 'src/auth/ — authentication module',
    });
    expect(messages[1].content).toContain('--- Codebase Context ---');
  });

  it('includes scope hint when provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
      scope: { type: 'feature', id: 'FEAT-001' },
    });
    expect(messages[1].content).toContain('--- Scope ---');
    expect(messages[1].content).toContain('feature level for FEAT-001');
  });

  it('omits optional sections when not provided', () => {
    const messages = buildTasksPrompt({
      stories: [{ id: 'US-001', raw: 'Story' }],
    });
    expect(messages[1].content).not.toContain('--- Gherkin');
    expect(messages[1].content).not.toContain('--- Parent Feature');
    expect(messages[1].content).not.toContain('--- Parent Epic');
    expect(messages[1].content).not.toContain('--- Architecture');
    expect(messages[1].content).not.toContain('--- Codebase');
    expect(messages[1].content).not.toContain('--- Scope');
  });

  it('handles multiple stories', () => {
    const messages = buildTasksPrompt({
      stories: [
        { id: 'US-001', raw: 'First story' },
        { id: 'US-002', raw: 'Second story' },
        { id: 'US-003', raw: 'Third story' },
      ],
    });
    expect(messages[1].content).toContain('[US-001]');
    expect(messages[1].content).toContain('[US-002]');
    expect(messages[1].content).toContain('[US-003]');
  });
});

describe('buildRefinePrompt', () => {
  it('returns system and user messages', () => {
    const messages = buildRefinePrompt('Artifact content', 'epic');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes artifact content and type', () => {
    const messages = buildRefinePrompt('# My Epic\n\nDetails', 'epic');
    expect(messages[1].content).toContain('# My Epic');
    expect(messages[1].content).toContain('epic');
  });
});
