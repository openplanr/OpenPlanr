import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerOperateCommand } from '../../src/cli/commands/operate.js';
import {
  buildOperatingMandate,
  createRegistryReconciledAdvisorBrief,
  type OperatingMandate,
  routeKindToProposalType,
} from '../../src/services/operate/advisors.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import { buildOperatingBootstrapMap } from '../../src/services/operate/context-research.js';
import { gateRecordedProposalCitations } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';
import {
  createOperatingAdapterStartHandoff,
  operateAdapterLifecycle,
} from '../../src/services/operate/maintenance.js';
import { runMissionDispatchFanOut } from '../../src/services/operate/mission-dispatch.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';
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
import { display } from '../../src/utils/logger.js';

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

// US-T1: the response contract is DISCLOSED in the mandate, validation is BATCHED,
// and `harness validate` is a lease-free read-only dry-run of the record contract.
interface CliActionResult {
  ok: boolean;
  action: string;
  code?: string;
  data?: { issues?: Array<{ path: string; rule: string; detail: string }>; valid?: boolean };
}

/**
 * Drive the REAL `planr operate` command tree end-to-end (commander parse → the
 * shared execute path → the real service), piping `stdinPayload` on stdin and
 * capturing the single emitted JSON result. Proves the mechanism through the CLI,
 * not just the bare service function (tonight's BL-007 lesson).
 */
async function runOperateCli(
  args: string[],
  stdinPayload: string,
  stateRoot: string,
): Promise<CliActionResult> {
  const emitted: string[] = [];
  const lineSpy = vi.spyOn(display, 'line').mockImplementation((value: string) => {
    emitted.push(value);
  });
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  const originalStateRoot = process.env.OPENPLANR_STATE_ROOT;
  const previousExitCode = process.exitCode;
  const stream = Readable.from([stdinPayload]);
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: false });
  Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
  process.env.OPENPLANR_STATE_ROOT = stateRoot;
  try {
    const program = new Command()
      .name('planr')
      .exitOverride()
      .option('--project-dir <path>', 'project directory')
      .option('--yes', 'confirm actions', false)
      .option('--json', 'emit JSON', false);
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    registerOperateCommand(program);
    await program.parseAsync(['node', 'planr', ...args]);
  } finally {
    lineSpy.mockRestore();
    if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
    if (originalStateRoot === undefined) delete process.env.OPENPLANR_STATE_ROOT;
    else process.env.OPENPLANR_STATE_ROOT = originalStateRoot;
    process.exitCode = previousExitCode;
  }
  const last = emitted.at(-1);
  if (last === undefined) throw new Error('the operate CLI emitted no JSON result');
  return JSON.parse(last) as CliActionResult;
}

// A v1.4 advisor action with a resolvable repository citation, valid on its own.
function validAction(
  key: string,
  pin: string,
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actionKey: key,
    title: 'Read-only advisory boundary is intact',
    summary: 'Keep the runtime session boundary and validate every material citation.',
    lane: 'DEV',
    routeKind: 'quick-task',
    horizon: 'immediate',
    confidence: 4,
    citations: [
      { kind: 'repository', path: 'src/service.ts', startLine: 1, endLine: 2, revision: pin },
    ],
    ...override,
  };
}

