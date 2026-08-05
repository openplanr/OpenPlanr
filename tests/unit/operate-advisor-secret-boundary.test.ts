import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/services/operate/canonical.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import { hardBlockedSecretDetections } from '../../src/services/operate/redaction.js';
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

// A genuine high-entropy credential (hard-blocked: `known-token`).
const REAL_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
// A genuine signed bearer credential (hard-blocked: `jwt`).
const REAL_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik9wZXJhdGluZyJ9',
  'S2VlcFRoaXNPdXRPZlRoZUJvYXJkTWFya2Rvd25QbGVhc2U',
].join('.');
// Public CI configuration an advisor legitimately quotes. It is secret-SHAPED
// (`structured-secret`) but discloses nothing: a permission grant, not a value.
const PUBLIC_WORKFLOW_PERMISSIONS = [
  'The release job declares:',
  '',
  '```yaml',
  'permissions:',
  '  contents: read',
  '  id-token: write',
  '```',
  '',
  'so it can mint a short-lived attestation identity without a stored credential.',
].join('\n');

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
 * A cycle in `advising` state on a native (Protocol v1.4) runtime, backed by a real
 * git repository so the workspace manifest pins a revision. Mirrors the fixture the
 * mission-dispatch suite builds; each operate suite owns its own copy.
 */
async function advisingMissionCycle(options: {
  runtime: string;
  enabledRoles: OperatingRoleId[];
}): Promise<MissionCycleFixture> {
  const projectRoot = await temporaryDirectory('openplanr-operate-secret-boundary-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-secret-boundary-local-');

  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://example.invalid/openplanr/secret-boundary-fixture.git'],
    { cwd: projectRoot },
  );
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await writeFile(
    join(projectRoot, 'src', 'service.ts'),
    "export const service = 'fixture';\nexport const ok = true;\n",
  );
  await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const pin = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
  ).stdout.trim();

  const paths = resolveOperatingPaths(projectRoot, { localRoot });
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
    `${JSON.stringify({ runtime: 'auto', sensitivityCeiling: 'internal' })}\n`,
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
      correlationId: 'secret-boundary-test',
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
    correlationId: 'secret-boundary-test',
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

type PrepareResult = { roles: string[]; lease: string };

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

async function preparedRole(
  fixture: MissionCycleFixture,
  idempotencyKey: string,
): Promise<{ role: OperatingRoleId; lease: string }> {
  const prepared = (await operateAdapterLifecycle({
    ...fixture,
    action: 'prepare',
    cycleId: 'CYCLE-001',
    evidenceDigest: fixture.evidenceDigest,
    idempotencyKey,
  })) as PrepareResult;
  return { role: prepared.roles[0] as OperatingRoleId, lease: prepared.lease };
}

function responseJsonPath(fixture: MissionCycleFixture, role: OperatingRoleId): string {
  return join(
    resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).advisors,
    `CYCLE-001.${role}.response.json`,
  );
}

describe('the hard-block set the record path fails closed on', () => {
  it('covers every definite credential category and no secret-shaped one', () => {
    const categoryOf = (value: string): string[] =>
      hardBlockedSecretDetections(value).map((detection) => detection.category);

    expect(categoryOf(`The deploy script embeds ${REAL_TOKEN}.`)).toEqual(['known-token']);
    expect(categoryOf(`The runbook pastes ${REAL_JWT} into the ticket.`)).toEqual(['jwt']);
    expect(
      categoryOf('curl -H "authorization: Bearer 0PENPL4NRsession" https://api.invalid'),
    ).toEqual(['authorization']);
    expect(
      categoryOf('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----'),
    ).toEqual(['private-key']);
    expect(
      categoryOf('The job clones https://ci-bot:s3cr3tP4ss@git.invalid/openplanr.git'),
    ).toEqual(['credential-url']);

    // Secret-SHAPED, not secret: redactable, never a reason to discard the work.
    expect(categoryOf(PUBLIC_WORKFLOW_PERMISSIONS)).toEqual([]);
    expect(categoryOf('The seed script still ships password: hunter2 inline.')).toEqual([]);
  });
});

