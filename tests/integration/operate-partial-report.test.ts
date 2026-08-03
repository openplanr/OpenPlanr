import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import { readOperatingReport } from '../../src/services/operate/reports.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

// SPEC-005 T-002 / FR5: an honest mid-run report over the Protocol v1.4 fan-out
// contract T-001 published. Bind the protocol loader to the local pipeline
// checkout exactly as the adapter-lifecycle and mission-dispatch suites do.
beforeAll(() => {
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterAll(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
});

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

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

function advisorResponse(title: string): Record<string, unknown> {
  return {
    outcome: 'quiet',
    analysisMarkdown: `# ${title}\n\nA validated, cited-quiet analysis for ${title}.`,
    claims: [],
    actions: [],
    gaps: [],
    conflicts: [],
  };
}

/**
 * Stand up a cycle in `advising` state with committed evidence, exactly as the
 * native harness expects on entry to `prepare`. Mirrors the adapter-lifecycle
 * unit fixture but with a configurable advisor set.
 */
async function advisingCycle(enabledRoles: string[]): Promise<{
  projectRoot: string;
  localRoot: string;
  evidenceDigest: `sha256:${string}`;
}> {
  const projectRoot = await temporaryDirectory('openplanr-partial-report-project-');
  const localRoot = await temporaryDirectory('openplanr-partial-report-local-');
  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    payload: Record<string, unknown>,
  ) => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      correlationId: 'partial-report-test',
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
      enabledRoles,
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.14.0', runtime: 'codex' },
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
        location: 'src/index.ts',
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
    correlationId: 'partial-report-test',
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
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  await mkdir(paths.root, { recursive: true });
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
  return { projectRoot, localRoot, evidenceDigest };
}

describe('honest mid-cycle report before Chair finalizes (SPEC-005 T-002 / FR5)', () => {
  it('renders recorded lenses with their real analysis and the exact recovery action for pending roles', async () => {
    const fixture = await advisingCycle([
      'strategy-finance',
      'technology-risk',
      'product-activation',
      'chair',
    ]);
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'partial',
    })) as { roles: string[]; lease: string };

    // Two advisors return and record immediately; the third is still running.
    await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'partial',
      role: 'strategy-finance',
      stdin: JSON.stringify(advisorResponse('CEO lens')),
    });
    await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'partial',
      role: 'technology-risk',
      stdin: JSON.stringify(advisorResponse('CTO lens')),
    });

    // Mid-cycle, BEFORE Chair — the exact false-negative moment from production.
    const report = await readOperatingReport({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
      cycleId: 'CYCLE-001',
    });
    const byRole = new Map(report.reports.map((entry) => [entry.roleId, entry]));

    // Every already-recorded lens renders its real analysis — not `not_evaluated`.
    for (const role of ['strategy-finance', 'technology-risk'] as const) {
      expect(byRole.get(role)?.outcome).toBe('quiet');
      expect(byRole.get(role)?.analysisMarkdown).toContain(
        role === 'strategy-finance' ? 'CEO lens' : 'CTO lens',
      );
    }
    expect(report.markdown).toContain('# CEO lens');
    expect(report.markdown).toContain('# CTO lens');

    // The still-running lens is honestly not yet evaluated (no fabricated result),
    // and the report never calls this active cycle quiet.
    expect(byRole.get('product-activation')?.outcome).toBe('not_evaluated');
    expect(byRole.get('product-activation')?.analysisMarkdown).toBeUndefined();
    expect(report.markdown).not.toContain('is quiet.');
    expect(report.markdown).not.toContain('No material action is recommended');

    // The exact next recovery action for the pending lens is surfaced by the live
    // lease-bound handoff: a single `harness record --role product-activation`.
    const resumed = (await operateAdapterLifecycle({
      ...fixture,
      action: 'resume',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'partial',
    })) as {
      handoff: { state: string; next: Array<{ action: string; role: string; argv: string[] }> };
    };
    expect(resumed.handoff.state).toBe('record-required');
    expect(resumed.handoff.next.map((action) => action.role)).toEqual(['product-activation']);
    const recovery = resumed.handoff.next[0];
    expect(recovery.action).toBe('harness.record');
    expect(recovery.argv.join(' ')).toContain(
      'planr operate harness record --role product-activation',
    );
  });
});
