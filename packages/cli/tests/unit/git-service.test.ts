import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkCleanTree, inspectGitTree } from '../../src/services/git-service.js';

const execFileAsync = promisify(execFile);

async function gitInit(dir: string) {
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

async function gitCommit(dir: string, message: string) {
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

describe('git-service', () => {
  let repo: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'planr-git-'));
    await gitInit(repo);
    writeFileSync(join(repo, 'README.md'), '# Initial');
    await gitCommit(repo, 'initial');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('reports a clean tree after an initial commit', async () => {
    const status = await inspectGitTree(repo);
    expect(status.kind).toBe('clean');
    if (status.kind === 'clean') {
      expect(status.head).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('reports a dirty tree when there are uncommitted changes', async () => {
    writeFileSync(join(repo, 'README.md'), '# Modified');
    const status = await inspectGitTree(repo);
    expect(status.kind).toBe('dirty');
    if (status.kind === 'dirty') {
      expect(status.changedPaths).toContain('README.md');
    }
    // Reset so later tests see a clean tree again
    await execFileAsync('git', ['checkout', '--', 'README.md'], { cwd: repo });
  });

  it('checkCleanTree opens the gate when tree is clean', async () => {
    const result = await checkCleanTree(repo, { allowDirty: false });
    expect(result.ok).toBe(true);
    expect(result.status.kind).toBe('clean');
    expect(result.message).toContain('clean');
  });

  it('checkCleanTree closes the gate when tree is dirty (no --allow-dirty)', async () => {
    writeFileSync(join(repo, 'extra.txt'), 'new file');
    const result = await checkCleanTree(repo, { allowDirty: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('uncommitted');
    expect(result.message).toContain('--allow-dirty');
    rmSync(join(repo, 'extra.txt'));
  });

  it('checkCleanTree opens the gate when tree is dirty AND --allow-dirty is passed', async () => {
    writeFileSync(join(repo, 'extra.txt'), 'new file');
    const result = await checkCleanTree(repo, { allowDirty: true });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('--allow-dirty');
    expect(result.message).toContain('cannot restore');
    rmSync(join(repo, 'extra.txt'));
  });

  it('reports not-a-repo in a non-git directory', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'planr-notgit-'));
    try {
      const status = await inspectGitTree(bare);
      expect(status.kind).toBe('not-a-repo');
    } finally {
      rmSync(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('checkCleanTree fails closed in a non-git directory without --allow-dirty', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'planr-notgit-'));
    try {
      const result = await checkCleanTree(bare, { allowDirty: false });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('git');
      expect(result.message).toContain('--allow-dirty');
    } finally {
      rmSync(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('checkCleanTree opens the gate in a non-git directory when --allow-dirty is passed', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'planr-notgit-'));
    try {
      const result = await checkCleanTree(bare, { allowDirty: true });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('disabled');
    } finally {
      rmSync(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