describe('the native advisor record path blocks on hard secrets only', () => {
  it('records an analysis that quotes a public permission key/value instead of discarding it', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['operations-customer', 'chair'],
    });
    const { role, lease } = await preparedRole(fixture, 'soft-secret-shape');

    const recorded = (await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease,
      idempotencyKey: 'soft-secret-shape',
      role,
      stdin: JSON.stringify({
        outcome: 'quiet',
        analysisMarkdown: `# COO analysis\n\n${PUBLIC_WORKFLOW_PERMISSIONS}`,
        claims: [],
        actions: [],
        gaps: [],
        conflicts: [],
      }),
    })) as { recorded: string; result: OperatingRoleResult };

    // The whole analysis is committed — a secret-SHAPED key/value is not a reason
    // to throw a lens' work away.
    expect(recorded.recorded).toBe(role);
    expect(recorded.result.roleId).toBe(role);
    const report = JSON.parse(await readFile(responseJsonPath(fixture, role), 'utf8')) as {
      analysisMarkdown: string;
    };
    expect(report.analysisMarkdown).toContain('# COO analysis');
    expect(report.analysisMarkdown).toContain('contents: read');
    expect(report.analysisMarkdown).toContain('short-lived attestation identity');
  });

  it('redacts a soft secret-shaped value in the persisted report rather than passing it through', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['operations-customer', 'chair'],
    });
    const { role, lease } = await preparedRole(fixture, 'soft-secret-redacted');

    await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease,
      idempotencyKey: 'soft-secret-redacted',
      role,
      stdin: JSON.stringify({
        outcome: 'quiet',
        analysisMarkdown: '# COO analysis\n\nThe seed script still ships password: hunter2 inline.',
        claims: [],
        actions: [],
        gaps: [],
        conflicts: [],
      }),
    });

    const persisted = await readFile(responseJsonPath(fixture, role), 'utf8');
    expect(persisted).not.toContain('hunter2');
    expect(persisted).toContain('[REDACTED]');
  });

  it('still refuses a genuine high-entropy token and persists nothing', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['operations-customer', 'chair'],
    });
    const { role, lease } = await preparedRole(fixture, 'hard-secret');

    await expect(
      operateAdapterLifecycle({
        ...fixture,
        action: 'record',
        cycleId: 'CYCLE-001',
        lease,
        idempotencyKey: 'hard-secret',
        role,
        stdin: JSON.stringify({
          outcome: 'quiet',
          analysisMarkdown: `# COO analysis\n\nThe deploy script embeds ${REAL_TOKEN} in plain text.`,
          claims: [],
          actions: [],
          gaps: [],
          conflicts: [],
        }),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_SECRET_DETECTED',
      details: expect.objectContaining({
        fields: [expect.objectContaining({ field: 'analysisMarkdown', category: 'known-token' })],
      }),
    });

    await expect(readFile(responseJsonPath(fixture, role), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();
    expect(replay.events.filter((event) => event.type === 'advisory.recorded')).toEqual([]);
  });

  it('reports every offending field, with its category, in one rejection', async () => {
    const fixture = await advisingMissionCycle({
      runtime: 'claude',
      enabledRoles: ['operations-customer', 'chair'],
    });
    const { role, lease } = await preparedRole(fixture, 'hard-secret-batch');

    const rejection = await operateAdapterLifecycle({
      ...fixture,
      action: 'record',
      cycleId: 'CYCLE-001',
      lease,
      idempotencyKey: 'hard-secret-batch',
      role,
      stdin: JSON.stringify({
        outcome: 'actions',
        analysisMarkdown: `# COO analysis\n\nThe support runbook pastes ${REAL_JWT} into the ticket.`,
        claims: [],
        actions: [
          {
            actionKey: 'rotate-support-credentials',
            title: `Rotate the credential behind ${REAL_TOKEN}`,
            summary: 'The escalation script sends authorization: Bearer 0PENPL4NRsupportSession.',
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
    }).catch((error: unknown) => error);

    expect(rejection).toMatchObject({ code: 'E_OPERATE_SECRET_DETECTED' });
    const details = (
      rejection as { details: { fields: Array<{ field: string; category: string }> } }
    ).details;
    // ONE rejection carries the COMPLETE list: an author never has to resubmit
    // once per offending field to discover the next one.
    expect(details.fields.map((entry) => `${entry.field}:${entry.category}`).sort()).toEqual([
      'actions.0.summary:authorization',
      'actions.0.title:known-token',
      'analysisMarkdown:jwt',
    ]);
    expect((rejection as { message: string }).message).toContain('analysisMarkdown (jwt)');
    expect((rejection as { message: string }).message).toContain('actions.0.title (known-token)');
    expect((rejection as { message: string }).message).toContain(
      'actions.0.summary (authorization)',
    );
    // The message discloses locations and categories only — never the value.
    expect((rejection as { message: string }).message).not.toContain(REAL_TOKEN);
    expect((rejection as { message: string }).message).not.toContain(REAL_JWT);
  });
});
