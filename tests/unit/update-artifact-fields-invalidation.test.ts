/**
 * `updateArtifactFields` — baseline-invalidation behavior (BL-sync-009).
 *
 * Whenever a caller updates `status` WITHOUT explicitly writing a new
 * `linearStatusReconciled`, the write should clear the baseline so the
 * next `planr linear sync` treats it as "local changed since last sync"
 * and pushes it to Linear. The sync itself opts out by passing its own
 * `linearStatusReconciled` value — that path must not be clobbered.
 *
 * Lives in this file rather than the main artifact-service test because
 * that file uses heavy mocking of fs / parseMarkdown that would paper
 * over the real behavior. This uses a real tmpdir to exercise the
 * frontmatter rewrite end-to-end.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { updateArtifactFields } from '../../src/services/artifact-service.js';
import { ensureDir, writeFile } from '../../src/utils/fs.js';

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'invalidation-test',
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
  };
}

describe('updateArtifactFields — linearStatusReconciled baseline invalidation', () => {
  let dir: string;
  const config = baseConfig();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'planr-invalidation-'));
    await ensureDir(join(dir, '.planr', 'quick'));
    await ensureDir(join(dir, '.planr', 'backlog'));
    await ensureDir(join(dir, '.planr', 'stories'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function writeQT(id: string, reconciled: string): Promise<string> {
    const body = `---\nid: "${id}"\ntitle: "${id} title"\nstatus: "pending"\nlinearIssueId: "uuid-${id}"\nlinearStatusReconciled: "${reconciled}"\n---\n\n# ${id}\n`;
    const p = join(dir, '.planr', 'quick', `${id}-t.md`);
    await writeFile(p, body);
    return p;
  }

  it('clears linearStatusReconciled when a caller updates status without setting a new baseline', async () => {
    const path = await writeQT('QT-500', 'in-progress');
    await updateArtifactFields(dir, config, 'quick', 'QT-500', { status: 'done' });
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toMatch(/status: ["']?done["']?/);
    expect(raw).toMatch(/linearStatusReconciled: ["']{2}/); // cleared to ""
  });

  it('preserves the caller-supplied linearStatusReconciled when it is explicit (sync path)', async () => {
    // The sync itself writes both fields together. That case must NOT be
    // auto-cleared — the sync's value is the new baseline.
    const path = await writeQT('QT-501', 'in-progress');
    await updateArtifactFields(dir, config, 'quick', 'QT-501', {
      status: 'done',
      linearStatusReconciled: 'done',
    });
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toMatch(/status: ["']?done["']?/);
    expect(raw).toMatch(/linearStatusReconciled: ["']?done["']?/);
  });

  it('does NOT touch linearStatusReconciled when the update has no status change', async () => {
    // e.g. updating just `owner` or a non-status field shouldn't invalidate
    // the sync baseline.
    const path = await writeQT('QT-502', 'in-progress');
    await updateArtifactFields(dir, config, 'quick', 'QT-502', { title: 'renamed' });
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toMatch(/linearStatusReconciled: ["']?in-progress["']?/);
  });

  it('works across artifact types — applies to backlog updates too', async () => {
    const blPath = join(dir, '.planr', 'backlog', 'BL-500-t.md');
    await writeFile(
      blPath,
      `---\nid: "BL-500"\ntitle: "BL-500"\npriority: "high"\ntags: ["bug"]\nstatus: "open"\ndescription: "x"\nlinearIssueId: "uuid-bl"\nlinearStatusReconciled: "open"\n---\n\n# BL-500\n`,
    );
    await updateArtifactFields(dir, config, 'backlog', 'BL-500', { status: 'closed' });
    const raw = readFileSync(blPath, 'utf-8');
    expect(raw).toMatch(/status: ["']?closed["']?/);
    expect(raw).toMatch(/linearStatusReconciled: ["']{2}/);
  });
});
