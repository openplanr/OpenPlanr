import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const onWindows = process.platform === 'win32';

/**
 * Windows resolves `npm` to `npm.cmd`, and Node refuses to execFile a `.cmd`
 * without a shell (the CVE-2024-27980 mitigation), so the shell is mandatory
 * there. A shell re-parses the argument list, so every argument is quoted —
 * several of these carry temporary directory paths.
 */
function npmExec(
  args: string[],
  options: Parameters<typeof execFileSync>[2] = {},
): string | Buffer {
  return execFileSync(npm, onWindows ? args.map((arg) => `"${arg}"`) : args, {
    ...options,
    ...(onWindows ? { shell: true } : {}),
  });
}
const repositoryRoot = resolve('.');
const pipelineRoot = resolve(
  process.env.OPENPLANR_PIPELINE_ROOT ?? join(repositoryRoot, '..', 'planr-pipeline'),
);
let root: string;
let projectRoot: string;
let minimalInstallRoot: string;
let fullInstallRoot: string;
let minimalPackageRoot: string;
let fullPackageRoot: string;
let minimalCli: string;
let fullCli: string;
let stateRoot: string;

function packageCli(packageRoot: string): string {
  return join(packageRoot, 'bin', 'planr.js');
}

/**
 * Directory holding the real `git`, so the isolated PATH can stay minimal
 * without removing a documented prerequisite.
 *
 * The previous list hardcoded `/usr/bin`, which contains git on POSIX by
 * coincidence. Windows got only System32, where git is absent — so the CLI
 * failed with `spawn git ENOENT` and reported "requires a Git worktree" inside
 * a repository it had just created. Resolving git makes the intent explicit on
 * every platform: isolate everything except the tools the product declares.
 */
function gitDirectory(): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const first = probe.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first ? dirname(first) : null;
}

function isolatedEnvironment(installRoot: string): NodeJS.ProcessEnv {
  const binDirectory = join(installRoot, 'node_modules', '.bin');
  return {
    ...process.env,
    HOME: join(root, 'home'),
    OPENPLANR_HOME: join(root, 'home', '.planr'),
    OPENPLANR_STATE_ROOT: stateRoot,
    OPENPLANR_PIPELINE_ROOT: '',
    NO_COLOR: '1',
    PATH: [
      binDirectory,
      dirname(process.execPath),
      gitDirectory(),
      ...(process.platform === 'win32'
        ? [process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '']
        : ['/usr/bin', '/bin']),
    ]
      .filter(Boolean)
      .join(process.platform === 'win32' ? ';' : ':'),
  };
}

function run(cli: string, installRoot: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, '--project-dir', projectRoot, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: isolatedEnvironment(installRoot),
  });
}

function jsonResult(cli: string, installRoot: string, args: string[]): Record<string, unknown> {
  const result = run(cli, installRoot, args);
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function pack(directory: string): string {
  const packed = JSON.parse(
    npmExec(['pack', '--json', '--ignore-scripts', '--pack-destination', root], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    }) as string,
  ) as Array<{ filename: string }>;
  return join(root, packed[0].filename);
}

function install(installRoot: string, tarballs: string[], omitOptional: boolean): void {
  npmExec(
    [
      'install',
      '--prefix',
      installRoot,
      ...(omitOptional ? ['--omit=optional'] : []),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      // Resolve dependencies from the local npm cache where possible. CI warms
      // it via setup-node, and these installs are the dominant cost of the
      // fixture — on Windows the whole setup runs roughly eight times slower
      // than on Linux or macOS, where network round-trips dominate.
      '--prefer-offline',
      '--no-progress',
      ...tarballs,
    ],
    {
      cwd: root,
      stdio: 'pipe',
      windowsHide: true,
    },
  );
}

