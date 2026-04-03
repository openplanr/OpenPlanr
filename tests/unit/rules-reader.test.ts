import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectRules } from '../../src/ai/codebase/rules-reader.js';
import { ensureDir, writeFile } from '../../src/utils/fs.js';

describe('readProjectRules', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'planr-rules-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when .planr/rules.md does not exist', async () => {
    const result = await readProjectRules(tmpDir);
    expect(result).toBeNull();
  });

  it('reads rules from .planr/rules.md', async () => {
    const rulesDir = path.join(tmpDir, '.planr');
    await ensureDir(rulesDir);
    await writeFile(
      path.join(rulesDir, 'rules.md'),
      '# Architecture Rules\n\n- All state is file-based markdown.\n- Services are stateless.',
    );

    const result = await readProjectRules(tmpDir);
    expect(result).toContain('Architecture Rules');
    expect(result).toContain('Services are stateless');
  });

  it('trims whitespace from rules content', async () => {
    const rulesDir = path.join(tmpDir, '.planr');
    await ensureDir(rulesDir);
    await writeFile(path.join(rulesDir, 'rules.md'), '  \n  Some rule  \n  ');

    const result = await readProjectRules(tmpDir);
    expect(result).toBe('Some rule');
  });

  it('truncates rules exceeding 8K chars', async () => {
    const rulesDir = path.join(tmpDir, '.planr');
    await ensureDir(rulesDir);
    const longContent = 'x'.repeat(10_000);
    await writeFile(path.join(rulesDir, 'rules.md'), longContent);

    const result = await readProjectRules(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(8_000);
  });
});
