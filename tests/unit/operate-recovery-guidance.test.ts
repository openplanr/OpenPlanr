import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { executeOperateAction, failure } from '../../src/services/operate/index.js';
import {
  createOperatingAdapterStartHandoff,
  operateAdapterLifecycle,
} from '../../src/services/operate/maintenance.js';
import { operatingMissionProtocolAvailable } from '../../src/services/operate/protocol.js';
import {
  OPERATE_AGENT_PROTOCOL_VERSION,
  OPERATE_PROTOCOL_VERSION,
  OperateError,
} from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

/**
 * Two defects observed while driving a real cycle, both about guidance a runtime
 * READS and then ACTS on:
 *
 *  1. Preparing the Chair while the advisor session is still open fails closed
 *     with `E_OPERATE_ADVISOR_ISOLATION` — correct — but the only recovery it
 *     offers is `planr operate run …`, whose prepare continuation re-enters the
 *     same branch and returns the identical error and the identical suggestion.
 *     The command that actually escapes (`planr operate harness finalize|cancel`
 *     against the OPEN session) is never named, so an agent following the CLI's
 *     own guidance cannot get out.
 *
 *  2. `planr operate inspect` — the first command of the journey — advertises the
 *     installed pipeline at protocol `1.2.0`, while mandates are signed and
 *     enforced at the agent protocol version.
 */

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

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

/** A committed cycle parked in `advising`, ready for a runtime-native dispatch. */
async function advisingCycle(): Promise<{
  projectRoot: string;
  localRoot: string;
  evidenceDigest: `sha256:${string}`;
}> {
  const projectRoot = await temporaryDirectory('openplanr-operate-recovery-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-recovery-local-');
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
      correlationId: 'operate-recovery-guidance-test',
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
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
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
    correlationId: 'operate-recovery-guidance-test',
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

describe('blocked adapter prepare names an escape, not the command that just failed', () => {
  it('points a second binding at closing the open session', async () => {
    const fixture = await advisingCycle();
    const handoff = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    const open = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: handoff.binding.idempotencyKey,
      role: 'strategy-finance,technology-risk',
    })) as { lease: string };

    // The Chair is prepared separately, after the independent advisors return —
    // so this is the exact live sequence: a second binding arriving while the
    // advisor session is still `prepared`.
    const rejection: unknown = await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: 'chair-prepare-key',
      role: 'chair',
    }).then(
      () => null,
      (reason: unknown) => reason,
    );
    if (!(rejection instanceof OperateError)) {
      throw new Error(
        `Expected E_OPERATE_ADVISOR_ISOLATION from a second binding, received: ${String(rejection)}`,
      );
    }
    expect(rejection.code).toBe('E_OPERATE_ADVISOR_ISOLATION');

    // `nextActions[0]` is what a runtime executes first. It must be a command
    // that CHANGES the blocking state — terminating the open session through its
    // own lifecycle — not a retry of the dispatch that just failed, which walks
    // straight back into this branch.
    const surfaced = failure('harness.prepare', rejection);
    expect(surfaced.ok).toBe(false);
    expect(surfaced.code).toBe('E_OPERATE_ADVISOR_ISOLATION');
    expect(surfaced.nextActions.length).toBeGreaterThan(0);
    const [primary] = surfaced.nextActions;
    expect(primary).toMatch(/planr operate (?:harness|adapter) (?:finalize|cancel)\b/);
    // The escape must carry the binding it applies to, or it is not runnable.
    expect(primary).toContain('--cycle-id CYCLE-001');

    // The blocked caller is, by definition, a DIFFERENT binding. Handing it the
    // open session's lease would hand it that session's capability, so recovery
    // guidance describes the lease it needs without disclosing this one.
    expect(JSON.stringify(rejection.details ?? {})).not.toContain(open.lease);
    expect(surfaced.nextActions.join('\n')).not.toContain(open.lease);
  });
});

describe('operate inspect advertises the protocol the pipeline actually enforces', () => {
  it('reports the agent protocol version for an installed pipeline', async () => {
    // Precondition: this checkout resolves a pipeline that publishes the agent
    // mandate contract. If it ever does not, fail here rather than silently
    // asserting against a downgraded install.
    expect(operatingMissionProtocolAvailable()).toBe(true);

    const projectRoot = await temporaryDirectory('openplanr-operate-inspect-protocol-');
    const localRoot = await temporaryDirectory('openplanr-operate-inspect-protocol-state-');
    const result = await executeOperateAction({
      action: 'inspect',
      interactive: false,
      options: { json: true, localRoot },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: true,
      // The on-disk ARTIFACT envelope is deliberately frozen at v1.2 (see
      // OPERATE_PROTOCOL_VERSION in types.ts) — restamping it is not the fix.
      protocolVersion: OPERATE_PROTOCOL_VERSION,
      data: {
        pipeline: {
          available: true,
          // …but `pipeline.protocolVersion` describes the CONTRACT the installed
          // pipeline enforces, which is the agent protocol mandates are signed at.
          protocolVersion: OPERATE_AGENT_PROTOCOL_VERSION,
        },
      },
    });
  });
});
