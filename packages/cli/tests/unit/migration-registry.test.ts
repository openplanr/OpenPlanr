import { describe, expect, it } from 'vitest';
import {
  crossesVersion,
  type Migration,
  REGISTERED_MIGRATIONS,
  runPendingMigrations,
} from '../../src/services/migration-registry.js';

describe('migration registry', () => {
  it('has no active product-specific migration after the Operate reset', () => {
    expect(REGISTERED_MIGRATIONS).toEqual([]);
  });

  it('runs only migrations crossed by a stable upgrade', async () => {
    const migration: Migration = {
      id: 'fixture-migration',
      version: '1.2.0',
      run: async () => ({ applied: true, alreadyApplied: false }),
    };

    expect(crossesVersion('1.1.0', '1.2.0', migration.version)).toBe(true);
    expect(crossesVersion('1.2.0', '1.3.0', migration.version)).toBe(false);
    expect(crossesVersion('preview', '1.2.0', migration.version)).toBe(false);
    await expect(
      runPendingMigrations('1.1.0', '1.2.0', { projectDir: '/fixture' }, [migration]),
    ).resolves.toEqual([{ id: 'fixture-migration', applied: true, alreadyApplied: false }]);
  });
});
