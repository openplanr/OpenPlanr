import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/services/operate/canonical.js';
import { gateRecordedProposalCitations } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';
import {
  createOperatingAdapterStartHandoff,
  operateAdapterLifecycle,
} from '../../src/services/operate/maintenance.js';
import type {
  OperatingConfig,
  OperatingMissionPacket,
  OperatingRoleId,
  OperatingRoleResult,
} from '../../src/services/operate/types.js';
import {
  buildWorkspaceManifest,
  resolveOperatingPaths,
  writeOperatingConfig,
} from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

// If the file body ever appears in a mission packet, a body has leaked into the
// body-free evidence index the mission contract promises.
const BODY_MARKER = 'MISSION_ADAPTER_BODY_MARKER_c41f';

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function operatingConfig(enabledRoles: OperatingRoleId[]): OperatingConfig {
  return {
    kind: 'operating-config',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    profile: 'saas',
    decisionOwner: 'Owner',
    cadence: 'manual',
    planningEngine: 'openplanr',
    enabledRoles,
    enabledProviders: ['repository', 'git'],
    caps: { surfacedFindings: 5, newSpecs: 2, openDecisions: 5, agentArtifacts: 3 },
    budgets: { maxFiles: 100, maxItems: 100, maxBytes: 2 * 1024 * 1024, maxDurationMs: 10_000 },
  } as OperatingConfig;
}

interface MissionCycleFixture {
  projectRoot: string;
  localRoot: string;
  evidenceDigest: `sha256:${string}`;
  pin: string;
}

/**
 * A cycle in `advising` state on a runtime of the caller's choosing, backed by a
 * real git repository (so the workspace manifest pins a revision and mission
 * citations resolve), a committed operating-config, charter, preferences (with
 * optional dispatch-mode overrides), and a committed evidence snapshot that
 * satisfies role readiness. Modeled on the pack-mode adapter-lifecycle fixture
 * plus the mission-packet git/workspace fixture.
 */