describe('US-T1 disclosed contract, batched validation, and lease-free validate dry-run', () => {
  it('ships the full response contract inside every prepared mandate without touching mandateDigest', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'contract-disclosed',
    })) as PrepareResult;

    // Assert on the ACTUAL prepare output, not a unit fixture.
    const mandate = prepared.mandates['strategy-finance'];
    expect(mandate.output).toBeDefined();
    expect(mandate.output?.schema).toBe('operating-advisor-response@1.2.0');
    // A dereferenceable JSON Schema, not just a schema NAME the runtime cannot resolve.
    expect(mandate.output?.jsonSchema).toBeTruthy();
    expect(typeof mandate.output?.jsonSchema).toBe('object');
    expect(mandate.output?.allowedProposalTypes).toEqual(['data-gap', 'decision', 'finding']);
    expect(mandate.output?.maximumProposals).toBe(4);
    expect(mandate.output?.maximumOutputBytes).toBeGreaterThan(0);
    expect(Array.isArray(mandate.output?.requiredBehavior)).toBe(true);
    expect(mandate.output?.requiredBehavior.length).toBeGreaterThan(0);

    // The disclosure is layered on AFTER the pipeline signed the digest: the record
    // path's input-digest binding still equals the signed mandateDigest verbatim.
    expect(prepared.roleInputDigests['strategy-finance']).toBe(mandate.mandateDigest);
    expect(mandate.mandateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('returns ALL violation categories in one CLI validate response (schema enum + citation + gap type + over-cap)', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'batch-validate',
    });

    // Four distinct violation categories in ONE payload: a bad enum, an over-cap
    // action count (5 > the strategy-finance cap of 4), an integer gaps[].impact,
    // and a malformed citation.
    const payload = JSON.stringify({
      outcome: 'actions',
      analysisMarkdown: '# CEO analysis\n\nMultiple contract violations.',
      claims: [],
      actions: [
        validAction('a1', fixture.pin),
        validAction('a2', fixture.pin),
        validAction('a3', fixture.pin),
        validAction('a4', fixture.pin, { routeKind: 'verified' }),
        validAction('a5', fixture.pin, {
          citations: [{ kind: 'repository', path: 'src/service.ts' }],
        }),
      ],
      gaps: [{ id: 'G1', question: 'What is the budget ceiling?', impact: 5 }],
      conflicts: [],
    });

    const result = await runOperateCli(
      [
        '--project-dir',
        fixture.projectRoot,
        'operate',
        'harness',
        'validate',
        '--role',
        'strategy-finance',
        '--cycle-id',
        'CYCLE-001',
        '--stdin',
        '--json',
      ],
      payload,
      fixture.localRoot,
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_OPERATE_ADVISOR_FAILED');
    const issues = result.data?.issues ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(4);
    // Every category is present in the SAME response — no category-at-a-time cycle.
    const hasCap = issues.some((issue) => issue.rule === 'maximumProposals');
    const hasEnum = issues.some(
      (issue) => issue.rule === 'enum' && issue.path.includes('routeKind'),
    );
    const hasGapType = issues.some(
      (issue) =>
        issue.rule === 'type' && issue.path.includes('gaps') && issue.path.includes('impact'),
    );
    const hasCitation = issues.some(
      (issue) => issue.rule === 'oneOf' && issue.path.includes('citations'),
    );
    expect({ hasCap, hasEnum, hasGapType, hasCitation }).toEqual({
      hasCap: true,
      hasEnum: true,
      hasGapType: true,
      hasCitation: true,
    });
    // Every issue is the canonical {path, rule, detail} shape.
    for (const issue of issues) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.rule).toBe('string');
      expect(typeof issue.detail).toBe('string');
    }
  });

  it('validate consumes no lease: two CLI validates then a record on the same lease', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'validate-then-record',
    })) as PrepareResult;

    const cleanPayload = JSON.stringify({
      outcome: 'actions',
      analysisMarkdown: '# CEO analysis\n\nThe runtime boundary is intact.',
      claims: [],
      actions: [validAction('invest-in-service', fixture.pin)],
      gaps: [],
      conflicts: [],
    });
    const validateArgs = [
      '--project-dir',
      fixture.projectRoot,
      'operate',
      'harness',
      'validate',
      '--role',
      'strategy-finance',
      '--cycle-id',
      'CYCLE-001',
      '--stdin',
      '--json',
    ];

    // Run validate TWICE — no lease, no idempotency key supplied.
    const first = await runOperateCli(validateArgs, cleanPayload, fixture.localRoot);
    const second = await runOperateCli(validateArgs, cleanPayload, fixture.localRoot);
    expect(first.ok).toBe(true);
    expect(first.data?.valid).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.data?.valid).toBe(true);

    // The lease and idempotency key were never consumed: the real record still lands.
    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'validate-then-record',
      role: 'strategy-finance',
      stdin: cleanPayload,
    })) as { recorded: string; result: OperatingRoleResult };
    expect(recorded.recorded).toBe('strategy-finance');
    expect(recorded.result.roleId).toBe('strategy-finance');
    expect(recorded.result.outcome).toBe('proposals');
  });
});

