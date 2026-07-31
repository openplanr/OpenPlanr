import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import {
  collectGitHubEvidence,
  collectLinearEvidence,
  collectOperatingEvidence,
} from '../../src/services/operate/evidence.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import { probeAvailableEvidenceSources } from '../../src/services/operate/interaction/answer-service.js';
import {
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
} from '../../src/services/operate/interaction/question-engine.js';
import {
  type OperatingQuestionContext,
  operatingInitQuestionRegistry,
} from '../../src/services/operate/interaction/question-registry.js';
import { operatingCheckboxChoices } from '../../src/services/operate/interaction/terminal-renderer.js';
import { buildWorkspaceManifest } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createGitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-sources-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/evidence-fixture.git'],
    { cwd: projectRoot },
  );
  await writeFile(join(projectRoot, 'README.md'), '# Fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('Operating Board evidence sources', () => {
  it('collects bounded GitHub issues, pull requests, releases, and checks', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-sources-local-');
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });
    const fetchImpl = vi.fn(async (request: string | URL | Request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith('/issues')) {
        return jsonResponse([
          {
            number: 1,
            title: 'Customer cannot complete onboarding',
            state: 'open',
            created_at: '2026-07-01T00:00:00Z',
            updated_at: '2026-07-27T00:00:00Z',
            labels: [{ name: 'customer' }],
          },
        ]);
      }
      if (url.pathname.endsWith('/pulls')) {
        return jsonResponse([
          {
            number: 2,
            title: 'Repair onboarding',
            state: 'closed',
            draft: false,
            created_at: '2026-07-02T00:00:00Z',
            updated_at: '2026-07-03T00:00:00Z',
            merged_at: '2026-07-03T00:00:00Z',
          },
        ]);
      }
      if (url.pathname.endsWith('/releases')) {
        return jsonResponse([
          {
            id: 3,
            tag_name: 'v1.0.0',
            name: 'First release',
            draft: false,
            prerelease: false,
            created_at: '2026-07-04T00:00:00Z',
            published_at: '2026-07-04T00:00:00Z',
          },
        ]);
      }
      return jsonResponse({
        check_runs: [
          {
            id: 4,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-07-05T00:00:00Z',
            completed_at: '2026-07-05T00:01:00Z',
          },
        ],
      });
    });

    const result = await collectGitHubEvidence({
      projectRoot,
      workspace,
      now: new Date('2026-07-28T10:01:00.000Z'),
      deadline: Date.now() + 10_000,
      budgets: budgets(),
      token: 'fixture-token',
      fetchImpl,
    });

    expect(result.items.map((item) => item.location)).toEqual([
      `${workspace.controlRepository.componentId}/issues`,
      `${workspace.controlRepository.componentId}/pull-requests`,
      `${workspace.controlRepository.componentId}/releases`,
      `${workspace.controlRepository.componentId}/checks`,
    ]);
    expect(result.items.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Customer cannot complete onboarding'),
        expect.stringContaining('Repair onboarding'),
        expect.stringContaining('v1.0.0'),
        expect.stringContaining('"conclusion":"success"'),
      ]),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const call of fetchImpl.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ method: 'GET', redirect: 'error' }));
    }
  });

  it('collects Linear teams, configured-team issues, and projects through query-only transport', async () => {
    const fetchImpl = vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes('OperatingTeams')) {
        return jsonResponse({
          data: {
            teams: {
              nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (body.query.includes('OperatingIssues')) {
        return jsonResponse({
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue-1',
                  identifier: 'ENG-1',
                  title: 'Ship evidence collection',
                  updatedAt: '2026-07-28T10:00:00Z',
                  priority: 1,
                  team: { id: 'team-1', key: 'ENG' },
                  state: { name: 'In Progress' },
                  labels: { nodes: [{ name: 'operate' }] },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          projects: {
            nodes: [
              {
                id: 'project-1',
                name: 'Operating Board',
                updatedAt: '2026-07-28T10:00:00Z',
                status: { name: 'Started' },
                teams: { nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }] },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    });

    const result = await collectLinearEvidence({
      projectRoot: '/unused-by-explicit-team-fixture',
      now: new Date('2026-07-28T10:01:00.000Z'),
      deadline: Date.now() + 10_000,
      budgets: budgets(),
      token: 'fixture-token',
      teamIds: ['team-1'],
      fetchImpl,
    });

    expect(result.items.map((item) => item.location)).toEqual(['teams', 'issues', 'projects']);
    expect(result.items[0]?.content).toContain('Engineering');
    expect(result.items[1]?.content).toContain('ENG-1');
    expect(result.items[2]?.content).toContain('Operating Board');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(String(call[1]?.body)) as { query: string };
      expect(body.query).toMatch(/^\s*query\b/);
      expect(call[1]).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error' }));
    }
  });

  it('launches configured file-import evidence through the real cycle collector', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-import-local-');
    await writeFile(
      join(projectRoot, 'customer-signals.csv'),
      'segment,signal\nenterprise,=unsafe-formula\n',
    );
    await execFileAsync('git', ['add', 'customer-signals.csv'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'evidence fixture'], {
      cwd: projectRoot,
    });
    const preview = await prepareOperatingInitialization({
      projectRoot,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      enabledProviders: ['file-import'],
      evidenceFiles: ['customer-signals.csv'],
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      now: '2026-07-28T10:00:00.000Z',
    });
    await applyOperatingInitialization({
      projectRoot,
      localRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });

    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace: preview.workspace,
      providers: ['file-import'],
      sensitivityCeiling: 'internal',
      budgets: budgets(),
      now: new Date('2026-07-28T10:01:00.000Z'),
      incremental: true,
      persistIncremental: true,
    });

    expect(evidence.sources).toEqual([
      expect.objectContaining({ id: 'file-import', status: 'collected', itemCount: 1 }),
    ]);
    expect(evidence.items[0]).toMatchObject({
      source: 'file-import',
      location: expect.stringMatching(/customer-signals\.csv$/),
      sensitivity: 'internal',
    });
    expect(evidence.items[0]?.summary).toContain("'=unsafe-formula");

    const previousStateRoot = process.env.OPENPLANR_STATE_ROOT;
    process.env.OPENPLANR_STATE_ROOT = localRoot;
    try {
      await expect(
        executeOperateAction({
          action: 'sources.test',
          projectRoot,
          interactive: false,
          arguments: { source: 'file-import' },
          options: { json: true },
        }),
      ).resolves.toMatchObject({
        ok: true,
        data: expect.objectContaining({
          healthy: true,
          observation: 'files:1',
          writeBoundary: 'none',
        }),
      });
      await expect(
        executeOperateAction({
          action: 'sources.test',
          projectRoot,
          interactive: false,
          arguments: {},
          options: { json: true },
        }),
      ).resolves.toMatchObject({
        ok: true,
        message: '1 configured evidence source test(s) passed.',
        data: {
          healthy: true,
          configuredSources: ['file-import'],
          results: [
            expect.objectContaining({
              healthy: true,
              observation: 'files:1',
              writeBoundary: 'none',
            }),
          ],
        },
      });
    } finally {
      if (previousStateRoot === undefined) delete process.env.OPENPLANR_STATE_ROOT;
      else process.env.OPENPLANR_STATE_ROOT = previousStateRoot;
    }
  });

  it('refreshes remote evidence when local workspace state is unchanged', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-refresh-local-');
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });
    let version = 1;
    const fetchImpl = vi.fn(async (request: string | URL | Request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith('/issues')) {
        return jsonResponse([
          {
            number: 1,
            title: `Remote issue version ${version}`,
            state: 'open',
            labels: [],
          },
        ]);
      }
      if (url.pathname.includes('/check-runs')) return jsonResponse({ check_runs: [] });
      return jsonResponse([]);
    });
    const collect = () =>
      collectOperatingEvidence({
        projectRoot,
        localRoot,
        cycleId: 'CYCLE-001',
        workspace,
        providers: ['github'],
        sensitivityCeiling: 'confidential',
        budgets: budgets(),
        now: new Date(`2026-07-28T10:0${version}:00.000Z`),
        incremental: true,
        persistIncremental: true,
        remote: { githubToken: 'fixture-token', fetchImpl },
      });

    const first = await collect();
    version = 2;
    const second = await collect();

    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(first.items[0]?.summary).toContain('Remote issue version 1');
    expect(second.items[0]?.summary).toContain('Remote issue version 2');
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('redacts one secret-bearing item without blocking eligible repository evidence', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-quarantine-local-');
    await writeFile(
      join(projectRoot, 'unsafe.ts'),
      'export const token = "npm_abcdefghijklmnopqrstuvwxyz0123456789";\n',
    );
    await writeFile(
      join(projectRoot, 'architecture.ts'),
      'export const architecture = "bounded native operating packs";\n',
    );
    await execFileAsync('git', ['add', 'unsafe.ts', 'architecture.ts'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'quarantine fixture'], {
      cwd: projectRoot,
    });
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });

    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace,
      providers: ['repository'],
      sensitivityCeiling: 'internal',
      budgets: budgets(),
      now: new Date('2026-07-28T10:01:00.000Z'),
    });

    expect(evidence.items.some((item) => item.location.endsWith('/architecture.ts'))).toBe(true);
    const unsafe = evidence.items.find((item) => item.location.endsWith('/unsafe.ts'));
    expect(unsafe).toBeDefined();
    expect(unsafe?.summary).toContain('[REDACTED_TOKEN]');
    expect(evidence.warnings).toEqual([]);
    expect(JSON.stringify(evidence)).not.toContain('npm_');
  });

  it('rejects a persisted incremental baseline whose workspaceDigest drifted and recollects deep', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-stale-baseline-local-');
    const workspaceBefore = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });
    const collect = (workspace: typeof workspaceBefore, now: string) =>
      collectOperatingEvidence({
        projectRoot,
        localRoot,
        cycleId: 'CYCLE-001',
        workspace,
        providers: ['repository'],
        sensitivityCeiling: 'internal',
        budgets: budgets(),
        now: new Date(now),
        incremental: true,
        persistIncremental: true,
      });

    // First collection writes a baseline keyed by (board, workspace components,
    // providers, ...) carrying workspaceBefore's digest; no baseline yet -> deep.
    const first = await collect(workspaceBefore, '2026-07-28T10:01:00.000Z');
    expect(first.delta?.mode).toBe('baseline');

    // A new commit changes the workspace digest but NOT the incremental key
    // (component remote/branch are unchanged), so the second collection resolves
    // the same baseline file — whose workspaceDigest is now stale.
    await writeFile(join(projectRoot, 'CHANGELOG.md'), '# workspace drift\n');
    await execFileAsync('git', ['add', 'CHANGELOG.md'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'workspace drift'], {
      cwd: projectRoot,
    });
    const workspaceAfter = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:02:00.000Z',
    });
    expect(workspaceAfter.workspaceDigest).not.toBe(workspaceBefore.workspaceDigest);

    const second = await collect(workspaceAfter, '2026-07-28T10:03:00.000Z');
    // The stale baseline is treated as no-baseline -> deep recollect, not a
    // 'standard' delta that would trust the superseded snapshot.
    expect(second.delta?.mode).toBe('baseline');
    expect(second.delta?.baselineFingerprint).toBeNull();
  });

  it('fails closed when a tracked repository file is a symlink escape', async () => {
    const projectRoot = await createGitProject();
    const outsideRoot = await temporaryDirectory('openplanr-operate-repository-outside-');
    const localRoot = await temporaryDirectory('openplanr-operate-repository-local-');
    await writeFile(join(outsideRoot, 'secret.json'), '{"token":"outside"}\n');
    await symlink(join(outsideRoot, 'secret.json'), join(projectRoot, 'escaped.json'));
    await execFileAsync('git', ['add', 'escaped.json'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'tracked symlink fixture'], {
      cwd: projectRoot,
    });
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });

    await expect(
      collectOperatingEvidence({
        projectRoot,
        localRoot,
        cycleId: 'CYCLE-001',
        workspace,
        providers: ['repository'],
        sensitivityCeiling: 'internal',
        budgets: budgets(),
        now: new Date('2026-07-28T10:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
  });
});

