import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');

function runPlanr(args: string[], cwd: string) {
  return spawnSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

let tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'planr-report-int-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('planr report integration', { timeout: 60000 }, () => {
  it('rejects pdf format with exit code 1', () => {
    const dir = makeTempDir();
    const init = runPlanr(['init', '--name', 'rp', '--no-ai'], dir);
    expect(init.status).toBe(0);

    const pdf = runPlanr(['report', 'weekly', '--format', 'pdf', '--no-github'], dir);
    expect(pdf.status).toBe(1);
    const out = `${pdf.stderr}\n${pdf.stdout}`;
    expect(out).toMatch(/PDF/i);
  });

  it('prints weekly markdown to stdout with --stdout', () => {
    const dir = makeTempDir();
    expect(runPlanr(['init', '--name', 'rp', '--no-ai'], dir).status).toBe(0);

    const r = runPlanr(['report', 'weekly', '--stdout', '--no-github'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/#/);
    expect(r.stdout.length).toBeGreaterThan(20);
  });

  it('writes report files under .planr/reports by default', () => {
    const dir = makeTempDir();
    expect(runPlanr(['init', '--name', 'rp', '--no-ai'], dir).status).toBe(0);

    const r = runPlanr(['report', 'weekly', '--no-github'], dir);
    expect(r.status).toBe(0);
    const reportsDir = join(dir, '.planr', 'reports');
    expect(existsSync(reportsDir)).toBe(true);
  });
});