// DoD #2 — the two mechanisms this project deliberately reversed must never return.
describe('FR12 anti-regression: no evidence-pack input, no repository-size ceiling in dispatch preparation (T-011)', () => {
  const DISPATCH_PREP_SOURCES = [
    'src/services/operate/context-research.ts',
    'src/services/operate/advisors.ts',
    'src/services/operate/mission-dispatch.ts',
  ];
  // The retired mechanisms, matched as concrete code identifiers (camelCase). The
  // surrounding prose that neutrally describes the retired pack — "evidence body",
  // "evidence index", "evidence pack" — is spaced/hyphenated and never a false hit.
  const FORBIDDEN_IDENTIFIERS = [
    'evidencePack',
    'evidenceBundle',
    'evidenceBody',
    'curatedEvidence',
    'preCollectedEvidence',
    'repositorySizeCeiling',
    'repositoryByteCeiling',
    'maxRepositoryBytes',
    'maxRepoSize',
    'repoSizeLimit',
    'repositorySizeLimit',
    'maxRepositorySize',
  ];

  it('declares no evidence-pack input parameter and no repository-size ceiling anywhere in the dispatch-preparation sources', async () => {
    for (const relativePath of DISPATCH_PREP_SOURCES) {
      const source = await readFile(resolve(process.cwd(), relativePath), 'utf8');
      for (const token of FORBIDDEN_IDENTIFIERS) {
        expect(source.includes(token), `${relativePath} must not reintroduce ${token}`).toBe(false);
      }
    }
  });

  it('produces a body-free, ceiling-free shared bootstrap map and mandate (pointers, not a pack)', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const map = await buildOperatingBootstrapMap(fixture.projectRoot);
    const mapRecord = map as unknown as Record<string, unknown>;
    // The map is a pointer set: no collected body, no evidence bundle, no size gate.
    for (const key of [
      'content',
      'body',
      'evidence',
      'evidencePack',
      'evidenceBundle',
      'maxBytes',
      'repositorySizeCeiling',
      'sizeCeiling',
    ]) {
      expect(mapRecord[key]).toBeUndefined();
    }
    for (const entry of map.entries) {
      const entryRecord = entry as unknown as Record<string, unknown>;
      expect(entryRecord.citation).toBeDefined();
      expect(entryRecord.content).toBeUndefined();
      expect(entryRecord.body).toBeUndefined();
    }

    const mandate = await buildOperatingMandate({
      roleId: 'strategy-finance',
      roots: ['src', '.planr'],
      bootstrapMap: map,
      researchBudgetMs: 60_000,
    });
    const mandateRecord = mandate as unknown as Record<string, unknown>;
    expect(mandateRecord.evidence).toBeUndefined();
    expect(mandateRecord.evidenceIndex).toBeUndefined();
    expect(mandateRecord.evidencePack).toBeUndefined();
    // The guidance references the shared map (never a pack); the per-role budget is a
    // graceful millisecond signal, never a size/enumeration cap on what may be read.
    expect(mandate.researchGuidance?.bootstrapMapDigest).toBe(map.mapDigest);
    expect(typeof mandate.researchGuidance?.perRoleResearchBudgetMs).toBe('number');
  });
});

// DoD #3 — a role past its per-role research budget synthesizes rather than being cut off.
describe('per-role research budget synthesizes rather than truncating (FR12 / T-011)', () => {
  it('a role past its injected budget synthesizes from what it has and is never cut off', async () => {
    let clock = 1_000;
    const now = (): number => clock;
    const overBudget: string[] = [];
    const FULL_OUTPUT = 'x'.repeat(5_000);
    const results = await runMissionDispatchFanOut<
      { role: string; overruns: boolean },
      { role: string; synthesized: boolean; output: string }
    >({
      items: [
        { role: 'a', overruns: false },
        { role: 'b', overruns: true },
      ],
      parallel: false,
      perRoleBudgetMs: 100,
      now,
      onBudgetExceeded: (item) => overBudget.push(item.role),
      run: async (item, signal) => {
        if (item.overruns) clock += 500; // the role spends past its research budget
        // The role consults its budget; if blown it wraps up and synthesizes from
        // what it has — returning its FULL gathered output, never a cut-off stub.
        const synthesized = signal.budgetExceeded();
        return { role: item.role, synthesized, output: FULL_OUTPUT };
      },
    });

    // Order preserved; the in-budget role did not synthesize early, the overrunning one did.
    expect(results.map((result) => result.role)).toEqual(['a', 'b']);
    expect(results[0].synthesized).toBe(false);
    expect(results[1].synthesized).toBe(true);
    // The overrunning role's output is intact and uncut — graceful synthesis, not truncation.
    expect(results[1].output).toBe(FULL_OUTPUT);
    expect(results[1].output).toHaveLength(5_000);
    expect(overBudget).toEqual(['b']);
  });

  it('bounds fan-out concurrency without reordering results', async () => {
    let active = 0;
    let peak = 0;
    const results = await runMissionDispatchFanOut<number, number>({
      items: [0, 1, 2, 3, 4],
      parallel: true,
      concurrency: 2,
      run: async (item) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 5));
        active -= 1;
        return item * 10;
      },
    });
    // Results stay in input order regardless of completion order.
    expect(results).toEqual([0, 10, 20, 30, 40]);
    // No more than `concurrency` roles researched at once.
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('keeps the legacy single-argument run signature working (backward compatible)', async () => {
    const results = await runMissionDispatchFanOut<number, number>({
      items: [1, 2, 3],
      parallel: false,
      run: (item) => Promise.resolve(item + 1),
    });
    expect(results).toEqual([2, 3, 4]);
  });
});