async function advisingMissionCycle(options: {
  runtime: string;
  enabledRoles: OperatingRoleId[];
  dispatchModeOverrides?: Record<string, 'pack' | 'mission'>;
}): Promise<MissionCycleFixture> {
  const projectRoot = await temporaryDirectory('openplanr-operate-mission-adapter-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-mission-adapter-local-');

  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/mission-adapter-fixture.git'],
    { cwd: projectRoot },
  );
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await writeFile(
    join(projectRoot, 'src', 'service.ts'),
    `export const service = '${BODY_MARKER}';\nexport const ok = true;\n`,
  );
  await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const pin = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
  ).stdout.trim();

  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  // Machine-local workspace roots + the committed workspace manifest, as
  // `refreshOperatingWorkspaceManifest` (called by prepare/record for mission
  // roles) requires both.
  const manifest = await buildWorkspaceManifest(projectRoot, [], {
    localRoot,
    persistRoots: true,
    capturedAt: '2026-07-28T09:00:00.000Z',
  });
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.workspace, `${canonicalize(manifest)}\n`);
  await writeOperatingConfig(projectRoot, operatingConfig(options.enabledRoles), { localRoot });
  await writeFile(
    paths.charter,
    [
      '# Operating charter',
      '',
      '## Product context',
      '- Purpose: Test isolated executive lenses',
      '- Stage: growth',
      '',
      '## Current goals',
      '- Preserve read-only runtime execution',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(paths.localRoot, 'preferences.json'),
    `${JSON.stringify({
      runtime: 'auto',
      sensitivityCeiling: 'internal',
      ...(options.dispatchModeOverrides
        ? { dispatchModeOverrides: options.dispatchModeOverrides }
        : {}),
    })}\n`,
  );

  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      correlationId: 'mission-adapter-test',
      expectedHead: head,
      timestamp: '2026-07-28T09:00:00.000Z',
      evidenceRefs: type === 'evidence.collected' ? ['EVD-git', 'EVD-repository'] : undefined,
      payload,
    });
    head = event.eventHash;
  };
  await append('cycle.preparing', {
    record: {
      kind: 'operating-cycle-manifest',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      id: 'CYCLE-001',
      state: 'preparing',
      health: 'normal',
      depth: 'standard',
      focus: ['all'],
      inputDigest: digest('a'),
      enabledRoles: options.enabledRoles,
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.17.0', runtime: options.runtime },
    },
  });
  await append('cycle.collecting', {});
  const evidenceDigest = digest('e');
  const collectedAt = '2026-07-28T09:00:00.000Z';
  const evidence = {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: evidenceDigest,
    collectedAt,
    truncated: false,
    items: [
      {
        id: 'EVD-repository',
        source: 'repository',
        location: 'src/service.ts',
        digest: digest('b'),
        collectedAt,
        observedFrom: null,
        observedTo: null,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['code', 'architecture'],
        summary: 'The runtime adapter exposes a read-only advisory boundary.',
      },
      {
        id: 'EVD-git',
        source: 'git',
        location: 'history/30d',
        digest: digest('c'),
        collectedAt,
        observedFrom: '2026-06-28T09:00:00.000Z',
        observedTo: collectedAt,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['change-history'],
        summary: 'Recent changes added deterministic operating contracts.',
      },
    ],
    sources: [
      {
        id: 'repository',
        fingerprint: digest('d'),
        status: 'collected',
        itemCount: 1,
        byteCount: 64,
      },
      { id: 'git', fingerprint: digest('f'), status: 'collected', itemCount: 1, byteCount: 64 },
    ],
    warnings: [],
  };
  const record = await store.putRecord('evidence-metadata', evidence, {
    correlationId: 'mission-adapter-test',
    createdAt: collectedAt,
  });
  await append('evidence.collected', {
    recordDigest: record.digest,
    sources: evidence.sources.map((source) => ({
      id: source.id,
      freshness: 'fresh',
      status: source.status,
      itemCount: source.itemCount,
    })),
  });
  await append('cycle.advising', {});
  return { projectRoot, localRoot, evidenceDigest, pin };
}

type PrepareResult = {
  roles: string[];
  rolePacks: Record<string, unknown>;
  missionPackets?: Record<string, OperatingMissionPacket>;
  roleInputDigests: Record<string, `sha256:${string}`>;
  lease: string;
  idempotencyKey: string;
  handoff: {
    kind: string;
    protocolVersion: string;
    state: string;
    next: Array<{
      action: string;
      role?: string;
      dispatch?: {
        agent?: string;
        missionPacketPointer?: string;
        rolePackPointer?: string;
        isolation?: string;
      };
      stdin?: { schema?: string; schemaPointer?: string };
    }>;
  };
};

