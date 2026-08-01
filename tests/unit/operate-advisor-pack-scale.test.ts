import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AdvisorAdapter,
  type AdvisorOperatingContext,
  createOperatingAdvisorPack,
  dispatchOperatingAdvisors,
} from '../../src/services/operate/advisors.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import type {
  OperatingEvidence,
  OperatingEvidenceReadiness,
} from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

// The exact byte count of the pack the field run shipped (US-002/FR2). A single
// excerpt this large would be quarantined by redaction's 16 KiB per-item gate, so
// the field incident's payload necessarily arrived as MANY in-gate excerpts whose
// aggregate no gate caught — that is the shape this scale test reproduces.
const FIELD_INCIDENT_BYTES = 2_736_185;
// technology-risk's real, published v1.2 pack budget (~640 KiB) after the
// reviewed registry raised it for real-repository economics.
const TECHNOLOGY_RISK_BUDGET = 655_360;
// < the v1.2 evidence summary schema cap (4096 chars) AND < redaction's 16 KiB
// quarantine gate, so every item is a valid, framed, in-gate excerpt.
const ITEM_SUMMARY_BYTES = 4_000;
const ITEM_COUNT = Math.ceil(FIELD_INCIDENT_BYTES / ITEM_SUMMARY_BYTES);

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

// Plain words that match none of redaction's instruction/secret patterns, so an
// excerpt is framed (not quarantined) and counts toward the pack budget.
const BENIGN_FILLER = 'alpha bravo charlie delta foxtrot golf hotel india juliet kilo lima mike ';

function benignSummary(bytes: number): string {
  return BENIGN_FILLER.repeat(Math.ceil(bytes / BENIGN_FILLER.length)).slice(0, bytes);
}

function repositoryItem(index: number, collectedAt: string): OperatingEvidence['items'][number] {
  return {
    id: `EVD-scale-${String(index).padStart(4, '0')}`,
    source: 'repository',
    location: `src/module-${index}.ts`,
    digest: `sha256:${String(index).padStart(64, '0')}`,
    collectedAt,
    observedFrom: null,
    observedTo: null,
    freshness: 'fresh',
    sensitivity: 'internal',
    claimTypes: ['code', 'architecture'],
    summary: benignSummary(ITEM_SUMMARY_BYTES),
  };
}

function advisorContext(): AdvisorOperatingContext {
  const context = {
    charter: {
      purpose: 'Prove pack input budgets fail closed.',
      stage: 'growth',
      businessModel: 'subscription',
      idealCustomer: 'technical founders',
      goals: ['Preserve bounded advisor input'],
      constraints: ['No autonomous deployment'],
      successMetrics: ['Every dispatch stays within budget'],
      guardrails: ['No external writes'],
      knownUnknowns: ['Aggregate payload scale'],
    },
    priorCycle: null,
    openDecisions: [],
    openGaps: [],
    pendingOutcomes: [],
  };
  return { ...context, snapshotDigest: digest('c') };
}

function overBudgetSnapshot(): OperatingEvidence {
  const collectedAt = '2026-07-28T10:00:00.000Z';
  const items: OperatingEvidence['items'] = [];
  for (let index = 0; index < ITEM_COUNT; index += 1) {
    items.push(repositoryItem(index, collectedAt));
  }
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt,
    truncated: false,
    items,
    sources: [
      {
        id: 'repository',
        fingerprint: digest('3'),
        status: 'collected',
        itemCount: ITEM_COUNT,
        byteCount: ITEM_COUNT * ITEM_SUMMARY_BYTES,
      },
    ],
    warnings: [],
  };
}

function readyTechnologyRisk(
  snapshot: OperatingEvidence,
): OperatingEvidenceReadiness['roles'][number] {
  return {
    roleId: 'technology-risk',
    readiness: 'ready',
    requirements: [],
    missingEvidence: [],
    evidenceRefs: snapshot.items.map((item) => item.id),
    modelCallAllowed: true,
    gapId: null,
  };
}

