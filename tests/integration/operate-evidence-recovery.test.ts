import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { createEvidenceDiagnostic } from '../../src/services/operate/evidence-diagnostics.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import type { CollectedEvidenceItem } from '../../src/services/operate/types.js';

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
