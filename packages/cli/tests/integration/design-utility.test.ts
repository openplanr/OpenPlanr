import { type ChildProcess, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const HELPER = resolve('../../skills/planr-design/scripts/design.mjs');
const pipelineRoot = resolvePipelinePackageRoot();
const cleanups: Array<() => unknown> = [];

type Run = { status: number | null; stdout: string; stderr: string };

function collect(child: ChildProcess) {
  return new Promise<Run>((done) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('close', (status) =>
      done({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}

function cliProcess(args: string[], cwd: string) {
  return spawn(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
    cwd: tmpdir(),
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const cli = (args: string[], cwd: string) => collect(cliProcess(args, cwd));

function helperProcess(args: string[], cwd: string) {
  return spawn(process.execPath, [HELPER, ...args], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function json(run: Run, status = 0) {
  expect(run.status, run.stderr || run.stdout).toBe(status);
  return JSON.parse(run.stdout.trim().split('\n').at(-1) as string) as Record<string, unknown>;
}

async function designProject() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-design-cli-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const { designFixture } = (await import(
    pathToFileURL(resolve('../design/tests/design-fixture.mjs')).href
  )) as { designFixture(root: string): { file: string } };
  return { dir, file: designFixture(dir).file };
}

/** Starts a long-running studio and resolves with its first JSON line. */
function started(child: ChildProcess) {
  const closed = collect(child);
  cleanups.push(async () => {
    child.kill('SIGTERM');
    await closed;
  });
  const session = new Promise<Record<string, unknown>>((done, fail) => {
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('\n')) done(JSON.parse(stdout.slice(0, stdout.indexOf('\n'))));
    });
    child.once('close', () => fail(new Error('Studio exited before startup')));
  });
  return { session, closed };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('openplanr design', { timeout: 120_000 }, () => {
  it('reports the design contract range of the installed workflow package', async () => {
    const { dir } = await designProject();
    const utility = (await import(
      pathToFileURL(join(pipelineRoot, 'lib/design/utility.mjs')).href
    )) as { DESIGN_UTILITY_CONTRACT: number; DESIGN_UTILITY_SUPPORTED: object };
    const pipeline = JSON.parse(readFileSync(join(pipelineRoot, 'package.json'), 'utf8'));
    expect(json(await cli(['design', 'capabilities', '--json'], dir))).toEqual({
      ok: true,
      contract: utility.DESIGN_UTILITY_CONTRACT,
      supported: utility.DESIGN_UTILITY_SUPPORTED,
      cli: expect.any(String),
      pipeline: pipeline.version,
    });
  });

  it('runs document commands from the project directory with the helper’s JSON', async () => {
    const { dir, file } = await designProject();
    const relative = 'design-document.json';
    const rendered = json(await cli(['design', 'render', relative, '--json'], dir));
    expect(rendered.revision).toMatch(/^[a-f0-9]{64}$/u);

    const inspected = json(await cli(['design', 'inspect', relative, '--json'], dir));
    expect(inspected).toEqual(json(await collect(helperProcess(['inspect', file], dir))));
    expect(json(await cli(['design', 'validate', relative, '--json'], dir))).toMatchObject({
      ok: true,
      verification: 'unverified',
    });
    expect(json(await cli(['design', 'view-context', relative, '--json'], dir))).toEqual(
      json(await collect(helperProcess(['view-context', file], dir))),
    );
    expect(json(await cli(['design', 'handoff', relative, '--json'], dir))).toEqual(
      json(await collect(helperProcess(['handoff', file, '--action', 'inspect'], dir))),
    );

    const exported = json(
      await cli(
        ['design', 'export', relative, '--format', 'html', '--output', 'out/view.html', '--json'],
        dir,
      ),
    );
    expect(exported).toMatchObject({ ok: true, output: join(dir, 'out/view.html') });
    expect(readFileSync(join(dir, 'out/view.html'), 'utf8')).toContain('<!doctype html>');
  });

  it('exits non-zero with the result when verification fails', async () => {
    const { dir, file } = await designProject();
    const { revision } = json(await cli(['design', 'render', file, '--json'], dir));
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ revision, status: 'failed' }));
    const failed = json(
      await cli(['design', 'verify', file, '--report', 'report.json', '--json'], dir),
      1,
    );
    expect(failed).toMatchObject({ status: 'failed', revision });
    expect(existsSync(join(dir, `.design/verification/${revision}.json`))).toBe(true);
  });

  it('reports utility failures with a stable code and keeps handoff read-only', async () => {
    const { dir, file } = await designProject();
    json(await cli(['design', 'render', file, '--json'], dir));
    expect(
      json(await cli(['design', 'export', file, '--format', 'png', '--json'], dir), 1),
    ).toMatchObject({ code: 'E_DESIGN_UTILITY_FAILED' });
    const fonts = [
      'design',
      'fonts',
      'fetch',
      '--family',
      'Inter:450',
      '--dest',
      'fonts',
      '--json',
    ];
    expect(json(await cli(fonts, dir), 1)).toMatchObject({
      code: 'E_DESIGN_UTILITY_FAILED',
      problem: expect.stringContaining('weight 450'),
    });
    const update = await cli(['design', 'handoff', file, '--action', 'approve', '--json'], dir);
    expect(update.status).toBe(1);
    expect(json(update, 1)).toMatchObject({ code: 'commander.invalidArgument' });
  });

  it('stops a studio another process started, from a second shell', async () => {
    const { dir, file } = await designProject();
    json(await collect(helperProcess(['render', file], dir)));
    const helper = started(helperProcess(['open', file, '--no-open'], dir));
    const helperSession = await helper.session;
    const running = json(await cli(['design', 'studio', 'status', file, '--json'], dir));
    expect(running).toMatchObject({ status: 'running', action: 'design_studio_status' });
    expect(json(await cli(['design', 'studio', 'stop', file, '--json'], dir))).toMatchObject({
      action: 'design_studio_stop',
      instanceId: running.instanceId,
    });
    await helper.closed;
    await expect(fetch(String(helperSession.url))).rejects.toThrow();

    const studio = started(cliProcess(['design', 'open', file, '--no-open', '--json'], dir));
    expect(await studio.session).toMatchObject({ url: expect.stringMatching(/^http:\/\/127/u) });
    expect(json(await cli(['design', 'studio', 'stop', file, '--json'], dir))).toMatchObject({
      action: 'design_studio_stop',
    });
    await studio.closed;
    expect(json(await cli(['design', 'studio', 'status', file, '--json'], dir))).toMatchObject({
      status: 'stopped',
    });
  });
});
