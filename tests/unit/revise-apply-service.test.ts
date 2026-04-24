/**
 * End-to-end test for the apply-from-audit replay path (BL-005).
 *
 * Exercises `runApplyFromAudit` against a synthetic audit file + a real
 * artifact on disk, verifying:
 *   - Diffs are applied atomically to target artifacts
 *   - Clean-tree gate blocks dirty trees (with `--allow-dirty` override)
 *   - Stale artifacts (source drifted since dry-run) are skipped, not silently rewritten
 *   - Zero AI tokens spent (guaranteed by construction — no AI provider injected)
 */

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';
import { runApplyFromAudit } from '../../src/services/revise-apply-service.js';

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

/**
 * Build an audit-format markdown file that readPlanFromAudit + applyUnifiedDiff
 * can replay.
 */
function buildSampleAudit(artifactPath: string, oldBlock: string, newBlock: string): string {
  return `# Revise audit — EPIC-200 (2026-04-22)
> mode=dry-run · cascade=off · started=2026-04-22T12:00:00.000Z

## Entries

### [would-apply] EPIC-200
> ${artifactPath}
> timestamp=2026-04-22T12:00:01.000Z

**Rationale:** Replace the Dependencies block with the real values.

**Evidence:**
- [file_exists] \`src/services/credentials-service.ts\`

**Diff:**
\`\`\`diff
--- EPIC-200 (before)
+++ EPIC-200 (proposed)
@@ -1,3 +1,3 @@
 # EPIC-200: Sample
-${oldBlock}
+${newBlock}
 trailer
\`\`\`

## Summary
> completed=2026-04-22T12:00:02.000Z · entries=1
`;
}

describe('runApplyFromAudit', () => {
  let projectDir: string;
  const config = createDefaultConfig('apply-test');

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'planr-apply-'));
    await gitInit(projectDir);
    mkdirSync(join(projectDir, '.planr', 'epics'), { recursive: true });
    mkdirSync(join(projectDir, '.planr', 'reports'), { recursive: true });
    writeFileSync(
      join(projectDir, '.planr', 'epics', 'EPIC-200-sample.md'),
      '# EPIC-200: Sample\nold dependencies\ntrailer\n',
    );
    await gitCommit(projectDir, 'initial');
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('applies the plan to disk and returns exit code 0', async () => {
    const artifactPath = join(projectDir, '.planr', 'epics', 'EPIC-200-sample.md');
    const auditPath = join(projectDir, '.planr', 'reports', 'audit-apply-test.md');
    writeFileSync(
      auditPath,
      buildSampleAudit(artifactPath, 'old dependencies', 'new dependencies'),
    );

    const code = await runApplyFromAudit({
      projectDir,
      config,
      auditPath,
      allowDirty: true,
      dryRun: false,
      yes: true, // non-interactive; uses the TTY-skip in confirmBulkRevise
    });

    expect(code).toBe(0);
    const after = readFileSync(artifactPath, 'utf-8');
    expect(after).toContain('new dependencies');
    expect(after).not.toContain('old dependencies');

    // Restore for subsequent tests.
    writeFileSync(artifactPath, '# EPIC-200: Sample\nold dependencies\ntrailer\n');
    await gitCommit(projectDir, 'reset after apply test');
  });

  it('dry-run mode leaves artifacts unchanged', async () => {
    const artifactPath = join(projectDir, '.planr', 'epics', 'EPIC-200-sample.md');
    const auditPath = join(projectDir, '.planr', 'reports', 'audit-dryrun-test.md');
    writeFileSync(
      auditPath,
      buildSampleAudit(artifactPath, 'old dependencies', 'new dependencies'),
    );

    const before = readFileSync(artifactPath, 'utf-8');
    const code = await runApplyFromAudit({
      projectDir,
      config,
      auditPath,
      allowDirty: true,
      dryRun: true,
      yes: true,
    });
    expect(code).toBe(0);
    expect(readFileSync(artifactPath, 'utf-8')).toBe(before);
  });

  it('skips stale entries when the source has drifted since dry-run', async () => {
    const artifactPath = join(projectDir, '.planr', 'epics', 'EPIC-200-sample.md');
    // Simulate drift: file no longer contains the `old dependencies` line
    // that the diff's context expects.
    writeFileSync(artifactPath, '# EPIC-200: Sample\nLOCAL EDIT\ntrailer\n');
    await gitCommit(projectDir, 'local drift');

    const auditPath = join(projectDir, '.planr', 'reports', 'audit-stale-test.md');
    writeFileSync(
      auditPath,
      buildSampleAudit(artifactPath, 'old dependencies', 'new dependencies'),
    );

    const before = readFileSync(artifactPath, 'utf-8');
    const code = await runApplyFromAudit({
      projectDir,
      config,
      auditPath,
      allowDirty: true,
      dryRun: false,
      yes: true,
    });
    // Returning 0 even on skipped entries — skipping is a recorded outcome,
    // not a fatal error. The user can inspect the apply audit to see what
    // was skipped.
    expect(code).toBe(0);
    expect(readFileSync(artifactPath, 'utf-8')).toBe(before); // unchanged

    // Restore.
    writeFileSync(artifactPath, '# EPIC-200: Sample\nold dependencies\ntrailer\n');
    await gitCommit(projectDir, 'reset after stale test');
  });

  it('clean-tree gate blocks replay on a dirty tree without --allow-dirty', async () => {
    const artifactPath = join(projectDir, '.planr', 'epics', 'EPIC-200-sample.md');
    const auditPath = join(projectDir, '.planr', 'reports', 'audit-cleantree-test.md');
    writeFileSync(
      auditPath,
      buildSampleAudit(artifactPath, 'old dependencies', 'new dependencies'),
    );
    // Audit file itself makes the tree dirty — exactly the scenario we want.
    const code = await runApplyFromAudit({
      projectDir,
      config,
      auditPath,
      allowDirty: false,
      dryRun: false,
      yes: true,
    });
    expect(code).toBe(1);
  });

  it('fails fast when the audit file is missing', async () => {
    const code = await runApplyFromAudit({
      projectDir,
      config,
      auditPath: join(projectDir, '.planr', 'reports', 'never-written.md'),
      allowDirty: true,
      dryRun: false,
      yes: true,
    });
    expect(code).toBe(1);
  });
});
