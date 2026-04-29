/**
 * BL-016 regression fence — `planr linear tasklist-sync` must accept healthy
 * UUID issue ids and only reject values that don't match a valid Linear
 * issue form.
 *
 * The earlier implementation pre-screened issue ids with
 * `isLikelyLinearWorkflowStateId`, which fired on every healthy task because
 * Linear issue ids and workflow-state ids are both UUIDv4 and indistinguishable
 * by shape. That guard was removed; this test prevents it from coming back
 * while preserving the legitimate guard for malformed values like `ENG42`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { runLinearTaskCheckboxSync } from '../src/services/linear-pull-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'tasklist-sync-stale-id-test',
    targets: ['cursor'],
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
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
      spec: 'SPEC',
    },
    createdAt: '2026-04-29',
    linear: { teamId: 'team-uuid-abc' },
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-stale-id-'));
  const config = baseConfig();
  await ensureDir(join(dir, '.planr', 'tasks'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

async function writeTaskFile(
  dir: string,
  id: string,
  linearIssueId: string,
  body = '## Tasks\n\n- [ ] **1.0** Task one\n',
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    'featureId: "FEAT-001"',
    `linearIssueId: "${linearIssueId}"`,
  ];
  await writeFile(
    join(dir, '.planr', 'tasks', `${id}-test.md`),
    `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n${body}`,
  );
}

/** Minimal fake `LinearClient.issue(id)` that returns an empty description so the merge does nothing. */
function fakeClientWithEmptyIssue(): LinearClient {
  return {
    issue: vi.fn(async () => ({ description: '' })),
    updateIssue: vi.fn(),
  } as unknown as LinearClient;
}

describe('runLinearTaskCheckboxSync — stale-id screening (BL-016)', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('accepts a valid UUIDv4 issue id and processes the task (no false-positive skip)', async () => {
    // Real Linear issue id shape — UUIDv4, same shape as workflow-state ids.
    await writeTaskFile(projectDir, 'TASK-001', '9b2f4c3e-1234-4abc-89de-fedcba987654');
    const client = fakeClientWithEmptyIssue();

    const summary = await runLinearTaskCheckboxSync(projectDir, config, client, {
      onConflict: 'linear',
      dryRun: true,
    });

    expect(summary.skippedStaleId).toBe(0);
    expect(summary.filesProcessed).toBe(1);
  });

  it('still rejects malformed issue ids (e.g. `ENG42` no hyphen) — preserves the legitimate guard', async () => {
    await writeTaskFile(projectDir, 'TASK-002', 'ENG42');
    const client = fakeClientWithEmptyIssue();

    const summary = await runLinearTaskCheckboxSync(projectDir, config, client, {
      onConflict: 'linear',
      dryRun: true,
    });

    expect(summary.skippedStaleId).toBe(1);
    expect(summary.filesProcessed).toBe(0);
  });

  it('accepts a Linear identifier-shape issue id (`ENG-42`)', async () => {
    await writeTaskFile(projectDir, 'TASK-003', 'ENG-42');
    const client = fakeClientWithEmptyIssue();

    const summary = await runLinearTaskCheckboxSync(projectDir, config, client, {
      onConflict: 'linear',
      dryRun: true,
    });

    expect(summary.skippedStaleId).toBe(0);
    expect(summary.filesProcessed).toBe(1);
  });
});
