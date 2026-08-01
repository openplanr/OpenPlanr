import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { collectOperatingEvidence } from '../../src/services/operate/evidence.js';
import {
  createEvidenceDiagnostic,
  readEvidenceDiagnostic,
} from '../../src/services/operate/evidence-diagnostics.js';
import type { CollectedEvidenceItem } from '../../src/services/operate/types.js';
import {
  buildWorkspaceManifest,
  resolveOperatingPaths,
} from '../../src/services/operate/workspace.js';

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
    const target = join(
      resolveOperatingPaths(projectRoot, { localRoot }).quarantine,
      'diagnostics',
      `${diagnostic.candidateId}.json`,
    );
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
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

// T-003 / FR2 — a `maxFiles`/cap truncation mid-walk is no longer a silent
// boolean: it names the last path reached and the top-level directories the
// capped walk never scanned, in `evidence.warnings`.
describe('Operating Board evidence truncation diagnostics (FR2)', () => {
  const dirs: string[] = [];

  async function monorepoFixture(): Promise<{ projectRoot: string; localRoot: string }> {
    const projectRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-truncation-'));
    const localRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-truncation-local-'));
    dirs.push(projectRoot, localRoot);
    await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
      cwd: projectRoot,
    });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/openplanr/truncation-fixture.git'],
      { cwd: projectRoot },
    );
    // Three product top-level directories, one tracked file each, committed so
    // git recency and ls-files resolve.
    for (const dir of ['apps', 'infra', 'packages']) {
      await mkdir(join(projectRoot, dir), { recursive: true });
      await writeFile(join(projectRoot, dir, 'service.ts'), `export const ${dir} = true;\n`);
    }
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'monorepo fixture'], {
      cwd: projectRoot,
    });
    return { projectRoot, localRoot };
  }

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
  });

  it('records the last path reached and the top-level directories never scanned', async () => {
    const { projectRoot, localRoot } = await monorepoFixture();
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });

    // A hard item cap of 2 stops the round-robin walk after the first two
    // alphabetical product groups (apps, infra), leaving `packages` unscanned.
    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace,
      providers: ['repository'],
      sensitivityCeiling: 'internal',
      budgets: {
        maxFiles: 100,
        maxItems: 2,
        maxBytes: 2 * 1024 * 1024,
        maxItemBytes: 256 * 1024,
        maxDurationMs: 10_000,
      },
      now: new Date('2026-07-28T10:01:00.000Z'),
    });

    expect(evidence.truncated).toBe(true);
    const truncationWarning = evidence.warnings.find((warning) =>
      warning.includes('Repository evidence collection was truncated'),
    );
    expect(truncationWarning).toBeDefined();
    // Names the top-level directory the cap never reached.
    expect(truncationWarning).toContain('packages');
    // Names the last path actually reached (an examined product file).
    expect(truncationWarning).toMatch(/last path reached: (apps|infra)\/service\.ts/);
    // The two product directories that WERE reached are represented.
    const topLevels = new Set(evidence.items.map((entry) => entry.location.split('/').slice(1)[0]));
    expect(topLevels).toEqual(new Set(['apps', 'infra']));
  });
});
