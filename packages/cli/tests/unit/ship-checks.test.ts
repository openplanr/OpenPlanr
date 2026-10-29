import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import { registerShipCommand } from '../../src/cli/commands/ship.js';
import type { ShipCheck, ShipChecksResult } from '../../src/services/ship-checks/contract.js';
import { discoverShipChecks } from '../../src/services/ship-checks/discover.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Files = Record<string, string>;

function git(root: string, ...args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, stdio: 'ignore' },
  );
}

function write(root: string, files: Files): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
}

/** A git repository on `main` holding `base` in one commit, with `change` left in the working tree. */
function fixture(base: Files, change: Files = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'planr-ship-checks-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  write(root, base);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  write(root, change);
  return root;
}

const byCommand = (result: ShipChecksResult, command: string): ShipCheck | undefined =>
  result.checks.find((check) => check.command === command);

const manifest = (scripts: Record<string, string>) =>
  JSON.stringify({ name: 'fixture', scripts }, null, 2);

const CI = `name: CI
on:
  pull_request:
  merge_group:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Build
        run: npm run build
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Lint
        run: npm run lint
      - name: Lint and fix
        run: npm run lint -- --fix
      - name: Migrations match the schema
        if: \${{ !cancelled() }}
        run: |
          npm run db:generate
          git diff --exit-code -- migrations
  suites:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        script: [test:unit, test:e2e]
    steps:
      - run: npm run \${{ matrix.script }}
      - run: echo "\${{ github.sha }}"
`;

const CI_BASE: Files = {
  '.github/workflows/ci.yml': CI,
  'package.json': manifest({
    build: 'tsc -p .',
    lint: 'biome check .',
    'db:generate': 'node scripts/generate.mjs',
    'test:unit': 'vitest run',
    'test:e2e': 'playwright test',
  }),
  'src/index.ts': 'export const value = 1;\n',
};

