import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS } from '../../src/services/operate/advisors.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  createOperatingAdapterStartHandoff,
  operateAdapterLifecycle,
} from '../../src/services/operate/maintenance.js';
import type { OperatingRoleResult } from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

// SPEC-005 T-002 exercises the Protocol v1.4 fan-out contract T-001 published
// (one record action per pending role, plus the `harness.heartbeat` recovery
// action), which lives in the local pipeline checkout. Bind the loader to it for
// this suite exactly as the mission-dispatch suite does.
beforeAll(() => {
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterAll(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
});

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function quietAdvisorResponse(title = 'Advisor analysis'): Record<string, unknown> {
  return {
    outcome: 'quiet',
    analysisMarkdown: `# ${title}\n\nNo citation-qualified action was identified.`,
    claims: [],
    actions: [],
    gaps: [],
    conflicts: [],
  };
}

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

async function advisingCycle(
  enabledRoles: string[] = ['strategy-finance', 'technology-risk', 'chair'],
): Promise<{
  projectRoot: string;
  localRoot: string;
  evidenceDigest: `sha256:${string}`;
}> {
  const projectRoot = await temporaryDirectory('openplanr-operate-adapter-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-adapter-local-');
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
      correlationId: 'adapter-role-brief-test',
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
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'codex',
      },
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
    correlationId: 'adapter-role-brief-test',
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

describe('native operating advisor lifecycle', () => {
  it('returns distinct digest-bound CEO and CTO briefs from prepare', async () => {
    const fixture = await advisingCycle();
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'prepare-role-briefs',
    })) as {
      roles: string[];
      roleBriefs: Record<
        string,
        {
          role: { displayLabel: string; mandate: string };
          authority: {
            readOnly: boolean;
            writeBoundary: string;
            forbiddenRecommendationCategories: string[];
          };
          output: {
            schema: string;
            jsonSchema: {
              required: string[];
              properties: { outcome: { enum: string[] } };
              examples: Array<Record<string, unknown>>;
            };
            allowedProposalTypes: string[];
          };
          briefDigest: `sha256:${string}`;
        }
      >;
      roleInputDigests: Record<string, `sha256:${string}`>;
      roleMandates: Record<string, { mandateDigest: `sha256:${string}` }>;
      lease: string;
      idempotencyKey: string;
      handoff: {
        kind: string;
        state: string;
        next: Array<{
          action: string;
          role: string;
          argv: string[];
          stdin?: {
            schemaPointer: string;
            schemaSource: string;
            maxBytes: number;
          };
        }>;
      };
    };

    expect(session.roles).toEqual(['strategy-finance', 'technology-risk']);
    expect(session.roleBriefs['strategy-finance'].role.displayLabel).toBe('CEO');
    expect(session.roleBriefs['technology-risk'].role.displayLabel).toBe('CTO');
    expect(session.roleBriefs['strategy-finance']).not.toEqual(
      session.roleBriefs['technology-risk'],
    );
    for (const role of session.roles) {
      const brief = session.roleBriefs[role];
      expect(brief.authority).toMatchObject({
        readOnly: true,
        writeBoundary: 'none',
      });
      expect(brief.authority.forbiddenRecommendationCategories.length).toBeGreaterThan(0);
      expect(brief.output.schema).toBe('operating-advisor-response@1.2.0');
      expect(brief.output.jsonSchema.required).toEqual([
        'outcome',
        'proposals',
        'gaps',
        'conflicts',
      ]);
      expect(brief.output.jsonSchema.properties.outcome.enum).toEqual(['proposals', 'quiet']);
      expect(brief.output.jsonSchema.examples[0]).toEqual({
        outcome: 'quiet',
        proposals: [],
        gaps: [],
        conflicts: [],
      });
      expect(session.roleInputDigests[role]).toBe(session.roleMandates[role].mandateDigest);
    }
    expect(session.handoff.kind).toBe('operating-adapter-handoff');
    expect(session.handoff.state).toBe('record-required');
    // T-001 widened `record-required.next` to one record action per PENDING role,
    // so both bound advisors are authorized to record immediately — the batch
    // barrier is gone at the contract level.
    const recordActions = session.handoff.next.filter(({ action }) => action === 'harness.record');
    expect(recordActions.map(({ role }) => role)).toEqual(['strategy-finance', 'technology-risk']);
    for (const record of recordActions) {
      expect(record.argv).toEqual([
        'planr',
        'operate',
        'harness',
        'record',
        '--role',
        record.role,
        '--cycle-id',
        'CYCLE-001',
        '--evidence-digest',
        fixture.evidenceDigest,
        '--lease',
        session.lease,
        '--idempotency-key',
        session.idempotencyKey,
        '--stdin',
        '--json',
      ]);
      expect(record.stdin).toEqual({
        schemaPointer: `/data/mandates/${record.role}/responseSchema`,
        schemaSource: 'harness.prepare-result',
        maxBytes: 262144,
        kind: 'stdin-json',
        mediaType: 'application/json',
        encoding: 'utf-8',
        schema: 'https://openplanr.dev/schemas/v1.4.0/operating-advisor-response.schema.json',
      });
    }

    const persisted = JSON.parse(
      await readFile(
        join(
          resolveOperatingPaths(fixture.projectRoot, {
            localRoot: fixture.localRoot,
          }).advisors,
          'CYCLE-001.json',
        ),
        'utf8',
      ),
    ) as typeof session;
    expect(persisted.roleBriefs).toEqual(session.roleBriefs);

    for (const [index, role] of session.roles.entries()) {
      if (index === 0) {
        const recorded = await operateAdapterLifecycle({
          ...fixture,
          action: 'record',
          cycleId: 'CYCLE-001',
          lease: session.lease,
          idempotencyKey: 'prepare-role-briefs',
          role,
          stdin: JSON.stringify(quietAdvisorResponse()),
        });
        expect(recorded).toMatchObject({
          recorded: role,
          result: {
            kind: 'operating-role-result',
            roleId: role,
            inputDigest: session.roleInputDigests[role],
            outcome: 'quiet',
          },
          session: {
            cycleId: 'CYCLE-001',
            recordedRoles: [role],
            state: 'recording',
          },
          handoff: {
            state: 'record-required',
            next: [{ action: 'harness.record', role: 'technology-risk' }],
          },
        });
        expect(recorded).not.toHaveProperty('session.roleBriefs');
        continue;
      }
      const result = quietAdvisorResponse();
      await operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: session.lease,
        idempotencyKey: 'prepare-role-briefs',
        role,
        stdin: JSON.stringify(result),
      });
    }
    const finalized = await operateAdapterLifecycle({
      ...fixture,
      action: 'finalize',
      cycleId: 'CYCLE-001',
      lease: session.lease,
      idempotencyKey: 'prepare-role-briefs',
    });
    expect(finalized).toMatchObject({
      session: {
        cycleId: 'CYCLE-001',
        state: 'finalized',
        recordedRoles: ['strategy-finance', 'technology-risk'],
      },
      results: [{ roleId: 'strategy-finance' }, { roleId: 'technology-risk' }],
    });
    expect(finalized).not.toHaveProperty('session.roleBriefs');
    expect(finalized).toMatchObject({
      handoff: {
        state: 'continue-required',
        next: [
          {
            action: 'run.continue',
            argv: [
              'planr',
              'operate',
              'run',
              '--cycle-id',
              'CYCLE-001',
              '--runtime',
              'codex',
              '--json',
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(finalized).length).toBeLessThan(8_000);
    for (const action of ['record', 'resume', 'cancel'] as const) {
      await expect(
        operateAdapterLifecycle({
          ...fixture,
          action,
          cycleId: 'CYCLE-001',
          lease: session.lease,
          idempotencyKey: 'prepare-role-briefs',
          ...(action === 'record'
            ? {
                role: session.roles[0],
                stdin: JSON.stringify({
                  outcome: 'quiet',
                  proposals: [],
                  gaps: [],
                  conflicts: [],
                }),
              }
            : {}),
        }),
      ).rejects.toMatchObject({ code: 'E_OPERATE_STATE_INVALID' });
    }
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();
    expect(
      replay.events
        .filter((event) => event.type === 'advisory.recorded')
        .map((event) => event.entityId)
        .sort(),
    ).toEqual(['CYCLE-001-strategy-finance', 'CYCLE-001-technology-risk']);

    const chair = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'prepare-chair',
      role: 'chair',
    })) as {
      roles: string[];
      roleBriefs: Record<string, { role: { displayLabel: string } }>;
      roleMandates: Record<string, { roleId: string; mandateDigest: `sha256:${string}` }>;
    };
    expect(chair.roles).toEqual(['chair']);
    expect(chair.roleBriefs.chair.role.displayLabel).toBe('Chair');
    expect(chair.roleMandates.chair).toMatchObject({ roleId: 'chair' });
    expect(chair.roleMandates.chair.mandateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects a partial canonical wrapper with compact-schema recovery and persists nothing', async () => {
    const fixture = await advisingCycle();
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'reject-partial-wrapper',
    })) as {
      roles: string[];
      lease: string;
    };
    const role = session.roles[0] as OperatingRoleResult['roleId'];

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: session.lease,
        idempotencyKey: 'reject-partial-wrapper',
        role,
        stdin: JSON.stringify({
          kind: 'operating-role-result',
          outcome: 'quiet',
          proposals: [],
          gaps: [],
          conflicts: [],
        }),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_ADVISOR_FAILED',
      details: expect.objectContaining({
        expectedSchema: 'operating-advisor-response@1.2.0',
        recoveryCommand: expect.stringContaining('planr operate run --cycle-id CYCLE-001'),
      }),
    });

    await expect(
      readFile(
        join(
          resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).advisors,
          `CYCLE-001.${role}.json`,
        ),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a native result carrying a secret and persists nothing', async () => {
    const fixture = await advisingCycle();
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'secret-scan',
    })) as {
      roles: string[];
      roleInputDigests: Record<string, `sha256:${string}`>;
      lease: string;
    };

    const role = session.roles[0] as OperatingRoleResult['roleId'];
    const result = {
      outcome: 'proposals' as const,
      proposals: [
        {
          proposalKey: 'leaky',
          type: 'finding' as const,
          title: 'Rotate the exposed key',
          // A native runtime echoing a credential it saw. The structured path
          // would have redacted this; this path must refuse it outright.
          problem:
            'The deploy script embeds ghp_abcdefghijklmnopqrstuvwxyz0123456789 in plain text.',
          proposal: 'Move the credential into the secret manager.',
          impact: 4,
          confidence: 3,
          ease: 3,
          severity: 'high' as const,
          citations: [
            {
              repositoryPath: 'src/index.ts',
              lineRange: { start: 1, end: 1 },
              pinnedRevision: 'a'.repeat(40),
            },
          ],
        },
      ],
      gaps: [],
      conflicts: [],
    };

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: session.lease,
        idempotencyKey: 'secret-scan',
        role,
        stdin: JSON.stringify(result),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_OPERATE_SECRET_DETECTED' }));

    // Nothing may be persisted: no advisory.recorded event reaches the stream.
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();
    expect(replay.events.filter((event) => event.type === 'advisory.recorded')).toEqual([]);
  });

  it('applies the native secret boundary to gap and conflict text', async () => {
    const fixture = await advisingCycle();
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'secret-scan-gap',
    })) as { roles: string[]; roleInputDigests: Record<string, `sha256:${string}`>; lease: string };

    const role = session.roles[0] as OperatingRoleResult['roleId'];
    const result = {
      outcome: 'quiet' as const,
      proposals: [],
      gaps: ['Missing source token ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
      conflicts: [],
    };

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: session.lease,
        idempotencyKey: 'secret-scan-gap',
        role,
        stdin: JSON.stringify(result),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_OPERATE_SECRET_DETECTED' }));
  });

  it('exposes an exact pre-prepare handoff and rejects binding drift', async () => {
    const fixture = await advisingCycle();
    const handoff = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    expect(handoff).toMatchObject({
      phase: 'advisors',
      state: 'prepare-required',
      binding: {
        cycleId: 'CYCLE-001',
        evidenceDigest: fixture.evidenceDigest,
        runtime: 'codex',
        lease: null,
        expiresAt: null,
      },
      next: [{ action: 'harness.prepare', effect: 'machine-local-write' }],
      recovery: [],
    });
    expect(handoff.next[0].argv.at(-1)).toBe('--json');

    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: handoff.binding.idempotencyKey,
      role: 'strategy-finance,technology-risk',
    })) as { lease: string };

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        evidenceDigest: digest('f'),
        action: 'record',
        cycleId: 'CYCLE-001',
        idempotencyKey: handoff.binding.idempotencyKey,
        lease: session.lease,
        role: 'strategy-finance',
        stdin: JSON.stringify({
          outcome: 'quiet',
          proposals: [],
          gaps: [],
          conflicts: [],
        }),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ADVISOR_ISOLATION' });

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'prepare',
        cycleId: 'CYCLE-001',
        idempotencyKey: handoff.binding.idempotencyKey,
        role: 'technology-risk',
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ADVISOR_ISOLATION' });
  });

  it('makes cancellation terminal for its lease and issues a fresh exact retry', async () => {
    const fixture = await advisingCycle();
    const initial = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: initial.binding.idempotencyKey,
    })) as { lease: string };
    const cancelled = await operateAdapterLifecycle({
      ...fixture,
      action: 'cancel',
      cycleId: 'CYCLE-001',
      idempotencyKey: initial.binding.idempotencyKey,
      lease: session.lease,
    });
    expect(cancelled).toMatchObject({
      handoff: { state: 'cancelled', next: [], recovery: [] },
    });
    for (const action of ['record', 'resume', 'finalize'] as const) {
      await expect(
        operateAdapterLifecycle({
          ...fixture,
          action,
          cycleId: 'CYCLE-001',
          idempotencyKey: initial.binding.idempotencyKey,
          lease: session.lease,
          ...(action === 'record'
            ? {
                role: 'strategy-finance',
                stdin: JSON.stringify({
                  outcome: 'quiet',
                  proposals: [],
                  gaps: [],
                  conflicts: [],
                }),
              }
            : {}),
        }),
      ).rejects.toMatchObject({ code: 'E_OPERATE_STATE_INVALID' });
    }

    const retry = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    expect(retry.state).toBe('prepare-required');
    expect(retry.binding.idempotencyKey).not.toBe(initial.binding.idempotencyKey);
    const restarted = await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: retry.binding.idempotencyKey,
    });
    expect(restarted).toMatchObject({
      state: 'prepared',
      handoff: { state: 'record-required' },
    });
  });

  it('recovers valid recorded work after expiry with a fresh lease', async () => {
    const fixture = await advisingCycle();
    const initial = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    const session = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: initial.binding.idempotencyKey,
    })) as { roles: string[]; lease: string };
    await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      idempotencyKey: initial.binding.idempotencyKey,
      lease: session.lease,
      role: session.roles[0],
      stdin: JSON.stringify(quietAdvisorResponse()),
    });
    const sessionPath = join(
      resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).advisors,
      'CYCLE-001.json',
    );
    const persisted = JSON.parse(await readFile(sessionPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      sessionPath,
      `${JSON.stringify({ ...persisted, expiresAt: '2000-01-01T00:00:00.000Z' })}\n`,
      { mode: 0o600 },
    );

    const retry = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    const recovered = await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: retry.binding.idempotencyKey,
    });
    expect(recovered).toMatchObject({
      recordedRoles: [session.roles[0]],
      state: 'recording',
      handoff: {
        state: 'record-required',
        next: [{ role: session.roles[1] }],
      },
    });
    expect((recovered as { lease: string }).lease).not.toBe(session.lease);
  });

  it('surfaces the lease expiry and remaining time in prepare output and handoff (default 15 minutes)', async () => {
    const fixture = await advisingCycle();
    const base = Date.parse('2026-07-28T10:00:00.000Z');
    const fifteenMinutes = 15 * 60 * 1_000;
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'lease-surface',
      now: () => new Date(base),
    })) as {
      expiresAt: string;
      leaseStatus: {
        expiresAt: string;
        remainingMs: number;
        remainingSeconds: number;
        expired: boolean;
      };
      handoff: { binding: { expiresAt: string | null } };
    };

    // With no machine-local preference, the lease keeps its historical 15-minute
    // default, measured from the injected clock rather than wall-clock.
    expect(prepared.expiresAt).toBe(new Date(base + fifteenMinutes).toISOString());
    expect(prepared.leaseStatus).toEqual({
      expiresAt: new Date(base + fifteenMinutes).toISOString(),
      remainingMs: fifteenMinutes,
      remainingSeconds: 900,
      expired: false,
    });
    // The handoff a native runtime consumes surfaces the same expiry it must honor.
    expect(prepared.handoff.binding.expiresAt).toBe(prepared.expiresAt);
  });

  it('refreshes the lease on each successful record and still enforces expiry after the window lapses', async () => {
    const fixture = await advisingCycle();
    let clockMs = Date.parse('2026-07-28T10:00:00.000Z');
    const now = () => new Date(clockMs);
    const fifteenMinutes = 15 * 60 * 1_000;

    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'lease-refresh',
      now,
    })) as { roles: string[]; lease: string; expiresAt: string };
    const preparedExpiry = prepared.expiresAt;
    expect(Date.parse(preparedExpiry)).toBe(clockMs + fifteenMinutes);

    // Advance five minutes and record the first role: the record must push expiry
    // forward to now + 15 minutes, not leave the original prepare-time expiry.
    clockMs += 5 * 60 * 1_000;
    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'lease-refresh',
      role: prepared.roles[0],
      stdin: JSON.stringify(quietAdvisorResponse()),
      now,
    })) as {
      session: { expiresAt: string };
      leaseStatus: { expiresAt: string; remainingMs: number };
      handoff: { binding: { expiresAt: string | null } };
    };
    const refreshedExpiry = new Date(clockMs + fifteenMinutes).toISOString();
    expect(recorded.session.expiresAt).toBe(refreshedExpiry);
    expect(Date.parse(recorded.session.expiresAt)).toBeGreaterThan(Date.parse(preparedExpiry));
    expect(recorded.leaseStatus.expiresAt).toBe(refreshedExpiry);
    expect(recorded.leaseStatus.remainingMs).toBe(fifteenMinutes);
    expect(recorded.handoff.binding.expiresAt).toBe(refreshedExpiry);

    // The refresh is persisted to the session file, not just echoed in the response.
    const sessionPath = join(
      resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).advisors,
      'CYCLE-001.json',
    );
    const persisted = JSON.parse(await readFile(sessionPath, 'utf8')) as { expiresAt: string };
    expect(persisted.expiresAt).toBe(refreshedExpiry);

    // Let the refreshed window lapse and attempt the next record: expiry is still
    // enforced even though an earlier record had pushed it forward.
    clockMs += fifteenMinutes + 1;
    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: prepared.lease,
        idempotencyKey: 'lease-refresh',
        role: prepared.roles[1],
        stdin: JSON.stringify(quietAdvisorResponse()),
        now,
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_ADVISOR_FAILED',
      details: { recoveryCommand: expect.stringContaining('operate run') },
    });
  });

  it('honors a machine-local configured lease duration on prepare', async () => {
    const fixture = await advisingCycle();
    const base = Date.parse('2026-07-28T10:00:00.000Z');
    const thirtyMinutes = 30 * 60 * 1_000;
    const paths = resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot });
    await mkdir(paths.localRoot, { recursive: true });
    await writeFile(
      join(paths.localRoot, 'preferences.json'),
      `${JSON.stringify({
        runtime: 'auto',
        timezone: 'UTC',
        sensitivityCeiling: 'internal',
        evidenceTtlMs: 7 * 24 * 60 * 60 * 1_000,
        enabledSources: ['repository'],
        adapterLeaseDurationMs: thirtyMinutes,
      })}\n`,
      { mode: 0o600 },
    );

    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'lease-configurable',
      now: () => new Date(base),
    })) as { expiresAt: string; leaseStatus: { remainingMs: number } };

    // Prepare honors the configured 30-minute lease instead of the 15-minute default.
    expect(prepared.expiresAt).toBe(new Date(base + thirtyMinutes).toISOString());
    expect(prepared.leaseStatus.remainingMs).toBe(thirtyMinutes);
  });

  it('supersedes a finalized session from a superseded board generation instead of a fatal cancel', async () => {
    const fixture = await advisingCycle();
    const paths = resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot });
    const sessionPath = join(paths.advisors, 'CYCLE-001.json');
    await mkdir(paths.advisors, { recursive: true });
    // A finalized adapter session left at this cycle path by a PRIOR board
    // generation: its boardIdentity does not match the current committed genesis.
    // Before FR4 this dead session forced E_OPERATE_ADVISOR_ISOLATION ("already
    // finalized") with only a whole-cycle re-run as the path forward.
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        implementation: 'openplanr-operate-adapter',
        boardIdentity: `sha256:${'0'.repeat(64)}`,
        cycleId: 'CYCLE-001',
        evidenceDigest: fixture.evidenceDigest,
        phase: 'advisors',
        runtime: 'codex',
        lease: 'prior-generation-lease',
        idempotencyKey: 'prior-generation-key',
        state: 'finalized',
        expiresAt: '2099-01-01T00:00:00.000Z',
        roles: ['strategy-finance', 'technology-risk'],
        recordedRoles: ['strategy-finance', 'technology-risk'],
        roleInputDigests: {},
        roleBriefs: {},
      })}\n`,
      { mode: 0o600 },
    );

    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'current-generation-prepare',
    })) as { state: string; roles: string[] };

    // The stale finalized session is superseded, not fatal: a fresh compatible
    // prepare succeeds and returns a working session for the current board.
    expect(prepared.state).toBe('prepared');
    expect(prepared.roles).toEqual(['strategy-finance', 'technology-risk']);
  });

  it('binds adapter sessions to board identity so a re-inited board never collides with a prior generation', async () => {
    const fixture = await advisingCycle();
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();
    const genesis = replay.events.find((event) => event.previousEventHash === null)?.eventHash;
    expect(genesis).toMatch(/^sha256:[a-f0-9]{64}$/);
    const priorGeneration = `sha256:${'0'.repeat(64)}`;
    expect(genesis).not.toBe(priorGeneration);

    const paths = resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot });
    const sessionPath = join(paths.advisors, 'CYCLE-001.json');
    await mkdir(paths.advisors, { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        implementation: 'openplanr-operate-adapter',
        boardIdentity: priorGeneration,
        cycleId: 'CYCLE-001',
        evidenceDigest: fixture.evidenceDigest,
        phase: 'advisors',
        runtime: 'codex',
        lease: 'prior-generation-lease',
        idempotencyKey: 'prior-generation-key',
        state: 'prepared',
        expiresAt: '2099-01-01T00:00:00.000Z',
        roles: ['strategy-finance', 'technology-risk'],
        recordedRoles: [],
        roleInputDigests: {},
        roleBriefs: {},
      })}\n`,
      { mode: 0o600 },
    );

    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'generation-b-prepare',
    })) as { boardIdentity: string };

    // Generation B binds the session to its own genesis and is never blocked by,
    // nor adopts, the prior generation's identity.
    expect(prepared.boardIdentity).toBe(genesis);
    expect(prepared.boardIdentity).not.toBe(priorGeneration);
    const persisted = JSON.parse(await readFile(sessionPath, 'utf8')) as { boardIdentity: string };
    expect(persisted.boardIdentity).toBe(genesis);
  });
});

