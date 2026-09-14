import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const portablePath = (value: string) => value.replaceAll('\\', '/');

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
      expect(portablePath(f.path)).toMatch(/\.cursor\/rules\/.*\.mdc$/);
    }
    const implementation = files.find((file) => file.path.endsWith('implement-task-list.mdc'));
    expect(implementation?.content).toContain('When an exact Planr task is supplied');
    expect(implementation?.content).toContain('Missing or stale planning state');
    expect(implementation?.content).toContain('ActiveStackFiles');
    expect(implementation?.content).not.toMatch(/ONE subtask at a time|Wait for user approval/u);
    expect(implementation?.content).not.toMatch(
      /mandatory human boundary|terminal SHIP receipt|targeted re-review/iu,
    );
  });

  it('pipeline scope produces one concise host-native guidance rule', async () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    gen.setScope('pipeline');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    const master = files.find((file) => file.path.endsWith('openplanr.mdc'));
    expect(master?.content).toContain('OpenPlanr host-native workflows');
    expect(master?.content).toContain('planr setup --runtime cursor --scope project');
    expect(master?.content).toMatch(/never launch\s+a second model-backed CLI/iu);
    expect(master?.content).not.toMatch(/planr-pipeline/iu);
  });

  it('all scope produces 6 agile rules plus one host-native guidance rule', async () => {
    const gen = new CursorGenerator(mockConfig, '/tmp');
    gen.setScope('all');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(7);
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

  it('pipeline or all scope produces one CLAUDE.md with native invocations', async () => {
    for (const scope of ['pipeline', 'all'] as const) {
      const gen = new ClaudeGenerator(mockConfig, '/tmp');
      gen.setScope(scope);
      const files = await gen.generate(emptyArtifacts);
      expect(files).toHaveLength(1);
      expect(files[0].path).toMatch(/CLAUDE\.md$/);
      expect(files[0].content).toContain('OpenPlanr host-native workflows');
      expect(files[0].content).toContain('/planr:plan <SPEC>');
      expect(files[0].content).toMatch(/does not launch a\s+second model/u);
      if (scope === 'all') {
        expect(files[0].content).toContain('When an exact Planr task is supplied');
        expect(files[0].content).toContain('ActiveStackFiles');
      }
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
    expect(files[0].content).not.toContain('OpenPlanr project guidance');
    expect(files[0].content).toContain('When an exact Planr task is supplied');
    expect(files[0].content).toContain('ActiveStackFiles');
    expect(files[0].content).not.toMatch(/ONE subtask at a time|Wait for user approval/u);
    expect(files[0].content).not.toMatch(
      /mandatory human boundary|terminal SHIP receipt|targeted re-review/iu,
    );
  });

  it('pipeline scope produces 1 file (AGENTS.md, pipeline content only)', async () => {
    const gen = new CodexGenerator(mockConfig, '/tmp');
    gen.setScope('pipeline');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(1);
    expect(files[0].path).toMatch(/AGENTS\.md$/);
    expect(files[0].content).toContain('OpenPlanr host-native workflows');
    expect(files[0].content).toContain('$planr:plan <SPEC>');
    expect(files[0].content).toMatch(/does not launch a\s+second model/u);
  });

  it('all scope produces 2 marker-tagged files (agile + pipeline blocks for AGENTS.md)', async () => {
    const gen = new CodexGenerator(mockConfig, '/tmp');
    gen.setScope('all');
    const files = await gen.generate(emptyArtifacts);
    expect(files).toHaveLength(2);
    expect(files[0].markerName).toBe('agile');
    expect(files[1].markerName).toBe('pipeline');
    expect(files[0].content).toContain('Agent Instructions');
    expect(files[1].content).toContain('OpenPlanr host-native workflows');
  });
});

describe('pipeline workflow template custody', () => {
  it('renders every host from one guidance-first implementation policy', () => {
    const shared = readFileSync(
      resolve('src/templates/rules/shared/implementation-guidance.md.hbs'),
      'utf8',
    );
    expect(shared).toContain('When an exact Planr task is supplied');
    expect(shared).toContain('Missing or stale planning state');
    expect(shared).toContain('ActiveStackFiles');
    expect(shared).toContain('Keep PLAN and SHIP as separate user-invoked workflows');
    expect(shared).toContain('report the failing command');
    expect(shared).toContain('`Outcome`, `Task`, `Changed`, `Checks`, and `Issues`');
    expect(shared).not.toMatch(
      /before implementing ANY|parent chain \(MANDATORY\)|read ALL ADRs/iu,
    );

    for (const source of [
      'src/templates/rules/codex/AGENTS.md.hbs',
      'src/templates/rules/claude/CLAUDE.md.hbs',
      'src/templates/rules/cursor/implement-task-list.mdc.hbs',
    ]) {
      const wrapper = readFileSync(resolve(source), 'utf8');
      expect(wrapper).toContain('{{{implementationGuidance}}}');
      expect(wrapper).not.toMatch(
        /before implementing ANY|parent chain \(MANDATORY\)|read ALL ADRs/iu,
      );
    }
  });

  it('keeps tracked workspace instruction projections aligned with canonical guidance', () => {
    const shared = readFileSync(
      resolve('src/templates/rules/shared/implementation-guidance.md.hbs'),
      'utf8',
    ).replaceAll('{{agilePath}}', '.planr');
    const trackedProjections = [
      resolve('AGENTS.md'),
      resolve('CLAUDE.md'),
      resolve('../pipeline/AGENTS.md'),
      resolve('../pipeline/CLAUDE.md'),
      resolve('../pipeline/.cursor/rules/implement-task-list.mdc'),
    ];

    for (const projection of trackedProjections) {
      const content = readFileSync(projection, 'utf8');
      expect(content).toContain(shared);
      expect(content).toContain('Keep PLAN and SHIP as separate user-invoked workflows');
      expect(content).toContain('concise error context, and the next useful action');
      expect(content).not.toMatch(
        /mandatory human|terminal SHIP receipt|blocked receipt|fixed correction|targeted re-review|one consolidated review|evidence ledger|digest-bound/iu,
      );
    }
  });

  it('does not retain unreachable local copies of pipeline-owned workflow sources', () => {
    const removedDuplicates = [
      'src/templates/rules/codex/_pipeline-section.md.hbs',
      'src/templates/rules/cursor/planr-pipeline.mdc.hbs',
      'src/templates/rules/cursor/planr-pipeline-plan.mdc.hbs',
      'src/templates/rules/cursor/planr-pipeline-ship.mdc.hbs',
      'src/templates/rules/cursor/agents/backend-agent.md',
      'src/templates/rules/cursor/agents/db-agent.md',
      'src/templates/rules/cursor/agents/designer-agent.md',
      'src/templates/rules/cursor/agents/devops-agent.md',
      'src/templates/rules/cursor/agents/doc-gen-agent.md',
      'src/templates/rules/cursor/agents/frontend-agent.md',
      'src/templates/rules/cursor/agents/qa-agent.md',
      'src/templates/rules/cursor/agents/specification-agent.md',
      'src/templates/rules/claude/planr-pipeline.md.hbs',
    ];
    expect(removedDuplicates.filter((source) => existsSync(resolve(source)))).toEqual([]);
  });
});
