import { describe, expect, it } from 'vitest';
import { joinNames, summarizeRuntimeChanges } from '../../src/services/runtime-change-summary.js';

const bookkeepingRoot = '/home/user/.planr/runtime';

const plan = {
  runtimes: ['claude-code', 'codex', 'cursor'] as const,
  actions: [
    {
      runtime: 'claude-code',
      target: `${bookkeepingRoot}/adapters/claude-code.json`,
      operation: 'update',
    },
    { runtime: 'codex', target: '/home/user/.codex/skills/a/SKILL.md', operation: 'update' },
    { runtime: 'codex', target: '/home/user/.codex/skills/b/SKILL.md', operation: 'update' },
    { runtime: 'codex', target: '/home/user/.codex/skills/c/SKILL.md', operation: 'update' },
    { runtime: 'codex', target: '/home/user/.codex/skills/d/SKILL.md', operation: 'create' },
    { runtime: 'codex', target: '/home/user/.codex/skills/e/SKILL.md', operation: 'unchanged' },
    { runtime: 'cursor', target: '/project/.cursor/rules/planr.mdc', operation: 'unchanged' },
  ],
  runtimeOperations: [
    {
      runtime: 'claude-code' as const,
      kind: 'refresh-marketplace' as const,
      id: 'openplanr-local',
      scope: 'user' as const,
      description: 'Refresh the generated local OpenPlanr Claude marketplace',
    },
    {
      runtime: 'claude-code' as const,
      kind: 'update' as const,
      id: 'planr@openplanr-local',
      scope: 'user' as const,
      currentVersion: '2.6.0',
      targetVersion: '2.2640.2',
      description: 'Refresh planr@openplanr-local to restore its stable plugin identity',
    },
  ],
};

describe('summarizeRuntimeChanges', () => {
  it('summarizes each agent without counting OpenPlanr records or the routine marketplace refresh', () => {
    expect(
      summarizeRuntimeChanges(
        { ...plan, runtimes: [...plan.runtimes] },
        {
          bookkeepingRoot,
          applied: true,
        },
      ),
    ).toEqual([
      {
        runtime: 'claude-code',
        host: 'Claude Code',
        changed: true,
        summary: 'OpenPlanr plugin 2.6.0 → 2.2640.2',
      },
      { runtime: 'codex', host: 'Codex', changed: true, summary: '3 files updated, 1 added' },
      { runtime: 'cursor', host: 'Cursor', changed: false, summary: 'already up to date' },
    ]);
  });

  it('phrases a preview as work still to do', () => {
    const [claude, codex] = summarizeRuntimeChanges(
      { ...plan, runtimes: [...plan.runtimes] },
      { bookkeepingRoot, applied: false },
    );
    expect(claude.summary).toBe('OpenPlanr plugin 2.6.0 → 2.2640.2');
    expect(codex.summary).toBe('3 files to update, 1 to add');
  });

  it('treats a marketplace refresh alone as no change', () => {
    const [claude] = summarizeRuntimeChanges(
      { runtimes: ['claude-code'], actions: [], runtimeOperations: [plan.runtimeOperations[0]] },
      { bookkeepingRoot, applied: true },
    );
    expect(claude).toMatchObject({ changed: false, summary: 'already up to date' });
  });
});

describe('joinNames', () => {
  it('joins names the way a sentence lists them', () => {
    expect(joinNames(['Claude Code'])).toBe('Claude Code');
    expect(joinNames(['Claude Code', 'Codex'])).toBe('Claude Code and Codex');
    expect(joinNames(['Claude Code', 'Codex', 'Cursor'])).toBe('Claude Code, Codex and Cursor');
  });
});