// SPEC-005 T-002: immediate per-role commit (FR1), heartbeat lease (FR2), and the
// honesty half of FR5, all over the widened Protocol v1.4 fan-out contract T-001
// published. Every assertion uses an injected clock — never a wall-clock sleep.
describe('durable per-role recording over the fan-out contract (SPEC-005 T-002)', () => {
  const fiveAdvisorRoles = [
    'strategy-finance',
    'technology-risk',
    'product-activation',
    'growth-market',
    'operations-customer',
  ];
  const boardRoles = [...fiveAdvisorRoles, 'chair'];
  const advisorsDir = (fixture: { projectRoot: string; localRoot: string }): string =>
    resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).advisors;

  it('records any pending role regardless of its position in the widened next array', async () => {
    const fixture = await advisingCycle(boardRoles);
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'reverse-order',
    })) as { roles: string[]; lease: string };

    // Prepare returns roles alphabetically; T-001's `next` carries one record
    // action per pending role. Record them in strict REVERSE-alphabetical order,
    // so every record after the first targets a role that is NOT the head of
    // `next` — the old position-keyed authorization would have rejected them.
    const sorted = [...prepared.roles].sort();
    const reversed = [...sorted].reverse();
    expect(reversed).not.toEqual(sorted);
    for (const role of reversed) {
      const recorded = (await operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: prepared.lease,
        idempotencyKey: 'reverse-order',
        role,
        stdin: JSON.stringify(quietAdvisorResponse(`analysis for ${role}`)),
      })) as { recorded: string };
      expect(recorded.recorded).toBe(role);
    }

    const session = JSON.parse(
      await readFile(join(advisorsDir(fixture), 'CYCLE-001.json'), 'utf8'),
    ) as { recordedRoles: string[] };
    expect(session.recordedRoles).toEqual(sorted);
  });

  it('never loses an already-recorded role when pending roles record concurrently', async () => {
    const fixture = await advisingCycle(boardRoles);
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'concurrent',
    })) as { roles: string[]; lease: string };

    // Fire every pending role's record at once. The widened handoff authorizes
    // them all immediately; `harness record` still mutates ONE shared, lease-bound
    // session, so the write must serialize per role. If it did not, two records
    // that both read `recordedRoles: []` would each persist their single role and
    // last-writer-wins would silently drop the others — the nondeterministic loss
    // T-001 handed this task to prevent.
    await Promise.all(
      prepared.roles.map((role) =>
        operateAdapterLifecycle({
          ...fixture,
          action: 'record',
          cycleId: 'CYCLE-001',
          lease: prepared.lease,
          idempotencyKey: 'concurrent',
          role,
          stdin: JSON.stringify(quietAdvisorResponse(`analysis for ${role}`)),
        }),
      ),
    );

    const sorted = [...prepared.roles].sort();
    const session = JSON.parse(
      await readFile(join(advisorsDir(fixture), 'CYCLE-001.json'), 'utf8'),
    ) as { recordedRoles: string[] };
    // No role was dropped from the shared session by the concurrent writes.
    expect(session.recordedRoles).toEqual(sorted);

    // Each role's own result file survived, and finalize sees every one of them
    // (no "missing roles") — the concurrent records lost nothing.
    for (const role of prepared.roles) {
      const result = JSON.parse(
        await readFile(join(advisorsDir(fixture), `CYCLE-001.${role}.json`), 'utf8'),
      ) as OperatingRoleResult;
      expect(result).toMatchObject({ kind: 'operating-role-result', roleId: role });
    }
    const finalized = (await operateAdapterLifecycle({
      ...fixture,
      action: 'finalize',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'concurrent',
    })) as { results: Array<{ roleId: string }> };
    expect(finalized.results.map((entry) => entry.roleId).sort()).toEqual(sorted);
  });

  it('keeps four recorded results durable when a fifth stalls past the original lease window', async () => {
    let clockMs = Date.parse('2026-07-28T10:00:00.000Z');
    const now = () => new Date(clockMs);
    const fixture = await advisingCycle(boardRoles);
    const initial = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: fiveAdvisorRoles,
    });
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: initial.binding.idempotencyKey,
      now,
    })) as { roles: string[]; lease: string; expiresAt: string };

    const recordedFour = [...prepared.roles].sort().slice(0, 4);
    const stalledRole = [...prepared.roles].sort()[4];
    // Four lenses return and record within the lease window, a couple of minutes
    // apart; the fifth never returns.
    for (const role of recordedFour) {
      clockMs += 2 * 60 * 1_000;
      await operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: prepared.lease,
        idempotencyKey: initial.binding.idempotencyKey,
        role,
        stdin: JSON.stringify(quietAdvisorResponse(`analysis for ${role}`)),
        now,
      });
    }

    // The stalled role holds the lease for well over its window; advance the clock
    // far past the last refreshed expiry. Resume now fails closed (expired) — this
    // is exactly the moment the old batch barrier lost the four completed analyses.
    clockMs = Date.parse(prepared.expiresAt) + 60 * 60 * 1_000;
    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'resume',
        cycleId: 'CYCLE-001',
        lease: prepared.lease,
        idempotencyKey: initial.binding.idempotencyKey,
        now,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ADVISOR_FAILED' });

    // The four validated results survived the lease expiry on disk, intact.
    for (const role of recordedFour) {
      const result = JSON.parse(
        await readFile(join(advisorsDir(fixture), `CYCLE-001.${role}.json`), 'utf8'),
      ) as OperatingRoleResult;
      expect(result).toMatchObject({
        kind: 'operating-role-result',
        cycleId: 'CYCLE-001',
        roleId: role,
      });
    }

    // A fresh prepare recovers exactly the four recorded roles without re-running
    // them and hands back the stalled fifth as the only remaining record action.
    const retry = await createOperatingAdapterStartHandoff({
      ...fixture,
      cycleId: 'CYCLE-001',
      runtime: 'codex',
      phase: 'advisors',
      roles: fiveAdvisorRoles,
    });
    const recovered = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      idempotencyKey: retry.binding.idempotencyKey,
      now,
    })) as {
      recordedRoles: string[];
      state: string;
      handoff: { state: string; next: Array<{ role: string }> };
    };
    expect(recovered.state).toBe('recording');
    expect(recovered.recordedRoles).toEqual(recordedFour);
    expect(recovered.handoff.state).toBe('record-required');
    expect(recovered.handoff.next.map((action) => action.role)).toEqual([stalledRole]);
  });

  it('renews the lease via heartbeat with no role result and no status change', async () => {
    let clockMs = Date.parse('2026-07-28T10:00:00.000Z');
    const now = () => new Date(clockMs);
    const fifteenMinutes = 15 * 60 * 1_000;
    const fixture = await advisingCycle();
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'heartbeat',
      now,
    })) as { roles: string[]; lease: string; expiresAt: string };
    const [firstRole, secondRole] = [...prepared.roles].sort();

    // One lens records; the other is still thinking.
    await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'heartbeat',
      role: firstRole,
      stdin: JSON.stringify(quietAdvisorResponse()),
      now,
    });

    // Near the record's refreshed window, heartbeat with no --role and no stdin.
    clockMs += 14 * 60 * 1_000;
    const beat = (await operateAdapterLifecycle({
      ...fixture,
      action: 'heartbeat',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'heartbeat',
      now,
    })) as {
      session: { expiresAt: string; recordedRoles: string[]; state: string };
      leaseStatus: { expiresAt: string; remainingMs: number; expired: boolean };
      handoff: { state: string; next: Array<{ role: string }> };
    };
    // The lease moves forward a full window from now; no role result was required.
    expect(beat.session.expiresAt).toBe(new Date(clockMs + fifteenMinutes).toISOString());
    expect(beat.leaseStatus.remainingMs).toBe(fifteenMinutes);
    expect(beat.leaseStatus.expired).toBe(false);
    // Recorded stays recorded, pending stays pending — heartbeat changed neither.
    expect(beat.session.recordedRoles).toEqual([firstRole]);
    expect(beat.handoff.state).toBe('record-required');
    expect(beat.handoff.next.map((action) => action.role)).toEqual([secondRole]);
    const persisted = JSON.parse(
      await readFile(join(advisorsDir(fixture), 'CYCLE-001.json'), 'utf8'),
    ) as { expiresAt: string };
    expect(persisted.expiresAt).toBe(beat.session.expiresAt);

    // Advance PAST where the session would have lapsed without the heartbeat
    // (the record's window ended one minute ago). The second record still
    // succeeds only because the heartbeat carried the session forward (FR2).
    clockMs += 2 * 60 * 1_000;
    const late = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'heartbeat',
      role: secondRole,
      stdin: JSON.stringify(quietAdvisorResponse()),
      now,
    })) as { recorded: string };
    expect(late.recorded).toBe(secondRole);
  });

  it('treats a replay of identical bytes for the same role as a safe no-op', async () => {
    const fixture = await advisingCycle();
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'replay',
    })) as { roles: string[]; lease: string };
    const role = [...prepared.roles].sort()[0];
    const stdin = JSON.stringify(quietAdvisorResponse('idempotent analysis'));

    const first = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'replay',
      role,
      stdin,
    })) as {
      recorded: string;
      result: { resultDigest: string };
      session: { recordedRoles: string[] };
    };
    expect(first.session.recordedRoles).toEqual([role]);

    // Replaying the exact same bytes for the same (role, idempotency key) is a
    // success, not an error: the resultDigest guard recognises identical content,
    // the recorded set is unchanged, and only one canonical event exists.
    const replay = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease: prepared.lease,
      idempotencyKey: 'replay',
      role,
      stdin,
    })) as {
      recorded: string;
      result: { resultDigest: string };
      session: { recordedRoles: string[] };
    };
    expect(replay.recorded).toBe(role);
    expect(replay.result.resultDigest).toBe(first.result.resultDigest);
    expect(replay.session.recordedRoles).toEqual([role]);

    const events = (
      await new OperatingEventStore(fixture.projectRoot, { localRoot: fixture.localRoot }).replay()
    ).events.filter(
      (event) => event.type === 'advisory.recorded' && event.entityId === `CYCLE-001-${role}`,
    );
    expect(events).toHaveLength(1);
  });
});

