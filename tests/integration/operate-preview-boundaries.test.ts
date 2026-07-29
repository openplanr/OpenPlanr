import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { evidenceProjectionSources } from '../../src/services/operate/evidence.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';
import type { OperatingRoleResult } from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const OPERATING_INTEGRATION_TIMEOUT_MS = 30_000;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createGitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-boundary-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
  );
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
  return projectRoot;
}

async function fileSnapshot(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = join(directory, entry.name);
      const key = relative(root, target);
      if (entry.isDirectory()) {
        await visit(target);
      } else {
        const metadata = await lstat(target);
        snapshot[key] = entry.isSymbolicLink()
          ? `symlink:${await readFile(target, 'utf8').catch(() => '')}`
          : `file:${metadata.mode.toString(8)}:${createHash('sha256')
              .update(await readFile(target))
              .digest('hex')}`;
      }
    }
  }
  await visit(root);
  return snapshot;
}

async function initialize(
  projectRoot: string,
  localRoot: string,
  runtime: 'claude' | 'codex' = 'codex',
  enabledRoles?: Array<'strategy-finance' | 'technology-risk' | 'chair'>,
): Promise<void> {
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: enabledRoles ? 'custom' : 'engineering',
    ...(enabledRoles ? { customProfile: { enabledRoles } } : {}),
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime,
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    charter: {
      purpose: 'Prove bounded Operating Board execution.',
      goals: ['Keep preview and dry-run safe.'],
    },
    now: '2026-07-28T10:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
}

function fixtureAdapter(invoke = vi.fn()): AdvisorAdapter {
  invoke.mockResolvedValue({
    outcome: 'quiet',
    proposals: [],
    gaps: [],
    conflicts: [],
  });
  return {
    id: 'boundary-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    invoke,
  };
}

async function recordQuietNativeResults(input: {
  projectRoot: string;
  localRoot: string;
  cycleId: string;
  evidenceDigest: `sha256:${string}`;
  roles: string[];
  idempotencyKey: string;
}): Promise<void> {
  const session = (await operateAdapterLifecycle({
    ...input,
    action: 'prepare',
    role: input.roles.join(','),
  })) as {
    lease: string;
    roleInputDigests: Record<string, `sha256:${string}`>;
  };
  const protocol = await loadOperatingProtocol();
  for (const role of input.roles) {
    const unsigned = {
      kind: 'operating-role-result' as const,
      schemaVersion: '1.0.0' as const,
      protocolVersion: '1.2.0' as const,
      cycleId: input.cycleId,
      roleId: role as OperatingRoleResult['roleId'],
      inputDigest: session.roleInputDigests[role],
      outcome: 'quiet' as const,
      proposals: [],
      gaps: [],
      conflicts: [],
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'claude',
        capability: 'analysis-high' as const,
      },
    };
    await operateAdapterLifecycle({
      ...input,
      action: 'record',
      lease: session.lease,
      role,
      stdin: JSON.stringify({
        ...unsigned,
        resultDigest: protocol.computeOperatingRoleResultDigest(unsigned as OperatingRoleResult),
      }),
    });
  }
  await operateAdapterLifecycle({
    ...input,
    action: 'finalize',
    lease: session.lease,
  });
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

