import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEvidenceDiagnostic,
  readEvidenceDiagnostic,
} from '../../src/services/operate/evidence-diagnostics.js';
import type { CollectedEvidenceItem } from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function fixture(): Promise<{
  projectRoot: string;
  localRoot: string;
  item: CollectedEvidenceItem;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-diagnostic-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-diagnostic-local-'));
  directories.push(projectRoot, localRoot);
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'fixture.yml'), 'passwordInput: placeholder\n');
  await execFileAsync('git', ['add', 'fixture.yml'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return {
    projectRoot,
    localRoot,
    item: {
      id: 'EV-test',
      source: 'repository',
      location: 'fixture.yml',
      content: 'passwordInput: placeholder\n',
      collectedAt: '2026-07-29T12:00:00.000Z',
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['repository-state'],
      quality: 'verified',
      coverage: 'complete',
      repository: {
        componentId: 'control',
        canonicalRemote: 'local:test',
        revision: 'fixture',
        configuredBranch: 'main',
        dirtyFingerprint: null,
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('Operating Board evidence diagnostics', () => {
  it('persists a Protocol-valid, value-free, mode-0600 diagnostic', async () => {
    const { projectRoot, localRoot, item } = await fixture();
    const diagnostic = await createEvidenceDiagnostic({
      projectRoot,
      localRoot,
      item,
      detection: {
        ruleId: 'structured-secret.v1',
        category: 'structured-secret',
        line: 1,
        hardBlock: false,
      },
    });
    expect(diagnostic).toMatchObject({
      kind: 'evidence-diagnostic',
      protocolVersion: '1.2.0',
      source: 'repository',
      componentId: 'control',
      location: 'fixture.yml',
      line: 1,
      valueDisclosed: false,
    });
    const saved = await readEvidenceDiagnostic({
      projectRoot,
      localRoot,
      candidateId: diagnostic.candidateId,
    });
    const files = await execFileAsync('find', [
      join(localRoot, 'operate'),
      '-name',
      `${diagnostic.candidateId}.json`,
      '-print',
    ]);
    const target = files.stdout.trim();
    expect(target).not.toBe('');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(target, 'utf8');
    expect(serialized).not.toContain('placeholder');
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(localRoot);
    expect(saved).toEqual(diagnostic);
  });

  it('withholds unsafe absolute locations while retaining an opaque candidate', async () => {
    const { projectRoot, localRoot, item } = await fixture();
    const diagnostic = await createEvidenceDiagnostic({
      projectRoot,
      localRoot,
      item: { ...item, location: '/Users/private/project/.env' },
      detection: {
        ruleId: 'known-token.v1',
        category: 'known-token',
        line: 2,
        hardBlock: true,
      },
    });
    expect(diagnostic).not.toHaveProperty('location');
    expect(diagnostic.candidateId).toMatch(/^EVC-/);
  });
});
