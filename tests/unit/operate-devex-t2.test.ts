import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderHuman } from '../../src/cli/commands/operate.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import type { OperateActionResult } from '../../src/services/operate/types.js';
import { display, logger } from '../../src/utils/logger.js';

const execFileAsync = promisify(execFile);
const cliEntry = resolve('src/cli/index.ts');
const repoOperateDir = resolve('.planr/operate');
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function gitProject(prefix: string): Promise<string> {
  const projectRoot = await temporaryDirectory(prefix);
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0', description: 'A fixture product' }, null, 2)}\n`,
  );
  await writeFile(join(projectRoot, 'README.md'), '# Fixture\n\nA fixture product.\n');
  await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the real CLI as a subprocess through the repo's tsx loader (so it exercises
 * current wiring without a stale build), capturing the exit code even when it is
 * non-zero. stdin is a closed pipe, so `isNonInteractive()` is true — the exact
 * non-TTY shape that silently no-opped.
 */
function runCli(projectDir: string, args: string[], stateRoot: string): CliRun {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', cliEntry, '--project-dir', projectDir, ...args],
      {
        encoding: 'utf8',
        input: '',
        env: { ...process.env, OPENPLANR_STATE_ROOT: stateRoot, NO_COLOR: '1' },
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
    };
  }
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// ── Defect A (FND-002) — `operate init` no longer silently no-ops ────────────
describe('FND-002 — non-TTY `operate init` is never a silent success', () => {
  it('prints actionable text mentioning --json and exits with the input-required code', async () => {
    const projectDir = await gitProject('openplanr-t2-init-');
    const stateRoot = await temporaryDirectory('openplanr-t2-init-state-');

    // The exact invocation that silently no-opped tonight.
    const run = runCli(projectDir, ['operate', 'init', '--yes'], stateRoot);

    expect(run.stdout.trim().length).toBeGreaterThan(0);
    expect(run.stdout).toContain('--json');
    // Input-required class (services/operate/index.ts `OPERATE_EXIT_CODES`), never
    // a spurious exit 0.
    expect(run.status).toBe(4);
  }, 30_000);

  it('keeps the machine `--json` handoff at exit 0 for a runtime to continue', async () => {
    const projectDir = await gitProject('openplanr-t2-init-json-');
    const stateRoot = await temporaryDirectory('openplanr-t2-init-json-state-');

    const run = runCli(projectDir, ['operate', 'init', '--json'], stateRoot);

    expect(run.status).toBe(0);
    const payload = JSON.parse(run.stdout.trim()) as {
      ok: boolean;
      flow?: string;
      code?: string;
    };
    expect(payload).toMatchObject({
      ok: true,
      flow: 'handoff',
      code: 'E_OPERATE_INPUT_REQUIRED',
    });
  }, 30_000);
});

// ── renderHuman generic last-resort branch (unit) ────────────────────────────
describe('renderHuman never renders an ok result as silent success', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseResult = {
    schemaVersion: '1.0.0' as const,
    protocolVersion: '1.2.0' as const,
    paths: {},
    counts: {},
    warnings: [],
    nextActions: [],
  };

  it('prints an actionable line for an ok payload of an unrecognized shape', () => {
    const lineSpy = vi.spyOn(display, 'line').mockImplementation(() => undefined);
    vi.spyOn(display, 'heading').mockImplementation(() => undefined);
    vi.spyOn(logger, 'success').mockImplementation(() => undefined);

    // No message, lines, data, preview, or next — the shape the renderer does not
    // otherwise surface.
    renderHuman({ ...baseResult, ok: true, action: 'mysteryShape' });

    expect(lineSpy).toHaveBeenCalled();
    const printed = lineSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed.trim().length).toBeGreaterThan(0);
    expect(printed).toContain('mysteryShape');
    expect(printed).toContain('--json');
  });

  it('surfaces a bare input_required handoff with a --json pointer', () => {
    const lineSpy = vi.spyOn(display, 'line').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    renderHuman({
      ...baseResult,
      ok: true,
      action: 'input_required',
      flow: 'handoff',
      code: 'E_OPERATE_INPUT_REQUIRED',
    } satisfies OperateActionResult);

    const printed = [
      ...warnSpy.mock.calls.map((call) => String(call[0])),
      ...lineSpy.mock.calls.map((call) => String(call[0])),
    ].join('\n');
    expect(printed.trim().length).toBeGreaterThan(0);
    expect(printed).toContain('--json');
  });
});

// ── Defect B (FND-001) — inspect points at the research-first path ───────────
describe('FND-001 — inspect points an uninitialized project at research-first', () => {
  it('names the research-first path in both the text hint and structured actions', async () => {
    const projectRoot = await gitProject('openplanr-t2-inspect-');
    const localRoot = await temporaryDirectory('openplanr-t2-inspect-state-');

    const result = await executeOperateAction({
      action: 'inspect',
      projectRoot,
      interactive: false,
      options: { json: true, localRoot },
    });

    expect((result.data as { initialized?: boolean }).initialized).toBe(false);
    // The text hint leads with the research-first entry, not the legacy cold
    // questionnaire.
    expect(result.nextActions).toEqual(['planr operate', 'planr operate context refresh']);
    expect(result.nextActions).not.toContain('planr operate init');
    // The structured actions are derived from the same commands, so they agree with
    // the text hint rather than telling a second, contradictory story.
    const commands = (result.actions ?? []).map((action) => action.command);
    expect(commands).toContain('planr operate');
    expect(commands).not.toContain('planr operate init');
  });
});

