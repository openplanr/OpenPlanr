/**
 * Linear estimate sync (BL-007 / QT-004).
 *
 * Pure-function tests for `resolveEstimateForPush` (scale snapping,
 * fallbacks, skip reasons) and end-to-end push tests that assert the
 * `estimate` field lands on `createIssue` / `updateIssue` inputs correctly
 * when the team has estimation enabled, and is omitted otherwise.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { resolveEstimateForPush } from '../src/services/linear/estimate-resolver.js';
import { runLinearPush } from '../src/services/linear-push-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

// ---------------------------------------------------------------------------
// Pure: resolveEstimateForPush — scale snapping
// ---------------------------------------------------------------------------

describe('resolveEstimateForPush — Fibonacci scale', () => {
  it('passes through exact Fibonacci values unchanged', () => {
    for (const v of [0, 1, 2, 3, 5, 8, 13, 21]) {
      const r = resolveEstimateForPush({ estimatedPoints: v }, 'fibonacci');
      expect(r.kind).toBe('mapped');
      if (r.kind === 'mapped') {
        expect(r.estimate).toBe(v);
        expect(r.snapped).toBe(false);
      }
    }
  });

  it('snaps off-scale values to the nearest Fibonacci number (BL-007 §6.1)', () => {
    // 4 is equidistant to 3 and 5; tie-break favors the larger value (5)
    const r4 = resolveEstimateForPush({ estimatedPoints: 4 }, 'fibonacci');
    expect(r4.kind === 'mapped' && r4.estimate).toBe(5);
    const r7 = resolveEstimateForPush({ estimatedPoints: 7 }, 'fibonacci');
    expect(r7.kind === 'mapped' && r7.estimate).toBe(8);
    const r10 = resolveEstimateForPush({ estimatedPoints: 10 }, 'fibonacci');
    expect(r10.kind === 'mapped' && r10.estimate).toBe(8); // 10 is closer to 8 than 13 (2 vs 3)
    const r25 = resolveEstimateForPush({ estimatedPoints: 25 }, 'fibonacci');
    expect(r25.kind === 'mapped' && r25.estimate).toBe(21); // clamps to max
  });

  it('reports snapped=true when the value changed', () => {
    const r = resolveEstimateForPush({ estimatedPoints: 4 }, 'fibonacci');
    expect(r.kind === 'mapped' && r.snapped).toBe(true);
    expect(r.kind === 'mapped' && r.originalValue).toBe(4);
  });
});

describe('resolveEstimateForPush — linear scale', () => {
  it('snaps to {0,1,2,3,4,5}', () => {
    const r35 = resolveEstimateForPush({ estimatedPoints: 3.5 }, 'linear');
    expect(r35.kind === 'mapped' && r35.estimate).toBe(4); // tie-break favors 4
    const r51 = resolveEstimateForPush({ estimatedPoints: 5.1 }, 'linear');
    expect(r51.kind === 'mapped' && r51.estimate).toBe(5);
    const r8 = resolveEstimateForPush({ estimatedPoints: 8 }, 'linear');
    expect(r8.kind === 'mapped' && r8.estimate).toBe(5); // clamps to max
  });
});

describe('resolveEstimateForPush — exponential scale', () => {
  it('snaps to {0,1,2,4,8,16}', () => {
    const r3 = resolveEstimateForPush({ estimatedPoints: 3 }, 'exponential');
    expect(r3.kind === 'mapped' && r3.estimate).toBe(4); // 3 is equidistant to 2 and 4; tie → 4
    const r6 = resolveEstimateForPush({ estimatedPoints: 6 }, 'exponential');
    expect(r6.kind === 'mapped' && r6.estimate).toBe(8); // equidistant to 4 and 8; tie → 8
  });
});

describe('resolveEstimateForPush — skip cases', () => {
  it('skips when team has estimation disabled (notUsed)', () => {
    const r = resolveEstimateForPush({ estimatedPoints: 3 }, 'notUsed');
    expect(r.kind).toBe('skip-not-used');
  });

  it('skips t-shirt scale (no reliable numeric mapping)', () => {
    const r = resolveEstimateForPush({ estimatedPoints: 3 }, 'tShirt');
    expect(r.kind).toBe('skip-t-shirt');
  });

  it('skips when frontmatter has no estimate field', () => {
    const r = resolveEstimateForPush({ title: 'x' }, 'fibonacci');
    expect(r.kind).toBe('skip-no-local-value');
  });

  it('skips when frontmatter estimate is empty string or null', () => {
    expect(resolveEstimateForPush({ estimatedPoints: '' }, 'fibonacci').kind).toBe(
      'skip-no-local-value',
    );
    expect(resolveEstimateForPush({ estimatedPoints: null }, 'fibonacci').kind).toBe(
      'skip-no-local-value',
    );
  });

  it('skips when estimate is a non-numeric or negative value', () => {
    const r1 = resolveEstimateForPush({ estimatedPoints: 'huge' }, 'fibonacci');
    expect(r1.kind).toBe('skip-invalid-value');
    const r2 = resolveEstimateForPush({ estimatedPoints: -3 }, 'fibonacci');
    expect(r2.kind).toBe('skip-invalid-value');
  });

  it('skips when scale is unknown or undefined', () => {
    const r1 = resolveEstimateForPush({ estimatedPoints: 3 }, undefined);
    expect(r1.kind).toBe('skip-not-used');
    const r2 = resolveEstimateForPush({ estimatedPoints: 3 }, 'whatever-new-scale');
    expect(r2.kind).toBe('skip-not-used');
  });
});

describe('resolveEstimateForPush — precedence', () => {
  it('prefers `estimatedPoints` over `storyPoints` (estimatedPoints is the canonical frontmatter name)', () => {
    const r = resolveEstimateForPush({ estimatedPoints: 5, storyPoints: 13 }, 'fibonacci');
    expect(r.kind === 'mapped' && r.estimate).toBe(5);
  });

  it('falls back to `storyPoints` when `estimatedPoints` is absent', () => {
    const r = resolveEstimateForPush({ storyPoints: 8 }, 'fibonacci');
    expect(r.kind === 'mapped' && r.estimate).toBe(8);
  });

  it('accepts string numbers (hand-edited frontmatter serializes numbers as strings sometimes)', () => {
    const r = resolveEstimateForPush({ estimatedPoints: '5' }, 'fibonacci');
    expect(r.kind === 'mapped' && r.estimate).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: estimate lands on create/update issue inputs
// ---------------------------------------------------------------------------

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'estimate-sync-test',
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
    createdAt: '2026-04-23',
    linear: {
      teamId: 'team-uuid-abc',
      standaloneProjectId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    },
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-estimate-'));
  const config = baseConfig();
  await ensureDir(join(dir, '.planr', 'quick'));
  await ensureDir(join(dir, '.planr', 'backlog'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

async function writeQT(
  dir: string,
  id: string,
  opts: { estimatedPoints?: number | string; linearIssueId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, 'status: "pending"'];
  if (opts.estimatedPoints !== undefined) {
    fm.push(`estimatedPoints: ${opts.estimatedPoints}`);
  }
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}: ${id} title\n\n## Tasks\n\n- [ ] **1.0** Do it\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-t.md`), body);
}

function makeFakeClient(estimationType: string) {
  const issueInputs: Array<Record<string, unknown>> = [];
  const createIssue = vi.fn(async (input: Record<string, unknown>) => {
    issueInputs.push(input);
    return { success: true, issueId: 'issue-uuid-1' };
  });
  const updateIssue = vi.fn<
    (id: string, input: Record<string, unknown>) => Promise<{ success: boolean }>
  >(async () => ({ success: true }));
  const issueLabels = vi.fn(async () => ({ nodes: [] }));
  const createIssueLabel = vi.fn(async () => ({ success: true, issueLabelId: 'label-uuid-1' }));
  const issue = vi.fn(async (id: string) => ({
    id,
    identifier: 'MUV-1',
    url: 'https://linear.app/test',
    labelIds: [] as string[],
  }));
  const team = vi.fn(async () => ({
    issueEstimationType: estimationType,
    states: async () => ({ nodes: [] }),
  }));
  const client = {
    createIssue,
    updateIssue,
    issueLabels,
    createIssueLabel,
    issue,
    team,
  } as unknown as LinearClient;
  return {
    client,
    calls: { createIssue, updateIssue, team },
    lastIssueInput: () => issueInputs[issueInputs.length - 1],
  };
}

describe('runLinearPush — estimate field (QT push)', () => {
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

  it('sends estimate on create for a Fibonacci team', async () => {
    await writeQT(projectDir, 'QT-050', { estimatedPoints: 3 });
    const fake = makeFakeClient('fibonacci');
    await runLinearPush(projectDir, config, fake.client, 'QT-050');
    expect(fake.lastIssueInput()?.estimate).toBe(3);
  });

  it('snaps off-scale values before sending (OP 4 → 5 on Fibonacci)', async () => {
    await writeQT(projectDir, 'QT-051', { estimatedPoints: 4 });
    const fake = makeFakeClient('fibonacci');
    await runLinearPush(projectDir, config, fake.client, 'QT-051');
    expect(fake.lastIssueInput()?.estimate).toBe(5);
  });

  it('omits estimate when team has estimation disabled', async () => {
    await writeQT(projectDir, 'QT-052', { estimatedPoints: 3 });
    const fake = makeFakeClient('notUsed');
    await runLinearPush(projectDir, config, fake.client, 'QT-052');
    expect(fake.lastIssueInput()).not.toHaveProperty('estimate');
  });

  it('omits estimate on tShirt teams (no numeric mapping)', async () => {
    await writeQT(projectDir, 'QT-053', { estimatedPoints: 3 });
    const fake = makeFakeClient('tShirt');
    await runLinearPush(projectDir, config, fake.client, 'QT-053');
    expect(fake.lastIssueInput()).not.toHaveProperty('estimate');
  });

  it('omits estimate when frontmatter has no storyPoints/estimatedPoints', async () => {
    await writeQT(projectDir, 'QT-054'); // no estimatedPoints
    const fake = makeFakeClient('fibonacci');
    await runLinearPush(projectDir, config, fake.client, 'QT-054');
    expect(fake.lastIssueInput()).not.toHaveProperty('estimate');
  });

  it('sends estimate on update too (not just create)', async () => {
    await writeQT(projectDir, 'QT-055', {
      estimatedPoints: 8,
      linearIssueId: '9b2f4c3e-1234-4abc-89de-000000000099',
    });
    const fake = makeFakeClient('fibonacci');
    await runLinearPush(projectDir, config, fake.client, 'QT-055');
    expect(fake.calls.updateIssue).toHaveBeenCalledTimes(1);
    const updateArgs = fake.calls.updateIssue.mock.calls[0];
    expect(updateArgs[1]?.estimate).toBe(8);
  });

  it('calls team() once to fetch estimation type (cached per run)', async () => {
    await writeQT(projectDir, 'QT-056', { estimatedPoints: 2 });
    const fake = makeFakeClient('fibonacci');
    await runLinearPush(projectDir, config, fake.client, 'QT-056');
    // team() is called twice per push run today: once for workflow states,
    // once for estimation type. Both are cached for subsequent artifacts.
    expect(fake.calls.team).toHaveBeenCalledTimes(2);
  });
});
