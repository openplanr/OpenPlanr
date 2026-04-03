import { describe, expect, it } from 'vitest';
import { detectDependencyHints } from '../../src/ai/validation/dependency-chains.js';
import {
  parseSourceInventory,
  validateRelevantFiles,
} from '../../src/ai/validation/task-validator.js';

describe('parseSourceInventory', () => {
  it('parses inventory lines into full file paths', () => {
    const inventory = [
      'src/services/: artifact-service.ts, config-service.ts, id-service.ts',
      'src/cli/commands/: quick.ts, task.ts, epic.ts',
    ].join('\n');

    const files = parseSourceInventory(inventory);
    expect(files.has('src/services/artifact-service.ts')).toBe(true);
    expect(files.has('src/services/config-service.ts')).toBe(true);
    expect(files.has('src/cli/commands/quick.ts')).toBe(true);
    expect(files.has('src/cli/commands/task.ts')).toBe(true);
    expect(files.size).toBe(6);
  });

  it('handles empty inventory', () => {
    expect(parseSourceInventory('').size).toBe(0);
  });

  it('handles trailing slashes in directory', () => {
    const files = parseSourceInventory('src/models/: types.ts');
    expect(files.has('src/models/types.ts')).toBe(true);
  });
});

describe('validateRelevantFiles', () => {
  const inventory = [
    'src/services/: artifact-service.ts, config-service.ts, id-service.ts',
    'src/cli/commands/: quick.ts, task.ts',
    'src/models/: types.ts',
  ].join('\n');

  it('returns no warnings when all files are valid', () => {
    const files = [
      { path: 'src/services/artifact-service.ts', reason: 'update', action: 'modify' as const },
      { path: 'src/cli/commands/backlog.ts', reason: 'new command', action: 'create' as const },
    ];

    const result = validateRelevantFiles(files, inventory, []);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on modify action for non-existent file', () => {
    const files = [
      { path: 'src/services/backlog-service.ts', reason: 'update', action: 'modify' as const },
    ];

    const result = validateRelevantFiles(files, inventory, []);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('backlog-service.ts');
    expect(result.warnings[0]).toContain('not found');
  });

  it('warns on create action for existing file', () => {
    const files = [{ path: 'src/models/types.ts', reason: 'new types', action: 'create' as const }];

    const result = validateRelevantFiles(files, inventory, []);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('types.ts');
    expect(result.warnings[0]).toContain('already exists');
  });

  it('warns on modify action in unknown directory', () => {
    const files = [{ path: 'src/unknown/module.ts', reason: 'update', action: 'modify' as const }];

    const result = validateRelevantFiles(files, inventory, []);
    // Should warn about both: file not in inventory AND unknown directory
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('warns on dependency chain gaps', () => {
    const hints = [
      {
        files: ['src/models/types.ts', 'src/services/config-service.ts'],
        reason: 'types imported by config',
      },
    ];
    const files = [
      { path: 'src/models/types.ts', reason: 'add new type', action: 'modify' as const },
    ];

    const result = validateRelevantFiles(files, inventory, hints);
    const chainWarning = result.warnings.find((w) => w.includes('config-service.ts'));
    expect(chainWarning).toBeDefined();
  });

  it('does not warn when all chain files are present', () => {
    const hints = [
      {
        files: ['src/models/types.ts', 'src/services/config-service.ts'],
        reason: 'types imported by config',
      },
    ];
    const files = [
      { path: 'src/models/types.ts', reason: 'add type', action: 'modify' as const },
      {
        path: 'src/services/config-service.ts',
        reason: 'update defaults',
        action: 'modify' as const,
      },
    ];

    const result = validateRelevantFiles(files, inventory, hints);
    const chainWarning = result.warnings.find((w) => w.includes('not included'));
    expect(chainWarning).toBeUndefined();
  });
});

describe('detectDependencyHints', () => {
  it('detects import-based dependency between two files', () => {
    const arch = new Map([
      [
        'src/services/config-service.ts',
        `import type { OpenPlanrConfig } from '../models/types.js';`,
      ],
      ['src/models/types.ts', 'export interface OpenPlanrConfig {}'],
    ]);

    const hints = detectDependencyHints(arch);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    const hint = hints.find(
      (h) =>
        h.files.includes('src/models/types.ts') &&
        h.files.includes('src/services/config-service.ts'),
    );
    expect(hint).toBeDefined();
  });

  it('returns empty for single architecture file', () => {
    const arch = new Map([['src/types.ts', 'export type Foo = string;']]);
    expect(detectDependencyHints(arch)).toHaveLength(0);
  });

  it('returns empty when no import relationships exist', () => {
    const arch = new Map([
      ['src/a.ts', 'export const a = 1;'],
      ['src/b.ts', 'export const b = 2;'],
    ]);
    expect(detectDependencyHints(arch)).toHaveLength(0);
  });
});