describe('openplanr ship checks discovery', () => {
  it('returns the versioned contract and identical bytes for the same state', async () => {
    const root = fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' });
    const first = await discoverShipChecks({ projectDir: root, tier: 'story' });
    const second = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(first).toMatchObject({
      kind: 'openplanr-ship-checks',
      schemaVersion: '1.1.0',
      complete: true,
      tier: 'story',
      tierSource: 'flag',
      base: { ref: 'main' },
      task: null,
      changed: { planningOnly: false, files: [{ path: 'src/index.ts', status: 'modified' }] },
    });
    expect(Object.keys(first)).toEqual([
      'kind',
      'schemaVersion',
      'complete',
      'projectRoot',
      'tier',
      'tierSource',
      'base',
      'task',
      'changed',
      'checks',
      'requirements',
      'acceptance',
      'relatedTests',
      'coverage',
      'diagnostics',
    ]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps a multi-line run step verbatim as one entry with its origin', async () => {
    const root = fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' });
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    const step = byCommand(result, 'npm run db:generate\ngit diff --exit-code -- migrations');
    expect(step).toMatchObject({
      cwd: '.',
      tags: ['ci', 'multi-line', 'conditional'],
      condition: '${{ !cancelled() }}',
      sources: [
        {
          kind: 'ci',
          file: '.github/workflows/ci.yml',
          line: 22,
          job: 'quality',
          step: 'Migrations match the schema',
        },
      ],
    });
    expect(result.checks.some((check) => check.command === 'npm ci')).toBe(false);
  });

  it('merges a step that only calls a package script with that script, but not one with arguments', async () => {
    const root = fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' });
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    const lint = byCommand(result, 'npm run lint');
    expect(lint?.script).toEqual({ name: 'lint', workspace: null });
    expect(lint?.tags).toEqual(['ci', 'package-script', 'fallback']);
    expect(lint?.sources.map((source) => source.kind)).toEqual(['ci', 'package']);
    expect(byCommand(result, 'npm run lint -- --fix')?.tags).toEqual(['ci']);
  });

  it('expands a static matrix and flags other expressions for review', async () => {
    const root = fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' });
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(byCommand(result, 'npm run test:unit')?.id).toBe('ci:ci.yml:suites:1[script=test:unit]');
    expect(byCommand(result, 'npm run test:e2e')?.id).toBe('ci:ci.yml:suites:1[script=test:e2e]');
    expect(byCommand(result, 'echo "${{ github.sha }}"')?.tags).toContain('needs-review');
  });

  it('lists the CI build first, and in the task tier only when build inputs change', async () => {
    const story = await discoverShipChecks({
      projectDir: fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' }),
      tier: 'story',
    });
    expect(story.checks[0]).toMatchObject({
      command: 'npm run build',
      tags: ['ci', 'package-script', 'build'],
    });

    const source = await discoverShipChecks({
      projectDir: fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' }),
      tier: 'task',
    });
    expect(byCommand(source, 'npm run build')).toBeUndefined();

    const tsconfig = await discoverShipChecks({
      projectDir: fixture(CI_BASE, { 'tsconfig.json': '{}\n' }),
      tier: 'task',
    });
    expect(tsconfig.checks[0]?.command).toBe('npm run build');

    const exportsChange = await discoverShipChecks({
      projectDir: fixture(CI_BASE, {
        'package.json': JSON.stringify({
          ...JSON.parse(CI_BASE['package.json'] ?? '{}'),
          exports: './dist/index.js',
        }),
      }),
      tier: 'task',
    });
    expect(exportsChange.checks[0]?.command).toBe('npm run build');
  });

  it('sets the working directory from step, job and workflow defaults in that order', async () => {
    const root = fixture(
      {
        '.github/workflows/ci.yml': `on: pull_request
defaults:
  run:
    working-directory: app
jobs:
  inherit:
    runs-on: x
    steps:
      - run: npm test
  job:
    runs-on: x
    defaults:
      run:
        working-directory: ./packages/core/
    steps:
      - run: npm test
      - working-directory: db
        run: npm test
`,
        'src/a.ts': 'export {};\n',
      },
      { 'src/a.ts': 'export const a = 1;\n' },
    );
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(result.checks.map((check) => [check.id, check.cwd])).toEqual([
      ['ci:ci.yml:inherit:1', 'app'],
      ['ci:ci.yml:job:1', 'packages/core'],
      ['ci:ci.yml:job:2', 'db'],
    ]);
  });

  it('applies pull-request path filters in the story tier and not in the push tier', async () => {
    const root = fixture(
      {
        '.github/workflows/docs.yml': `on:
  pull_request:
    paths: ['docs/**']
jobs:
  docs:
    runs-on: x
    steps:
      - run: node scripts/check-docs.mjs
`,
        '.github/workflows/nightly.yml': `on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  nightly:
    runs-on: x
    steps:
      - run: node scripts/nightly.mjs
`,
        'src/a.ts': 'export {};\n',
      },
      { 'src/a.ts': 'export const a = 1;\n' },
    );
    const story = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(byCommand(story, 'node scripts/check-docs.mjs')).toBeUndefined();
    const push = await discoverShipChecks({ projectDir: root, tier: 'push' });
    expect(byCommand(push, 'node scripts/check-docs.mjs')).toBeDefined();
    expect(byCommand(push, 'node scripts/nightly.mjs')).toBeUndefined();
    expect(push.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'WORKFLOW_NOT_IN_TIER',
        path: '.github/workflows/nightly.yml',
      }),
    );
  });

  it('reads Test Requirements into checks, prose requirements and acceptance IDs', async () => {
    const task = `# T-001

## Test Requirements

- AC-001: the parser rejects an empty file.
- \`vitest run src/parser.test.ts\`
- \`tsc --noEmit -p tsconfig.test.json\` (AC-002)
- fixturectl verify --strict

## Definition of Done
- \`npm run never-listed\`
`;
    const root = fixture(
      {
        '.gitignore': 'node_modules/\n',
        'node_modules/.bin/fixturectl': '#!/bin/sh\n',
        'tasks/T-001.md': task,
        'src/a.ts': 'export {};\n',
      },
      { 'src/a.ts': 'export const a = 1;\n' },
    );
    const result = await discoverShipChecks({ projectDir: root, task: 'tasks/T-001.md' });
    expect(result.task).toEqual({ path: 'tasks/T-001.md' });
    expect(
      result.checks
        .filter((check) => check.tags.includes('task'))
        .map((check) => [check.command, check.acceptanceIds]),
    ).toEqual([
      ['vitest run src/parser.test.ts', []],
      ['tsc --noEmit -p tsconfig.test.json', ['AC-002']],
      ['fixturectl verify --strict', []],
    ]);
    expect(result.requirements).toEqual([
      {
        kind: 'prose',
        text: 'AC-001: the parser rejects an empty file.',
        acceptanceIds: ['AC-001'],
      },
    ]);
    expect(result.acceptance).toEqual(['AC-001', 'AC-002']);
    expect(byCommand(result, 'npm run never-listed')).toBeUndefined();
  });

  it('lists existing tests that mention a name the change exports', async () => {
    const root = fixture(
      {
        'src/widget.ts': 'export const other = 1;\n',
        'tests/widget.test.ts': "import { parseWidget } from '../src/widget';\n",
        'tests/unrelated.test.ts': 'const parseWidgetry = 1;\n',
      },
      { 'src/widget.ts': 'export const other = 1;\nexport function parseWidget() {}\n' },
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.relatedTests).toEqual([
      { name: 'parseWidget', kind: 'export', files: ['tests/widget.test.ts'] },
    ]);
  });

  it('selects the planning tier for a .planr-only change', async () => {
    const root = fixture(
      {
        '.planr/specs/SPEC-001-x/SPEC-001-x.md': '# x\n',
        '.github/workflows/ci.yml': CI,
        'package.json': CI_BASE['package.json'] ?? '',
      },
      { '.planr/specs/SPEC-001-x/SPEC-001-x.md': '# x, edited\n' },
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result).toMatchObject({
      tier: 'planning',
      tierSource: 'auto',
      changed: { planningOnly: true },
    });
    expect(result.checks.map((check) => [check.command, check.tags])).toEqual([
      ['openplanr spec sync --dry-run', ['planning', 'report-only']],
      ['openplanr sync --dry-run', ['planning', 'report-only']],
    ]);
    const story = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(byCommand(story, 'openplanr sync --dry-run')).toBeDefined();
    expect(story.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'PLANNING_ONLY_CHANGE' }),
    );
  });

  it('reads husky hooks as shell and marks tracked-only checks', async () => {
    const root = fixture(
      {
        '.husky/pre-commit':
          '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\n# staged files only\nnpx lint-staged\nnpm run \\\n  typecheck\n',
        '.husky/pre-push': 'npm test\n',
        '.lintstagedrc.json': '{ "*.ts": "biome check --write" }\n',
        'scripts/check-paths.mjs': "execFileSync('git', ['ls-files', '-z']);\n",
        'package.json': manifest({
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          'check:paths': 'node scripts/check-paths.mjs',
        }),
        '.github/workflows/ci.yml':
          'on: pull_request\njobs:\n  paths:\n    runs-on: x\n    steps:\n      - run: npm run check:paths\n',
        'src/a.ts': 'export {};\n',
      },
      { 'src/a.ts': 'export const a = 1;\n' },
    );
    const task = await discoverShipChecks({ projectDir: root, tier: 'task' });
    const hooks = task.checks.filter((check) => check.tags.includes('hook'));
    expect(hooks.map((check) => [check.command, check.sources[0]?.line])).toEqual([
      ['npx lint-staged', 5],
      ['npm run typecheck', 6],
    ]);
    expect(byCommand(task, 'npx lint-staged')).toMatchObject({
      scope: 'tracked-only',
      scopeReason: expect.stringContaining('lint-staged'),
    });
    expect(byCommand(task, 'npm test')).toBeUndefined();

    const push = await discoverShipChecks({ projectDir: root, tier: 'push' });
    expect(byCommand(push, 'npm test')?.sources[0]).toMatchObject({
      kind: 'hook',
      hook: 'pre-push',
    });
    expect(byCommand(push, 'npm run check:paths')).toMatchObject({
      scope: 'tracked-only',
      scopeReason: expect.stringContaining('scripts/check-paths.mjs'),
    });
    expect(byCommand(push, 'npm run typecheck')?.scope).toBe('worktree');
  });

  it('reports an invalid workflow as an error and marks the result incomplete', async () => {
    const root = fixture(
      {
        '.github/workflows/broken.yml': 'on: pull_request\njobs: [\n',
        '.github/workflows/ok.yml':
          'on: pull_request\njobs:\n  ok:\n    runs-on: x\n    steps:\n      - run: node check.mjs\n',
        'src/a.ts': 'export {};\n',
      },
      { 'src/a.ts': 'export const a = 1;\n' },
    );
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'WORKFLOW_INVALID',
        severity: 'error',
        path: '.github/workflows/broken.yml',
      }),
    );
    expect(byCommand(result, 'node check.mjs')).toBeDefined();
  });

  it('rejects a missing task file', async () => {
    const root = fixture({ 'src/a.ts': 'export {};\n' });
    await expect(
      discoverShipChecks({ projectDir: root, task: 'missing.md' }),
    ).rejects.toMatchObject({
      code: 'E_SHIP_CHECKS_TASK_NOT_FOUND',
    });
  });

  it("lists every non-install run step of this repository's CI workflow in the push tier", async () => {
    const repository = fileURLToPath(new URL('../../../../', import.meta.url));
    const workflow = '.github/workflows/ci.yml';
    const document = parseDocument(readFileSync(join(repository, workflow), 'utf8')).toJS() as {
      jobs: Record<string, { steps?: { run?: string }[] }>;
    };
    const expected = Object.values(document.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => typeof step.run === 'string' && step.run.trim() !== 'npm ci').length;
    const result = await discoverShipChecks({ projectDir: repository, tier: 'push' });
    const steps = new Set(
      result.checks.flatMap((check) =>
        check.sources
          .filter((source) => source.file === workflow)
          .map((source) => `${source.job}:${source.line}`),
      ),
    );
    expect(steps.size).toBe(expected);
  });
});