function readinessDoc(
  role: OperatingEvidenceReadiness['roles'][number],
): OperatingEvidenceReadiness {
  return {
    kind: 'operating-evidence-readiness',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    inputDigest: digest('b'),
    evaluatedAt: '2026-07-28T10:00:01.000Z',
    roles: [role],
  };
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
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

// A committed, advising cycle whose persisted evidence reaches the field scale.
// technology-risk is ready (repository code/architecture + one git change-history
// item), so prepare reaches pack construction — where the budget must fail closed.
async function preparedOverBudgetCycle(): Promise<{
  projectRoot: string;
  localRoot: string;
  evidenceDigest: `sha256:${string}`;
  advisorsDir: string;
}> {
  const projectRoot = await temporaryDirectory('openplanr-operate-scale-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-scale-local-');
  const store = new OperatingEventStore(projectRoot, { localRoot });
  // Fresh relative to the wall clock: prepare re-evaluates readiness with the real
  // `new Date()`, so the evidence must sit inside the roles' freshness windows.
  const collectedAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const observedFrom = new Date(Date.now() - 20 * 24 * 60 * 60_000).toISOString();
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    payload: Record<string, unknown>,
    evidenceRefs?: string[],
  ): Promise<void> => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      correlationId: 'operate-scale',
      expectedHead: head,
      timestamp: collectedAt,
      evidenceRefs,
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
      enabledRoles: ['technology-risk', 'chair'],
      enabledProviders: ['repository'],
      createdAt: collectedAt,
      updatedAt: collectedAt,
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'fixture',
      },
    },
  });
  await append('cycle.collecting', {});
  const evidenceDigest = digest('e');
  const items: OperatingEvidence['items'] = [
    {
      id: 'EVD-repository',
      source: 'repository',
      location: 'src/index.ts',
      digest: digest('b'),
      collectedAt,
      observedFrom: null,
      observedTo: null,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['code', 'architecture'],
      summary: benignSummary(ITEM_SUMMARY_BYTES),
    },
    {
      id: 'EVD-git',
      source: 'git',
      location: 'history/30d',
      digest: digest('c'),
      collectedAt,
      observedFrom,
      observedTo: collectedAt,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['change-history'],
      summary: 'Recent changes added deterministic operating contracts.',
    },
  ];
  for (let index = 0; index < ITEM_COUNT; index += 1) {
    items.push(repositoryItem(index, collectedAt));
  }
  const evidence: OperatingEvidence = {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: evidenceDigest,
    collectedAt,
    truncated: false,
    items,
    sources: [
      {
        id: 'repository',
        fingerprint: digest('d'),
        status: 'collected',
        itemCount: ITEM_COUNT + 1,
        byteCount: (ITEM_COUNT + 1) * ITEM_SUMMARY_BYTES,
      },
      {
        id: 'git',
        fingerprint: digest('f'),
        status: 'collected',
        itemCount: 1,
        byteCount: 64,
      },
    ],
    warnings: [],
  };
  const record = await store.putRecord('evidence-metadata', evidence, {
    correlationId: 'operate-scale',
    createdAt: collectedAt,
  });
  await append(
    'evidence.collected',
    {
      recordDigest: record.digest,
      sources: evidence.sources.map((source) => ({
        id: source.id,
        freshness: 'fresh',
        status: source.status,
        itemCount: source.itemCount,
      })),
    },
    ['EVD-git', 'EVD-repository'],
  );
  await append('cycle.advising', {});
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  await mkdir(paths.root, { recursive: true });
  await writeFile(
    paths.charter,
    [
      '# Operating charter',
      '',
      '## Product context',
      '- Purpose: Prove pack input budgets fail closed',
      '- Stage: growth',
      '',
      '## Current goals',
      '- Preserve bounded advisor input',
      '',
    ].join('\n'),
  );
  return { projectRoot, localRoot, evidenceDigest, advisorsDir: paths.advisors };
}

describe('field-scale pack input budget', () => {
  it('makes createOperatingAdvisorPack throw before returning a field-scale pack', async () => {
    const snapshot = overBudgetSnapshot();
    const rawSummaryBytes = snapshot.items.reduce(
      (total, item) => total + Buffer.byteLength(item.summary ?? '', 'utf8'),
      0,
    );
    // The reconstructed evidence really is at the field incident's scale.
    expect(rawSummaryBytes).toBeGreaterThanOrEqual(FIELD_INCIDENT_BYTES);

    await expect(
      createOperatingAdvisorPack({
        cycleId: 'CYCLE-001',
        role: readyTechnologyRisk(snapshot),
        evidence: snapshot,
        context: advisorContext(),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_EVIDENCE_BUDGET',
      details: { roleId: 'technology-risk', maxInputBytes: TECHNOLOGY_RISK_BUDGET },
    });
  });

  it('fails closed at the dispatchOperatingAdvisors call site with no provider invocation', async () => {
    const snapshot = overBudgetSnapshot();
    const invoke = vi.fn(async () => ({
      outcome: 'quiet' as const,
      proposals: [],
      gaps: [],
      conflicts: [],
    }));
    const adapter: AdvisorAdapter = {
      id: 'bounded-fixture',
      mode: 'structured',
      toolIsolation: 'not-applicable',
      capability: 'analysis-high',
      invoke,
    };

    const result = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      evidence: snapshot,
      readiness: readinessDoc(readyTechnologyRisk(snapshot)),
      context: advisorContext(),
      adapter,
      depth: 'standard',
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.failed.map((entry) => entry.roleId)).toEqual(['technology-risk']);
    expect(result.failed[0]?.message.toLowerCase()).toContain('budget');
  });

  it('fails closed at the operateAdapterLifecycle prepare call site and persists no session', async () => {
    const { projectRoot, localRoot, evidenceDigest, advisorsDir } = await preparedOverBudgetCycle();

    await expect(
      operateAdapterLifecycle({
        projectRoot,
        localRoot,
        action: 'prepare',
        cycleId: 'CYCLE-001',
        evidenceDigest,
        idempotencyKey: 'scale-prepare',
        role: 'technology-risk',
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_EVIDENCE_BUDGET' });

    // Fail closed: no native adapter session is written to disk.
    await expect(readFile(join(advisorsDir, 'CYCLE-001.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
