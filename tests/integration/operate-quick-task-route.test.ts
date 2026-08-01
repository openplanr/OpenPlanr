import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import { sha256Digest } from '../../src/services/operate/canonical.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import {
  logEntryToOperatingRecord,
  OperatingEventStore,
  type OperatingRecordsLogEntry,
} from '../../src/services/operate/event-store.js';
import { readJournal } from '../../src/services/operate/journal.js';
import { governOperatingFinding } from '../../src/services/operate/lifecycle.js';
import { assertOperatingArtifact } from '../../src/services/operate/protocol.js';
import {
  applyOperatingRoute,
  createOperatingRoutePlan,
  readOperatingRoute,
  rollbackOperatingRoute,
} from '../../src/services/operate/routes.js';
import type { OperatingFinding } from '../../src/services/operate/types.js';
import {
  refreshOperatingWorkspaceManifest,
  resolveOperatingPaths,
} from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const FIXED_DIGEST = `sha256:${'a'.repeat(64)}` as const;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function initialize(): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await temporaryDirectory('openplanr-operate-quick-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-quick-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
  );
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    },
    charter: {
      purpose: 'Exercise the small, bounded quick-task route.',
      goals: ['Keep bounded delivery routing deterministic.'],
    },
    now: '2026-07-28T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return { projectRoot, localRoot };
}

function devFinding(overrides: Partial<OperatingFinding>): OperatingFinding {
  return {
    kind: 'operating-finding',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    id: 'FND-001',
    cycleId: 'CYCLE-001',
    title: 'Tidy the health log label',
    category: 'finding',
    problem: 'A stale log label reads "helth" and confuses on-call skimming.',
    cost: 'Minor: a recurring second of confusion per on-call skim.',
    proposal: 'Rename the log label to "health"; no behavior change.',
    impact: 1,
    confidence: 3,
    ease: 5,
    score: 15,
    severity: 'low',
    sensitivity: 'internal',
    criticalOverride: false,
    lane: 'DEV',
    owner: 'Product owner',
    evidenceRefs: ['EVD-quick-fixture'],
    status: 'proposed',
    dependsOn: [],
    createdAt: '2026-07-28T13:00:00.000Z',
    updatedAt: '2026-07-28T13:00:00.000Z',
    ...overrides,
  };
}

/**
 * One advisor role emits two DEV `finding` proposals from the same evidence: a
 * small, bounded one (impact 1 → derived severity low, ease 5) that classifies
 * as `create-quick-task` (v1.3), and a heavier one (impact 3 → derived severity
 * medium) that stays `create-spec` (v1.2). Every other role stays quiet, so the
 * cycle yields exactly those two DEV routes side by side.
 */
function quickAndSpecAdapter(): AdvisorAdapter {
  return {
    id: 'quick-task-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      if (input.roleId === 'technology-risk' || input.roleId === 'chair') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'quick-fix',
            type: 'finding',
            title: 'Tidy the health log label',
            problem: 'A stale log label reads "helth" and confuses on-call skimming.',
            proposal: 'Rename the log label to "health"; no behavior change.',
            impact: 1,
            confidence: 3,
            ease: 5,
            severity: 'low',
            citations: [
              {
                repositoryPath: 'service.ts',
                lineRange: { start: 1, end: 1 },
                pinnedRevision: input.pinnedRevision,
              },
            ],
          },
          {
            proposalKey: 'spec-work',
            type: 'finding',
            title: 'Harden service health reporting',
            problem: 'Health behavior is not represented by a reviewed specification.',
            proposal: 'Create a bounded specification with a measurable completion outcome.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            citations: [
              {
                repositoryPath: 'service.ts',
                lineRange: { start: 1, end: 1 },
                pinnedRevision: input.pinnedRevision,
              },
            ],
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

async function readRouteRecord(
  store: OperatingEventStore,
  routeId: string,
): Promise<ReturnType<typeof logEntryToOperatingRecord> | null> {
  const raw = await readFile(store.paths.records, 'utf8').catch(() => '');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const record = logEntryToOperatingRecord(JSON.parse(line) as OperatingRecordsLogEntry);
    if (record.recordType === 'route' && (record.content as { id?: string }).id === routeId) {
      return record;
    }
  }
  return null;
}

async function pathExists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
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

