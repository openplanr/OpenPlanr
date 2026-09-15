import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOperateClient } from '../../src/services/operate/client.js';
import {
  authoredAdvisorResultForFixture,
  readIssuedAssignmentClaim,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

type JsonRecord = Record<string, unknown>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function lock(projectIdentity: string, options: { live: boolean }) {
  const createdAt = new Date(Date.now() + (options.live ? 0 : -120_000)).toISOString();
  return {
    format: 'openplanr-operate-lock',
    projectIdentity,
    nonce: randomUUID().replaceAll('-', ''),
    pid: options.live ? process.pid : 2_147_483_647,
    createdAt,
    expiresAt: new Date(Date.now() + (options.live ? 60_000 : -60_000)).toISOString(),
  };
}

describe('OpenPlanr durable restart and recovery', () => {
  it('replays the exact ledger before resume and exposes explicit recovery for pointer damage', async () => {
    const fixture = await createTestProject('operate-restart');
    projects.push(fixture);
    const first = createOperateClient(fixture.dir);
    const started = await first.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-restart', domainId: 'software', domainVersion: '1.0.0' },
        focus: ['recovery'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-restart',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const data = started.data as {
      generation: string;
      cycle: { cycleId: string };
      availableAssignments: Array<{ assignmentId: string }>;
    };
    const claimed = await first.dispatch({
      operation: 'operate.assignment.claim',
      request: {
        assignmentId: data.availableAssignments[0]?.assignmentId ?? '',
        actor: { actorId: 'restart-agent', kind: 'agent', runtime: 'codex' },
      },
    });
    expect(claimed.ok).toBe(true);

    const restarted = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.cycle.resume',
      request: { cycleId: data.cycle.cycleId },
    });
    expect(restarted).toMatchObject({
      ok: true,
      data: { cycle: { cycleId: data.cycle.cycleId }, progress: { active: 1 } },
    });

    const currentPath = resolve(fixture.dir, '.planr', 'operate', 'state', 'CURRENT');
    const current = await readFile(currentPath, 'utf8');
    await writeFile(currentPath, 'damaged-pointer\n');
    const failed = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.cycle.resume',
      request: { cycleId: data.cycle.cycleId },
    });
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'OPERATE_STORE_CORRUPT' },
      allowedActions: [{ tool: 'operate.recovery.inspect' }],
    });
    const inspection = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.recovery.inspect',
      request: {},
    });
    expect(inspection).toMatchObject({
      ok: true,
      data: { status: 'repairable', allowedRecovery: 'restore-generation' },
      allowedActions: [{ tool: 'operate.recovery.restore' }],
    });
    if (!inspection.ok) throw new Error('inspection failed');
    const generation = (inspection.data as { recoverableGeneration: string }).recoverableGeneration;
    const restored = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.recovery.restore',
      request: { generation },
    });
    expect(restored).toMatchObject({ ok: true, data: { generation, status: 'restored' } });
    expect(await readFile(currentPath, 'utf8')).not.toBe('damaged-pointer\n');
    expect(current.trim()).not.toBe('');
  });

  it('rejects partial and internally inconsistent corruption across project-local integrity surfaces', async () => {
    const fixture = await createTestProject('operate-integrity-matrix');
    projects.push(fixture);
    await writeScreenedEvidenceFixture(fixture.dir);
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-integrity', domainId: 'software', domainVersion: '1.0.0' },
        focus: ['integrity matrix'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-integrity',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const startData = started.data as {
      cycle: { cycleId: string };
      availableAssignments: Array<{ assignmentId: string; roleId: string }>;
    };
    const claimant = { actorId: 'integrity-agent', kind: 'agent' as const, runtime: 'codex' };
    const claimed = await client.dispatch({
      operation: 'operate.assignment.claim',
      request: {
        assignmentId: startData.availableAssignments[0].assignmentId,
        actor: claimant,
      },
    });
    if (!claimed.ok) throw new Error(JSON.stringify(claimed));
    const claim = await readIssuedAssignmentClaim(client, claimed.data as JsonRecord, claimant);
    const advisorBody = authoredAdvisorResultForFixture(claim, true);
    const submitted = await client.dispatch({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: startData.availableAssignments[0].assignmentId,
        submissionId: claim.submissionId,
        actor: claimant,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from(JSON.stringify(advisorBody)).toString('base64'),
      },
    });
    if (!submitted.ok) throw new Error(JSON.stringify(submitted));
    const root = join(fixture.dir, '.planr', 'operate', 'state');
    const backup = join(fixture.dir, '.planr', 'operate-pristine');
    await cp(root, backup, { recursive: true });
    const generation = (await readFile(join(root, 'CURRENT'), 'utf8')).trim();
    const generationRoot = () => join(root, 'generations', generation);
    const manifestPath = () => join(generationRoot(), 'manifest.json');
    const restore = async () => {
      await rm(root, { recursive: true, force: true });
      await cp(backup, root, { recursive: true });
    };
    const mutateManifest = async (mutate: (manifest: JsonRecord) => void) => {
      const manifest = JSON.parse(await readFile(manifestPath(), 'utf8')) as JsonRecord;
      mutate(manifest);
      await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
    };
    const assertRejected = async () => {
      expect(
        await createOperateClient(fixture.dir).dispatch({
          operation: 'operate.cycle.resume',
          request: { cycleId: startData.cycle.cycleId },
        }),
      ).toMatchObject({ ok: false, error: { code: 'OPERATE_STORE_CORRUPT' } });
    };

    const manifestMutations: Array<[string, (manifest: JsonRecord) => void]> = [
      [
        'manifest metadata',
        (manifest) => Object.assign(manifest, { createdAt: '2030-01-01T00:00:00.000Z' }),
      ],
      [
        'base state',
        (manifest) =>
          Object.assign(manifest.baseState as JsonRecord, {
            generatedAt: '2030-01-01T00:00:00.000Z',
          }),
      ],
      [
        'projected state',
        (manifest) =>
          Object.assign(manifest.state as JsonRecord, { generatedAt: '2030-01-01T00:00:00.000Z' }),
      ],
      [
        'preferences',
        (manifest) =>
          Object.assign(manifest.preferences as JsonRecord, { lastCycleId: 'cyc_foreign_0001' }),
      ],
      [
        'replay index',
        (manifest) => {
          const replay = (manifest.state as JsonRecord).eventReplayIndex as JsonRecord[];
          replay[0] = { ...replay[0], payloadHash: `sha256:${'0'.repeat(64)}` };
        },
      ],
      [
        'Artifact metadata',
        (manifest) => {
          const artifacts = manifest.artifacts as JsonRecord[];
          artifacts[0] = { ...artifacts[0], sizeBytes: Number(artifacts[0].sizeBytes) + 1 };
        },
      ],
    ];
    for (const [, mutate] of manifestMutations) {
      await restore();
      await mutateManifest(mutate);
      await assertRejected();
    }

    await restore();
    await writeFile(join(generationRoot(), 'events.jsonl'), '{}\n');
    await assertRejected();

    await restore();
    const rawManifest = JSON.parse(await readFile(manifestPath(), 'utf8')) as JsonRecord;
    const artifactEntry = (rawManifest.artifacts as JsonRecord[])[0];
    await writeFile(
      join(generationRoot(), 'artifacts', String(artifactEntry.file)),
      Buffer.from('offline replacement'),
    );
    await assertRejected();

    await restore();
    await mutateManifest((manifest) => {
      const state = manifest.state as JsonRecord;
      state.generatedAt = '2031-01-01T00:00:00.000Z';
      const projection = Object.fromEntries(
        Object.entries(state).filter(
          ([key]) => key === 'eventHead' || key === 'eventReplayIndex' || /ReplayIndex$/u.test(key),
        ),
      );
      manifest.replayIndexHash = digest(projection);
      const withoutIntegrity = { ...manifest };
      delete withoutIntegrity.integrityHash;
      manifest.integrityHash = digest(withoutIntegrity);
    });
    await assertRejected();

    await restore();
    const coordinatedManifest = JSON.parse(await readFile(manifestPath(), 'utf8')) as JsonRecord;
    (coordinatedManifest.preferences as JsonRecord).reviewOwners = {};
    const manifestWithoutIntegrity = { ...coordinatedManifest };
    delete manifestWithoutIntegrity.integrityHash;
    coordinatedManifest.integrityHash = digest(manifestWithoutIntegrity);
    await writeFile(manifestPath(), `${JSON.stringify(coordinatedManifest, null, 2)}\n`);
    const custodyPath = join(root, 'CUSTODY.json');
    const coordinatedCustody = JSON.parse(await readFile(custodyPath, 'utf8')) as JsonRecord;
    coordinatedCustody.headIntegrityHash = coordinatedManifest.integrityHash;
    await writeFile(custodyPath, `${JSON.stringify(coordinatedCustody, null, 2)}\n`);
    await assertRejected();

    await restore();
    await writeFile(join(root, 'HEADS.jsonl'), '');
    await assertRejected();

    await restore();
    const inspection = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.recovery.inspect',
      request: {},
    });
    expect(inspection).toMatchObject({
      ok: true,
      data: {
        integrityBoundary: {
          model: 'project-local-integrity',
          detects: [
            'accidental-corruption',
            'partial-or-incoherent-rewrite',
            'journal-truncation',
            'foreign-project-copy',
          ],
          authenticity: 'not-provided',
          outsideBoundary: ['fully-coordinated-same-user-offline-rewrite'],
          futureRequirement: 'externally-anchored-or-signed-custody',
        },
      },
    });
    const recoveryStatus = JSON.stringify(inspection);
    expect(recoveryStatus).not.toContain('tamper-evident');
    expect(recoveryStatus).not.toContain('append-only');
    expect(recoveryStatus).not.toContain('OS-immutable');
  });

  it('distinguishes live owners from stale/orphan locks and recovers deterministically', async () => {
    const fixture = await createTestProject('operate-lock-recovery');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-lock', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['lock recovery'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-lock',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const root = join(fixture.dir, '.planr', 'operate', 'state');
    const custody = JSON.parse(await readFile(join(root, 'CUSTODY.json'), 'utf8')) as {
      projectIdentity: string;
    };
    await writeFile(
      join(root, 'LOCK'),
      `${JSON.stringify(lock(custody.projectIdentity, { live: true }))}\n`,
    );
    expect(
      await client.dispatch({ operation: 'operate.recovery.inspect', request: {} }),
    ).toMatchObject({ ok: true, data: { status: 'locked', lock: { status: 'live' } } });
    expect(
      await client.dispatch({
        operation: 'operate.cycle.start',
        request: {
          scope: { scopeId: 'scope-lock', domainId: 'business', domainVersion: '1.0.0' },
          focus: ['live conflict'],
          trigger: { kind: 'manual' },
          mode: 'standard',
          ownerActorId: 'owner-lock',
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'OPERATE_STORE_CONFLICT' } });

    await writeFile(
      join(root, 'LOCK'),
      `${JSON.stringify(lock(custody.projectIdentity, { live: false }))}\n`,
    );
    const stale = await client.dispatch({ operation: 'operate.recovery.inspect', request: {} });
    expect(stale).toMatchObject({
      ok: true,
      data: {
        status: 'repairable',
        allowedRecovery: 'clear-stale-lock',
        lock: { status: 'stale' },
      },
      allowedActions: [{ tool: 'operate.recovery.clear-stale-lock' }],
    });
    expect(
      await client.dispatch({ operation: 'operate.recovery.clear-stale-lock', request: {} }),
    ).toMatchObject({ ok: true, data: { status: 'cleared' } });

    await writeFile(
      join(root, 'LOCK'),
      `${JSON.stringify(lock(custody.projectIdentity, { live: false }))}\n`,
    );
    const recovered = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-lock', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['automatic stale recovery'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-lock',
      },
    });
    expect(recovered.ok).toBe(true);
    await mkdir(join(root, 'stale-locks'), { recursive: true });
    expect((await readdir(join(root, 'stale-locks'))).length).toBeGreaterThanOrEqual(2);
  });

  it('serializes concurrent stale-lock recovery so exactly one writer commits', async () => {
    const fixture = await createTestProject('operate-concurrent-recovery');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    const first = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-concurrent', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['seed'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-concurrent',
      },
    });
    if (!first.ok) throw new Error(JSON.stringify(first));
    const root = join(fixture.dir, '.planr', 'operate', 'state');
    const custody = JSON.parse(await readFile(join(root, 'CUSTODY.json'), 'utf8')) as {
      projectIdentity: string;
    };
    await writeFile(
      join(root, 'LOCK'),
      `${JSON.stringify(lock(custody.projectIdentity, { live: false }))}\n`,
    );
    const start = (focus: string) =>
      createOperateClient(fixture.dir).dispatch({
        operation: 'operate.cycle.start',
        request: {
          scope: { scopeId: 'scope-concurrent', domainId: 'business', domainVersion: '1.0.0' },
          focus: [focus],
          trigger: { kind: 'manual' },
          mode: 'standard',
          ownerActorId: 'owner-concurrent',
        },
      });
    const results = await Promise.all([start('writer-a'), start('writer-b')]);
    expect(results.filter((entry) => entry.ok)).toHaveLength(1);
    expect(results.filter((entry) => !entry.ok)).toHaveLength(1);
    expect(results.find((entry) => !entry.ok)).toMatchObject({
      ok: false,
      error: { code: 'OPERATE_STORE_CONFLICT' },
    });
    const records = (await readFile(join(root, 'HEADS.jsonl'), 'utf8')).trim().split('\n');
    expect(records).toHaveLength(2);
  });
});
