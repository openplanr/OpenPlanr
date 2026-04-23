/**
 * Integration tests for `syncLinearStatusIntoArtifacts` with QT + BL coverage.
 *
 * Locks in:
 *   - QT and BL artifacts are iterated alongside features and stories.
 *   - BL statuses use the backlog vocabulary (open/closed) — Linear
 *     "In Progress" does NOT demote a local BL to `in-progress` or similar.
 *   - `promoted` BL status is never overwritten even when Linear says "Done"
 *     — the promotion target pointer lives only locally.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { syncLinearStatusIntoArtifacts } from '../src/services/linear-pull-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'status-sync-test',
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
    },
    createdAt: '2026-04-23',
    linear: {
      teamId: 'team-uuid-abc',
      standaloneProjectId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    },
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-status-sync-'));
  const config = baseConfig();
  for (const subdir of ['quick', 'backlog', 'features', 'stories']) {
    await ensureDir(join(dir, '.planr', subdir));
  }
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

async function writeQT(
  dir: string,
  id: string,
  status: string,
  linearIssueId: string,
): Promise<void> {
  const body = `---\nid: "${id}"\ntitle: "${id} title"\nstatus: "${status}"\nlinearIssueId: "${linearIssueId}"\n---\n\n# ${id}: ${id} title\n\n## Tasks\n\n- [ ] **1.0** Do the thing\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-t.md`), body);
}

async function writeBL(
  dir: string,
  id: string,
  status: string,
  linearIssueId: string,
): Promise<void> {
  const body = `---\nid: "${id}"\ntitle: "${id} title"\npriority: "high"\ntags: ["bug"]\nstatus: "${status}"\ndescription: "BL desc."\nlinearIssueId: "${linearIssueId}"\n---\n\n# ${id}\n\n## Description\nBL desc.\n`;
  await writeFile(join(dir, '.planr', 'backlog', `${id}-t.md`), body);
}

/**
 * Build a LinearClient mock whose `issues()` call returns the shape that
 * `fetchLinearIssueStateNames` expects: a connection with `nodes` containing
 * `{id, state: Promise<{name}>}`.
 */
function makeClientWithStates(issueIdToState: Record<string, string>): LinearClient {
  const issues = vi.fn(async () => ({
    nodes: Object.entries(issueIdToState).map(([id, name]) => ({
      id,
      state: Promise.resolve({ name }),
    })),
  }));
  return { issues } as unknown as LinearClient;
}

describe('syncLinearStatusIntoArtifacts — QT status pull', () => {
  let dir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    dir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updates QT frontmatter when Linear state differs from local', async () => {
    const linearId = '11111111-1111-4111-8111-111111111111';
    await writeQT(dir, 'QT-100', 'pending', linearId);
    const client = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-100-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?in-progress["']?/);
  });

  it('leaves QT unchanged when Linear state maps to the same local status', async () => {
    const linearId = '22222222-2222-4222-8222-222222222222';
    await writeQT(dir, 'QT-101', 'done', linearId);
    const client = makeClientWithStates({ [linearId]: 'Completed' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
  });
});

describe('syncLinearStatusIntoArtifacts — BL status pull', () => {
  let dir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    dir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Linear "Done" transitions local BL open → closed', async () => {
    const linearId = '33333333-3333-4333-8333-333333333333';
    await writeBL(dir, 'BL-100', 'open', linearId);
    const client = makeClientWithStates({ [linearId]: 'Done' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-100-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?closed["']?/);
  });

  it('Linear "In Progress" leaves local BL open (in-flight stays open, never maps to in-progress)', async () => {
    const linearId = '44444444-4444-4444-8444-444444444444';
    await writeBL(dir, 'BL-101', 'open', linearId);
    const client = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    // Maps to `open` — same as local, so no write.
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-101-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?open["']?/);
    expect(raw).not.toMatch(/status: ["']?in-progress["']?/);
  });

  it('locally `promoted` BL is never overwritten when Linear says Done', async () => {
    // A BL was promoted to a QT/story locally. Linear only sees the "Done"
    // state. Pulling back as `closed` would destroy the `promoted → target`
    // linkage captured in the BL body. The sync must treat this as unchanged.
    const linearId = '55555555-5555-4555-8555-555555555555';
    await writeBL(dir, 'BL-102', 'promoted', linearId);
    const client = makeClientWithStates({ [linearId]: 'Done' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-102-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?promoted["']?/);
  });
});
