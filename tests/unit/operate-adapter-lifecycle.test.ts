import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  createOperatingAdapterStartHandoff,
  operateAdapterLifecycle,
} from '../../src/services/operate/maintenance.js';
import type { OperatingRoleResult } from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

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

async function advisingCycle(): Promise<{
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
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'fixture',
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
      rolePacks: Record<
        string,
        { inputDigest: `sha256:${string}`; evidence: { items: unknown[] } }
      >;
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
      expect(session.roleInputDigests[role]).toBe(session.rolePacks[role].inputDigest);
      expect(session.rolePacks[role].evidence.items.length).toBeGreaterThan(0);
    }
    expect(session.handoff.kind).toBe('operating-adapter-handoff');
    expect(session.handoff.state).toBe('record-required');
    const recordActions = session.handoff.next.filter(({ action }) => action === 'adapter.record');
    expect(recordActions.map(({ role }) => role)).toEqual(['strategy-finance']);
    for (const record of recordActions) {
      expect(record.argv).toEqual([
        'planr',
        'operate',
        'adapter',
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
        schemaPointer: `/data/rolePacks/${record.role}/roleBrief/output/jsonSchema`,
        schemaSource: 'adapter.prepare-result',
        maxBytes: 32768,
        kind: 'stdin-json',
        mediaType: 'application/json',
        encoding: 'utf-8',
        schema: 'https://openplanr.dev/schemas/v1.2.0/operating-advisor-response.schema.json',
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

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease: session.lease,
        idempotencyKey: 'prepare-role-briefs',
        role: 'technology-risk',
        stdin: JSON.stringify({
          outcome: 'quiet',
          proposals: [],
          gaps: [],
          conflicts: [],
        }),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_ADVISOR_ISOLATION',
      details: {
        expectedRole: 'strategy-finance',
        recoveryCommand: expect.stringContaining('operate adapter resume'),
      },
    });

    for (const [index, role] of session.roles.entries()) {
      if (index === 0) {
        const recorded = await operateAdapterLifecycle({
          ...fixture,
          action: 'record',
          cycleId: 'CYCLE-001',
          lease: session.lease,
          idempotencyKey: 'prepare-role-briefs',
          role,
          stdin: JSON.stringify({
            outcome: 'quiet',
            proposals: [],
            gaps: [],
            conflicts: [],
          }),
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
            next: [{ action: 'adapter.record', role: 'technology-risk' }],
          },
        });
        expect(recorded).not.toHaveProperty('session.rolePacks');
        expect(recorded).not.toHaveProperty('session.roleBriefs');
        continue;
      }
      const result = {
        outcome: 'quiet' as const,
        proposals: [],
        gaps: [],
        conflicts: [],
      };
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
    expect(finalized).not.toHaveProperty('session.rolePacks');
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
              'fixture',
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
      rolePacks: Record<
        string,
        {
          roleBrief: { role: { displayLabel: string } };
          evidence: { items: Array<{ source: string }> };
        }
      >;
    };
    expect(chair.roles).toEqual(['chair']);
    expect(chair.rolePacks.chair.roleBrief.role.displayLabel).toBe('Chair');
    expect(
      chair.rolePacks.chair.evidence.items.some((item) => item.source === 'advisor-results'),
    ).toBe(true);
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
      rolePacks: Record<string, { evidence: { items: Array<{ id: string }> } }>;
      lease: string;
    };

    const role = session.roles[0] as OperatingRoleResult['roleId'];
    const evidenceRef = session.rolePacks[role].evidence.items[0].id;
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
          evidenceRefs: [evidenceRef],
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
      runtime: 'fixture',
      phase: 'advisors',
      roles: ['strategy-finance', 'technology-risk'],
    });
    expect(handoff).toMatchObject({
      phase: 'advisors',
      state: 'prepare-required',
      binding: {
        cycleId: 'CYCLE-001',
        evidenceDigest: fixture.evidenceDigest,
        runtime: 'fixture',
        lease: null,
        expiresAt: null,
      },
      next: [{ action: 'adapter.prepare', effect: 'machine-local-write' }],
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
      runtime: 'fixture',
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
      runtime: 'fixture',
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
      runtime: 'fixture',
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
      stdin: JSON.stringify({
        outcome: 'quiet',
        proposals: [],
        gaps: [],
        conflicts: [],
      }),
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
      runtime: 'fixture',
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
});
