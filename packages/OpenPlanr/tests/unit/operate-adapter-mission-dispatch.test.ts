import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OperatingMandate } from '../../src/services/operate/advisors.js';
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

// If the file body ever appears in a mandate, an evidence body has leaked into
// the body-free, index-free mandate the contract promises.
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
 * and a committed evidence snapshot that satisfies role readiness.
 */
async function advisingMissionCycle(options: {
  runtime: string;
  enabledRoles: OperatingRoleId[];
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
  mandates: Record<string, OperatingMandate>;
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
        mandatePointer?: string;
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
  it('prepares a mandate (not a pack) with declared boundaries and no evidence body, and hands back a v1.4 harness record action on a claude-code runtime', async () => {
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

    // The role resolved to native mandate dispatch, so its session data is an
    // operating mandate exposed at /data/mandates/<role>, NOT a rolePack.
    expect(prepared.roles).toEqual(['strategy-finance']);
    const mandate = prepared.mandates['strategy-finance'];
    expect(mandate?.kind).toBe('operating-mandate');
    expect(mandate?.protocolVersion).toBe('1.4.0');
    expect(mandate?.mandateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Declared boundaries — the granted workspace roots (including `.planr/`
    // regardless of git tracking), the sensitivity ceiling, and forbidden paths.
    expect(mandate?.boundaries.roots).toContain('.planr');
    expect(mandate?.boundaries.roots).toContain('src');
    expect(mandate?.boundaries.sensitivityCeiling).toBeTruthy();
    // NO evidence body and NO evidence index — the mandate is bounded instruction.
    expect(canonicalize(mandate)).not.toContain(BODY_MARKER);
    expect((mandate as unknown as Record<string, unknown>).evidenceIndex).toBeUndefined();
    expect((mandate as unknown as Record<string, unknown>).evidence).toBeUndefined();
    expect(mandate?.responseSchema).toBe('operating-advisor-response@1.4.0');
    expect(prepared.roleInputDigests['strategy-finance']).toBe(mandate?.mandateDigest);

    // The handoff is v1.4 and its record action names the generated lens agent and
    // points at the mandate — never a rolePackPointer, never empty-tools.
    expect(prepared.handoff.protocolVersion).toBe('1.4.0');
    expect(prepared.handoff.state).toBe('record-required');
    const recordAction = prepared.handoff.next.find((entry) => entry.action === 'harness.record');
    expect(recordAction?.role).toBe('strategy-finance');
    expect(recordAction?.dispatch?.agent).toBe('operating-strategy-finance');
    expect(recordAction?.dispatch?.mandatePointer).toBe('/data/mandates/strategy-finance');
    expect(recordAction?.dispatch?.missionPacketPointer).toBeUndefined();
    expect(recordAction?.dispatch?.rolePackPointer).toBeUndefined();
    expect(recordAction?.dispatch).toMatchObject({
      assurance: 'runtime-governed',
      toolIsolation: 'enforced',
      permissionAuthority: 'runtime-session',
    });
    expect(recordAction?.stdin?.schema).toBe(
      'https://openplanr.dev/schemas/v1.4.0/operating-advisor-response.schema.json',
    );
  });

  it('stamps protocolVersion 1.4.0 on the start handoff for every certified runtime', async () => {
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
    expect(start.protocolVersion).toBe('1.4.0');

    // Every supported runtime starts from the same Protocol v1.4 harness contract.
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
    expect(codexStart.protocolVersion).toBe('1.4.0');
  });

  it('accepts a v1.4 citation-bearing response and threads its actions through citation validation', async () => {
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
        outcome: 'actions',
        analysisMarkdown: '# CEO analysis\n\nThe runtime boundary is intact.',
        claims: [],
        actions: [
          {
            actionKey: 'invest-in-service',
            title: 'Read-only advisory boundary is intact',
            summary: 'Keep the runtime session boundary and validate every material citation.',
            lane: 'DEV',
            routeKind: 'quick-task',
            horizon: 'immediate',
            impact: 4,
            confidence: 4,
            ease: 3,
            citations: [
              {
                kind: 'repository',
                path: 'src/service.ts',
                startLine: 1,
                endLine: 2,
                revision: fixture.pin,
              },
            ],
          },
        ],
        gaps: [],
        conflicts: [],
      }),
    })) as { recorded: string; result: OperatingRoleResult };

    // The record action accepted the rich v1.4 response, and its citation flowed
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

  it('prepares every enabled advisor role as a Protocol v1.4 mandate', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'mission-mixed',
    })) as PrepareResult;

    expect(prepared.roles).toEqual(['strategy-finance', 'technology-risk']);
    expect(Object.keys(prepared.mandates)).toEqual(['strategy-finance', 'technology-risk']);
    expect(prepared.mandates['strategy-finance'].kind).toBe('operating-mandate');
    expect(prepared.mandates['technology-risk'].protocolVersion).toBe('1.4.0');
    expect(prepared.roleInputDigests['strategy-finance']).toBe(
      prepared.mandates['strategy-finance'].mandateDigest,
    );
    expect(prepared.roleInputDigests['technology-risk']).toBe(
      prepared.mandates['technology-risk'].mandateDigest,
    );

    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'mission-mixed',
      role: 'strategy-finance',
      stdin: JSON.stringify({
        outcome: 'quiet',
        analysisMarkdown: '# CEO analysis\n\nNo qualified action.',
        claims: [],
        actions: [],
        gaps: [],
        conflicts: [],
      }),
    })) as { recorded: string; result: OperatingRoleResult };
    expect(recorded.result.roleId).toBe('strategy-finance');
    const technologyRecorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'mission-mixed',
      role: 'technology-risk',
      stdin: JSON.stringify({
        outcome: 'quiet',
        analysisMarkdown: '# CTO analysis\n\nNo qualified action.',
        claims: [],
        actions: [],
        gaps: [],
        conflicts: [],
      }),
    })) as { recorded: string; result: OperatingRoleResult };
    expect(technologyRecorded.result.roleId).toBe('technology-risk');
  });

  it('requires the Protocol v1.4 same-runtime harness handoff for codex and cursor', async () => {
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

      expect(Object.keys(prepared.mandates)).toEqual(['strategy-finance']);
      expect(prepared.handoff.protocolVersion).toBe('1.4.0');
      const recordAction = prepared.handoff.next.find((entry) => entry.action === 'harness.record');
      expect(recordAction?.dispatch?.mandatePointer).toBe('/data/mandates/strategy-finance');
      expect(recordAction?.dispatch?.rolePackPointer).toBeUndefined();
    }
  });
});
