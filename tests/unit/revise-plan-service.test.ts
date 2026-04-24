import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filterReplayable, readPlanFromAudit } from '../../src/services/revise-plan-service.js';

/** The real audit format emitted by audit-log-service, trimmed for test focus. */
const SAMPLE_AUDIT = `# Revise audit — EPIC-100 (2026-04-22)
> mode=dry-run · cascade=on · started=2026-04-22T10:00:00.000Z

## Entries

### [would-apply] FEAT-150
> /repo/.planr/features/FEAT-150-sample.md
> timestamp=2026-04-22T10:01:00.000Z

**Rationale:** Dependencies section was vague; replaced with concrete feature ids.

**Evidence:**
- [sibling_artifact] \`FEAT-151\` — "# FEAT-151: Title"
- [sibling_artifact] \`FEAT-152\` — "# FEAT-152: Another"

**Diff:**
\`\`\`diff
--- FEAT-150 (before)
+++ FEAT-150 (proposed)
@@ -5,3 +5,3 @@
 overview text
-All other features
+FEAT-151, FEAT-152
 more text
\`\`\`

### [skipped-by-agent] FEAT-151
> /repo/.planr/features/FEAT-151-another.md
> timestamp=2026-04-22T10:02:00.000Z

**Rationale:** No drift detected.

### [flagged] FEAT-152
> /repo/.planr/features/FEAT-152-flagged.md
> timestamp=2026-04-22T10:03:00.000Z

**Rationale:** Evidence insufficient to rewrite; human review needed.

**Ambiguous (human decision required):**
- §Overview: Unclear whether this describes v1 or v2 behavior.

## Summary
> completed=2026-04-22T10:04:00.000Z · entries=3
`;

describe('readPlanFromAudit', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-plan-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts scope and all entries from a real-shaped audit', () => {
    const auditPath = join(tmpDir, 'sample-audit.md');
    writeFileSync(auditPath, SAMPLE_AUDIT);

    const plan = readPlanFromAudit(auditPath);
    expect(plan.scope).toBe('EPIC-100');
    expect(plan.startedAt).toBe('2026-04-22T10:00:00.000Z');
    expect(plan.entries).toHaveLength(3);
  });

  it('captures rationale, artifact path, outcome, and diff on would-apply entries', () => {
    const auditPath = join(tmpDir, 'sample-apply.md');
    writeFileSync(auditPath, SAMPLE_AUDIT);

    const plan = readPlanFromAudit(auditPath);
    const feat150 = plan.entries.find((e) => e.artifactId === 'FEAT-150');
    expect(feat150).toBeDefined();
    expect(feat150?.outcome).toBe('would-apply');
    expect(feat150?.artifactPath).toBe('/repo/.planr/features/FEAT-150-sample.md');
    expect(feat150?.rationale).toContain('Dependencies section was vague');
    expect(feat150?.diff).toContain('+FEAT-151, FEAT-152');
    expect(feat150?.diff).toContain('-All other features');
  });

  it('extracts evidence citations with their quotes', () => {
    const auditPath = join(tmpDir, 'sample-evidence.md');
    writeFileSync(auditPath, SAMPLE_AUDIT);

    const plan = readPlanFromAudit(auditPath);
    const feat150 = plan.entries.find((e) => e.artifactId === 'FEAT-150');
    expect(feat150?.evidence).toHaveLength(2);
    expect(feat150?.evidence[0]).toEqual({
      type: 'sibling_artifact',
      ref: 'FEAT-151',
      quote: '# FEAT-151: Title',
    });
  });

  it('captures ambiguous entries for flagged decisions', () => {
    const auditPath = join(tmpDir, 'sample-ambig.md');
    writeFileSync(auditPath, SAMPLE_AUDIT);

    const plan = readPlanFromAudit(auditPath);
    const feat152 = plan.entries.find((e) => e.artifactId === 'FEAT-152');
    expect(feat152?.outcome).toBe('flagged');
    expect(feat152?.ambiguous).toHaveLength(1);
    expect(feat152?.ambiguous[0].section).toBe('Overview');
  });

  it('throws on a missing audit file', () => {
    expect(() => readPlanFromAudit(join(tmpDir, 'does-not-exist.md'))).toThrow(/Cannot read/);
  });

  it('throws on an audit with no recognizable header', () => {
    const bad = join(tmpDir, 'bad.md');
    writeFileSync(bad, '# Something Else\n\n## Entries\n');
    expect(() => readPlanFromAudit(bad)).toThrow(/recognizable header/);
  });

  it('throws on an audit with header but no entries', () => {
    const empty = join(tmpDir, 'empty.md');
    writeFileSync(
      empty,
      '# Revise audit — EPIC-999 (2026-04-22)\n> started=2026-04-22T00:00:00.000Z\n\n## Entries\n\n',
    );
    expect(() => readPlanFromAudit(empty)).toThrow(/no entries/);
  });
});

describe('filterReplayable', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-plan-filter-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only would-apply entries that have a diff and artifact path', () => {
    const auditPath = join(tmpDir, 'sample.md');
    writeFileSync(auditPath, SAMPLE_AUDIT);
    const plan = readPlanFromAudit(auditPath);

    const replayable = filterReplayable(plan);
    expect(replayable).toHaveLength(1);
    expect(replayable[0].artifactId).toBe('FEAT-150');
  });
});