describe('operate create-quick-task route classification (FR6 / E-006)', () => {
  it('routes small, bounded implementation work to a valid v1.3 create-quick-task route', async () => {
    const { projectRoot, localRoot } = await initialize();
    const config = await validateOperatingConfiguration(projectRoot);
    const store = new OperatingEventStore(projectRoot, { localRoot });
    const eventHead = (await store.replay()).eventHead;
    const workspace = await refreshOperatingWorkspaceManifest(projectRoot, { localRoot });

    // A DEV finding that is low-risk (severity low), easy (ease 5), and small in
    // blast radius (impact 1) routes to the quick-task delivery surface. The
    // returned route passes assertOperatingArtifact internally, so it is a valid
    // Protocol v1.3 operating-route-plan.
    const route = await createOperatingRoutePlan({
      projectRoot,
      cycleId: 'CYCLE-001',
      finding: devFinding({}),
      config,
      workspace,
      eventHead,
      evidenceDigest: FIXED_DIGEST,
      providerDigest: FIXED_DIGEST,
      sequence: 1,
      localRoot,
      now: '2026-07-28T13:00:00.000Z',
    });
    expect(route.actions[0]?.kind).toBe('create-quick-task');
    expect(route.actions[0]?.lane).toBe('DEV');
    expect(route.actions[0]?.owner).toBe('Product owner');
    expect(route.protocolVersion).toBe('1.3.0');
    expect(route.actions[0]?.targetPath).toMatch(/^\.planr\/quick\/QUICK-\d{3}-.+\.md$/);
    // No route kind may invoke SHIP (R1): the quick-task target stays inside the
    // reviewed quick-task surface, never a ship marker or pipeline invocation.
    expect(route.actions[0]?.targetPath).not.toMatch(/\.pipeline-shipped|ship/);
  });

  it('keeps heavier DEV findings on create-spec so existing routing is preserved', async () => {
    const { projectRoot, localRoot } = await initialize();
    const config = await validateOperatingConfiguration(projectRoot);
    const store = new OperatingEventStore(projectRoot, { localRoot });
    const eventHead = (await store.replay()).eventHead;
    const workspace = await refreshOperatingWorkspaceManifest(projectRoot, { localRoot });

    // Medium severity / impact 3 is not "small, bounded" work — it must remain a
    // full create-spec route, unchanged by the new classifier branch.
    const route = await createOperatingRoutePlan({
      projectRoot,
      cycleId: 'CYCLE-001',
      finding: devFinding({ impact: 3, ease: 4, severity: 'medium', score: 36 }),
      config,
      workspace,
      eventHead,
      evidenceDigest: FIXED_DIGEST,
      providerDigest: FIXED_DIGEST,
      sequence: 1,
      specId: 'SPEC-001',
      localRoot,
      now: '2026-07-28T13:00:00.000Z',
    });
    expect(route.actions[0]?.kind).toBe('create-spec');
    expect(route.protocolVersion).toBe('1.2.0');
    expect(route.actions[0]?.targetPath).toMatch(/^\.planr\/specs\/SPEC-001-/);
  });
});

