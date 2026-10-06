import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

function runPlanr(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, NO_COLOR: '1', ...env },
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
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  tempDirs = [];
});

describe('openplanr report integration', { timeout: 60000 }, () => {
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

  it('rejects a removed --push slack target before writing or pushing anything', () => {
    const dir = makeTempDir();
    expect(runPlanr(['init', '--name', 'rp', '--no-ai'], dir).status).toBe(0);
    const bin = makeTempDir();
    const marker = join(bin, 'gh-calls');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> "${marker}"\nexit 1\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}` };
    for (const targets of ['slack', 'github,slack']) {
      const r = runPlanr(['report', 'weekly', '--no-github', '--push', targets], dir, env);
      expect(r.status).toBe(1);
      expect(`${r.stderr}\n${r.stdout}`).toMatch(/--push slack was removed in this version/);
    }
    expect(existsSync(join(dir, '.planr', 'reports'))).toBe(false);
    expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('');
  });

  it('loads a config that still lists the removed Slack settings', () => {
    const dir = makeTempDir();
    expect(runPlanr(['init', '--name', 'rp', '--no-ai'], dir).status).toBe(0);
    const configPath = join(dir, '.planr', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.distribution = {
      slackWebhookUrl: 'https://hooks.example.invalid/services/fixture',
      slackChannel: '#fixture',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const r = runPlanr(['report', 'weekly', '--stdout', '--no-github'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/#/);
  });
});
