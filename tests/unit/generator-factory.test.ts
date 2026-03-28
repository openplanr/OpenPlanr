import { describe, it, expect } from 'vitest';
import { createGenerator, createGenerators } from '../../src/generators/generator-factory.js';
import { CursorGenerator } from '../../src/generators/cursor-generator.js';
import { ClaudeGenerator } from '../../src/generators/claude-generator.js';
import { CodexGenerator } from '../../src/generators/codex-generator.js';
import type { OpenPlanrConfig } from '../../src/models/types.js';

const mockConfig: OpenPlanrConfig = {
  projectName: 'test-project',
  targets: ['cursor', 'claude', 'codex'],
  outputPaths: {
    agile: 'docs/agile',
    cursorRules: '.cursor/rules',
    claudeConfig: '.',
    codexConfig: '.',
  },
};

describe('createGenerator', () => {
  it('creates CursorGenerator for cursor target', () => {
    const gen = createGenerator('cursor', mockConfig, '/tmp');
    expect(gen).toBeInstanceOf(CursorGenerator);
    expect(gen.getTargetName()).toBe('cursor');
  });

  it('creates ClaudeGenerator for claude target', () => {
    const gen = createGenerator('claude', mockConfig, '/tmp');
    expect(gen).toBeInstanceOf(ClaudeGenerator);
    expect(gen.getTargetName()).toBe('claude');
  });

  it('creates CodexGenerator for codex target', () => {
    const gen = createGenerator('codex', mockConfig, '/tmp');
    expect(gen).toBeInstanceOf(CodexGenerator);
    expect(gen.getTargetName()).toBe('codex');
  });

  it('throws for unknown target', () => {
    expect(() => createGenerator('unknown' as any, mockConfig, '/tmp')).toThrow('Unknown target');
  });
});

describe('createGenerators', () => {
  it('creates generators for all targets in config', () => {
    const generators = createGenerators(mockConfig, '/tmp');
    expect(generators).toHaveLength(3);
    expect(generators[0]).toBeInstanceOf(CursorGenerator);
    expect(generators[1]).toBeInstanceOf(ClaudeGenerator);
    expect(generators[2]).toBeInstanceOf(CodexGenerator);
  });

  it('creates single generator when config has one target', () => {
    const config = { ...mockConfig, targets: ['cursor' as const] };
    const generators = createGenerators(config, '/tmp');
    expect(generators).toHaveLength(1);
  });
});