describe('Operating Board preview and dry-run boundaries', () => {
  it(
    'persists one native handoff before any executive advisor is invoked',
    async () => {
      const projectRoot = await createGitProject();
      const localRoot = await temporaryDirectory('openplanr-operate-native-local-');
      await initialize(projectRoot, localRoot, 'claude', [
        'strategy-finance',
        'technology-risk',
        'chair',
      ]);
      const invoke = vi.fn();

      const cycle = await runOperatingCycle({
        projectRoot,
        localRoot,
        runtime: 'claude',
        confirmed: true,
        deferAdvisors: true,
        adapter: fixtureAdapter(invoke),
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(cycle.nativeHandoff).toMatchObject({
        phase: 'advisors',
        cycleId: 'CYCLE-001',
        evidenceDigest: cycle.evidence?.fingerprint,
        roles: expect.arrayContaining(['technology-risk']),
      });
      expect(cycle.state?.cycles.at(-1)).toMatchObject({
        id: 'CYCLE-001',
        state: 'advising',
      });

      await recordQuietNativeResults({
        projectRoot,
        localRoot,
        cycleId: cycle.nativeHandoff?.cycleId as string,
        evidenceDigest: cycle.nativeHandoff?.evidenceDigest as `sha256:${string}`,
        roles: cycle.nativeHandoff?.roles as string[],
        idempotencyKey: 'native-advisors',
      });
      const chairHandoff = await runOperatingCycle({
        projectRoot,
        localRoot,
        runtime: 'claude',
        confirmed: true,
        deferAdvisors: true,
        adapter: fixtureAdapter(invoke),
      });
      expect(chairHandoff.nativeHandoff).toMatchObject({
        phase: 'chair',
        roles: ['chair'],
      });
      await recordQuietNativeResults({
        projectRoot,
        localRoot,
        cycleId: chairHandoff.nativeHandoff?.cycleId as string,
        evidenceDigest: chairHandoff.nativeHandoff?.evidenceDigest as `sha256:${string}`,
        roles: ['chair'],
        idempotencyKey: 'native-chair',
      });
      const completed = await runOperatingCycle({
        projectRoot,
        localRoot,
        runtime: 'claude',
        confirmed: true,
        deferAdvisors: true,
        adapter: fixtureAdapter(invoke),
      });
      expect(completed.nativeHandoff).toBeUndefined();
      expect(completed.roleResults?.map(({ roleId }) => roleId).sort()).toEqual([
        'chair',
        'strategy-finance',
        'technology-risk',
      ]);
      expect(completed.state?.cycles.at(-1)?.state).not.toBe('advising');
      expect(invoke).not.toHaveBeenCalled();
    },
    OPERATING_INTEGRATION_TIMEOUT_MS,
  );

  it('routes the Claude CLI run into the isolated machine lifecycle', async () => {
    const projectRoot = await createGitProject();
    const preview = await prepareOperatingInitialization({
      projectRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'claude',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      enabledProviders: ['repository', 'git'],
      charter: { purpose: 'Exercise native executive lenses.' },
      now: '2026-07-28T10:00:00.000Z',
    });
    await applyOperatingInitialization({
      projectRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });

    const result = await executeOperateAction({
      action: 'run',
      projectRoot,
      interactive: false,
      options: { json: true, runtime: 'claude', yes: true },
    });

    expect(result).toMatchObject({
      ok: true,
      state: 'advising',
      message: 'Operating cycle is awaiting isolated native advisors execution.',
      nextActions: [
        expect.stringMatching(/^planr operate adapter prepare .* --role .*technology-risk/),
      ],
      data: {
        nativeHandoff: {
          phase: 'advisors',
          cycleId: 'CYCLE-001',
          roles: expect.arrayContaining(['technology-risk']),
        },
      },
    });
  });

  it('initializes safely on an unborn Git branch before the first commit', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-unborn-project-');
    await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
    await writeFile(join(projectRoot, 'README.md'), '# Unborn workspace\n');

    const preview = await prepareOperatingInitialization({
      projectRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      enabledProviders: ['repository', 'git'],
      charter: { purpose: 'Initialize before the first commit.' },
      now: '2026-07-28T10:00:00.000Z',
    });

    expect(preview.workspace.controlRepository).toMatchObject({
      pinnedRevision: '0'.repeat(40),
      dirtyFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    await applyOperatingInitialization({
      projectRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });
    const cycle = await runOperatingCycle({
      projectRoot,
      offline: true,
      confirmed: true,
    });
    expect(cycle.state.cycles.at(-1)).toMatchObject({
      id: 'CYCLE-001',
      state: 'blocked',
      health: 'blocked',
    });
    expect(cycle.evidence?.items.some((item) => item.source === 'git')).toBe(false);
    expect(cycle.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('technology-risk not evaluated')]),
    );
    const status = await executeOperateAction({
      action: 'status',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    expect(status).toMatchObject({
      ok: true,
      state: null,
      message: expect.stringMatching(/^Operating Board is blocked on \d+ evidence or advisor/),
    });
    expect(status.message).not.toContain('quiet');
  });

  it('produces a loader-valid CLI initialization preview without writing state', async () => {
    const projectRoot = await createGitProject();
    const before = await fileSnapshot(projectRoot);
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        profile: 'engineering',
        decisionOwner: 'Product owner',
        planningEngine: 'openplanr',
        runtime: 'codex',
        cadence: 'manual',
        timezone: 'UTC',
        sensitivityCeiling: 'internal',
        sources: ['repository', 'git'],
        charter: { purpose: 'Preview the board.' },
        preview: true,
        dryRun: false,
      },
    });
    const preview = result.preview as {
      config: unknown;
      changedPaths: string[];
      previewDigest: string;
    };

    expect(result).toMatchObject({
      ok: true,
      action: 'init',
      protocolVersion: '1.2.0',
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: ['planr operate init --yes'],
    });
    expect(preview.changedPaths.slice(0, 3)).toEqual([
      '.planr/operate/config.json',
      '.planr/operate/charter.md',
      '.planr/operate/workspace.json',
    ]);
    expect(preview.changedPaths).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^\.planr\/operate\/records\/sha256\/[a-f0-9]{2}\/[a-f0-9]{62}\.json$/,
        ),
        '.planr/operate/checkpoints/current.json',
        '.planr/operate/projections/state.json',
        '.planr/operate/projections/register.md',
        '.planr/operate/projections/decisions.md',
        '.planr/operate/projections/data-gaps.md',
        '.planr/operate/projections/backlog.md',
        '.planr/operate/events.jsonl',
      ]),
    );
    expect(preview.previewDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      (await loadOperatingProtocol()).validateProtocolArtifact('operating-config', preview.config),
    ).toEqual([]);
    expect(await fileSnapshot(projectRoot)).toEqual(before);
  });

  it('makes cycle preview provider-call-free and byte-for-byte write-free', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-boundary-local-');
    await initialize(projectRoot, localRoot);
    const invoke = vi.fn();
    const adapter = fixtureAdapter(invoke);
    const beforeProject = await fileSnapshot(projectRoot);
    const beforeLocal = await fileSnapshot(localRoot);

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      preview: true,
      adapter,
      now: new Date('2026-07-28T11:00:00.000Z'),
    });

    expect(result).toMatchObject({
      preview: true,
      dryRun: false,
      modelCalls: 0,
      cycle: { id: 'CYCLE-001', state: 'preparing' },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(await fileSnapshot(projectRoot)).toEqual(beforeProject);
    expect(await fileSnapshot(localRoot)).toEqual(beforeLocal);
  });

  it('returns the stable top-level automation envelope for run previews', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-json-envelope-local-');
    await initialize(projectRoot, localRoot);

    const result = await executeOperateAction({
      action: 'run',
      projectRoot,
      interactive: false,
      options: {
        preview: true,
        dryRun: false,
        offline: true,
        reviewOnly: false,
        focus: ['technology'],
        depth: 'standard',
        runtime: 'codex',
        json: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'run',
      cycleId: 'CYCLE-001',
      state: 'preparing',
      paths: {
        cycle: '.planr/operate/cycles/CYCLE-001',
        brief: '.planr/operate/cycles/CYCLE-001/brief.md',
      },
      counts: {
        findings: 0,
        decisions: 0,
        gaps: 0,
        specs: 0,
        artifacts: 0,
      },
      warnings: [],
      nextActions: ['planr operate run --offline'],
    });
  });

  it('allows disclosed dry-run advisor calls but commits no bytes or cycle ID', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-dry-run-local-');
    await initialize(projectRoot, localRoot);
    const invoke = vi.fn();
    const adapter = fixtureAdapter(invoke);
    const beforeProject = await fileSnapshot(projectRoot);
    const beforeLocal = await fileSnapshot(localRoot);

    const first = await runOperatingCycle({
      projectRoot,
      localRoot,
      dryRun: true,
      adapter,
      now: new Date('2026-07-28T11:00:00.000Z'),
    });
    const second = await runOperatingCycle({
      projectRoot,
      localRoot,
      dryRun: true,
      adapter,
      now: new Date('2026-07-28T11:05:00.000Z'),
    });

    expect(first).toMatchObject({
      preview: false,
      dryRun: true,
      cycle: { id: 'CYCLE-001' },
    });
    expect(second.cycle.id).toBe('CYCLE-001');
    expect(first.modelCalls).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalled();
    expect(await fileSnapshot(projectRoot)).toEqual(beforeProject);
    expect(await fileSnapshot(localRoot)).toEqual(beforeLocal);
  });

  it('rejects workspace movement after an advisor call and before committing its result', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-diverged-local-');
    await initialize(projectRoot, localRoot);
    const invoke = vi.fn();
    const adapter = fixtureAdapter(invoke);
    invoke.mockImplementation(async () => {
      await writeFile(
        join(projectRoot, 'service.ts'),
        'export function health(): string { return "changed during cycle"; }\n',
      );
      return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
    });

    await expect(
      runOperatingCycle({
        projectRoot,
        localRoot,
        adapter,
        now: new Date('2026-07-28T11:10:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_HEAD_DIVERGED' });
    expect(invoke).toHaveBeenCalled();
    const events = (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events;
    expect(events.some((event) => event.type === 'evidence.collected')).toBe(false);
    expect(events.some((event) => event.type === 'advisory.recorded')).toBe(false);
  });

  it('commits an offline cycle through canonical events and checkpoint projection', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-committed-local-');
    await initialize(projectRoot, localRoot);
    const adapter = fixtureAdapter();

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter,
      offline: true,
      confirmed: true,
      now: new Date('2026-07-28T12:00:00.000Z'),
    });

    const store = new OperatingEventStore(projectRoot, { localRoot });
    const replay = await store.replay();
    const checkpoint = await store.readCheckpoint();
    expect(result.cycle.id).toBe('CYCLE-001');
    expect(replay.events[0]).toMatchObject({
      type: 'projection.rebuilt',
      cycleId: 'CYCLE-000',
    });
    expect(replay.events.find((event) => event.type === 'cycle.preparing')).toMatchObject({
      type: 'cycle.preparing',
      cycleId: 'CYCLE-001',
    });
    expect(replay.events.some((event) => event.type === 'evidence.collected')).toBe(true);
    expect(replay.events.some((event) => event.type === 'advisory.recorded')).toBe(true);
    expect(['cycle.blocked', 'cycle.closed', 'cycle.reviewable']).toContain(
      replay.events.at(-1)?.type,
    );
    expect(checkpoint?.eventHead).toEqual(replay.eventHead);
    expect(checkpoint?.state.cycles).toHaveLength(1);
  });

  it('transitions a quiet cycle through reviewable before closing it', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-quiet-cycle-local-');
    await initialize(projectRoot, localRoot);
    const configPath = join(projectRoot, '.planr', 'operate', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          enabledRoles: ['strategy-finance'],
          enabledProviders: ['git'],
        },
        null,
        2,
      )}\n`,
    );

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: fixtureAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T12:02:00.000Z'),
    });
    const events = (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events;
    const cycleTransitions = events
      .filter((event) => event.type.startsWith('cycle.'))
      .map((event) => event.type);

    expect(cycleTransitions.slice(-2)).toEqual(['cycle.reviewable', 'cycle.closed']);
    expect(result.state?.cycles).toContainEqual(
      expect.objectContaining({
        id: 'CYCLE-001',
        state: 'closed',
        health: 'quiet',
      }),
    );
  });

  it('persists a linked data gap when a standard non-Chair advisor fails', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-partial-advisor-local-');
    await initialize(projectRoot, localRoot);
    const configPath = join(projectRoot, '.planr', 'operate', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          enabledRoles: ['strategy-finance'],
          enabledProviders: ['git'],
        },
        null,
        2,
      )}\n`,
    );
    const invoke = vi.fn();
    const adapter = fixtureAdapter(invoke);
    invoke.mockRejectedValue(new Error('fixture advisor unavailable'));

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter,
      confirmed: true,
      now: new Date('2026-07-28T12:05:00.000Z'),
    });
    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    const failureGap = result.state?.dataGaps.find(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes('strategy-finance'),
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.warnings).toContainEqual(expect.stringContaining('strategy-finance failed'));
    expect(failureGap).toMatchObject({
      status: 'open',
      owner: 'Product owner',
      affectedRoles: ['strategy-finance'],
    });
    expect(replay.events.some((event) => event.type === 'gap.open')).toBe(true);
    expect(replay.events.at(-1)).toMatchObject({
      type: 'cycle.reviewable',
      payload: { patch: { health: 'partial' } },
    });
  });

  it.each(['collecting', 'advising', 'consolidating'] as const)(
    'resumes %s from persisted records without duplicate collection or completed advisor calls',
    async (phase) => {
      const projectRoot = await createGitProject();
      const localRoot = await temporaryDirectory(`openplanr-operate-resume-${phase}-local-`);
      await initialize(projectRoot, localRoot);
      const seedAdapter = fixtureAdapter();
      const at = new Date('2026-07-28T13:00:00.000Z');
      const seeded = await runOperatingCycle({
        projectRoot,
        localRoot,
        dryRun: true,
        adapter: seedAdapter,
        now: at,
      });
      const store = new OperatingEventStore(projectRoot, { localRoot });
      let head = (await store.replay()).eventHead;
      const append = async (
        type: Parameters<OperatingEventStore['append']>[0]['type'],
        payload: Record<string, unknown>,
        entityId = seeded.cycle.id,
        evidenceRefs: string[] = [],
      ) => {
        const event = await store.append({
          type,
          cycleId: seeded.cycle.id,
          entityId,
          payload,
          evidenceRefs,
          expectedHead: head.hash,
        });
        head = { sequence: event.sequence, hash: event.eventHash };
      };
      await append('cycle.preparing', { record: seeded.cycle });
      await append('cycle.collecting', {});
      const evidence = seeded.evidence;
      if (!evidence) {
        throw new Error('Expected the seeded cycle to include evidence.');
      }
      const evidenceRecord = await store.putRecord(
        'evidence-metadata',
        evidence as unknown as Record<string, unknown>,
        { correlationId: seeded.cycle.id, createdAt: at.toISOString() },
      );
      await append(
        'evidence.collected',
        {
          recordDigest: evidenceRecord.digest,
          sources: evidenceProjectionSources(evidence),
        },
        seeded.cycle.id,
        evidence.items.map((item) => item.id),
      );
      if (phase !== 'collecting') {
        await append('cycle.advising', {});
        for (const result of seeded.roleResults ?? []) {
          const record = await store.putRecord(
            'advisor-result',
            result as unknown as Record<string, unknown>,
            { correlationId: seeded.cycle.id, createdAt: at.toISOString() },
          );
          await append(
            'advisory.recorded',
            { recordDigest: record.digest },
            `${seeded.cycle.id}-${result.roleId}`,
            result.proposals.flatMap((proposal) => proposal.evidenceRefs),
          );
        }
      }
      if (phase === 'consolidating') {
        await append('cycle.consolidating', {});
      }
      const invoke = vi.fn();
      const resumed = await runOperatingCycle({
        projectRoot,
        localRoot,
        adapter: fixtureAdapter(invoke),
        now: at,
      });
      const events = (await store.replay()).events;
      expect(events.filter((event) => event.type === 'evidence.collected')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'advisory.recorded')).toHaveLength(
        seeded.roleResults?.length ?? 0,
      );
      if (phase === 'collecting') {
        expect(invoke).toHaveBeenCalled();
      } else {
        expect(invoke).not.toHaveBeenCalled();
        expect(resumed.modelCalls).toBe(0);
      }
    },
    OPERATING_INTEGRATION_TIMEOUT_MS,
  );
});
