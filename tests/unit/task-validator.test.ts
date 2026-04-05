import { describe, expect, it } from 'vitest';
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

    const result = validateRelevantFiles(files, inventory);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on modify action for non-existent file', () => {
    const files = [
      { path: 'src/services/backlog-service.ts', reason: 'update', action: 'modify' as const },
    ];

    const result = validateRelevantFiles(files, inventory);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('backlog-service.ts');
    expect(result.warnings[0]).toContain('not found');
  });

  it('warns on create action for existing file', () => {
    const files = [{ path: 'src/models/types.ts', reason: 'new types', action: 'create' as const }];

    const result = validateRelevantFiles(files, inventory);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('types.ts');
    expect(result.warnings[0]).toContain('already exists');
  });

  it('warns on modify action in unknown directory', () => {
    const files = [{ path: 'src/unknown/module.ts', reason: 'update', action: 'modify' as const }];

    const result = validateRelevantFiles(files, inventory);
    // Should warn about both: file not in inventory AND unknown directory
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});