const codes = (result: ShipChecksResult): string[] => result.diagnostics.map(({ code }) => code);

const LINT_STAGED: Files = {
  '.husky/pre-commit': 'npx lint-staged\n',
  'src/index.ts': 'export const value = 1;\n',
};

/** Links the workspace's own TypeScript into a fixture so the project resolves it. */
function withTypeScript(root: string): string {
  const source = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(source, join(root, 'node_modules/typescript'), 'dir');
  return root;
}

const TS_BASE: Files = {
  '.gitignore': 'node_modules\n',
  'tsconfig.json': JSON.stringify({ include: ['src'] }),
  'src/index.ts': 'export const value = 1;\n',
};

describe('openplanr ship checks coverage', () => {
  it('names untracked files that tracked-only checks cannot see', async () => {
    const root = fixture(LINT_STAGED, { 'src/new.ts': 'export {};\n' });
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.trackedOnly).toEqual({
      checks: ['hook:pre-commit:1'],
      unseen: ['src/new.ts'],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'UNTRACKED_NOT_SEEN',
        severity: 'warning',
        message: expect.stringMatching(/src\/new\.ts.*git add -N/u),
      }),
    );
  });

  it('stops reporting a new file once it is staged or marked intent-to-add', async () => {
    for (const args of [['add'], ['add', '-N']]) {
      const root = fixture(LINT_STAGED, { 'src/new.ts': 'export {};\n' });
      git(root, ...args, 'src/new.ts');
      const result = await discoverShipChecks({ projectDir: root });
      expect(result.coverage.trackedOnly.unseen).toEqual([]);
      expect(codes(result)).not.toContain('UNTRACKED_NOT_SEEN');
    }
  });

  it('reports nothing unseen when no check is tracked-only', async () => {
    const root = fixture(CI_BASE, { 'src/new.ts': 'export {};\n' });
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(result.coverage.trackedOnly).toEqual({ checks: [], unseen: [] });
    expect(codes(result)).not.toContain('UNTRACKED_NOT_SEEN');
  });

  it('follows a script file one level deep to find a tracked-only check', async () => {
    const root = fixture(
      {
        '.github/workflows/ci.yml':
          'on: pull_request\njobs:\n  paths:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run check:paths\n',
        'package.json': manifest({ 'check:paths': 'node scripts/paths.mjs' }),
        'scripts/paths.mjs': "execFileSync('git', ['ls-files']);\n",
      },
      { 'docs/new.md': '# New\n' },
    );
    const result = await discoverShipChecks({ projectDir: root, tier: 'story' });
    expect(result.coverage.trackedOnly.unseen).toEqual(['docs/new.md']);
    expect(result.coverage.trackedOnly.checks).toHaveLength(1);
  });

  it('lists new TypeScript files that no tsconfig includes', async () => {
    const root = withTypeScript(
      fixture(TS_BASE, { 'src/b.ts': 'export {};\n', 'tests/a.test.ts': 'export {};\n' }),
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript).toEqual({
      tsconfigs: ['tsconfig.json'],
      uncovered: ['tests/a.test.ts'],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TS_NOT_COVERED',
        severity: 'warning',
        message: expect.stringContaining('tests/a.test.ts'),
      }),
    );
  });

  it('lists a staged new TypeScript file that no tsconfig includes', async () => {
    const root = withTypeScript(fixture(TS_BASE, { 'tests/a.test.ts': 'export {};\n' }));
    git(root, 'add', 'tests/a.test.ts');
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.changed.files).toContainEqual({ path: 'tests/a.test.ts', status: 'added' });
    expect(result.coverage.typescript?.uncovered).toEqual(['tests/a.test.ts']);
  });

  it('reports a broken extends and does not count its fallback files as covered', async () => {
    const root = withTypeScript(
      fixture(
        {
          '.gitignore': 'node_modules\n',
          'tsconfig.base.json': JSON.stringify({ include: ['src'] }),
          'tsconfig.json': JSON.stringify({ extends: './tsconfig.bse.json' }),
          'src/index.ts': 'export const value = 1;\n',
        },
        { 'tests/a.test.ts': 'export {};\n' },
      ),
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript?.uncovered).toEqual(['tests/a.test.ts']);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TSCONFIG_ERROR',
        severity: 'warning',
        path: 'tsconfig.json',
        message: expect.stringContaining('tsconfig.bse.json'),
      }),
    );
  });

  it('warns about a tsconfig that is not valid JSON', async () => {
    const root = withTypeScript(
      fixture(
        { ...TS_BASE, 'tsconfig.test.json': '{\n  "include": [\n' },
        { 'src/b.ts': 'export {};\n' },
      ),
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TSCONFIG_UNREADABLE',
        severity: 'warning',
        path: 'tsconfig.test.json',
      }),
    );
    expect(result.coverage.typescript?.uncovered).toEqual([]);
  });

  it('matches files that a tsconfig reaches through a symlinked directory', async () => {
    const root = withTypeScript(fixture(TS_BASE, { 'real/n.ts': 'export {};\n' }));
    symlinkSync('../real', join(root, 'src/linked'), 'dir');
    git(root, 'add', 'src/linked');
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript?.uncovered).toEqual([]);
  });

  it('counts files reached through extends, files and project references', async () => {
    const root = withTypeScript(
      fixture(
        {
          '.gitignore': 'node_modules\n',
          'tsconfig.base.json':
            '{\n  // shared options\n  "compilerOptions": { "strict": true },\n  "include": ["src"],\n}\n',
          'tsconfig.json': JSON.stringify({
            extends: './tsconfig.base.json',
            files: ['scripts/tool.ts'],
            references: [{ path: './config/test.json' }],
          }),
          'config/test.json': JSON.stringify({ include: ['../tests'] }),
          'scripts/tool.ts': 'export {};\n',
        },
        { 'tests/a.test.ts': 'export {};\n', '.planr/tool.ts': 'export {};\n' },
      ),
    );
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript?.uncovered).toEqual([]);
    expect(codes(result)).not.toContain('TS_NOT_COVERED');
  });

  it('skips the tsconfig scan when the change adds no TypeScript file', async () => {
    const root = withTypeScript(fixture(TS_BASE, { 'src/index.ts': 'export const value = 2;\n' }));
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript).toEqual({ tsconfigs: [], uncovered: [] });
  });

  it('returns null TypeScript coverage when the project cannot resolve typescript', async () => {
    const root = fixture(TS_BASE, { 'src/b.ts': 'export {};\n' });
    const result = await discoverShipChecks({ projectDir: root });
    expect(result.coverage.typescript).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TYPESCRIPT_UNAVAILABLE', severity: 'info' }),
    );
  });
});

