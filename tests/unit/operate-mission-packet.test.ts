import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdvisorOperatingContext,
  buildOperatingMissionPacket,
  deriveOperatingMissionBudget,
  deriveOperatingMissionBudgets,
  describeOperatingMissionTruncation,
} from '../../src/services/operate/advisors.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  buildOperatingMissionPackets,
  sourceOperatingMissionPacketState,
} from '../../src/services/operate/engine.js';
import {
  buildOperatingEvidenceIndex,
  collectOperatingEvidence,
} from '../../src/services/operate/evidence.js';
import type {
  OperatingConfig,
  OperatingEvidence,
  OperatingEvidenceIndexItem,
  OperatingRoleId,
  OperatingWorkspaceManifest,
} from '../../src/services/operate/types.js';
import { buildWorkspaceManifest } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

// A unique marker written into a source file. If it ever appears in a built
// index or mission packet, a file body has leaked into a body-free artifact.
const BODY_MARKER = 'MISSION_BODY_MARKER_7f3a91c2';

const ALL_ROLES: OperatingRoleId[] = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'chair',
];

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createGitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-mission-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/mission-fixture.git'],
    { cwd: projectRoot },
  );
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await mkdir(join(projectRoot, '.planr', 'specs'), { recursive: true });
  await writeFile(join(projectRoot, 'README.md'), '# Mission fixture\n');
  await writeFile(join(projectRoot, 'src', 'app.ts'), `export const app = '${BODY_MARKER}';\n`);
  await writeFile(
    join(projectRoot, '.planr', 'specs', 'SPEC-x.md'),
    `# Spec\n\nContains ${BODY_MARKER} inside a planr artifact.\n`,
  );
  await execFileAsync('git', ['add', '.'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

function budgets() {
  return {
    maxFiles: 100,
    maxItems: 100,
    maxBytes: 2 * 1024 * 1024,
    maxItemBytes: 256 * 1024,
    maxDurationMs: 10_000,
  };
}

async function collectRealEvidence(): Promise<{
  workspace: OperatingWorkspaceManifest;
  evidence: OperatingEvidence;
}> {
  const projectRoot = await createGitProject();
  const localRoot = await temporaryDirectory('openplanr-operate-mission-local-');
  const workspace = await buildWorkspaceManifest(projectRoot, [], {
    localRoot,
    persistRoots: true,
    capturedAt: '2026-07-28T10:00:00.000Z',
  });
  const evidence = await collectOperatingEvidence({
    projectRoot,
    cycleId: 'CYCLE-001',
    workspace,
    providers: ['repository', 'git'],
    sensitivityCeiling: 'confidential',
    budgets: budgets(),
    localRoot,
    now: new Date('2026-07-28T10:00:00.000Z'),
  });
  return { workspace, evidence };
}

function config(): OperatingConfig {
  return {
    kind: 'operating-config',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    profile: 'saas',
    decisionOwner: 'Owner',
    cadence: 'manual',
    planningEngine: 'openplanr',
    enabledRoles: ALL_ROLES,
    enabledProviders: ['repository', 'git'],
    caps: { surfacedFindings: 5, newSpecs: 2, openDecisions: 5, agentArtifacts: 3 },
    budgets: {
      maxFiles: 100,
      maxItems: 100,
      maxBytes: 2 * 1024 * 1024,
      maxDurationMs: 10_000,
    },
  };
}

function advisorContext(): AdvisorOperatingContext {
  const context = {
    charter: {
      purpose: 'Operate a trustworthy planning product.',
      stage: 'growth',
      businessModel: 'subscription',
      idealCustomer: 'technical founders',
      goals: ['Improve activation', 'Ship the operating board'],
      constraints: ['No autonomous deployment'],
      successMetrics: ['First brief in five minutes'],
      guardrails: ['No external writes'],
      knownUnknowns: ['Conversion baseline'],
    },
    priorCycle: {
      id: 'CYCLE-000',
      state: 'closed',
      health: 'normal',
      findings: 2,
      decisions: 1,
      gaps: 1,
      pendingOutcomes: 1,
    },
    openDecisions: [
      {
        id: 'DEC-001',
        status: 'open',
        summary: 'Choose activation metric',
        owner: 'Owner',
        evidenceRefs: [],
      },
    ],
    openGaps: [
      {
        id: 'GAP-001',
        status: 'open',
        summary: 'Verify runtime isolation',
        owner: 'Owner',
        evidenceRefs: [],
      },
    ],
    pendingOutcomes: [
      {
        id: 'OUT-001',
        status: 'pending',
        summary: 'Activation rate',
        owner: null,
        evidenceRefs: [],
      },
    ],
  };
  return { ...context, snapshotDigest: digest('c') };
}

describe('Operating Board mission packets (FR1/E-001)', () => {
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
          rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
        ),
    );
  });

  it('builds body-free evidence index items from a real git workspace', async () => {
    const { evidence } = await collectRealEvidence();
    const index = buildOperatingEvidenceIndex(evidence);

    expect(index.length).toBeGreaterThan(0);
    for (const item of index) {
      expect(item.id).toMatch(/^EVX-[A-Za-z0-9._-]+$/);
      expect(item.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(item.classification.length).toBeGreaterThan(0);
      expect(['fresh', 'stale', 'unknown']).toContain(item.freshness);
      expect(['public', 'internal', 'confidential', 'restricted']).toContain(item.sensitivity);
      expect(Array.isArray(item.signals)).toBe(true);
      // A path-referenced item OR a revision-referenced item — never both, and
      // never neither.
      expect(Boolean(item.path) !== Boolean(item.revision)).toBe(true);
      // No item may carry any body-bearing field.
      const record = item as Record<string, unknown>;
      expect(record.content).toBeUndefined();
      expect(record.summary).toBeUndefined();
      expect(record.body).toBeUndefined();
    }

    // Content-scan: the file body never appears in the serialized index.
    expect(JSON.stringify(index)).not.toContain(BODY_MARKER);

    // At least one path-referenced source item exists for the real src/ file.
    expect(index.some((item) => item.path === 'src/app.ts')).toBe(true);
    // Dot-prefixed planr paths cannot be schema-valid index pointers.
    expect(index.every((item) => !item.path?.startsWith('.planr'))).toBe(true);
  });

  it('records one pinned revision identically across manifest, index, and every packet', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const pin = workspace.controlRepository.pinnedRevision;
    expect(pin).toMatch(/^[a-f0-9]{7,64}$/);

    const index = buildOperatingEvidenceIndex(evidence);
    for (const item of index) {
      if (item.revision) expect(item.revision).toBe(pin);
    }
    // The git-history evidence is revision-referenced at the pinned revision.
    expect(index.some((item) => item.revision === pin)).toBe(true);

    const { packets } = await buildOperatingMissionPackets({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidence,
    });
    expect(packets).toHaveLength(ALL_ROLES.length);
    for (const packet of packets) {
      expect(packet.pinnedRevision).toBe(pin);
      for (const item of packet.evidenceIndex) {
        if (item.revision) expect(item.revision).toBe(pin);
      }
    }
  });

  it('sources the mission packet non-evidence payload from live cycle state', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const index = buildOperatingEvidenceIndex(evidence);
    const context = advisorContext();
    const state = sourceOperatingMissionPacketState({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context,
      evidenceIndex: index,
    });

    expect(state.charter.currentGoals).toEqual(['Improve activation', 'Ship the operating board']);
    expect(state.charter.productCharter).toContain('Operate a trustworthy planning product.');
    expect(state.priorCycleSummary.cycleId).toBe('CYCLE-000');
    expect(state.priorCycleSummary.openDecisions).toEqual(['DEC-001']);
    expect(state.priorCycleSummary.openGaps).toEqual(['GAP-001']);
    expect(state.priorCycleSummary.pendingOutcomes).toEqual(['OUT-001']);
    expect(state.planningStatus.planningEngine).toBe('openplanr');
    expect(state.declaredRoots).toContain('src');

    const { packet } = await buildOperatingMissionPacket({
      roleId: 'strategy-finance',
      ...state,
      evidenceIndex: index,
    });
    expect(packet.charter.currentGoals).toEqual(state.charter.currentGoals);
    expect(packet.priorCycleSummary).toEqual(state.priorCycleSummary);
    expect(packet.planningStatus).toEqual(state.planningStatus);
    expect(JSON.stringify(packet)).not.toContain(BODY_MARKER);
  });

  it('keeps every role mission packet within its derived mission budget', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const { packets } = await buildOperatingMissionPackets({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidence,
    });
    const derivedBudgets = await deriveOperatingMissionBudgets();
    for (const packet of packets) {
      const bytes = Buffer.byteLength(canonicalize(packet), 'utf8');
      // Every packet fits its own role's derived budget — no longer a flat
      // single-digit-KiB cap, but the registry-proportional [1, 32] KiB spread.
      expect(bytes).toBeLessThanOrEqual(derivedBudgets[packet.roleId]);
    }
    // The derived budget tracks the registry spread instead of the old 9-KiB cap.
    expect(deriveOperatingMissionBudget(655_360)).toBe(20 * 1024);
    expect(deriveOperatingMissionBudget(524_288)).toBe(16 * 1024);
    expect(deriveOperatingMissionBudget(196_608)).toBe(6 * 1024);
  });

  it('fails closed with E_OPERATE_MISSION_PACKET_BUDGET naming the role before dispatch', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const index = buildOperatingEvidenceIndex(evidence);
    const state = sourceOperatingMissionPacketState({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidenceIndex: index,
    });
    // Synthesize an oversized index with NO maxEvidenceItems, so no truncation
    // happens: it is well over strategy-finance's 16-KiB derived budget yet under
    // the pipeline producer's own 512-KiB maxInputBytes, so the engine's derived
    // -budget gate is the one that fires (an untruncated oversized index still
    // fails closed — truncation only applies when a cap is supplied).
    const oversized: OperatingEvidenceIndexItem[] = Array.from({ length: 300 }, (_, ordinal) => ({
      id: `EVX-oversized${String(ordinal).padStart(4, '0')}`,
      path: `src/generated/module${String(ordinal).padStart(4, '0')}/file${ordinal}.ts`,
      contentHash: digest('a'),
      source: 'repository',
      classification: 'source-code',
      freshness: 'fresh',
      sensitivity: 'internal',
      signals: ['code', 'architecture'],
    }));

    await expect(
      buildOperatingMissionPacket({
        roleId: 'strategy-finance',
        ...state,
        evidenceIndex: oversized,
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_MISSION_PACKET_BUDGET',
      message: expect.stringContaining('strategy-finance'),
    });
  });

  it('truncates a monorepo-scale index to the cap, fits the budget, and reports the drop (FR4)', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const index = buildOperatingEvidenceIndex(evidence);
    const state = sourceOperatingMissionPacketState({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidenceIndex: index,
    });
    // A monorepo-scale prioritized index (hundreds of repository pointers). The
    // caller's collection order is the priority order; the pipeline keeps the
    // first `cap` and truncates the rest — never an alphabetical re-starve.
    const monorepo: OperatingEvidenceIndexItem[] = Array.from({ length: 400 }, (_, ordinal) => ({
      id: `EVX-monorepo${String(ordinal).padStart(4, '0')}`,
      path: `packages/service-${String(ordinal).padStart(4, '0')}/src/index.ts`,
      contentHash: digest('b'),
      source: 'repository',
      classification: 'source-code',
      freshness: 'fresh',
      sensitivity: 'internal',
      signals: ['code', 'architecture'],
    }));
    const cap = 40;

    const { packet, truncation } = await buildOperatingMissionPacket({
      roleId: 'technology-risk',
      ...state,
      evidenceIndex: monorepo,
      maxEvidenceItems: cap,
    });

    // The packet fits: exactly `cap` items, within the role's derived budget —
    // no fail-closed on a healthy (if large) repository.
    expect(packet.evidenceIndex).toHaveLength(cap);
    const derivedBudgets = await deriveOperatingMissionBudgets();
    expect(Buffer.byteLength(canonicalize(packet), 'utf8')).toBeLessThanOrEqual(
      derivedBudgets['technology-risk'],
    );
    // The highest-priority items survived (the first `cap` in caller order).
    const kept = new Set(packet.evidenceIndex.map((item) => item.id));
    expect(kept.has('EVX-monorepo0000')).toBe(true);
    expect(kept.has('EVX-monorepo0399')).toBe(false);

    // The drop is loud provenance on the signed packet AND a returned record.
    const budgets = packet.budgets as {
      maxEvidenceItems?: number;
      truncatedEvidenceItems?: boolean;
      evidenceItemsBeforeTruncation?: number;
    };
    expect(budgets.truncatedEvidenceItems).toBe(true);
    expect(budgets.evidenceItemsBeforeTruncation).toBe(400);
    expect(truncation).toMatchObject({
      roleId: 'technology-risk',
      evidenceItemsBeforeTruncation: 400,
      keptItems: cap,
      droppedItems: 400 - cap,
      maxEvidenceItems: cap,
    });
    // A human-readable warning is producible for the cycle's warnings channel.
    if (!truncation) throw new Error('expected a truncation record');
    expect(describeOperatingMissionTruncation(truncation)).toContain('technology-risk');
    expect(describeOperatingMissionTruncation(truncation)).toContain('360');
  });

  it('surfaces per-role truncations from buildOperatingMissionPackets so the cycle can warn (FR4)', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const index = buildOperatingEvidenceIndex(evidence);
    // The real index carries more than one permitted item for a repository-reading
    // role, so a cap of 1 forces a reported truncation.
    expect(index.length).toBeGreaterThan(1);

    const { packets, truncations } = await buildOperatingMissionPackets({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidence,
      maxEvidenceItems: 1,
    });

    // Every role still built a packet — nothing failed closed.
    expect(packets).toHaveLength(ALL_ROLES.length);
    // At least one role's index exceeded the cap and was reported, never dropped
    // silently.
    expect(truncations.length).toBeGreaterThan(0);
    for (const truncation of truncations) {
      expect(truncation.maxEvidenceItems).toBe(1);
      expect(truncation.keptItems).toBe(1);
      expect(truncation.droppedItems).toBeGreaterThanOrEqual(1);
      expect(truncation.evidenceItemsBeforeTruncation).toBe(
        truncation.keptItems + truncation.droppedItems,
      );
    }
    // Each truncated role's packet carries exactly its capped item count.
    for (const truncation of truncations) {
      const packet = packets.find((entry) => entry.roleId === truncation.roleId);
      expect(packet?.evidenceIndex).toHaveLength(1);
    }
  });

  it('leaves a healthy repository under its cap untouched — no warning, no fail-closed (FR4)', async () => {
    const { workspace, evidence } = await collectRealEvidence();
    const { packets, truncations } = await buildOperatingMissionPackets({
      cycleId: 'CYCLE-001',
      config: config(),
      workspace,
      context: advisorContext(),
      evidence,
      // The configured item budget; each role's effective cap is the smaller of
      // it and the registry-sized default — both far above this tiny repo's index.
      maxEvidenceItems: config().budgets.maxItems,
    });

    // No fail-closed: every enabled role produced a packet.
    expect(packets).toHaveLength(ALL_ROLES.length);
    // No truncation warning, and no packet carries a truncation flag.
    expect(truncations).toEqual([]);
    for (const packet of packets) {
      const budgets = packet.budgets as { truncatedEvidenceItems?: boolean };
      expect(budgets.truncatedEvidenceItems).toBeUndefined();
    }
  });
});
