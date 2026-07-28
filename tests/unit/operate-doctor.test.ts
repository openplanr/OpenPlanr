import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { operatingProjectKey } from '../../src/services/operate/config.js';
import { diagnoseOperatingBoard } from '../../src/services/operate/doctor.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { prepareJournalTransaction } from '../../src/services/operate/journal.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

let root: string;
let projectRoot: string;
let localRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-operate-doctor-'));
  projectRoot = join(root, 'project');
  localRoot = join(root, 'state');
  mkdirSync(projectRoot, { recursive: true });
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterEach(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe('Operating Board doctor', () => {
  it('validates Protocol registries, event replay, checkpoints, and projections', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    await store.writeCheckpoint();

    const diagnostics = await diagnoseOperatingBoard({
      projectRoot,
      localRoot,
      pipelineVersion: '0.30.0',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'operate-protocol', status: 'pass' }),
        expect.objectContaining({ code: 'operate-event-replay', status: 'pass' }),
        expect.objectContaining({ code: 'operate-checkpoint', status: 'pass' }),
        expect.objectContaining({ code: 'operate-projection', status: 'pass' }),
        expect.objectContaining({ code: 'operate-locks', status: 'pass' }),
        expect.objectContaining({ code: 'operate-journals', status: 'pass' }),
      ]),
    );
  });

  it('reports corrupt replay state instead of inventing recovery history', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    writeFileSync(store.paths.events, '{not-json}\n');

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-event-replay')).toMatchObject({
      status: 'fail',
      fix: 'Run `planr operate integrity status`; do not edit events.jsonl by hand.',
    });
  });

  it('detects stale leases and incomplete transaction journals without deleting either', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    mkdirSync(paths.locks, { recursive: true });
    writeFileSync(
      join(paths.locks, 'project.lock'),
      `${JSON.stringify({
        projectKey: operatingProjectKey(projectRoot),
        nonce: 'stale-lock-nonce-that-is-long-enough-0001',
        pid: 999_999,
        host: 'test-host',
        processStartedAt: 'Mon Jan 01 00:00:00 2024',
        createdAt: '2024-01-01T00:00:00.000Z',
        heartbeatAt: '2024-01-01T00:00:00.000Z',
        leaseDurationMs: 5_000,
        leaseExpiresAt: '2024-01-01T00:00:05.000Z',
        expectedEventHead: { sequence: 0, hash: null },
      })}\n`,
    );
    writeFileSync(join(projectRoot, 'existing.txt'), 'before\n');
    await prepareJournalTransaction(projectRoot, {
      localRoot,
      eventHead: { sequence: 0, hash: null },
      previewDigest: `sha256:${'a'.repeat(64)}`,
      transactionId: 'TXN-doctor-pending',
      writes: [
        {
          relativePath: 'existing.txt',
          operation: 'replace',
          content: 'after\n',
        },
      ],
    });

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-locks')).toMatchObject({
      status: 'warn',
      message: '1 operating lock lease(s) are stale',
    });
    expect(diagnostics.find((item) => item.code === 'operate-journals')).toMatchObject({
      status: 'warn',
      message: '1 operating transaction journal(s) require recovery',
    });
    expect(paths.locks).toBeTruthy();
  });
});