describe('operate create-quick-task apply, rollback, and version isolation (FR6 / E-006)', () => {
  it('applies a quick-task route to a real .planr/quick file and rolls it back byte-exact, with no v1.3 bleed into the v1.2 create-spec route', async () => {
    const { projectRoot, localRoot } = await initialize();
    const config = await validateOperatingConfiguration(projectRoot);

    const cycle = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: quickAndSpecAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
    });
    const routes = cycle.routes ?? [];
    const quickRoute = routes.find((route) => route.actions[0]?.kind === 'create-quick-task');
    const specRoute = routes.find((route) => route.actions[0]?.kind === 'create-spec');
    expect(
      quickRoute,
      JSON.stringify({ warnings: cycle.warnings, readiness: cycle.readiness }, null, 2),
    ).toBeDefined();
    expect(specRoute).toBeDefined();

    // The two route plans carry their own frozen envelopes.
    expect(quickRoute?.protocolVersion).toBe('1.3.0');
    expect(specRoute?.protocolVersion).toBe('1.2.0');

    const store = new OperatingEventStore(projectRoot, { localRoot });

    // The route.proposed event carrying the v1.3 route plan is itself stamped
    // v1.3 and validates at 1.3.0; the create-spec route.proposed stays v1.2 —
    // no version bleeds from one route into the other in the same event log.
    const replay = await store.replay();
    const quickProposed = replay.events.find(
      (event) => event.type === 'route.proposed' && event.entityId === quickRoute?.id,
    );
    const specProposed = replay.events.find(
      (event) => event.type === 'route.proposed' && event.entityId === specRoute?.id,
    );
    await expect(assertOperatingArtifact('operating-event', quickProposed)).resolves.toMatchObject({
      protocolVersion: '1.3.0',
    });
    await expect(assertOperatingArtifact('operating-event', specProposed)).resolves.toMatchObject({
      protocolVersion: '1.2.0',
    });

    // The persisted route records agree: the quick-task record validates at 1.3.0,
    // the create-spec record at 1.2.0.
    const quickRecord = await readRouteRecord(store, quickRoute?.id as string);
    const specRecord = await readRouteRecord(store, specRoute?.id as string);
    await expect(assertOperatingArtifact('operating-record', quickRecord)).resolves.toMatchObject({
      recordType: 'route',
      protocolVersion: '1.3.0',
    });
    await expect(assertOperatingArtifact('operating-record', specRecord)).resolves.toMatchObject({
      recordType: 'route',
      protocolVersion: '1.2.0',
    });

    // Accept the small finding: acceptance is not application (accept≠apply).
    const quickTarget = join(projectRoot, quickRoute?.actions[0]?.targetPath as string);
    expect(await pathExists(quickTarget)).toBe(false);
    const governed = (await governOperatingFinding({
      projectRoot,
      localRoot,
      findingId: quickRoute?.actions[0]?.findingId as string,
      action: 'accept',
      confirmed: true,
      reason: 'Fixture acceptance after reviewing the exact quick-task preview.',
    })) as { routeId: string; routePreviewDigest: string };
    expect(governed.routeId).toBe(quickRoute?.id);
    // Accepting a route never writes its destination bytes.
    expect(await pathExists(quickTarget)).toBe(false);

    const acceptedRoute = await readOperatingRoute(projectRoot, governed.routeId);

    // Digest-bound preview: applying with anything other than the exact preview
    // digest is refused, and no destination bytes are written.
    await expect(
      applyOperatingRoute({
        projectRoot,
        localRoot,
        route: acceptedRoute,
        config,
        confirmationDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED' });
    expect(await pathExists(quickTarget)).toBe(false);

    // Apply against the exact preview digest: the quick-task file lands through
    // the write-ahead journal, byte-exact to the committed preview.
    const applied = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route: acceptedRoute,
      config,
      confirmationDigest: governed.routePreviewDigest,
    });
    expect(applied).toMatchObject({ state: 'applied', shipInvoked: false });
    expect(applied.transactionId).toBeDefined();
    expect(await pathExists(quickTarget)).toBe(true);

    const appliedBytes = await readFile(quickTarget);
    const appliedText = appliedBytes.toString('utf8');
    // Provenance is recorded the same way create-decision records it.
    expect(appliedText).toContain('status: "pending"');
    expect(appliedText).toContain(quickRoute?.cycleId as string);
    expect(appliedText).toContain(quickRoute?.actions[0]?.findingId as string);
    expect(appliedText).toContain(quickRoute?.actions[0]?.owner as string);
    // R1: the quick-task surface never invokes SHIP nor emits a ship marker.
    expect(appliedText).not.toMatch(/\.pipeline-shipped/);
    expect(quickRoute?.actions[0]?.targetPath).not.toMatch(/\.pipeline-shipped|\bship\b/);

    const transactionsRoot = resolveOperatingPaths(projectRoot, { localRoot }).transactions;
    const journal = await readJournal(
      join(transactionsRoot, applied.transactionId as string, 'journal.json'),
    );
    // The committed journal is bound to the route preview digest, and the bytes
    // on disk hash to exactly what the journal committed.
    expect(journal.previewDigest).toBe(quickRoute?.previewDigest);
    const quickWrite = journal.writes.find(
      (write) => write.path === quickRoute?.actions[0]?.targetPath,
    );
    expect(quickWrite?.operation).toBe('create');
    expect(quickWrite?.beforeDigest).toBeNull();
    expect(quickWrite?.afterDigest).toBe(sha256Digest(appliedBytes));

    // No route path invoked SHIP anywhere in the log.
    expect(replay.events.some((event) => event.type === 'ship.observed')).toBe(false);
    const afterApply = await store.replay();
    expect(afterApply.events.some((event) => event.type === 'ship.observed')).toBe(false);

    // Byte-exact rollback: the applied file is removed and the prior (absent)
    // state is restored exactly.
    const rolledHead = await rollbackOperatingRoute({
      projectRoot,
      localRoot,
      route: acceptedRoute,
      transactionId: applied.transactionId as string,
      recoveryId: 'RCV-quick-task-rollback',
    });
    expect(rolledHead.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(access(quickTarget)).rejects.toMatchObject({ code: 'ENOENT' });
    const rolledBackState = await store.state();
    expect(rolledBackState.routes.find((route) => route.id === quickRoute?.id)?.state).toBe(
      'rolled_back',
    );
    // The v1.2 create-spec route is untouched by the quick-task lifecycle.
    expect(rolledBackState.routes.find((route) => route.id === specRoute?.id)?.state).toBe(
      'proposed',
    );
  });
});