// FR12 (SPEC-005 T-003): the native harness prepare path is the one real runs use.
// It must thread the SAME shared, citation-bearing bootstrap map and graceful
// per-role research budget into every advisor mandate that the inline dispatch path
// does — otherwise native-runtime agents receive no research targeting at all.
describe('native prepare threads FR12 research guidance into advisor mandates', () => {
  it('attaches the shared bootstrap map and per-role budget to every advisor mandate', async () => {
    const fixture = await advisingCycle();
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'fr12-native-prepare',
    })) as {
      roles: string[];
      mandates: Record<
        string,
        {
          mandateDigest: `sha256:${string}`;
          researchGuidance?: {
            bootstrapMap: { kind: string; mapDigest: `sha256:${string}` } | null;
            bootstrapMapDigest: `sha256:${string}` | null;
            focusAreas: string[];
            deduplicationHints: string[];
            perRoleResearchBudgetMs: number | null;
            stopResearchingAndSynthesize: string[];
          };
        }
      >;
    };

    expect(prepared.roles).toEqual(['strategy-finance', 'technology-risk']);
    // The one shared map is referenced by BOTH advisor mandates (same digest),
    // proving it is built once per cycle and threaded, not rebuilt per role.
    const digests = prepared.roles.map(
      (role) => prepared.mandates[role].researchGuidance?.bootstrapMapDigest,
    );
    for (const role of prepared.roles) {
      const guidance = prepared.mandates[role].researchGuidance;
      expect(guidance, `role ${role} must carry FR12 research guidance`).toBeDefined();
      expect(guidance?.bootstrapMap?.kind).toBe('operating-bootstrap-map');
      expect(guidance?.bootstrapMapDigest).toMatch(/^sha256:/);
      expect(guidance?.perRoleResearchBudgetMs).toBe(DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS);
      expect(guidance?.stopResearchingAndSynthesize.length).toBeGreaterThan(0);
      expect(guidance?.focusAreas.length).toBeGreaterThan(0);
    }
    expect(new Set(digests).size).toBe(1);
  });

  it('leaves a standalone Chair mandate byte-identical (no research guidance)', async () => {
    const fixture = await advisingCycle();
    const prepared = (await operateAdapterLifecycle({
      ...fixture,
      action: 'prepare',
      cycleId: 'CYCLE-001',
      evidenceDigest: fixture.evidenceDigest,
      idempotencyKey: 'fr12-chair-prepare',
      role: 'chair',
    })) as {
      roles: string[];
      mandates: Record<string, { researchGuidance?: unknown }>;
    };
    expect(prepared.roles).toEqual(['chair']);
    // The Chair is prepared alone, derives an empty advisor set, and its mandate
    // stays byte-identical — no research guidance is attached.
    expect(prepared.mandates.chair.researchGuidance).toBeUndefined();
  });
});
