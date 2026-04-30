import { describe, expect, it } from 'vitest';
import { ClaudeGenerator } from '../../src/generators/claude-generator.js';
import { CodexGenerator } from '../../src/generators/codex-generator.js';
import { CursorGenerator } from '../../src/generators/cursor-generator.js';
import { createGenerator, createGenerators } from '../../src/generators/generator-factory.js';
import type { OpenPlanrConfig } from '../../src/models/types.js';

const mockConfig: OpenPlanrConfig = {
  projectName: 'test-project',
  targets: ['cursor', 'claude', 'codex'],
  outputPaths: {
    agile: '.planr',
    cursorRules: '.cursor/rules',
    claudeConfig: '.',
    codexConfig: '.',
  },
};

const emptyArtifacts = { epics: [], features: [], stories: [], tasks: [] };

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
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input intentionally
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

describe('BaseGenerator scope handling (via public API)', () => {
  it('setScope returns the generator for fluent chaining', () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    expect(gen.setScope('pipeline')).toBe(gen);
  });

  // Default scope behaviour and the agile/pipeline/all gating logic are tested
  // observationally via the per-generator file-list assertions below — they are
  // the public contract. Probing protected `scope`/`includesAgile`/`includesPipeline`
  // directly would couple the tests to internal helpers.
});

describe('CursorGenerator.generate file-list per scope', () => {
  it('agile scope produces 6 .mdc files (existing behaviour)', async () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    gen.setScope('agile');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(6);
    for (const f of files) {
      expect(f.path).toMatch(/\.cursor\/rules\/.*\.mdc$/);
    }
  });

  it('pipeline scope produces 3 .mdc files + 8 agent body files', async () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    gen.setScope('pipeline');
    const files = await gen.generate(emptyArtifacts);
    // 3 pipeline rules + 8 agent body files = 11
    expect(files).toHaveLength(11);
    const ruleFiles = files.filter((f) => f.path.endsWith('.mdc'));
    const agentFiles = files.filter((f) => f.path.includes('/agents/'));
    expect(ruleFiles).toHaveLength(3);
    expect(agentFiles).toHaveLength(8);
  });

  it('all scope produces 6 + 3 + 8 = 17 files total', async () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    gen.setScope('all');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(17);
  });
});

describe('ClaudeGenerator.generate file-list per scope', () => {
  it('agile scope produces 1 file (CLAUDE.md only)', async () => {
    const gen = new ClaudeGenerator(mockConfig, '/tmp');
    gen.setScope('agile');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    expect(files[0].path).toMatch(/CLAUDE\.md$/);
  });

  it('pipeline or all scope produces 2 files (CLAUDE.md + planr-pipeline.md)', async () => {
    for (const scope of ['pipeline', 'all'] as const) {
      const gen = new ClaudeGenerator(mockConfig, '/tmp');
      gen.setScope(scope);
      const files = await gen.generate(emptyArtifacts);
      expect(files).toHaveLength(2);
      expect(files[0].path).toMatch(/CLAUDE\.md$/);
      expect(files[1].path).toMatch(/planr-pipeline\.md$/);
    }
  });
});

describe('CodexGenerator.generate file-list per scope', () => {
  it('agile scope produces 1 file (AGENTS.md, agile content only)', async () => {
    const gen = new CodexGenerator(mockConfig, '/tmp');
    gen.setScope('agile');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    expect(files[0].path).toMatch(/AGENTS\.md$/);
    expect(files[0].content).not.toContain('Planr Pipeline Orchestration');
  });

  it('pipeline scope produces 1 file (AGENTS.md, pipeline content only)', async () => {
    const gen = new CodexGenerator(mockConfig, '/tmp');
    gen.setScope('pipeline');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    expect(files[0].path).toMatch(/AGENTS\.md$/);
    expect(files[0].content).toContain('Planr Pipeline Orchestration');
  });

  it('all scope produces 1 file (AGENTS.md with both sections concatenated)', async () => {
    const gen = new CodexGenerator(mockConfig, '/tmp');
    gen.setScope('all');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('Agent Instructions');
    expect(files[0].content).toContain('Planr Pipeline Orchestration');
  });
});