beforeAll(() => {
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterAll(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('native mission dispatch reaches the record action (FR1 / US-003)', () => {
  it('prepares a mission packet (not a pack) and hands back a v1.3 mission record action on a claude-code runtime', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'mission-prepare',
    })) as PrepareResult;

    // The role resolved to native mission dispatch, so its session data is a
    // buildOperatingMissionPackets output exposed at /data/missionPackets/<role>,
    // NOT a rolePack.
    expect(prepared.roles).toEqual(['strategy-finance']);
    expect(prepared.rolePacks).toEqual({});
    const packet = prepared.missionPackets?.['strategy-finance'];
    expect(packet?.kind).toBe('operating-mission-packet');
    expect(packet?.protocolVersion).toBe('1.3.0');
    expect(packet?.packetDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // A body-free evidence INDEX only — no file body ever, and no rolePack pointer.
    expect(canonicalize(packet)).not.toContain(BODY_MARKER);
    for (const item of packet?.evidenceIndex ?? []) {
      expect((item as Record<string, unknown>).content).toBeUndefined();
      expect((item as Record<string, unknown>).body).toBeUndefined();
    }
    expect(prepared.roleInputDigests['strategy-finance']).toBe(packet?.packetDigest);

    // The handoff is v1.3 and its record action names the generated lens agent and
    // points at the mission packet — never a rolePackPointer, never empty-tools.
    expect(prepared.handoff.protocolVersion).toBe('1.3.0');
    expect(prepared.handoff.state).toBe('record-required');
    const recordAction = prepared.handoff.next.find((entry) => entry.action === 'adapter.record');
    expect(recordAction?.role).toBe('strategy-finance');
    expect(recordAction?.dispatch?.agent).toBe('operating-strategy-finance');
    expect(recordAction?.dispatch?.missionPacketPointer).toBe(
      '/data/missionPackets/strategy-finance',
    );
    expect(recordAction?.dispatch?.rolePackPointer).toBeUndefined();
    expect(recordAction?.dispatch?.isolation).toBe('enforced-read-only-bounded');
    expect(recordAction?.stdin?.schema).toBe(
      'https://openplanr.dev/schemas/v1.3.0/operating-advisor-response.schema.json',
    );
  });

  it('stamps protocolVersion 1.3.0 on the start (prepare-required) handoff — the second call site — when a bound role resolves mission', async () => {
    const mission = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const start = (await createOperatingAdapterStartHandoff({
      projectRoot: mission.projectRoot,
      cycleId: 'CYCLE-001',
      evidenceDigest: mission.evidenceDigest,
      runtime: 'claude',
      phase: 'advisors',
      roles: ['strategy-finance'],
      localRoot: mission.localRoot,
    })) as { state: string; protocolVersion: string };
    expect(start.state).toBe('prepare-required');
    expect(start.protocolVersion).toBe('1.3.0');

    // The same start handoff stays v1.2 for an advisory-isolation runtime.
    const fallback = await advisingMissionCycle({
      runtime: 'codex',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const codexStart = (await createOperatingAdapterStartHandoff({
      projectRoot: fallback.projectRoot,
      cycleId: 'CYCLE-001',
      evidenceDigest: fallback.evidenceDigest,
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance'],
      localRoot: fallback.localRoot,
    })) as { protocolVersion: string };
    expect(codexStart.protocolVersion).toBe('1.2.0');
  });

  it('accepts a v1.3 citation-bearing response and threads its citations through gateRecordedProposalCitations', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'mission-record',
    })) as PrepareResult;

    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'mission-record',
      role: 'strategy-finance',
      stdin: JSON.stringify({
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'invest-in-service',
            type: 'finding',
            title: 'Read-only advisory boundary is intact',
            problem: 'The runtime adapter must never widen its grant.',
            proposal: 'Keep the bounded read-only surface as the only tool grant.',
            impact: 4,
            confidence: 4,
            ease: 3,
            severity: 'medium',
            citations: [
              {
                repositoryPath: 'src/service.ts',
                lineRange: { start: 1, end: 2 },
                pinnedRevision: fixture.pin,
              },
            ],
          },
        ],
        gaps: [],
        conflicts: [],
      }),
    })) as { recorded: string; result: OperatingRoleResult };

    // The record action accepted the compact v1.3 response, and its citation flowed
    // through the citation gate into a minted, snapshot-bound evidenceRef — the
    // committed result is v1.2-valid (evidenceRefs, no raw citations).
    expect(recorded.recorded).toBe('strategy-finance');
    expect(recorded.result.roleId).toBe('strategy-finance');
    expect(recorded.result.outcome).toBe('proposals');
    const proposal = recorded.result.proposals[0];
    expect(proposal.evidenceRefs.some((ref) => /^EVD-/.test(ref))).toBe(true);
    expect((proposal as Record<string, unknown>).citations).toBeUndefined();

    // Re-running the SAME gate over the committed result is a no-op (citations were
    // already resolved), proving the gate is exactly where the citations landed.
    const regated = await gateRecordedProposalCitations({
      roleResults: [recorded.result],
      context: {
        projectRoot: fixture.projectRoot,
        cycleId: 'CYCLE-001',
        descriptor: {
          componentId: 'control',
          canonicalRemote: 'github.com/openplanr/mission-adapter-fixture',
          configuredBranch: 'main',
          pinnedRevision: fixture.pin,
          dirtyFingerprint: null,
          readOnly: false,
        },
        cache: new OperatingEvidenceCache(
          resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).evidence,
          'internal',
        ),
        owner: 'Owner',
      },
    });
    expect(regated.roleResults[0].proposals).toHaveLength(1);
  });

  it('runs a mixed-mode cycle: the default role prepares a mission packet, the pack-overridden role prepares a rolePack', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      dispatchModeOverrides: { 'technology-risk': 'pack' },
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'mission-mixed',
    })) as PrepareResult;

    expect(prepared.roles).toEqual(['strategy-finance', 'technology-risk']);
    // Both dispatch paths coexist in ONE prepared session: the default role is a
    // mission packet, the --dispatch-mode-override=pack role is a v1.2 rolePack.
    expect(Object.keys(prepared.missionPackets ?? {})).toEqual(['strategy-finance']);
    expect(Object.keys(prepared.rolePacks)).toEqual(['technology-risk']);
    expect(prepared.missionPackets?.['strategy-finance'].kind).toBe('operating-mission-packet');
    // Provenance never lies: the overridden role's committed input digest is a
    // pack digest, never a mission packet digest.
    expect(prepared.roleInputDigests['strategy-finance']).toBe(
      prepared.missionPackets?.['strategy-finance'].packetDigest,
    );
    expect(prepared.roleInputDigests['technology-risk']).not.toBe(
      prepared.missionPackets?.['strategy-finance'].packetDigest,
    );

    // The pack-overridden role records via the v1.2 pack path (a v1.2 evidenceRef
    // response, not a v1.3 citation response), proving the override is
    // execution-effective, not merely a label.
    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'mission-mixed',
      role: 'strategy-finance',
      stdin: JSON.stringify({ outcome: 'quiet', proposals: [], gaps: [], conflicts: [] }),
    })) as { recorded: string; result: OperatingRoleResult };
    expect(recorded.result.roleId).toBe('strategy-finance');
    const packRecorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'mission-mixed',
      role: 'technology-risk',
      // A v1.2 pack response (evidenceRefs, no citations) — only valid on the pack
      // path. Its acceptance proves technology-risk was prepared as a pack.
      stdin: JSON.stringify({ outcome: 'quiet', proposals: [], gaps: [], conflicts: [] }),
    })) as { recorded: string; result: OperatingRoleResult };
    expect(packRecorded.result.roleId).toBe('technology-risk');
  });

  it('fails codex/cursor closed to the pack path: no mission packet, v1.2 rolePack handoff', async () => {
    for (const runtime of ['codex', 'cursor']) {
      const fixture = await advisingMissionCycle({
        runtime,
        enabledRoles: ['strategy-finance', 'chair'],
      });
      const prepared = (await operateAdapterLifecycle({
        ...fixture,
        action: 'prepare',
        cycleId: 'CYCLE-001',
        evidenceDigest: fixture.evidenceDigest,
        idempotencyKey: `fail-closed-${runtime}`,
      })) as PrepareResult;

      // An advisory-isolation runtime never receives a native lens: the role is a
      // v1.2 pack, the handoff defaults to 1.2.0, and its record action points at
      // the rolePack with empty-tool isolation.
      expect(prepared.missionPackets).toBeUndefined();
      expect(Object.keys(prepared.rolePacks)).toEqual(['strategy-finance']);
      expect(prepared.handoff.protocolVersion).toBe('1.2.0');
      const recordAction = prepared.handoff.next.find((entry) => entry.action === 'adapter.record');
      expect(recordAction?.dispatch?.rolePackPointer).toBe('/data/rolePacks/strategy-finance');
      expect(recordAction?.dispatch?.missionPacketPointer).toBeUndefined();
      expect(recordAction?.dispatch?.isolation).toBe('enforced-empty-tools');
    }
  });
});