// T5 — the Chair's brief bounds are RECONCILED from the role registry, so the
// Chair can propose bounded routes (it could not, at all, before this) and the
// registry and the enforced runtime contract can never disagree again.
describe('T5 — registry-reconciled proposal bounds unblock the Chair and bind runtime to the registry', () => {
  /** The four route kinds tonight's rejected Chair consolidation used. */
  function chairConsolidationPayload(pin: string): string {
    return JSON.stringify({
      outcome: 'actions',
      analysisMarkdown:
        '# Chair consolidation\n\nConsolidate the recorded board into four bounded routes.',
      claims: [],
      actions: [
        validAction('consolidate-quick-task', pin, { routeKind: 'quick-task' }),
        validAction('consolidate-spec', pin, { routeKind: 'spec' }),
        validAction('consolidate-decision', pin, { routeKind: 'decision' }),
        validAction('consolidate-experiment', pin, { routeKind: 'experiment' }),
      ],
      gaps: [],
      conflicts: [],
    });
  }

  it('records the exact Chair payload rejected tonight (quick-task, spec, decision, experiment) through the real record path', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    // The Chair is prepared alone (its own phase), exactly as the live cycle does.
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'chair-repro',
      role: 'chair',
    })) as PrepareResult;
    expect(prepared.roles).toEqual(['chair']);

    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'chair-repro',
      role: 'chair',
      stdin: chairConsolidationPayload(fixture.pin),
    })) as { recorded: string; result: OperatingRoleResult };

    // Tonight this shape failed with "Advisor chair returned proposal types
    // outside its canonical brief: decision, finding". It now records: every action
    // maps to an allowed type and its citations resolve to minted evidenceRefs.
    expect(recorded.recorded).toBe('chair');
    expect(recorded.result.roleId).toBe('chair');
    expect(recorded.result.outcome).toBe('proposals');
    expect(recorded.result.proposals).toHaveLength(4);
    const types = new Set(recorded.result.proposals.map((proposal) => proposal.type));
    // decision routeKind → decision proposal; the other three → finding.
    expect(types).toEqual(new Set(['decision', 'finding']));
    for (const proposal of recorded.result.proposals) {
      expect(proposal.evidenceRefs.some((reference) => /^EVD-/.test(reference))).toBe(true);
    }
  });

  it('accepts the same Chair payload through the lease-free `harness validate` dry-run', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'chair-validate',
      role: 'chair',
    });

    const result = await runOperateCli(
      [
        '--project-dir',
        fixture.projectRoot,
        'operate',
        'harness',
        'validate',
        '--role',
        'chair',
        '--cycle-id',
        'CYCLE-001',
        '--stdin',
        '--json',
      ],
      chairConsolidationPayload(fixture.pin),
      fixture.localRoot,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.valid).toBe(true);
  });

  it('ships the registry-true Chair contract inside the prepared mandate (cap 12, finding+decision allowed)', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['strategy-finance', 'chair'],
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'chair-contract',
      role: 'chair',
    })) as PrepareResult;

    // The sibling task ships the brief's output facet inside the mandate, so once
    // the values are registry-derived the runtime SEES the true caps and types.
    const output = prepared.mandates.chair.output;
    expect(output?.maximumProposals).toBe(12);
    expect(output?.allowedProposalTypes).toEqual(expect.arrayContaining(['finding', 'decision']));
    // The frozen consolidation vocabulary is LEFT intact, not removed.
    expect(output?.allowedProposalTypes).toEqual(expect.arrayContaining(['merge', 'sequence']));
  });

  it('binds every role: maximumProposals === registry maxActions and the routeKind image is allowed (iterated, no hardcoded role list)', async () => {
    const protocol = await loadOperatingProtocol();
    const registry = protocol.listOperatingRoles();
    expect(registry.length).toBeGreaterThan(0);

    for (const role of registry) {
      const roleId = role.id;
      const brief = createRegistryReconciledAdvisorBrief(protocol, roleId);
      const routeKinds = role.allowedRouteKinds as string[];
      const maxActions = (role.budgets as { maxActions: number }).maxActions;
      const image = [...new Set(routeKinds.map(routeKindToProposalType))].sort();

      // The cap is the registry's, verbatim — a future registry cap edit cannot
      // silently disagree with the enforced runtime bound.
      expect(brief.output.maximumProposals, `maximumProposals for ${roleId}`).toBe(maxActions);
      // Every proposal type an action of this role's allowed route kinds becomes is
      // allowed by the brief — this is the property the Chair violated tonight.
      for (const type of image) {
        expect(
          brief.output.allowedProposalTypes,
          `${roleId} must allow its registry-reachable type ${type}`,
        ).toContain(type);
      }
      // The registry image restricted to the routeKind codomain equals exactly the
      // reachable-type portion of the allowed set (no reachable type is missing and
      // none is invented beyond the mapping's codomain).
      const reachable = brief.output.allowedProposalTypes
        .filter((type) => type === 'finding' || type === 'decision')
        .sort();
      expect(reachable, `reachable allowed types for ${roleId}`).toEqual(image);
    }
  });
});
