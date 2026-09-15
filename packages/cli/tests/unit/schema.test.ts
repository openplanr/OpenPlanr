import { describe, expect, it } from 'vitest';
import { configSchema } from '../../src/models/schema.js';

describe('configSchema', () => {
  const validConfig = {
    projectName: 'test-project',
    targets: ['cursor', 'claude'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.',
      codexConfig: '.',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
    },
    createdAt: '2026-03-26',
  };

  it('validates a correct config', () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects empty project name', () => {
    const result = configSchema.safeParse({ ...validConfig, projectName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid target', () => {
    const result = configSchema.safeParse({ ...validConfig, targets: ['vim'] });
    expect(result.success).toBe(false);
  });

  it('rejects empty targets array', () => {
    const result = configSchema.safeParse({ ...validConfig, targets: [] });
    expect(result.success).toBe(false);
  });

  it('accepts optional author field', () => {
    const result = configSchema.safeParse({ ...validConfig, author: 'John' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.author).toBe('John');
    }
  });
});