function removePipelineBin(installRoot: string): void {
  const directory = join(installRoot, 'node_modules', '.bin');
  for (const suffix of ['', '.cmd', '.ps1']) {
    const target = join(directory, `planr-pipeline${suffix}`);
    if (existsSync(target)) unlinkSync(target);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-packed-operate-'));
  projectRoot = join(root, 'project');
  minimalInstallRoot = join(root, 'minimal-install');
  fullInstallRoot = join(root, 'full-install');
  stateRoot = join(root, 'state');
  mkdirSync(projectRoot, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 'OpenPlanr Pack Test'], {
    cwd: projectRoot,
  });
  execFileSync('git', ['config', 'user.email', 'pack-test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  writeFileSync(join(projectRoot, 'README.md'), '# Packed Operating Board fixture\n');
  // Packing needs a current dist/, but CI already runs `npm run build` in the
  // step before `npm test`. Repeating the full tsc compile here is pure
  // duplication, and on Windows it was enough to push this hook past four
  // minutes. Build only when nothing usable is present — locally that still
  // produces one, and CI reuses the artifact it just built.
  if (!existsSync(join(repositoryRoot, 'dist', 'cli', 'index.js'))) {
    npmExec(['run', 'build'], {
      cwd: repositoryRoot,
      stdio: 'pipe',
      windowsHide: true,
    });
  }
  const pipelineTarball = pack(pipelineRoot);
  const cliTarball = pack(repositoryRoot);
  install(minimalInstallRoot, [cliTarball], true);
  install(fullInstallRoot, [pipelineTarball, cliTarball], true);
  removePipelineBin(fullInstallRoot);

  minimalPackageRoot = join(minimalInstallRoot, 'node_modules', 'openplanr');
  fullPackageRoot = join(fullInstallRoot, 'node_modules', 'openplanr');
  minimalCli = packageCli(minimalPackageRoot);
  fullCli = packageCli(fullPackageRoot);

  execFileSync('git', ['add', '.'], { cwd: projectRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
  // Budget set from measurement, not estimate. This hook packs two real
  // tarballs and performs two real npm installs; measured cost is ~28s on
  // macOS, ~35s on Linux, and ~236s on Windows. The previous 240s left four
  // seconds of headroom on Windows, so the job passed or failed on chance.
  // Ten minutes keeps a genuine hang bounded while giving the slowest observed
  // platform room to vary.
}, 600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('packed planning-only Operating Board', () => {
  it('omits the optional pipeline package', () => {
    expect(existsSync(minimalCli)).toBe(true);
    expect(existsSync(join(minimalInstallRoot, 'node_modules', 'planr-pipeline'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(minimalPackageRoot, 'package.json'), 'utf8')) as {
      optionalDependencies?: Record<string, string>;
    };
    expect(manifest.optionalDependencies?.['planr-pipeline']).toBe('0.33.1');
  });

  it('keeps help, inspect, and demo provider-free and functional', () => {
    const help = run(minimalCli, minimalInstallRoot, ['operate', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('inspect');
    expect(help.stdout).toContain('demo');

    expect(
      jsonResult(minimalCli, minimalInstallRoot, ['operate', 'inspect', '--json']),
    ).toMatchObject({
      ok: true,
      action: 'inspect',
      data: { pipeline: { available: false } },
    });
    expect(jsonResult(minimalCli, minimalInstallRoot, ['operate', 'demo', '--json'])).toMatchObject(
      {
        ok: true,
        action: 'demo',
      },
    );
  });

  it('fails a pipeline command before provider use with exact recovery', () => {
    const result = run(minimalCli, minimalInstallRoot, ['operate', 'sources', 'list', '--json']);
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      action: 'sources.list',
      code: 'E_PIPELINE_NOT_INSTALLED',
      data: {
        recovery:
          'Run `npm install -g openplanr@latest` (without `--omit=optional`), then `planr setup --scope user`.',
      },
      exitCode: 3,
    });
    expect(existsSync(join(projectRoot, '.planr', 'operate'))).toBe(false);
  });
});

describe('packed full Operating Board lifecycle', () => {
  it('resolves the nested engine without exposing planr-pipeline on PATH', () => {
    expect(existsSync(fullCli)).toBe(true);
    expect(existsSync(join(fullInstallRoot, 'node_modules', 'planr-pipeline'))).toBe(true);
    expect(existsSync(join(fullInstallRoot, 'node_modules', '.bin', 'planr-pipeline'))).toBe(false);
    expect(jsonResult(fullCli, fullInstallRoot, ['operate', 'inspect', '--json'])).toMatchObject({
      ok: true,
      action: 'inspect',
      data: { pipeline: { available: true, protocolVersion: '1.2.0' } },
    });
  });

  it('initializes idempotently and supports an immediate committed cycle', async () => {
    const initInputs = [
      'operate',
      'init',
      '--profile',
      'engineering',
      '--decision-owner',
      'Product owner',
      '--planning-engine',
      'openplanr',
      '--runtime',
      'codex',
      '--cadence',
      'manual',
      '--timezone',
      'UTC',
      '--sensitivity-ceiling',
      'internal',
      '--source',
      'repository',
      '--source',
      'git',
      '--purpose',
      'Exercise the packed Operating Board lifecycle.',
      '--product-stage',
      'growth',
      '--business-model',
      'subscription SaaS',
      '--ideal-customer',
      'technical product teams',
      '--goal',
      'Produce reviewable operating decisions.',
      '--success-metric',
      'Time to a cited operating brief',
      '--guardrail',
      'Humans approve every mutation.',
      '--known-unknown',
      'Current activation baseline',
      '--json',
    ];
    const initialize = (): Record<string, unknown> => {
      const preview = jsonResult(fullCli, fullInstallRoot, [...initInputs, '--preview']);
      const action = (
        preview.actions as
          | Array<{ id?: string; command?: string; confirmationDigest?: string }>
          | undefined
      )?.find((entry) => entry.id === 'operate.init.apply');
      expect(action?.confirmationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(action?.command).toMatch(
        /^planr operate init --answers-token [A-Za-z0-9_-]+ --preview-created-at /,
      );
      const replayArguments = action?.command?.split(' ').slice(1) ?? [];
      return jsonResult(fullCli, fullInstallRoot, [
        ...replayArguments,
        '--confirm',
        action?.confirmationDigest as string,
        '--yes',
        '--json',
      ]);
    };
    expect(initialize()).toMatchObject({ ok: true, action: 'init' });
    const firstConfig = readFileSync(join(projectRoot, '.planr', 'operate', 'config.json'));
    expect(initialize()).toMatchObject({ ok: true, action: 'init' });
    expect(readFileSync(join(projectRoot, '.planr', 'operate', 'config.json'))).toEqual(
      firstConfig,
    );

    const priorStateRoot = process.env.OPENPLANR_STATE_ROOT;
    const priorPipelineRoot = process.env.OPENPLANR_PIPELINE_ROOT;
    process.env.OPENPLANR_STATE_ROOT = stateRoot;
    process.env.OPENPLANR_PIPELINE_ROOT = '';
    try {
      const { runOperatingCycle } = (await import(
        pathToFileURL(join(fullPackageRoot, 'dist', 'services', 'operate', 'engine.js')).href
      )) as {
        runOperatingCycle(input: Record<string, unknown>): Promise<{
          cycle: { id: string };
        }>;
      };
      const cycle = await runOperatingCycle({
        projectRoot,
        confirmed: true,
        now: new Date('2026-07-28T12:00:00.000Z'),
        adapter: {
          id: 'packed-fixture',
          mode: 'structured',
          toolIsolation: 'not-applicable',
          capability: 'analysis-high',
          async invoke(input: { roleId: string; evidence: { items: Array<{ id: string }> } }) {
            const evidenceRef = input.evidence.items[0]?.id;
            if (input.roleId !== 'technology-risk' || !evidenceRef) {
              return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
            }
            return {
              outcome: 'proposals',
              proposals: [
                {
                  proposalKey: 'packed-owner-route',
                  type: 'decision',
                  title: 'Choose the release owner',
                  problem: 'The release decision owner needs an explicit recorded choice.',
                  proposal: 'Record Product owner as the accountable release owner.',
                  impact: 3,
                  confidence: 3,
                  ease: 5,
                  severity: 'medium',
                  evidenceRefs: [evidenceRef],
                },
              ],
              gaps: [],
              conflicts: [],
            };
          },
        },
      });

      expect(
        jsonResult(fullCli, fullInstallRoot, ['operate', 'review', cycle.cycle.id, '--json']),
      ).toMatchObject({
        ok: true,
        action: 'review',
      });
      expect(
        jsonResult(fullCli, fullInstallRoot, [
          'operate',
          'report',
          cycle.cycle.id,
          '--lens',
          'CTO',
          '--json',
        ]),
      ).toMatchObject({
        ok: true,
        action: 'report',
        data: {
          cycleId: cycle.cycle.id,
          reports: [
            expect.objectContaining({
              roleId: 'technology-risk',
              label: 'CTO',
            }),
          ],
          actions: expect.any(Array),
        },
      });
    } finally {
      if (priorStateRoot === undefined) delete process.env.OPENPLANR_STATE_ROOT;
      else process.env.OPENPLANR_STATE_ROOT = priorStateRoot;
      if (priorPipelineRoot === undefined) delete process.env.OPENPLANR_PIPELINE_ROOT;
      else process.env.OPENPLANR_PIPELINE_ROOT = priorPipelineRoot;
    }
  }, 120_000);

  it('keeps accept, apply, decision, rollback, diagnostics, and doctor boundaries explicit', () => {
    const findings = jsonResult(fullCli, fullInstallRoot, ['operate', 'findings', 'list', '--json'])
      .data as Array<{ id: string }>;
    const findingId = findings[0]?.id;
    expect(findingId).toMatch(/^FND-/);
    const accepted = jsonResult(fullCli, fullInstallRoot, [
      'operate',
      'findings',
      'accept',
      findingId,
      '--reason',
      'Packed acceptance fixture.',
      '--yes',
      '--json',
    ]).data as { routeId: string; routePreviewDigest: string };
    const preview = jsonResult(fullCli, fullInstallRoot, [
      'operate',
      'routes',
      'apply',
      accepted.routeId,
      '--preview',
      '--json',
    ]).data as { previewDigest: string };
    expect(
      jsonResult(fullCli, fullInstallRoot, [
        'operate',
        'routes',
        'apply',
        accepted.routeId,
        '--preview-digest',
        preview.previewDigest,
        '--yes',
        '--json',
      ]),
    ).toMatchObject({
      ok: true,
      action: 'routes.apply',
    });

    const decisions = jsonResult(fullCli, fullInstallRoot, [
      'operate',
      'decisions',
      'list',
      '--json',
    ]).data as Array<{ id: string; status: string; options?: Array<{ id: string }> }>;
    const openDecision = decisions.find((decision) => decision.status === 'open');
    expect(openDecision).toBeDefined();
    expect(
      jsonResult(fullCli, fullInstallRoot, [
        'operate',
        'decisions',
        'decide',
        openDecision?.id as string,
        '--value',
        openDecision?.options?.[0]?.id ?? 'accept',
        '--reason',
        'Packed decision fixture.',
        '--yes',
        '--json',
      ]),
    ).toMatchObject({
      ok: true,
      action: 'decisions.decide',
    });

    expect(
      jsonResult(fullCli, fullInstallRoot, [
        'operate',
        'routes',
        'rollback',
        accepted.routeId,
        '--yes',
        '--json',
      ]),
    ).toMatchObject({
      ok: true,
      action: 'routes.rollback',
    });
    expect(
      jsonResult(fullCli, fullInstallRoot, [
        'operate',
        'diagnostics',
        'export',
        '--output',
        '.planr/operate/diagnostics.json',
        '--json',
      ]),
    ).toMatchObject({
      ok: true,
      action: 'diagnostics.export',
    });

    const doctor = run(fullCli, fullInstallRoot, ['doctor', '--json']);
    expect(doctor.status, doctor.stderr || doctor.stdout).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ ok: true });
  }, 120_000);
});
