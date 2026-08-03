import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  operatingProjectKey,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { acquireOperatingLock } from '../../src/services/operate/lock-service.js';
import { repairOperatingSecurity } from '../../src/services/operate/maintenance.js';
import { containsSecret } from '../../src/services/operate/redaction.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function initializedProject(): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await temporaryDirectory('openplanr-security-project-');
  const localRoot = await temporaryDirectory('openplanr-security-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'engineering',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    charter: { purpose: 'Exercise explicit sensitive-state repair.' },
    now: '2026-07-28T14:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return { projectRoot, localRoot };
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('explicit Operating Board sensitive-state repair', () => {
  it('purges sensitive bytes, blocks writers while quarantined, and signs a metadata-only discontinuity', async () => {
    const { projectRoot, localRoot } = await initializedProject();
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    const charterPath = paths.charter;
    const rawSecret = 'ghp_abcdefghijklmnopqrstuvwxyz';
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.writeCheckpoint(await store.state());
    const oldCheckpoint = JSON.parse(await readFile(paths.checkpoint, 'utf8')) as {
      integrity: Record<string, unknown>;
    };
    oldCheckpoint.integrity = {
      status: 'signed',
      signature: {
        algorithm: 'hmac-sha256',
        keyId: rawSecret,
        value: 'a'.repeat(43),
      },
    };
    await writeFile(paths.checkpoint, JSON.stringify(oldCheckpoint));
    // Protocol v1.3 keeps records in `.state/records.jsonl`; a stray sensitive
    // file dropped under `.state/` still has to be detected and purged.
    const leakedRecordPath = join(paths.state, 'aa', 'leaked-record.json');
    await writeFile(
      charterPath,
      `${await readFile(charterPath, 'utf8')}\nAuthorization: Bearer ${rawSecret}\n`,
    );
    await mkdir(join(paths.state, 'aa'), { recursive: true });
    await writeFile(leakedRecordPath, JSON.stringify({ token: rawSecret }));
    const localLeakPaths = [
      join(paths.cache, 'cached-evidence.json'),
      join(paths.evidence, 'raw-evidence.json'),
      join(paths.advisors, 'advisor-response.json'),
      join(paths.journals, 'journal-output.json'),
      join(paths.transactions, 'orphaned-output.json'),
      join(paths.quarantine, 'RCV-OLD', 'commit-safe', 'charter.md'),
      join(paths.localRoot, 'orphaned-sensitive-output.json'),
    ];
    for (const target of localLeakPaths) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify({ token: rawSecret }));
    }

    const oldHead = (await store.replay()).eventHead;

    const preview = (await repairOperatingSecurity({
      projectRoot,
      localRoot,
      confirmed: false,
    })) as { affected: string[] };
    expect(preview.affected).toContain('.planr/operate/charter.md');
    expect(preview.affected).toContain('.planr/operate/.state/aa/leaked-record.json');

    let quarantineReached!: () => void;
    let resumeRepair!: () => void;
    const atQuarantine = new Promise<void>((resolve) => {
      quarantineReached = resolve;
    });
    const continueRepair = new Promise<void>((resolve) => {
      resumeRepair = resolve;
    });
    const repairPromise = repairOperatingSecurity({
      projectRoot,
      localRoot,
      confirmed: true,
      async faultInjector(boundary) {
        expect(boundary).toBe('project-quarantined');
        quarantineReached();
        await continueRepair;
      },
    });
    await atQuarantine;
    const competingWriter = await acquireOperatingLock(projectRoot, {
      projectKey: operatingProjectKey(projectRoot),
      expectedEventHead: oldHead,
      currentEventHead: oldHead,
      localRoot,
    }).then(
      (lock) => ({ error: null, lock }),
      (error: unknown) => ({ error, lock: null }),
    );
    if (competingWriter.lock) {
      await competingWriter.lock.release();
    }
    resumeRepair();
    expect(competingWriter.error).toMatchObject({ code: 'E_OPERATE_CYCLE_ACTIVE' });

    const repaired = (await repairPromise) as {
      purgedEntries: number;
      quarantine: { root: string; manifestDigest: string; fileCount: number };
      checkpoint: { integrity: { status: string } };
      guidance: string;
    };
    const replay = await store.replay();
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({
      sequence: 1,
      previousEventHash: null,
      type: 'security.discontinuity',
      actor: { kind: 'human', id: 'operate-cli' },
      payload: {
        oldHead,
        oldCheckpoint: {
          integrityStatus: 'signed',
          keyId: expect.stringMatching(/^digest:[a-f0-9]{64}$/),
        },
        requiresSignedCheckpoint: true,
      },
    });
    expect(JSON.stringify(replay.events[0])).not.toContain(rawSecret);
    expect(repaired.checkpoint.integrity.status).toBe('signed');
    expect(repaired.purgedEntries).toBeGreaterThanOrEqual(localLeakPaths.length);
    expect(repaired.quarantine.fileCount).toBeGreaterThan(0);
    expect(repaired.quarantine.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await stat(repaired.quarantine.root)).isDirectory()).toBe(true);
    const quarantineFiles = (await regularFiles(repaired.quarantine.root)).map((target) =>
      relative(repaired.quarantine.root, target),
    );
    expect(quarantineFiles).toEqual(['manifest.json']);
    const quarantineManifest = JSON.parse(
      await readFile(join(repaired.quarantine.root, 'manifest.json'), 'utf8'),
    ) as {
      state: string;
      files: Array<Record<string, unknown> & { path: string }>;
    };
    expect(quarantineManifest.state).toBe('quarantined');
    expect(JSON.stringify(quarantineManifest)).not.toContain(rawSecret);
    for (const entry of quarantineManifest.files) {
      expect(Object.keys(entry).sort()).toEqual(['affected', 'digest', 'path', 'scope', 'size']);
      expect(isAbsolute(entry.path)).toBe(false);
    }

    expect(containsSecret(await readFile(charterPath, 'utf8'))).toBe(false);
    await expect(readFile(leakedRecordPath)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const root of [
      paths.cache,
      paths.evidence,
      paths.advisors,
      paths.journals,
      paths.transactions,
    ]) {
      expect(await regularFiles(root)).toEqual([]);
    }
    for (const root of [paths.root, paths.localRoot]) {
      for (const target of await regularFiles(root)) {
        expect((await readFile(target)).includes(Buffer.from(rawSecret)), target).toBe(false);
      }
    }
    expect(JSON.stringify(repaired)).not.toContain(rawSecret);
    const recoveryRecordDigest = replay.events[0]?.payload.recoveryRecordDigest;
    expect(recoveryRecordDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const recoveryRecord = await store.readRecord(recoveryRecordDigest as `sha256:${string}`);
    expect(JSON.stringify(recoveryRecord)).not.toContain(rawSecret);
    expect(repaired.guidance).toContain('Rotate every exposed credential');
    expect(repaired.guidance).toContain('Git history');
  });
});
