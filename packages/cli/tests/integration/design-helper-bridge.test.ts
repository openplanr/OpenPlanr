import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HELPER = resolve('../../skills/planr-design/scripts/design.mjs');
const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const pipelineRoot = resolvePipelinePackageRoot();
const cleanups: Array<() => unknown> = [];

type Run = { status: number | null; stdout: string; stderr: string };

interface FakeHost {
  state: {
    events: Array<Record<string, unknown>>;
    requests: Array<{ url: string; init: { method?: string; headers?: Record<string, string> } }>;
  };
  listen(): Promise<{ baseUrl: string; close(): Promise<void> }>;
}

async function load<T>(relative: string): Promise<T> {
  return (await import(pathToFileURL(resolve(relative)).href)) as T;
}

function helper(args: string[], env: Record<string, string>, cwd: string) {
  return new Promise<Run>((resolveRun) => {
    const child = spawn(process.execPath, [HELPER, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('close', (status) =>
      resolveRun({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}

function json(run: Run) {
  expect(run.status, run.stderr || run.stdout).toBe(0);
  return JSON.parse(run.stdout.trim().split('\n').at(-1) as string) as Record<string, unknown>;
}

async function project(cli: boolean | string) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-helper-bridge-')));
  cleanups.push(() => rmSync(outer, { recursive: true, force: true }));
  const { designFixture } = await load<{ designFixture(root: string): { file: string } }>(
    '../design/tests/design-fixture.mjs',
  );
  const { createFakeShareHost } = await load<{ createFakeShareHost(): FakeHost }>(
    '../design/tests/fake-share-host.mjs',
  );
  const dir = join(outer, 'project');
  const { file } = designFixture(dir);
  const host = createFakeShareHost();
  const server = await host.listen();
  cleanups.push(() => server.close());
  const bin = join(outer, 'bin');
  mkdirSync(bin);
  if (cli) {
    // The real CLI from source, reachable as `openplanr` the way a global install would be.
    writeFileSync(
      join(bin, 'openplanr'),
      typeof cli === 'string'
        ? cli
        : `#!/bin/sh\nexec "${process.execPath}" "${TSX}" "${CLI}" "$@"\n`,
    );
    chmodSync(join(bin, 'openplanr'), 0o755);
  }
  const home = join(outer, 'private');
  // Only this bin is searched for node and openplanr, so an installed global CLI cannot answer.
  symlinkSync(process.execPath, join(bin, 'node'));
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: outer,
    NO_COLOR: '1',
    PLANR_HOME: home,
    OPENPLANR_SHARE_BASE: server.baseUrl,
    OPENPLANR_PIPELINE_ROOT: pipelineRoot,
  };
  json(await helper(['render', file], env, dir));
  return { dir, file, host, home, env, bin };
}

/** Every file under a directory with its bytes, to show that nothing was written. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[path] = readFileSync(path, 'base64');
    }
  return files;
}

async function openStudio(file: string, env: Record<string, string>, dir: string) {
  const studio = spawn(process.execPath, [HELPER, 'open', file, '--no-open', '--port', '0'], {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(
    () =>
      new Promise((resolveExit) => {
        studio.once('exit', resolveExit);
        studio.kill('SIGTERM');
      }),
  );
  const opened = await new Promise<{ url: string }>((resolveOpen, rejectOpen) => {
    let text = '';
    studio.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const line = text.split('\n').find((value) => value.trim().startsWith('{'));
      if (line) resolveOpen(JSON.parse(line));
    });
    studio.once('exit', (code) => rejectOpen(new Error(`studio exited with ${code}`)));
  });
  const page = await fetch(opened.url);
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { url: opened.url, cookie };
}

async function timed(request: Promise<Response>) {
  const started = performance.now();
  const response = await request;
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body, ms: performance.now() - started };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('the bundled design helper shares only through the openplanr CLI', {
  timeout: 180_000,
}, () => {
  it('shares, syncs and publishes owner decisions through the CLI', async () => {
    const { dir, file, host, home, env, bin } = await project(true);
    const shared = json(await helper(['share', file], env, dir));
    expect(String(shared.url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/d\//);
    const custodyDir = join(home, 'design-shares');
    const record = JSON.parse(
      readFileSync(
        join(custodyDir, readdirSync(custodyDir).find((name) => name.endsWith('.json')) as string),
        'utf8',
      ),
    ).custody;

    const { decryptWorkspaceRevision, prepareWorkspaceEvent } = await load<{
      decryptWorkspaceRevision(
        access: unknown,
        revision: string,
        options: unknown,
      ): Promise<{ reviewOf: string; envelope: { artifacts: Array<Record<string, unknown>> } }>;
      prepareWorkspaceEvent(
        access: unknown,
        event: unknown,
        options: unknown,
      ): Promise<Record<string, unknown>>;
    }>('../design/lib/design/workspace-client.mjs');
    const bundle = await decryptWorkspaceRevision(record, record.currentRevision, {
      fetchImpl: fetch,
    });
    const date = '2026-11-05T10:00:00.000Z';
    const artifact = bundle.envelope.artifacts[0];
    const event = await prepareWorkspaceEvent(
      record,
      {
        kind: 'review',
        author: 'Teammate',
        reviewOf: bundle.reviewOf,
        review: {
          schemaVersion: '1.0.0',
          reviewId: 'reviewer-1',
          reviewOf: bundle.reviewOf,
          decision: 'pending',
          overall: 'Needs contrast',
          createdAt: date,
          updatedAt: date,
          pins: [
            {
              id: 'pin-1',
              artifactId: artifact.id,
              author: { name: 'Teammate' },
              intent: 'improve',
              status: 'open',
              comment: 'Increase label contrast',
              region: { x: 0.1, y: 0.1, w: 0, h: 0 },
              viewport: artifact.viewport,
              replies: [],
              createdAt: date,
              updatedAt: date,
            },
          ],
        },
      },
      { reviewOf: bundle.reviewOf },
    );
    host.state.events.push({ ...event, sequence: 1 });

    const feedback = json(await helper(['feedback', file, '--action', 'inspect'], env, dir));
    expect(JSON.stringify(feedback)).toContain('Increase label contrast');
    expect(feedback.sync).toBeUndefined();

    const decision = join(dir, 'decision.json');
    writeFileSync(
      decision,
      JSON.stringify({ pinId: 'pin-1', disposition: 'accepted', reason: 'Clearer labels' }),
    );
    const designState = () => snapshot(join(dir, '.design'));
    const saved = designState();
    const requestsBefore = host.state.requests.length;
    renameSync(join(bin, 'openplanr'), join(bin, 'openplanr.off'));
    const refused = await helper(
      ['handoff', file, '--action', 'disposition', '--input', decision],
      env,
      dir,
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/Sharing runs in the OpenPlanr CLI/);
    expect(designState()).toEqual(saved);
    expect(host.state.requests.length).toBe(requestsBefore);
    renameSync(join(bin, 'openplanr.off'), join(bin, 'openplanr'));

    const before = host.state.requests.length;
    json(await helper(['handoff', file, '--action', 'disposition', '--input', decision], env, dir));
    const metadata = host.state.requests
      .slice(before)
      .find(({ url, init }) => url.endsWith('/events') && init.method === 'POST');
    expect(metadata?.init.headers?.Authorization).toBe(`Bearer ${record.ownerAuth}`);

    json(await helper(['manage', file, '--action', 'pause'], env, dir));
    expect(host.state.requests.at(-1)?.url).toMatch(/\/manage$/);
  });

  it('keeps the studio responsive while a hung CLI times out, and remembers the failure', async () => {
    const { dir, file, env } = await project('#!/bin/sh\nexec sleep 60\n');
    const { url, cookie } = await openStudio(file, env, dir);
    const headers = { cookie };
    const panel = timed(fetch(`${url}api/design-share`, { headers }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const unrelated = await timed(fetch(`${url}api/design-status`, { headers }));
    expect(unrelated.status).toBe(200);
    expect(unrelated.ms).toBeLessThan(1_500);
    const first = await panel;
    expect(first.body).toMatchObject({
      shared: false,
      unavailable: { code: 'E_DESIGN_SHARE_CLI_UNRESPONSIVE' },
    });
    expect(first.ms).toBeLessThan(10_000);
    const second = await timed(fetch(`${url}api/design-share`, { headers }));
    expect(second.body).toMatchObject({ unavailable: { code: 'E_DESIGN_SHARE_CLI_UNRESPONSIVE' } });
    expect(second.ms).toBeLessThan(1_000);
  });

  it('keeps local design working and says sharing needs the CLI when it is missing', async () => {
    const { dir, file, host, home, env } = await project(false);
    json(await helper(['validate', file], env, dir));
    const feedback = json(await helper(['feedback', file, '--action', 'inspect'], env, dir));
    expect(feedback.sync).toMatchObject({ skipped: 'E_DESIGN_SHARE_CLI_REQUIRED' });
    const exported = json(
      await helper(['export', file, '--output', join(dir, 'export.html')], env, dir),
    );
    expect(existsSync(String(exported.output))).toBe(true);

    const opened = await openStudio(file, env, dir);
    const cookie = opened.cookie;
    const panel = await fetch(`${opened.url}api/design-share`, { headers: { cookie } });
    expect(panel.status).toBe(200);
    expect(await panel.json()).toMatchObject({
      shared: false,
      unavailable: { code: 'E_DESIGN_SHARE_CLI_REQUIRED' },
    });

    const share = await helper(['share', file], env, dir);
    expect(share.status).toBe(1);
    expect(share.stderr).toMatch(/Sharing runs in the OpenPlanr CLI.*npm install -g openplanr/s);
    expect(host.state.requests).toEqual([]);
    expect(existsSync(join(home, 'design-shares'))).toBe(false);
  });
});
