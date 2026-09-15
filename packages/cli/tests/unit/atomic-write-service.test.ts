import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atomicWriteFile, backupIfPresent } from '../../src/services/atomic-write-service.js';

describe('atomicWriteFile', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-atomic-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('writes a new file when the target does not exist', async () => {
    const target = join(tmpDir, 'fresh.md');
    const result = await atomicWriteFile(target, '# hello');
    expect(result.targetPath).toBe(target);
    expect(readFileSync(target, 'utf-8')).toBe('# hello');
  });

  it('replaces an existing file atomically', async () => {
    const target = join(tmpDir, 'update.md');
    writeFileSync(target, 'old content');
    await atomicWriteFile(target, 'new content');
    expect(readFileSync(target, 'utf-8')).toBe('new content');
  });

  it('creates parent directories as needed', async () => {
    const target = join(tmpDir, 'nested', 'deeply', 'new.md');
    const result = await atomicWriteFile(target, 'nested');
    expect(result.targetPath).toBe(target);
    expect(readFileSync(target, 'utf-8')).toBe('nested');
  });

  it('copies the original to backupPath before overwriting', async () => {
    const target = join(tmpDir, 'backup-test.md');
    const backup = join(tmpDir, 'backup', 'backup-test.md.bak');
    writeFileSync(target, 'original');
    const result = await atomicWriteFile(target, 'rewritten', { backupPath: backup });
    expect(result.backupPath).toBe(backup);
    expect(readFileSync(backup, 'utf-8')).toBe('original');
    expect(readFileSync(target, 'utf-8')).toBe('rewritten');
  });

  it('skips backup when the original does not exist', async () => {
    const target = join(tmpDir, 'brand-new.md');
    const backup = join(tmpDir, 'backup', 'brand-new.md.bak');
    const result = await atomicWriteFile(target, 'content', { backupPath: backup });
    expect(result.backupPath).toBeUndefined();
    expect(readFileSync(target, 'utf-8')).toBe('content');
  });

  it('leaves no temp files behind after a successful write', async () => {
    const target = join(tmpDir, 'temps.md');
    await atomicWriteFile(target, 'a');
    await atomicWriteFile(target, 'b');
    await atomicWriteFile(target, 'c');
    const entries = readdirSync(tmpDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('leaves the original untouched if the write target becomes invalid mid-flight', async () => {
    // Simulate a failure by targeting an impossible path (null byte)
    const target = join(tmpDir, 'bad\0path.md');
    await expect(atomicWriteFile(target, 'x')).rejects.toThrow();
    // Original working-directory state should not have new temp files
    const entries = readdirSync(tmpDir);
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0);
  });
});

describe('backupIfPresent', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-backup-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('returns undefined when the source does not exist', async () => {
    const result = await backupIfPresent(
      join(tmpDir, 'does-not-exist.md'),
      join(tmpDir, 'backup.bak'),
    );
    expect(result).toBeUndefined();
  });

  it('copies content to backup path when source exists', async () => {
    const source = join(tmpDir, 'src.md');
    writeFileSync(source, 'data');
    const backup = join(tmpDir, 'backups', 'src.md.bak');
    const result = await backupIfPresent(source, backup);
    expect(result).toBe(backup);
    expect(readFileSync(backup, 'utf-8')).toBe('data');
  });

  it('overwrites an existing backup slot on re-run (idempotent)', async () => {
    const source = join(tmpDir, 'rerun.md');
    writeFileSync(source, 'v2');
    const backup = join(tmpDir, 'rerun.md.bak');
    writeFileSync(backup, 'v1'); // pre-existing backup
    const result = await backupIfPresent(source, backup);
    expect(result).toBe(backup);
    expect(readFileSync(backup, 'utf-8')).toBe('v2');
  });
});