describe('openplanr ship checks command', () => {
  async function run(args: string[]): Promise<{ output: string; exitCode: number | undefined }> {
    const program = new Command().exitOverride().option('--project-dir <path>');
    registerShipCommand(program);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      lines.push(values.map(String).join(' '));
    });
    const previous = process.exitCode;
    process.exitCode = undefined;
    try {
      await program.parseAsync(['node', 'openplanr', ...args]);
      return { output: lines.join('\n'), exitCode: process.exitCode as number | undefined };
    } finally {
      spy.mockRestore();
      process.exitCode = previous;
    }
  }

  it('prints the JSON result', async () => {
    const root = fixture(CI_BASE, { 'src/index.ts': 'export const value = 2;\n' });
    const { output, exitCode } = await run([
      '--project-dir',
      root,
      'ship',
      'checks',
      '--tier',
      'story',
      '--json',
    ]);
    expect(exitCode).toBeUndefined();
    expect(JSON.parse(output)).toMatchObject({ kind: 'openplanr-ship-checks', tier: 'story' });
  });

  it('exits 1 with a failure envelope for an unknown tier or a missing task', async () => {
    const root = fixture({ 'src/a.ts': 'export {};\n' });
    const tier = await run([
      '--project-dir',
      root,
      'ship',
      'checks',
      '--tier',
      'nightly',
      '--json',
    ]);
    expect(tier.exitCode).toBe(1);
    expect(JSON.parse(tier.output)).toMatchObject({
      ok: false,
      code: 'E_SHIP_CHECKS_TIER_INVALID',
    });
    const task = await run([
      '--project-dir',
      root,
      'ship',
      'checks',
      '--task',
      'nope.md',
      '--json',
    ]);
    expect(task.exitCode).toBe(1);
    expect(JSON.parse(task.output)).toMatchObject({
      ok: false,
      code: 'E_SHIP_CHECKS_TASK_NOT_FOUND',
    });
  });
});