// ── Deliverable C — `operate report --html` ─────────────────────────────────
describe.skipIf(!existsSync(resolve('.planr/operate')))(
  'operate report --html renders a self-contained shareable board (CLI arm — needs a locally recorded cycle)',
  () => {
    let projectDir = '';
    let stateRoot = '';

    // The CLI arm needs a genuinely recorded operate cycle to render. That exists on a
    // dev machine after any real board run, but the repo's .planr/ is gitignored, so CI
    // has none — the original unconditional cpSync of repo state failed CI on first run
    // (works-on-my-machine, this batch's own defect class). The arm self-gates; the
    // rendering itself is covered unconditionally by the unit arm below it.
    const hasLocalCycle = existsSync(repoOperateDir);

    beforeAll(async () => {
      projectDir = await temporaryDirectory('openplanr-t2-html-');
      stateRoot = await temporaryDirectory('openplanr-t2-html-state-');
      if (hasLocalCycle) {
        await mkdir(join(projectDir, '.planr'), { recursive: true });
        cpSync(repoOperateDir, join(projectDir, '.planr', 'operate'), { recursive: true });
      }
    });

    it.skipIf(!existsSync(repoOperateDir))(
      'drives through the CLI to real table markup, zero remote attributes, and the open suggestion',
      async () => {
        const outPath = join(await temporaryDirectory('openplanr-t2-html-out-'), 'board.html');

        const run = runCli(
          projectDir,
          ['operate', 'report', 'CYCLE-001', '--html', '--out', outPath],
          stateRoot,
        );

        expect(run.status).toBe(0);
        // Human mode prints the path and the exact artifact-open follow-up.
        expect(run.stdout).toContain('planr artifact open');
        expect(run.stdout).toContain(outPath);
        expect(existsSync(outPath)).toBe(true);

        const html = readFileSync(outPath, 'utf8');
        // Real table markup, not a fenced pipe dump.
        expect(html).toMatch(/<table>/);
        expect(html).toMatch(/<th>/);
        expect(html).toMatch(/<td>/);
        // Self-contained shell.
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        // The artifact validator blocks remote hrefs in attributes: there must be zero
        // `src=`/`href=` pointing at a remote URL, and no anchor tags at all.
        expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
        expect(html).not.toMatch(/<a\s[^>]*href/i);
      },
      30_000,
    );

    it('returns { path, suggestedNext } on the --json surface', async () => {
      const outPath = join(await temporaryDirectory('openplanr-t2-html-json-'), 'board.html');

      const run = runCli(
        projectDir,
        ['operate', 'report', 'CYCLE-001', '--html', '--out', outPath, '--json'],
        stateRoot,
      );

      expect(run.status).toBe(0);
      const payload = JSON.parse(run.stdout.trim()) as {
        ok: boolean;
        data?: { path?: string; suggestedNext?: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.data?.path).toBe(outPath);
      expect(payload.data?.suggestedNext).toContain('planr artifact open');
    }, 30_000);
  },
);

// ── Docs — first-command guidance matches the shipped behaviour ──────────────
describe('report --html rendering (unit arm — runs everywhere, no cycle needed)', () => {
  // The CLI arm above self-gates on a locally recorded cycle; this arm keeps the
  // renderer itself covered unconditionally in CI with the same assertions the CLI
  // arm makes about the produced document.
  it('renders real table markup, keeps URLs as prose, and carries no remote attributes', async () => {
    const { renderOperatingReportHtml } = await import('../../src/services/operate/report-html.js');
    const html = renderOperatingReportHtml({
      title: 'CYCLE-FIXTURE',
      markdown: [
        '# Operating Brief',
        '',
        '| Lens | Outcome |',
        '| --- | --- |',
        '| CTO | actions |',
        '',
        'See https://example.com and run `open file://tmp/report.html` for details.',
        '',
        '```',
        'planr operate report CYCLE-001 --html',
        '```',
      ].join('\n'),
    });
    expect(html).toContain('<table');
    expect(html).toContain('<td>CTO</td>');
    // URLs survive as visible prose…
    expect(html).toContain('https://example.com');
    // …but never as fetchable attributes: the output must stay artifact-open-safe.
    expect(html).not.toMatch(/(?:src|href|srcset)\s*=\s*["'](?:https?:|file:|\/\/)/i);
  });
});

describe('docs steer the first command at the research-first path', () => {
  it('CLI.md and OPERATING_BOARD.md name research-first and the --html report', () => {
    const cli = readFileSync(resolve('docs/CLI.md'), 'utf8');
    const board = readFileSync(resolve('docs/OPERATING_BOARD.md'), 'utf8');

    expect(cli).toContain('research-first');
    expect(cli).toContain('planr operate context refresh');
    expect(cli).toContain('planr operate report [cycleId] --html');
    expect(board).toContain('research-first');
    expect(board).toContain('planr operate context refresh');
  });
});
