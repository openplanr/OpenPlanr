import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, readFile, fileExists, listFiles, ensureDir } from '../../src/utils/fs.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'planr-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('writeFile', () => {
  it('writes content to a file', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'hello world');
    const content = await readFile(filePath);
    expect(content).toBe('hello world');
  });

  it('creates parent directories automatically', async () => {
    const filePath = join(tempDir, 'nested', 'deep', 'test.txt');
    await writeFile(filePath, 'nested content');
    const content = await readFile(filePath);
    expect(content).toBe('nested content');
  });
});

describe('readFile', () => {
  it('reads file content as utf-8 string', async () => {
    const filePath = join(tempDir, 'read-test.md');
    await writeFile(filePath, '# Heading\n\nBody text');
    const content = await readFile(filePath);
    expect(content).toBe('# Heading\n\nBody text');
  });
});

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    const filePath = join(tempDir, 'exists.txt');
    await writeFile(filePath, 'content');
    expect(await fileExists(filePath)).toBe(true);
  });

  it('returns false for non-existing file', async () => {
    expect(await fileExists(join(tempDir, 'nope.txt'))).toBe(false);
  });

  it('returns true for existing directory', async () => {
    expect(await fileExists(tempDir)).toBe(true);
  });
});

describe('ensureDir', () => {
  it('creates directory if it does not exist', async () => {
    const dirPath = join(tempDir, 'new-dir');
    await ensureDir(dirPath);
    expect(await fileExists(dirPath)).toBe(true);
  });

  it('does not throw if directory already exists', async () => {
    await ensureDir(tempDir);
    expect(await fileExists(tempDir)).toBe(true);
  });
});

describe('listFiles', () => {
  it('lists all files in directory', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'a');
    await writeFile(join(tempDir, 'b.txt'), 'b');
    const files = await listFiles(tempDir);
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
  });

  it('filters by regex pattern', async () => {
    await writeFile(join(tempDir, 'EPIC-001-slug.md'), '');
    await writeFile(join(tempDir, 'EPIC-002-other.md'), '');
    await writeFile(join(tempDir, 'readme.txt'), '');
    const files = await listFiles(tempDir, /^EPIC-\d{3}/);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.startsWith('EPIC-'))).toBe(true);
  });

  it('returns empty array for non-existent directory', async () => {
    const files = await listFiles(join(tempDir, 'does-not-exist'));
    expect(files).toEqual([]);
  });
});