describe('Operating Board evidence source questionnaire', () => {
  const context: OperatingQuestionContext = {
    timezone: 'UTC',
    availableSources: ['repository', 'planr', 'git', 'file-import'],
  };
  const sourcesQuestion = () =>
    operatingInitQuestionRegistry(context).find(
      (definition) => definition.question.questionId === 'sources',
    )?.question;

  it('probes availability honestly rather than asserting a static list', async () => {
    const gitOnly = await createGitProject();
    await expect(probeAvailableEvidenceSources(gitOnly)).resolves.toEqual([
      'repository',
      'git',
      'file-import',
    ]);
    await mkdir(join(gitOnly, '.planr'), { recursive: true });
    await expect(probeAvailableEvidenceSources(gitOnly)).resolves.toEqual([
      'repository',
      'planr',
      'git',
      'file-import',
    ]);
    const bare = await temporaryDirectory('openplanr-operate-bare-project-');
    await expect(probeAvailableEvidenceSources(bare)).resolves.toEqual([
      'repository',
      'file-import',
    ]);
  });

  it('offers no github or linear choice until they are configurable in-flow', () => {
    const ids = sourcesQuestion()?.choices?.map((choice) => choice.id);
    expect(ids).not.toContain('github');
    expect(ids).not.toContain('linear');
    expect(ids).toEqual(['repository', 'planr', 'git', 'file-import']);
  });

  it('carries per-choice preselected schema-to-UI for suggested sources', async () => {
    const question = sourcesQuestion();
    const preselected = (question?.choices ?? [])
      .filter((choice) => (choice as { preselected?: boolean }).preselected === true)
      .map((choice) => choice.id);
    expect(preselected).toEqual(['repository', 'planr', 'git']);

    const state = await evaluateOperatingInitQuestions({ context });
    if (state.status !== 'input-required') throw new Error('Expected foundation questions.');
    const questionnaire = await createOperatingInitQuestionnaire({
      context: { ...context, projectRoot: process.cwd() },
      questions: state.questions,
      stage: state.stage,
    });
    // The built questionnaire must validate against the installed 0.34.0 schema
    // WITH preselected present on the suggested source choices.
    const built = questionnaire.questions.find((question) => question.questionId === 'sources');
    const builtPreselected = (built?.choices ?? [])
      .filter((choice) => (choice as { preselected?: boolean }).preselected === true)
      .map((choice) => choice.id);
    expect(builtPreselected).toEqual(['repository', 'planr', 'git']);
  });

  it('renders preselected choices pre-checked and never fabricates a select from repeated-text', () => {
    const checkbox = operatingCheckboxChoices(sourcesQuestion() as never);
    expect(checkbox.filter((choice) => choice.checked).map((choice) => choice.value)).toEqual([
      'repository',
      'planr',
      'git',
    ]);
    // Guardrails is repeated-text even though it now carries a suggestion — it is
    // never turned into a select, so no repeated option is fabricated into a choice.
    const guardrails = operatingInitQuestionRegistry(context).find(
      (definition) => definition.question.questionId === 'guardrails',
    )?.question;
    expect(guardrails?.type).toBe('repeated-text');
    expect(guardrails?.choices).toBeUndefined();
  });

  it('accepts every offered source as submittable', async () => {
    const offered = sourcesQuestion()?.choices?.map((choice) => choice.id) ?? [];
    const result = await evaluateOperatingInitQuestions({
      answers: { sources: offered },
      context,
    });
    // Foundation is still incomplete, but the offered sources themselves never
    // hard-fail availability or choice validation.
    expect(result.status).toBe('input-required');
  });
});
