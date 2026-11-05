import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

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
  fetchImpl: typeof fetch;
  listen(): Promise<{ baseUrl: string; close(): Promise<void> }>;
}

async function load<T>(relative: string): Promise<T> {
  return (await import(pathToFileURL(resolve(relative)).href)) as T;
}

function cli(args: string[], cwd: string, env: Record<string, string>, input?: string) {
  return new Promise<Run>((resolveRun) => {
    const child = spawn(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', OPENPLANR_PIPELINE_ROOT: pipelineRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.end(input ?? '');
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

async function sharedProject() {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-design-share-')));
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
  const home = join(outer, 'private');
  const env = { PLANR_HOME: home, OPENPLANR_SHARE_BASE: server.baseUrl };
  return { dir, file, host, server, home, env };
}

function custody(home: string) {
  const directory = join(home, 'design-shares');
  const name = readdirSync(directory).find((entry) => entry.endsWith('.json')) as string;
  return {
    path: join(directory, name),
    record: JSON.parse(readFileSync(join(directory, name), 'utf8')),
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('openplanr artifact design sharing commands', { timeout: 120_000 }, () => {
  it('reports the sharing runtime the skill helpers compare against', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-share-runtime-')));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const result = json(await cli(['artifact', 'share-runtime', '--json'], dir, {}));
    expect(result).toMatchObject({ ok: true, designShareCompat: 1 });
    expect(typeof result.cli).toBe('string');
    expect(typeof result.pipeline).toBe('string');
  });

  it('runs the full owner lifecycle against a loopback share host', async () => {
    const { dir, file, host, server, home, env } = await sharedProject();
    const shared = json(
      await cli(['artifact', 'share', file, '--yes', '--no-open', '--json'], dir, env),
    );
    expect(String(shared.url)).toMatch(new RegExp(`^${server.baseUrl}/d/`));
    const owner = custody(home).record.custody;
    expect(statSync(custody(home).path).mode & 0o777).toBe(0o600);

    const status = await cli(['artifact', 'status', file, '--json'], dir, env);
    expect(json(status)).toMatchObject({ shared: true, url: shared.url });
    expect(status.stdout).not.toContain(owner.token);
    expect(status.stdout).not.toContain(owner.ownerAuth);

    json(await cli(['artifact', 'publish', file, '--yes', '--json'], dir, env));

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
    const latest = custody(home).record.custody;
    const bundle = await decryptWorkspaceRevision(latest, latest.currentRevision, {
      fetchImpl: host.fetchImpl,
    });
    const date = '2026-11-05T10:00:00.000Z';
    const artifact = bundle.envelope.artifacts[0];
    const event = await prepareWorkspaceEvent(
      latest,
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

    const feedback = json(
      await cli(['artifact', 'feedback', file, '--action', 'inspect', '--json'], dir, env),
    );
    expect(JSON.stringify(feedback)).toContain('Increase label contrast');

    const before = host.state.requests.length;
    const disposition = await cli(
      ['artifact', 'handoff', file, '--action', 'disposition', '--input', '-', '--json'],
      dir,
      env,
      JSON.stringify({ pinId: 'pin-1', disposition: 'accepted', reason: 'Clearer labels' }),
    );
    json(disposition);
    const metadata = host.state.requests
      .slice(before)
      .find(({ url, init }) => url.endsWith('/events') && init.method === 'POST');
    expect(metadata?.init.headers?.Authorization).toBe(`Bearer ${latest.ownerAuth}`);

    const exported = join(dir, 'feedback-export.json');
    json(
      await cli(
        ['artifact', 'feedback', file, '--action', 'export', '--output', exported, '--json'],
        dir,
        env,
      ),
    );
    expect(statSync(exported).mode & 0o777).toBe(0o600);

    for (const action of ['rotate', 'pause', 'resume'])
      json(
        await cli(['artifact', 'manage', file, '--action', action, '--yes', '--json'], dir, env),
      );

    const access = json(
      await cli(['artifact', 'manage', file, '--action', 'access', '--json'], dir, env),
    );
    expect(access.token).toBe(custody(home).record.custody.token);
    const masked = await cli(['artifact', 'manage', file, '--action', 'access'], dir, env);
    expect(masked.status, masked.stderr).toBe(0);
    expect(masked.stdout).not.toContain(String(access.token));

    const recovery = join(dir, 'recovery.json');
    json(
      await cli(
        ['artifact', 'manage', file, '--action', 'recovery', '--output', recovery, '--json'],
        dir,
        env,
      ),
    );
    expect(statSync(recovery).mode & 0o777).toBe(0o600);
    const saved = custody(home).path;
    renameSync(saved, `${saved}.moved`);
    json(
      await cli(
        ['artifact', 'manage', file, '--action', 'restore', '--input', recovery, '--yes', '--json'],
        dir,
        env,
      ),
    );
    expect(json(await cli(['artifact', 'status', file, '--json'], dir, env))).toMatchObject({
      shared: true,
      url: shared.url,
    });

    for (const action of ['revoke', 'delete'])
      json(
        await cli(['artifact', 'manage', file, '--action', action, '--yes', '--json'], dir, env),
      );
  });

  it('refuses destructive management without confirmation', async () => {
    const { dir, file, env } = await sharedProject();
    json(await cli(['artifact', 'share', file, '--yes', '--no-open', '--json'], dir, env));
    const refused = await cli(
      ['artifact', 'manage', file, '--action', 'delete', '--json'],
      dir,
      env,
    );
    expect(refused.status).not.toBe(0);
    expect(JSON.parse(refused.stdout).code).toBe('E_ARTIFACT_CONFIRMATION_REQUIRED');
  });

  it('gives share failures a stable public code', async () => {
    const { dir, file, env } = await sharedProject();
    const { renderDesignDocument } = await load<{
      renderDesignDocument(file: string): Promise<unknown>;
    }>('../design/lib/design/document.mjs');
    await renderDesignDocument(file);
    const unshared = await cli(
      ['artifact', 'manage', file, '--action', 'pause', '--json'],
      dir,
      env,
    );
    expect(unshared.status).not.toBe(0);
    expect(JSON.parse(unshared.stdout)).toMatchObject({
      ok: false,
      code: 'E_DESIGN_SHARE_FAILED',
      problem: 'Create the shared review first.',
    });
  });

  it('prints help for every sharing command without contacting the host or writing', async () => {
    const { dir, file, host, home, env } = await sharedProject();
    for (const command of [
      'share',
      'publish',
      'sync',
      'status',
      'manage',
      'feedback',
      'handoff',
      'share-runtime',
    ])
      for (const args of [
        ['artifact', command, '--help'],
        ['artifact', command, file, '--help'],
        ['artifact', command, file, '-h'],
      ]) {
        const run = await cli(args, dir, env);
        expect(run.status, `${args.join(' ')}\n${run.stderr}`).toBe(0);
        expect(run.stdout).toContain('Usage:');
      }
    expect(host.state.requests).toEqual([]);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(dir, 'review-handoff.json'))).toBe(false);
  });
});
