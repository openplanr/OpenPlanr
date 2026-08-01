import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import {
  diagnoseOperatingBoard,
  type OperatingDoctorDiagnostic,
} from '../../src/services/operate/doctor.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

/**
 * Detection coverage for the Protocol v1.3 storage diagnostics:
 * `operate-layout` and `operate-records`. The pre-existing codes are covered by
 * `operate-doctor.test.ts`; this suite fires the new codes' pass AND failure
 * branches against real on-disk fixtures. Every asserted message/fix string is
 * the literal text `doctor.ts` emits (see the diagnostic implementations), never
 * invented.
 */

let root: string;
let projectRoot: string;
let localRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-operate-doctor-v13-'));
  projectRoot = join(root, 'project');
  localRoot = join(root, 'state');
  mkdirSync(projectRoot, { recursive: true });
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterEach(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function paths() {
  return resolveOperatingPaths(projectRoot, { localRoot });
}

async function runDoctor(): Promise<OperatingDoctorDiagnostic[]> {
  return diagnoseOperatingBoard({ projectRoot, localRoot, pipelineVersion: '0.33.1' });
}

function byCode(
  diagnostics: OperatingDoctorDiagnostic[],
  code: string,
): OperatingDoctorDiagnostic | undefined {
  const matches = diagnostics.filter((entry) => entry.code === code);
  // Additivity guard: each new v1.3 code must appear exactly once per run.
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** A genuinely valid v1.3 project: `.planr/operate/.state/` with an empty chain. */
async function initFreshV13Project(): Promise<void> {
  await new OperatingEventStore(projectRoot, { localRoot }).initialize();
}

/**
 * One canonical, internally-consistent `records.jsonl` line, computed with the
 * exact digest formula `diagnoseRecordsLog` recomputes (contentDigest is the
 * canonical digest of `content`; digest is the canonical digest of the
 * `{recordType, createdAt, correlationId, contentDigest}` tuple).
 */
function consistentRecordsLine(): string {
  const recordType = 'recovery';
  const createdAt = '2026-07-31T00:00:00.000Z';
  const correlationId = 'operate-doctor-v13-fixture';
  const content = { kind: 'fixture', note: 'valid record content' };
  const contentDigest = canonicalDigest(content);
  const digest = canonicalDigest({ recordType, createdAt, correlationId, contentDigest });
  return JSON.stringify({
    kind: 'operating-records-log-entry',
    schemaVersion: '1.0.0',
    protocolVersion: '1.3.0',
    digest,
    recordType,
    createdAt,
    correlationId,
    contentDigest,
    content,
  });
}

function writeRecordsLog(contents: string): void {
  writeFileSync(paths().records, contents, { mode: 0o600 });
}

/** Reconstruct the legacy SPEC-002 (v1.2) storage tree with no `.state/` view. */
function writeLegacySpec002Layout(): void {
  const operateRoot = paths().root;
  mkdirSync(operateRoot, { recursive: true });
  writeFileSync(join(operateRoot, 'events.jsonl'), '', { mode: 0o600 });
  const bucket = join(operateRoot, 'records', 'sha256', 'ab');
  mkdirSync(bucket, { recursive: true });
  writeFileSync(
    join(bucket, `${'c'.repeat(62)}.json`),
    JSON.stringify({ kind: 'operating-record' }),
    {
      mode: 0o600,
    },
  );
  const checkpoints = join(operateRoot, 'checkpoints');
  mkdirSync(checkpoints, { recursive: true });
  writeFileSync(
    join(checkpoints, 'current.json'),
    JSON.stringify({ eventHead: { sequence: 0, hash: null } }),
    { mode: 0o600 },
  );
}

describe('Operating Board doctor v1.3 diagnostics', () => {
  describe('fresh v1.3 project', () => {
    it('reports operate-layout and operate-records as passing', async () => {
      await initFreshV13Project();

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-layout')).toEqual({
        code: 'operate-layout',
        status: 'pass',
        message: 'Operating storage is on the v1.3 `.state/` layout with no SPEC-002 residue',
      });
      expect(byCode(diagnostics, 'operate-records')).toEqual({
        code: 'operate-records',
        status: 'pass',
        message: 'No v1.3 `.state/records.jsonl` log is present yet',
      });
    });

    it('reports the populated pass branch for a consistent records log', async () => {
      await initFreshV13Project();
      writeRecordsLog(`${consistentRecordsLine()}\n`);

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-records')).toEqual({
        code: 'operate-records',
        status: 'pass',
        message:
          '1 operating records.jsonl entry is parseable with consistent content-address digests',
      });
    });
  });

  describe('operate-layout', () => {
    it('flags a genuine v1.2/SPEC-002-layout project with the migration repair command', async () => {
      writeLegacySpec002Layout();

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-layout')).toEqual({
        code: 'operate-layout',
        status: 'warn',
        message:
          'Operating storage is on the legacy SPEC-002 layout and has not migrated to the v1.3 `.state/` layout',
        fix: 'Run `planr operate migrate apply --yes` to migrate the storage layout to v1.3.',
      });
    });

    it('flags interrupted-migration residue when the v1.3 layout coexists with SPEC-002 paths', async () => {
      await initFreshV13Project();
      // Leave SPEC-002 residue alongside the committed `.state/` view: the root
      // events log, the records tree, and the checkpoint directory.
      const operateRoot = paths().root;
      writeFileSync(join(operateRoot, 'events.jsonl'), '', { mode: 0o600 });
      mkdirSync(join(operateRoot, 'records'), { recursive: true });
      mkdirSync(join(operateRoot, 'checkpoints'), { recursive: true });

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-layout')).toEqual({
        code: 'operate-layout',
        status: 'warn',
        message:
          'Operating storage is on the v1.3 `.state/` layout but 3 SPEC-002 residue path(s) remain from an interrupted migration',
        fix: 'Run `planr operate migrate apply --yes` to clear the residual SPEC-002 layout.',
      });
    });
  });

  describe('operate-records', () => {
    it('fails on a malformed .state/records.jsonl JSON line', async () => {
      await initFreshV13Project();
      writeRecordsLog('{not valid json\n');

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-records')).toEqual({
        code: 'operate-records',
        status: 'fail',
        message: 'Operating `.state/records.jsonl` line 1 is not valid JSON',
        fix: 'Run `planr operate integrity status`; do not edit .state/records.jsonl by hand.',
      });
    });

    it('fails on a .state/records.jsonl line whose digest does not match its content', async () => {
      await initFreshV13Project();
      // Well-formed JSON with `sha256:`-prefixed digests (so it clears the
      // missing-digest guard) but whose contentDigest cannot be the digest of
      // the embedded content.
      writeRecordsLog(
        `${JSON.stringify({
          kind: 'operating-records-log-entry',
          schemaVersion: '1.0.0',
          protocolVersion: '1.3.0',
          digest: `sha256:${'0'.repeat(64)}`,
          recordType: 'recovery',
          createdAt: '2026-07-31T00:00:00.000Z',
          correlationId: 'operate-doctor-v13-fixture',
          contentDigest: `sha256:${'1'.repeat(64)}`,
          content: { tampered: true },
        })}\n`,
      );

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-records')).toEqual({
        code: 'operate-records',
        status: 'fail',
        message: 'Operating `.state/records.jsonl` line 1 digest does not match its content',
        fix: 'Run `planr operate integrity status`, then recover the affected cycle from the verified event chain.',
      });
    });

    it('fails on a .state/records.jsonl line missing its content-address digests', async () => {
      await initFreshV13Project();
      writeRecordsLog(`${JSON.stringify({ recordType: 'recovery' })}\n`);

      const diagnostics = await runDoctor();

      expect(byCode(diagnostics, 'operate-records')).toEqual({
        code: 'operate-records',
        status: 'fail',
        message: 'Operating `.state/records.jsonl` line 1 is missing its content-address digests',
        fix: 'Run `planr operate integrity status`; do not edit .state/records.jsonl by hand.',
      });
    });
  });
});
