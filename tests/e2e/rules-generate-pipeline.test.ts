import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const run = (args: string, opts?: { cwd?: string }) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: 'utf-8',
    cwd: opts?.cwd,
    env: { ...process.env, NO_COLOR: '1' },
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

// `npx tsx` cold-start can take 5-7s on the first invocation; budget generously.
const TIMEOUT_MS = 25_000;

describe('planr init auto-generates pipeline rules by default', () => {
  it(
    'init --yes (non-interactive default) produces both agile + pipeline rules for cursor',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-init-default --no-ai --yes', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Agile rules (existing default)
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      // Pipeline rules (NEW default — closes the cross-runtime DX gap)
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'agents', 'frontend-agent.md'))).toBe(true);
      // CLAUDE.md gets the pipeline block + sibling reference card
      expect(existsSync(join(dir, 'planr-pipeline.md'))).toBe(true);
      // Codex AGENTS.md gets the pipeline orchestration section
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agents).toContain('Planr Pipeline Orchestration');
    },
    TIMEOUT_MS,
  );

  it(
    'init --no-pipeline-rules opts out, producing only agile rules',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-init-optout --no-ai --no-pipeline-rules --yes', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Agile rules still generated
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      // Pipeline rules NOT generated (explicit opt-out)
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(false);
      expect(existsSync(join(rulesRoot, 'agents'))).toBe(false);
      // No sibling Claude reference card
      expect(existsSync(join(dir, 'planr-pipeline.md'))).toBe(false);
      // Codex AGENTS.md has agile content but NOT the pipeline section
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agents).not.toContain('Planr Pipeline Orchestration');
    },
    TIMEOUT_MS,
  );
});

describe('rules generate --scope pipeline', () => {
  it(
    'cursor + scope=pipeline produces 3 .mdc rules + 8 agent body files',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-cursor --no-ai --yes', { cwd: dir });
      run('rules generate --target cursor --scope pipeline', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // 3 .mdc files
      for (const name of [
        'planr-pipeline.mdc',
        'planr-pipeline-plan.mdc',
        'planr-pipeline-ship.mdc',
      ]) {
        expect(existsSync(join(rulesRoot, name))).toBe(true);
      }
      // 8 agent body files
      for (const agent of [
        'db-agent',
        'designer-agent',
        'specification-agent',
        'frontend-agent',
        'backend-agent',
        'qa-agent',
        'devops-agent',
        'doc-gen-agent',
      ]) {
        expect(existsSync(join(rulesRoot, 'agents', `${agent}.md`))).toBe(true);
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
    'cursor + scope=all produces 6 agile + 3 pipeline + 8 agent files',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-cursor-all --no-ai --yes', { cwd: dir });
      run('rules generate --target cursor --scope all', { cwd: dir });

      const rulesRoot = join(dir, '.cursor', 'rules');
      // Spot-check both sets
      expect(existsSync(join(rulesRoot, 'agile-checklist.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'planr-pipeline.mdc'))).toBe(true);
      expect(existsSync(join(rulesRoot, 'agents', 'frontend-agent.md'))).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'codex + scope=pipeline produces a single AGENTS.md with pipeline section only',
    () => {
      const dir = makeTempDir();
      run('init --name pipe-codex --no-ai --yes', { cwd: dir });
      run('rules generate --target codex --scope pipeline', { cwd: dir });

      const agents = join(dir, 'AGENTS.md');
      expect(existsSync(agents)).toBe(true);
      const content = readFileSync(agents, 'utf-8');
      expect(content).toContain('Planr Pipeline Orchestration');
      // Agile section header should NOT be present (scope=pipeline)
      expect(content).not.toContain('Agent Instructions');
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
      expect(content).toContain('Planr Pipeline Orchestration');
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
      const master = readFileSync(join(rulesRoot, 'planr-pipeline.mdc'), 'utf-8');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal token under test
      expect(master).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      // Note: the vendored agent body files DO retain Claude-Code-specific
      // path tokens in their internal docs (intentional — the master rule
      // documents the substitution). The .mdc rule files are the user-facing
      // surface and must be free of those tokens.
    },
    TIMEOUT_MS,
  );
});
