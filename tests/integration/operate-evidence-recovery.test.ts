import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import {
  buildOperatingEvidenceIndex,
  collectOperatingEvidence,
  starvedRoleEvidenceGaps,
} from '../../src/services/operate/evidence.js';
import { createEvidenceDiagnostic } from '../../src/services/operate/evidence-diagnostics.js';
import { evaluateEvidenceReadiness } from '../../src/services/operate/evidence-readiness.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import { narrowEvidenceToMissionCeiling } from '../../src/services/operate/maintenance.js';
import type { CollectedEvidenceItem } from '../../src/services/operate/types.js';
import { buildWorkspaceManifest } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function initializedFixture(): Promise<{
  projectRoot: string;
  localRoot: string;
  item: CollectedEvidenceItem;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-recovery-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-recovery-local-'));
  directories.push(projectRoot, localRoot);
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'service.yml'), 'passwordInput: placeholder\n');
  await execFileAsync('git', ['add', 'service.yml'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'saas',
    decisionOwner: 'Asem',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository'],
    charter: {
      purpose: 'Test exact evidence recovery.',
      goals: ['Preserve secret quarantine.'],
    },
    now: '2026-07-29T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return {
    projectRoot,
    localRoot,
    item: {
      id: 'EV-test',
      source: 'repository',
      location: 'service.yml',
      content: 'passwordInput: placeholder\n',
      collectedAt: '2026-07-29T12:00:00.000Z',
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['repository-state'],
      quality: 'verified',
      coverage: 'complete',
    },
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('Operating Board evidence recovery', () => {
  it('requires a digest-bound preview and stores only exact classification metadata', async () => {
    const { projectRoot, localRoot, item } = await initializedFixture();
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
    const diagnosed = await executeOperateAction({
      action: 'evidence.diagnose',
      projectRoot,
      arguments: { candidateId: diagnostic.candidateId },
      options: { json: true, localRoot },
      interactive: false,
    });
    expect(JSON.stringify(diagnosed)).not.toContain('placeholder');
    expect(diagnosed).toMatchObject({
      ok: true,
      data: {
        valueDisclosed: false,
        diagnostic: { candidateId: diagnostic.candidateId },
      },
    });

    const preview = await executeOperateAction({
      action: 'evidence.classify',
      projectRoot,
      arguments: { candidateId: diagnostic.candidateId },
      options: {
        json: true,
        localRoot,
        status: 'false-positive',
        reason: 'This is a UI selector name, not credential material.',
      },
      interactive: false,
    });
    const digest = preview.actions?.[0]?.confirmationDigest;
    expect(digest).toMatch(/^sha256:/);
    const applied = await executeOperateAction({
      action: 'evidence.classify',
      projectRoot,
      arguments: { candidateId: diagnostic.candidateId },
      options: {
        json: true,
        localRoot,
        yes: true,
        confirm: digest,
        status: 'false-positive',
        reason: 'This is a UI selector name, not credential material.',
      },
      interactive: false,
    });
    expect(applied).toMatchObject({
      ok: true,
      data: {
        state: 'classified',
        diagnostic: {
          candidateId: diagnostic.candidateId,
          classification: { status: 'false-positive', classifiedBy: 'Asem' },
        },
      },
    });
  });

  it('gates a starved repository role with a governed gap while other roles still dispatch (FR2)', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-starve-'));
    const localRoot = await mkdtemp(join(tmpdir(), 'operate-evidence-starve-local-'));
    directories.push(projectRoot, localRoot);
    await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
      cwd: projectRoot,
    });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/openplanr/starve-fixture.git'],
      { cwd: projectRoot },
    );
    // Every tracked file lives under a dot-prefixed tree, so all repository items
    // are dropped by the mission index path pattern — the post-index evidence
    // retains zero repository items.
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001.md'),
      '# Roadmap\nActivation and retention are the current priorities.\n',
    );
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'dot-only fixture'], {
      cwd: projectRoot,
    });
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-29T12:00:00.000Z',
    });

    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace,
      providers: ['repository', 'planr', 'git'],
      sensitivityCeiling: 'internal',
      budgets: {
        maxFiles: 100,
        maxItems: 100,
        maxBytes: 2 * 1024 * 1024,
        maxItemBytes: 256 * 1024,
        maxDurationMs: 10_000,
      },
      now: new Date('2026-07-29T12:01:00.000Z'),
    });

    const missionEvidenceIndex = buildOperatingEvidenceIndex(
      narrowEvidenceToMissionCeiling(evidence, 'internal'),
      { sensitivityCeiling: 'internal' },
    );
    expect(missionEvidenceIndex.some((item) => item.source === 'repository')).toBe(false);

    const readiness = await evaluateEvidenceReadiness({
      cycleId: 'CYCLE-001',
      evidence,
      enabledRoles: ['technology-risk', 'strategy-finance'],
      now: new Date('2026-07-29T12:01:00.000Z'),
      missionEvidenceIndex,
    });
    const starved = readiness.roles.filter((role) => !role.modelCallAllowed).map((r) => r.roleId);
    const ready = readiness.roles.filter((role) => role.modelCallAllowed).map((r) => r.roleId);
    // The repository-dependent role is gated; a repository-independent role still
    // dispatches — the batch is not thrown wholesale.
    expect(starved).toEqual(['technology-risk']);
    expect(ready).toContain('strategy-finance');

    const gaps = await starvedRoleEvidenceGaps({
      cycleId: 'CYCLE-001',
      roleIds: starved,
      owner: 'Asem',
      now: '2026-07-29T12:01:00.000Z',
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      kind: 'operating-data-gap',
      affectedRoles: ['technology-risk'],
      status: 'open',
      owner: 'Asem',
    });
  });

  it('never permits known credential signatures to become false positives', async () => {
    const { projectRoot, localRoot, item } = await initializedFixture();
    const diagnostic = await createEvidenceDiagnostic({
      projectRoot,
      localRoot,
      item: { ...item, content: 'npm_abcdefghijklmnopqrstuvwxyz0123456789' },
      detection: {
        ruleId: 'known-token.v1',
        category: 'known-token',
        line: 1,
        hardBlock: true,
      },
    });
    const result = await executeOperateAction({
      action: 'evidence.classify',
      projectRoot,
      arguments: { candidateId: diagnostic.candidateId },
      options: {
        json: true,
        localRoot,
        status: 'false-positive',
        reason: 'Attempted override.',
      },
      interactive: false,
    });
    expect(result).toMatchObject({ ok: false, code: 'E_OPERATE_SECRET_DETECTED' });
    expect(JSON.stringify(result)).not.toContain('npm_');
  });
});
