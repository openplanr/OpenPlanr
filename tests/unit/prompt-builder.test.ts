import { describe, expect, it } from 'vitest';
import {
  buildEpicPrompt,
  buildFeaturesPrompt,
  buildRefinePrompt,
  buildRevisePrompt,
  buildStoriesPrompt,
  buildTasksPrompt,
  type RevisePromptContext,
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

describe('buildRevisePrompt', () => {
  const baseCtx: RevisePromptContext = {
    artifact: { id: 'TASK-007', type: 'task', content: '# TASK-007\n\nSome body' },
    parents: [],
    siblings: [],
    sources: [],
    writableScope: 'all',
  };

  it('returns system and user messages', () => {
    const messages = buildRevisePrompt(baseCtx);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('labels the target artifact with id and type', () => {
    const messages = buildRevisePrompt(baseCtx);
    expect(messages[1].content).toContain('[TARGET_ARTIFACT]');
    expect(messages[1].content).toContain('type=task');
    expect(messages[1].content).toContain('id=TASK-007');
    expect(messages[1].content).toContain('# TASK-007');
  });

  it('emits explicit "(none)" markers when optional sections are empty', () => {
    const messages = buildRevisePrompt(baseCtx);
    expect(messages[1].content).toContain('[PARENT_CHAIN]\n(none — this is a top-level artifact)');
    expect(messages[1].content).toContain('[SIBLINGS]\n(none)');
    expect(messages[1].content).toContain('[CODEBASE_CONTEXT]\n(not loaded');
    expect(messages[1].content).toContain('[DECLARED_SOURCES]\n(no sources');
  });

  it('includes parent chain content when provided (US-034 scenario)', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      parents: [
        { id: 'EPIC-002', type: 'epic', content: '# Epic body' },
        { id: 'FEAT-007', type: 'feature', content: '# Feature body' },
      ],
    });
    expect(messages[1].content).toContain('[PARENT_CHAIN]');
    expect(messages[1].content).toContain('--- epic EPIC-002 ---');
    expect(messages[1].content).toContain('# Epic body');
    expect(messages[1].content).toContain('--- feature FEAT-007 ---');
    expect(messages[1].content).toContain('# Feature body');
  });

  it('includes sibling artifacts when provided', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      siblings: [{ id: 'TASK-006', type: 'task', content: '# Sibling task body' }],
    });
    expect(messages[1].content).toContain('[SIBLINGS]');
    expect(messages[1].content).toContain('--- task TASK-006 ---');
    expect(messages[1].content).toContain('# Sibling task body');
  });

  it('includes codebase context when provided', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      codebaseContextFormatted: '## Tech Stack\nnode + typescript',
    });
    expect(messages[1].content).toContain('[CODEBASE_CONTEXT]\n## Tech Stack');
    expect(messages[1].content).not.toContain('(not loaded');
  });

  it('includes declared sources when provided', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      sources: [
        { label: 'PRD-platform.md', content: 'Product vision document' },
        { label: '.cursor/rules/components.mdc', content: 'Use atomic design' },
      ],
    });
    expect(messages[1].content).toContain('[DECLARED_SOURCES]');
    expect(messages[1].content).toContain('--- PRD-platform.md ---');
    expect(messages[1].content).toContain('Product vision document');
    expect(messages[1].content).toContain('--- .cursor/rules/components.mdc ---');
  });

  it('emits the writable scope verbatim', () => {
    const messages = buildRevisePrompt({ ...baseCtx, writableScope: 'prose' });
    expect(messages[1].content).toContain('[WRITABLE_SCOPE]\nprose');
  });

  it('emits [TEMPLATE_STRUCTURE] with canonical sections when provided', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      canonicalSections: ['Business Value', 'Problem Statement', 'Risks', 'Features'],
    });
    const content = messages[1].content;
    expect(content).toContain('[TEMPLATE_STRUCTURE]');
    expect(content).toContain('## Business Value');
    expect(content).toContain('## Problem Statement');
    expect(content).toContain('## Risks');
    expect(content).toContain('## Features');
    // The prompt should instruct the agent to flag rather than add new sections.
    expect(content).toContain("emit 'flag'");
  });

  it('emits a fallback [TEMPLATE_STRUCTURE] note when no canonical sections are provided', () => {
    const messages = buildRevisePrompt(baseCtx);
    expect(messages[1].content).toContain('[TEMPLATE_STRUCTURE]');
    expect(messages[1].content).toContain('no canonical section list enforced');
  });

  it('emits an empty canonical sections list as the fallback (treats empty === missing)', () => {
    const messages = buildRevisePrompt({ ...baseCtx, canonicalSections: [] });
    expect(messages[1].content).toContain('no canonical section list enforced');
  });

  it('produces a stable section order matching the system prompt expectations', () => {
    const messages = buildRevisePrompt({
      ...baseCtx,
      canonicalSections: ['Business Value', 'Features'],
    });
    const content = messages[1].content;
    const idx = {
      target: content.indexOf('[TARGET_ARTIFACT]'),
      parents: content.indexOf('[PARENT_CHAIN]'),
      siblings: content.indexOf('[SIBLINGS]'),
      code: content.indexOf('[CODEBASE_CONTEXT]'),
      sources: content.indexOf('[DECLARED_SOURCES]'),
      template: content.indexOf('[TEMPLATE_STRUCTURE]'),
      scope: content.indexOf('[WRITABLE_SCOPE]'),
    };
    expect(idx.target).toBeGreaterThanOrEqual(0);
    expect(idx.target).toBeLessThan(idx.parents);
    expect(idx.parents).toBeLessThan(idx.siblings);
    expect(idx.siblings).toBeLessThan(idx.code);
    expect(idx.code).toBeLessThan(idx.sources);
    expect(idx.sources).toBeLessThan(idx.template);
    expect(idx.template).toBeLessThan(idx.scope);
  });
});
