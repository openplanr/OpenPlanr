import { execFile } from 'node:child_process';
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { governOperatingFinding } from '../../src/services/operate/lifecycle.js';
import { applyOperatingRoute, readOperatingRoute } from '../../src/services/operate/routes.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function pipelineRouteAdapter(): AdvisorAdapter {
  return {
    id: 'pipeline-po-route-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      if (input.roleId !== 'strategy-finance') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'pipeline-po-dev-route',
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

async function initializePipelinePoWorkspace(): Promise<{
  projectRoot: string;
  localRoot: string;
}> {
  const projectRoot = await temporaryDirectory('openplanr-operate-pipeline-po-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-pipeline-po-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await mkdir(join(projectRoot, '.planr'), { recursive: true });
  await writeFile(
    join(projectRoot, '.planr', 'config.json'),
    `${JSON.stringify({ idPrefix: { spec: 'SPEC' } }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
  );
  await execFileAsync('git', ['add', '.planr/config.json', 'service.ts'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });

  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'pipeline-po',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      caps: {
        surfacedFindings: 10,
        newSpecs: 3,
        openDecisions: 3,
        agentArtifacts: 2,
      },
    },
    charter: {
      purpose: 'Exercise the asynchronous Pipeline-PO route handoff.',
      goals: ['Keep PLAN review separate from SHIP.'],
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

async function acceptedDevRoute(projectRoot: string, localRoot: string) {
  const cycle = await runOperatingCycle({
    projectRoot,
    localRoot,
    adapter: pipelineRouteAdapter(),
    confirmed: true,
    now: new Date('2026-07-28T13:00:00.000Z'),
  });
  const proposed = cycle.routes?.find((candidate) => candidate.actions[0]?.lane === 'DEV');
  expect(proposed).toBeDefined();
  const governed = (await governOperatingFinding({
    projectRoot,
    localRoot,
    findingId: proposed?.actions[0]?.findingId as string,
    action: 'accept',
    confirmed: true,
    reason: 'Review and accept the exact Pipeline-PO route preview.',
  })) as { routeId: string; routePreviewDigest: string };
  return {
    route: await readOperatingRoute(projectRoot, governed.routeId),
    confirmationDigest: governed.routePreviewDigest,
    config: await validateOperatingConfiguration(projectRoot),
  };
}

function provenanceEvent(input: {
  artifactPath: string;
  artifactId: string;
  eventId: string;
  producer: 'planr-pipeline' | 'openplanr';
  runId: string;
}) {
  return {
    schema_version: '1.0.0',
    event_id: input.eventId,
    timestamp: '2026-07-28T13:30:00.000Z',
    artifact_id: input.artifactId,
    artifact_path: input.artifactPath,
    operation: 'decomposed',
    producer: {
      product: input.producer,
      version: input.producer === 'planr-pipeline' ? '0.30.0' : '1.14.0',
      runtime: 'codex',
      phase: input.producer === 'planr-pipeline' ? 'po' : 'planning',
    },
    run_id: input.runId,
  };
}

async function simulateNativePipelinePlan(input: {
  projectRoot: string;
  targetPath: string;
  conflictingProducer?: boolean;
}) {
  const specDirectory = dirname(join(input.projectRoot, input.targetPath));
  const specId = input.targetPath.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
  if (!specId) throw new Error('Fixture target does not include a SPEC id.');
  await mkdir(join(specDirectory, 'stories'), { recursive: true });
  await mkdir(join(specDirectory, 'tasks'), { recursive: true });
  await writeFile(
    join(specDirectory, 'stories', 'US-001-health.md'),
    `---\nid: "US-001"\nspecId: "${specId}"\ntitle: "Health"\nstatus: "ready"\n---\n`,
  );
  await writeFile(
    join(specDirectory, 'tasks', 'T-001-health.md'),
    `---\nid: "T-001"\nspecId: "${specId}"\nstoryId: "US-001"\ntitle: "Health"\nstatus: "pending"\n---\n`,
  );
  const provenancePath = join(input.projectRoot, '.planr', 'provenance.jsonl');
  await appendFile(
    provenancePath,
    `${JSON.stringify(
      provenanceEvent({
        artifactPath: input.targetPath,
        artifactId: specId,
        eventId: 'native-pipeline-plan',
        producer: 'planr-pipeline',
        runId: 'native-pipeline-plan',
      }),
    )}\n`,
  );
  if (input.conflictingProducer) {
    await appendFile(
      provenancePath,
      `${JSON.stringify(
        provenanceEvent({
          artifactPath: input.targetPath,
          artifactId: specId,
          eventId: 'conflicting-openplanr-plan',
          producer: 'openplanr',
          runId: 'conflicting-openplanr-plan',
        }),
      )}\n`,
    );
  }
  return { specDirectory, specId, provenancePath };
}

async function readProvenance(path: string) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

describe('Operating Board asynchronous Pipeline-PO handoff', () => {
  it('prepares once, resumes native PLAN, validates provenance, and applies without SHIP', async () => {
    const { projectRoot, localRoot } = await initializePipelinePoWorkspace();
    const { route, confirmationDigest, config } = await acceptedDevRoute(projectRoot, localRoot);
    const targetPath = route.actions[0]?.targetPath as string;

    const awaiting = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config,
      confirmationDigest,
    });
    expect(awaiting).toEqual(
      expect.objectContaining({
        state: 'awaiting-plan',
        invocation: 'planr pipeline plan "harden-service-health-reporting" --runtime codex',
        shipInvoked: false,
      }),
    );

    const handoffPath = join(
      resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
      'planning-handoffs',
      `${route.id}.json`,
    );
    const firstHandoffBytes = await readFile(handoffPath, 'utf8');
    expect(JSON.parse(firstHandoffBytes)).toMatchObject({
      kind: 'operating-planning-handoff',
      routeId: route.id,
      planningEngine: 'pipeline-po',
      invocation: awaiting.invocation,
      state: 'awaiting-plan',
      shipInvoked: false,
      prepared: {
        planningEngine: 'pipeline-po',
        state: 'awaiting-native-plan',
        shipInvoked: false,
        prepared: {
          phase: 'plan.prepared',
          mode: 'spec-driven',
          requiresHumanReviewBeforeShip: true,
        },
      },
    });

    const repeatedAwaiting = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config,
      confirmationDigest,
    });
    expect(repeatedAwaiting).toMatchObject({
      transactionId: awaiting.transactionId,
      state: 'awaiting-plan',
      invocation: awaiting.invocation,
      shipInvoked: false,
    });
    expect(await readFile(handoffPath, 'utf8')).toBe(firstHandoffBytes);

    const { specDirectory, provenancePath } = await simulateNativePipelinePlan({
      projectRoot,
      targetPath,
    });
    await expect(
      applyOperatingRoute({
        projectRoot,
        localRoot,
        route,
        config,
        confirmationDigest,
        faultInjector(boundary) {
          if (boundary === 'spec-linked') {
            throw new Error('simulated interruption after Pipeline-PO completion');
          }
        },
      }),
    ).rejects.toThrow('simulated interruption after Pipeline-PO completion');

    const completionRunId = `operate-${route.id.toLowerCase()}`;
    expect(
      (await readProvenance(provenancePath)).filter((event) => event.run_id === completionRunId),
    ).toHaveLength(1);

    const applied = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config,
      confirmationDigest,
    });
    expect(applied).toMatchObject({
      transactionId: awaiting.transactionId,
      state: 'applied',
      shipInvoked: false,
    });
    expect(
      (await readProvenance(provenancePath)).filter((event) => event.run_id === completionRunId),
    ).toHaveLength(1);
    await expect(access(join(specDirectory, '.pipeline-shipped'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const idempotent = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config,
      confirmationDigest,
    });
    expect(idempotent).toMatchObject({
      transactionId: awaiting.transactionId,
      state: 'applied',
      shipInvoked: false,
    });
    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    expect(
      replay.events.filter(
        (event) => event.type === 'route.applied' && event.entityId === route.id,
      ),
    ).toHaveLength(1);
    expect(
      replay.events.filter(
        (event) => event.type === 'spec.linked' && event.cycleId === route.cycleId,
      ),
    ).toHaveLength(1);
  });

  it('rejects PLAN artifacts attributed to conflicting decomposition producers', async () => {
    const { projectRoot, localRoot } = await initializePipelinePoWorkspace();
    const { route, confirmationDigest, config } = await acceptedDevRoute(projectRoot, localRoot);
    const targetPath = route.actions[0]?.targetPath as string;
    const awaiting = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config,
      confirmationDigest,
    });
    expect(awaiting).toMatchObject({ state: 'awaiting-plan', shipInvoked: false });

    const { specDirectory } = await simulateNativePipelinePlan({
      projectRoot,
      targetPath,
      conflictingProducer: true,
    });
    await expect(
      applyOperatingRoute({
        projectRoot,
        localRoot,
        route,
        config,
        confirmationDigest,
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_PLANNER_CONFLICT',
      details: {
        producers: ['openplanr', 'pipeline-po'],
      },
    });
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).state()).routes.find(
        (candidate) => candidate.id === route.id,
      )?.state,
    ).toBe('prepared');
    await expect(access(join(specDirectory, '.pipeline-shipped'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
