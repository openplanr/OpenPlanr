import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const TSX_CLI = resolve('node_modules/tsx/dist/cli.mjs');
const run = (args: string, opts?: { cwd?: string; env?: Record<string, string> }) =>
  execFileSync(process.execPath, [TSX_CLI, CLI, ...args.trim().split(/\s+/)], {
    encoding: 'utf-8',
    cwd: opts?.cwd,
    env: { ...process.env, NO_COLOR: '1', ...opts?.env },
  });

let tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'planr-rules-pipeline-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// Keep a generous budget for real CLI work without relying on a shared npx cache.
const TIMEOUT_MS = 25_000;

describe('init and setup have separate responsibilities', () => {
  it(
    'init produces project planning context without installing pipeline adapters',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-init-default --no-ai --yes', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Agile rules (existing default)
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(false);
      expect(existsSync(join(rulesRoot, 'openplanr.mdc'))).toBe(false);
      expect(existsSync(join(dir, 'planr-pipeline.md'))).toBe(false);
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agents).not.toContain('OpenPlanr runtime policy');
    },
    TIMEOUT_MS,
  );

  it(
    'setup installs portable project adapters after init',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-init-setup --no-ai --yes', { cwd: dir });
      run('setup --runtime all --scope project --yes', {
        cwd: dir,
        env: { OPENPLANR_HOME: join(dir, '.test-home') },
      });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Agile rules still generated
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'openplanr.mdc'))).toBe(true);
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agents).toContain('OpenPlanr runtime policy');
      expect(existsSync(join(dir, '.planr', 'runtime-lock.json'))).toBe(true);
    },
    TIMEOUT_MS,
  );
});

describe('rules generate --scope pipeline', () => {
  it(
    'cursor + scope=pipeline produces a portable rule, aliases, and 9 role files',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-cursor --no-ai --yes', { cwd: dir });
      run('rules generate --target cursor --scope pipeline', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      expect(existsSync(join(rulesRoot, 'openplanr.mdc'))).toBe(true);
      // Three compatibility aliases remain for the deprecation window.
      for (const name of [
        'planr-pipeline.mdc',
        'planr-pipeline-plan.mdc',
        'planr-pipeline-ship.mdc',
      ]) {
        expect(existsSync(join(rulesRoot, name))).toBe(true);
      }
      // Nine portable role files come from the canonical registry.
      for (const agent of [
        'db-agent',
        'designer-agent',
        'specification-agent',
        'entity-scaffold-agent',
        'frontend-agent',
        'backend-agent',
        'qa-agent',
        'devops-agent',
        'doc-gen-agent',
      ]) {
        expect(existsSync(join(rulesRoot, 'openplanr-roles', `${agent}.md`))).toBe(true);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'cursor + scope=pipeline does NOT regenerate agile .mdc files',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-cursor-only --no-ai --yes', { cwd: dir });

      // `planr init` auto-generates the 6 agile rules. Delete them to verify
      // that `--scope pipeline` produces only pipeline files (not agile ones).
      const rulesRoot = join(dir, '.cursor', 'rules');
      for (const name of [
        'agile-checklist.mdc',
        'create-epic.mdc',
        'create-features.mdc',
        'create-user-story.mdc',
        'create-task-list.mdc',
        'implement-task-list.mdc',
      ]) {
        rmSync(join(rulesRoot, name), { force: true });
      }

      run('rules generate --target cursor --scope pipeline', { cwd: dir });

      // Pipeline scope must NOT recreate the agile files we just deleted.
      for (const name of ['agile-checklist.mdc', 'create-epic.mdc', 'create-features.mdc']) {
        expect(existsSync(join(rulesRoot, name))).toBe(false);
      }
      // ...and pipeline files must exist.
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'cursor + scope=all produces agile rules plus portable pipeline assets',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-cursor-all --no-ai --yes', { cwd: dir });
      run('rules generate --target cursor --scope all', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Spot-check both sets
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'openplanr-roles', 'frontend-agent.md'))).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'codex + scope=pipeline splices policy without deleting existing agile context',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-codex --no-ai --yes', { cwd: dir });
      run('rules generate --target codex --scope pipeline', { cwd: dir });

      const agents = join(dir, 'AGENTS.md');
      expect(existsSync(agents)).toBe(true);
      const content = readFileSync(agents, 'utf-8');
      expect(content).toContain('OpenPlanr runtime policy');
      expect(content).toContain('Agent Instructions');
      expect(content).toContain('##planr-agile:begin##');
      expect(content).toContain('##planr-pipeline:begin##');
    },
    TIMEOUT_MS,
  );

  it(
    'codex + scope=all produces a single AGENTS.md with BOTH sections',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-codex-all --no-ai --yes', { cwd: dir });
      run('rules generate --target codex --scope all', { cwd: dir });

      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('Agent Instructions');
      expect(content).toContain('OpenPlanr runtime policy');
    },
    TIMEOUT_MS,
  );

  it(
    'claude + scope=pipeline produces CLAUDE.md (with pipeline block) + sibling planr-pipeline.md',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-claude --no-ai --yes', { cwd: dir });
      run('rules generate --target claude --scope pipeline', { cwd: dir });

      const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
      const ref = join(dir, 'planr-pipeline.md');
      expect(claude).toContain('Planr Pipeline (Path A)');
      expect(existsSync(ref)).toBe(true);
      const refContent = readFileSync(ref, 'utf-8');
      expect(refContent).toContain('/planr-pipeline:plan');
      expect(refContent).toContain('/planr-pipeline:ship');
    },
    TIMEOUT_MS,
  );

  it(
    'claude + scope=agile produces only CLAUDE.md (no sibling pipeline reference card)',
    () => {
      const dir = makeTempDir();
      // Use --no-pipeline-rules so init produces a clean agile-only baseline.
      // Without this, init's default-on auto-gen would write the sibling card pre-test.
      run('init --name pipe-claude-agile --no-ai --no-pipeline-rules --yes', { cwd: dir });
      run('rules generate --target claude --scope agile', { cwd: dir });

      expect(existsSync(join(dir, 'planr-pipeline.md'))).toBe(false);
      const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
      // The {{#if pipelineScope}} block must NOT render in agile scope
      expect(claude).not.toContain('Planr Pipeline (Path A)');
    },
    TIMEOUT_MS,
  );

  it(
    'invalid --scope value exits with non-zero',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-invalid --no-ai --yes', { cwd: dir });
      let threw = false;
      try {
        run('rules generate --target cursor --scope bogus', { cwd: dir });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal token under test
    'no ${CLAUDE_PLUGIN_ROOT} substitution leaks into Cursor rule files (anti-leak)',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-noleak --no-ai --yes', { cwd: dir });
      run('rules generate --target cursor --scope pipeline', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Spot-check the master rule
      const master = readFileSync(join(rulesRoot, 'openplanr.mdc'), 'utf-8');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal token under test
      expect(master).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      for (const path of [
        join(rulesRoot, 'openplanr-roles', 'frontend-agent.md'),
        join(rulesRoot, 'openplanr-roles', 'backend-agent.md'),
      ]) {
        const content = readFileSync(path, 'utf8');
        expect(content).not.toMatch(/CLAUDE_PLUGIN_ROOT|Sonnet|Opus|\/planr-pipeline:/);
      }
    },
    TIMEOUT_MS,
  );
});
