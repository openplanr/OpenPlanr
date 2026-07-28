import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import type { OperatingArtifactGeneratorAdapter } from '../../src/services/operate/artifact-route-generation.js';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { governOperatingFinding } from '../../src/services/operate/lifecycle.js';
import { applyOperatingRoute, readOperatingRoute } from '../../src/services/operate/routes.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const offlineProviderDigest = canonicalDigest({ provider: 'offline' });

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function acceptedAgentRoute(): Promise<{
  projectRoot: string;
  localRoot: string;
  route: Awaited<ReturnType<typeof readOperatingRoute>>;
}> {
  const projectRoot = await temporaryDirectory('openplanr-agent-route-project-');
  const localRoot = await temporaryDirectory('openplanr-agent-route-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'service.ts'), 'export const ready = true;\n');
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const initialization = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository', 'git'],
      caps: {
        surfacedFindings: 3,
        newSpecs: 1,
        openDecisions: 1,
        agentArtifacts: 1,
      },
      budgets: {
        maxFiles: 100,
        maxItems: 100,
        maxBytes: 1024 * 1024,
        maxDurationMs: 10_000,
      },
    },
    charter: {
      purpose: 'Exercise resumable AGENT artifact generation.',
      goals: ['Generate one reviewed local artifact.'],
    },
    now: '2026-07-28T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview: initialization,
    confirmationDigest: initialization.previewDigest,
  });
  const adapter: AdvisorAdapter = {
    id: 'agent-route-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      const evidenceRef = input.evidence.items[0]?.id;
      if (!evidenceRef) {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      if (input.roleId !== 'chair') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'agent-brief',
            type: 'merge',
            title: 'Prepare a bounded operating brief',
            problem: 'The owner needs one cited local synthesis.',
            proposal: 'Generate a local Markdown brief for review.',
            impact: 2,
            confidence: 3,
            ease: 5,
            severity: 'low',
            evidenceRefs: [evidenceRef],
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
  const cycle = await runOperatingCycle({
    projectRoot,
    localRoot,
    adapter,
    confirmed: true,
    now: new Date('2026-07-28T13:00:00.000Z'),
  });
  const proposed = cycle.routes?.find((route) => route.actions[0]?.lane === 'AGENT');
  expect(
    proposed,
    JSON.stringify(
      {
        warnings: cycle.warnings,
        readiness: cycle.readiness,
        findings: cycle.findings,
        routes: cycle.routes,
      },
      null,
      2,
    ),
  ).toBeDefined();
  const accepted = (await governOperatingFinding({
    projectRoot,
    localRoot,
    findingId: proposed?.actions[0]?.findingId as string,
    action: 'accept',
    confirmed: true,
    reason: 'Review the bounded local generation route.',
  })) as { routeId: string };
  return {
    projectRoot,
    localRoot,
    route: await readOperatingRoute(projectRoot, accepted.routeId),
  };
}

function generator(
  generate: OperatingArtifactGeneratorAdapter['generate'],
  overrides: Partial<OperatingArtifactGeneratorAdapter> = {},
): OperatingArtifactGeneratorAdapter {
  return {
    id: 'fixture-generator',
    runtime: 'fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    supportedArtifactTypes: ['markdown'],
    providerDigest: offlineProviderDigest,
    generate,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('Operating Board AGENT route generation', () => {
  it('generates privately, requires exact-byte review, commits provenance, and stays idempotent', async () => {
    const { projectRoot, localRoot, route } = await acceptedAgentRoute();
    const observedRequests: Array<Record<string, unknown>> = [];
    const adapter = generator(async (request) => {
      observedRequests.push(request as unknown as Record<string, unknown>);
      return {
        content: '# Owner brief\n\nEvidence: EVD-repository\n',
        usage: { tokens: 32, costUsd: 0 },
      };
    });
    const prepared = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config: await validateOperatingConfiguration(projectRoot),
      confirmationDigest: route.previewDigest,
      artifactGenerator: adapter,
    });
    expect(prepared).toMatchObject({
      state: 'awaiting-artifact-review',
      previewDigest: expect.stringMatching(/^sha256:/),
      artifact: {
        content: '# Owner brief\n\nEvidence: EVD-repository\n',
        attempts: [{ attempt: 1, state: 'generated' }],
      },
      shipInvoked: false,
    });
    expect(observedRequests).toHaveLength(1);
    expect(observedRequests[0]).toMatchObject({
      externalActions: [],
      sandbox: { network: 'none', filesystem: 'none', tools: [] },
    });
    await expect(
      access(join(projectRoot, route.actions[0]?.targetPath as string)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const repeatedPreparation = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config: await validateOperatingConfiguration(projectRoot),
      confirmationDigest: route.previewDigest,
      artifactGenerator: adapter,
    });
    expect(repeatedPreparation).toMatchObject({
      state: 'awaiting-artifact-review',
      previewDigest: prepared.previewDigest,
    });
    expect(observedRequests).toHaveLength(1);

    const applied = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config: await validateOperatingConfiguration(projectRoot),
      confirmationDigest: prepared.previewDigest as string,
      artifactGenerator: adapter,
    });
    expect(applied).toMatchObject({ state: 'applied', shipInvoked: false });
    expect(await readFile(join(projectRoot, route.actions[0]?.targetPath as string), 'utf8')).toBe(
      '# Owner brief\n\nEvidence: EVD-repository\n',
    );
    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    expect(replay.events.filter((event) => event.type === 'artifact.created')).toHaveLength(1);
    expect(replay.events.some((event) => event.type === 'route.applied')).toBe(true);
    expect(
      replay.events.some((event) =>
        ['ship.observed', 'spec.linked', 'outcome.registered'].includes(event.type),
      ),
    ).toBe(false);

    const repeated = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route,
      config: await validateOperatingConfiguration(projectRoot),
      confirmationDigest: prepared.previewDigest as string,
      artifactGenerator: adapter,
    });
    expect(repeated).toMatchObject({
      state: 'applied',
      transactionId: applied.transactionId,
    });
    expect(observedRequests).toHaveLength(1);
  }, 15_000);

  it('fails closed when the selected adapter cannot generate the typed format', async () => {
    const { projectRoot, localRoot, route } = await acceptedAgentRoute();
    let invoked = false;
    await expect(
      applyOperatingRoute({
        projectRoot,
        localRoot,
        route,
        config: await validateOperatingConfiguration(projectRoot),
        confirmationDigest: route.previewDigest,
        artifactGenerator: generator(
          async () => {
            invoked = true;
            return { content: '# impossible\n' };
          },
          { supportedArtifactTypes: [] },
        ),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ARTIFACT_REJECTED' });
    expect(invoked).toBe(false);
    await expect(
      access(join(projectRoot, route.actions[0]?.targetPath as string)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries invalid output and enforces the three-attempt cap', async () => {
    const recovered = await acceptedAgentRoute();
    let recoveredInvocations = 0;
    const recoveredResult = await applyOperatingRoute({
      ...recovered,
      config: await validateOperatingConfiguration(recovered.projectRoot),
      confirmationDigest: recovered.route.previewDigest,
      artifactGenerator: generator(async () => {
        recoveredInvocations += 1;
        return {
          content:
            recoveredInvocations === 1 ? 'javascript:alert("unsafe")' : '# Validated on retry\n',
        };
      }),
    });
    expect(recoveredResult).toMatchObject({
      state: 'awaiting-artifact-review',
      artifact: {
        attempts: [
          { attempt: 1, state: 'failed', failureCode: 'E_OPERATE_ARTIFACT_OUTPUT_INVALID' },
          { attempt: 2, state: 'generated' },
        ],
      },
    });

    const exhausted = await acceptedAgentRoute();
    const exhaustedConfig = await validateOperatingConfiguration(exhausted.projectRoot);
    let exhaustedInvocations = 0;
    const rejected = () =>
      applyOperatingRoute({
        ...exhausted,
        config: exhaustedConfig,
        confirmationDigest: exhausted.route.previewDigest,
        artifactGenerator: generator(async () => {
          exhaustedInvocations += 1;
          return { content: 'javascript:alert("unsafe")' };
        }),
      });
    await expect(
      applyOperatingRoute({
        ...exhausted,
        config: exhaustedConfig,
        confirmationDigest: exhausted.route.previewDigest,
        artifactGenerator: generator(async () => {
          exhaustedInvocations += 1;
          return { content: 'javascript:alert("unsafe")' };
        }),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_ARTIFACT_REJECTED',
      details: {
        attempts: expect.arrayContaining([
          {
            attempt: 3,
            state: 'failed',
            failureCode: 'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
          },
        ]),
      },
    });
    expect(exhaustedInvocations).toBe(3);
    await expect(rejected()).rejects.toMatchObject({ code: 'E_OPERATE_ARTIFACT_REJECTED' });
    expect(exhaustedInvocations).toBe(3);
  }, 20_000);

  it('resumes a durably failed attempt without regenerating attempt one', async () => {
    const fixture = await acceptedAgentRoute();
    const attempts: number[] = [];
    const adapter = generator(async (request) => {
      attempts.push(request.attempt);
      if (request.attempt === 1) throw new Error('transient provider failure');
      return { content: '# Resumed brief\n' };
    });
    await expect(
      applyOperatingRoute({
        ...fixture,
        config: await validateOperatingConfiguration(fixture.projectRoot),
        confirmationDigest: fixture.route.previewDigest,
        artifactGenerator: adapter,
        faultInjector(boundary) {
          if (boundary === 'artifact-attempt-failed') {
            throw new Error('simulated process interruption');
          }
        },
      }),
    ).rejects.toThrow('simulated process interruption');
    expect(attempts).toEqual([1]);
    expect(
      (
        await new OperatingEventStore(fixture.projectRoot, {
          localRoot: fixture.localRoot,
        }).state()
      ).routes.find((route) => route.id === fixture.route.id)?.state,
    ).toBe('prepared');

    const resumed = await applyOperatingRoute({
      ...fixture,
      config: await validateOperatingConfiguration(fixture.projectRoot),
      confirmationDigest: fixture.route.previewDigest,
      artifactGenerator: adapter,
    });
    expect(resumed).toMatchObject({
      state: 'awaiting-artifact-review',
      artifact: {
        attempts: [
          { attempt: 1, state: 'failed' },
          { attempt: 2, state: 'generated' },
        ],
      },
    });
    expect(attempts).toEqual([1, 2]);
  }, 15_000);
});
