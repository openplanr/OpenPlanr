import { spawn, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const CLI = resolve('src/cli/index.ts');
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const pipelineRoot = resolvePipelinePackageRoot();
const tempDirs: string[] = [];

function temporary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-artifact-command-'));
  tempDirs.push(dir);
  return dir;
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      OPENPLANR_PIPELINE_ROOT: pipelineRoot,
    },
  });
}

function runAsync(args: string[], cwd: string, env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        OPENPLANR_PIPELINE_ROOT: pipelineRoot,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('close', (status) => {
      resolveRun({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('planr artifact and retired pipeline facade', { timeout: 30_000 }, () => {
  it('prepares an unapproved design handoff without starting Plan or publishing', async () => {
    const dir = temporary();
    const { designFixture } = await import(
      pathToFileURL(resolve('../design/tests/design-fixture.mjs')).href
    );
    const { file } = designFixture(dir);
    const result = await runAsync(['artifact', 'handoff', file, '--json'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
    const handoff = JSON.parse(readFileSync(join(dir, 'review-handoff.json'), 'utf8'));
    expect(JSON.stringify(handoff)).not.toContain('"status":"approved"');
    expect(readFileSync(join(dir, 'review-handoff.md'), 'utf8')).toContain('handoff');
    writeFileSync(join(dir, 'plain.html'), '<!doctype html><title>Plain artifact</title>');
    const rejected = run(['artifact', 'handoff', 'plain.html', '--json'], dir);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain('design-document.json');
  });

  it('opens an authored design document through the public artifact route', async () => {
    const dir = temporary();
    const fixtureModule = pathToFileURL(resolve('../design/tests/design-fixture.mjs')).href;
    const { designFixture } = await import(fixtureModule);
    const { file } = designFixture(dir);
    const child = spawn(
      process.execPath,
      [TSX, CLI, '--project-dir', dir, 'artifact', 'open', file, '--no-open', '--json'],
      {
        cwd: dir,
        env: { ...process.env, NO_COLOR: '1', OPENPLANR_PIPELINE_ROOT: pipelineRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      const session = await new Promise<{ url: string; status: string; revision: string }>(
        (done, fail) => {
          let stdout = '';
          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            if (!stdout.includes('\n')) return;
            try {
              done(JSON.parse(stdout.trim()));
            } catch (error) {
              fail(error);
            }
          });
          child.once('error', fail);
          child.once('close', () => fail(new Error(stderr || 'Studio exited before startup')));
        },
      );
      expect(session.status).toBe('loading');
      expect(session.revision).toMatch(/^[a-f0-9]{64}$/);
      const response = await fetch(session.url);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('data-design-view="canvas"');
      expect(html).toContain('data-design-view="prototype"');
      expect(html).toContain('data-design-view="walkthrough"');
      expect(JSON.parse(readFileSync(join(dir, 'finalized.json'), 'utf8'))).toMatchObject({
        design_format: 'canvas',
        html_file: expect.stringContaining(session.revision),
      });
      expect(readFileSync(join(dir, 'design-spec.md'), 'utf8')).toContain('## 10.');
      writeFileSync(file, '{ "kind": "openplanr-design-document", "draft":');
      const recovered = await runAsync(['artifact', 'open', file, '--no-open', '--json'], dir);
      expect(recovered.status, recovered.stderr).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        url: session.url,
        revision: session.revision,
        reused: true,
        draftError: expect.any(String),
      });
    } finally {
      child.kill('SIGTERM');
      await closed;
    }
  });

  it('opens a verified diagram manifest in the artifact review studio', async () => {
    const dir = temporary();
    const source = join(dir, 'sequence.planr-diagram.json');
    writeFileSync(
      source,
      readFileSync(resolve('../artifact/fixtures/diagram/grammars/sequence.planr-diagram.json')),
    );
    const rendered = run(['diagram', 'render', source, '--output', '.', '--json'], dir);
    expect(rendered.status, rendered.stderr).toBe(0);
    const manifest = JSON.parse(rendered.stdout).manifest.path as string;
    const child = spawn(
      process.execPath,
      [TSX, CLI, '--project-dir', dir, 'artifact', 'open', manifest, '--no-open', '--json'],
      {
        cwd: dir,
        env: { ...process.env, NO_COLOR: '1', OPENPLANR_PIPELINE_ROOT: pipelineRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      const session = await new Promise<{ url: string; presentation: string }>((done, fail) => {
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (!stdout.includes('\n')) return;
          try {
            done(JSON.parse(stdout.trim()));
          } catch (error) {
            fail(error);
          }
        });
        child.once('error', fail);
        child.once('close', () =>
          fail(new Error(stderr || 'Diagram studio exited before startup')),
        );
      });
      expect(session.presentation).toBe('diagram');
      const response = await fetch(session.url);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Sequence fixture');
      expect(html).toContain('data-planr-diagram-studio="2"');
      expect(html).not.toContain('<iframe');
      expect(html).toContain('Fit width');
      const artifact = await fetch(`${session.url}artifacts/sequence-fixture`);
      expect(artifact.status).toBe(200);
      expect(await artifact.text()).toContain('data-planr-diagram-studio');
    } finally {
      child.kill('SIGTERM');
      await closed;
    }
  });

  it('reserves --short for the explicit immutable snapshot transport', () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>review</title>');
    const result = run(
      ['artifact', 'share', 'artifact.html', '--short', '--no-open', '--json'],
      dir,
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('requires `--snapshot`');
  });

  it('creates a private fragment link through the public planr artifact command', () => {
    const dir = temporary();
    writeFileSync(
      join(dir, 'artifact.html'),
      '<!doctype html><html><body><button id="ready">Ready</button></body></html>',
    );

    const result = run(
      [
        'artifact',
        'share',
        'artifact.html',
        '--snapshot',
        '--no-open',
        '--secret-output',
        'review.secret.json',
        '--json',
      ],
      dir,
    );
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      transport: 'fragment',
      uploaded: false,
      presentation: 'document',
      opened: false,
      secretExported: true,
    });
    expect(output).not.toHaveProperty('url');
    expect(output).not.toHaveProperty('reviewUrl');
    expect(output).not.toHaveProperty('deletionToken');
    expect(`${result.stdout}${result.stderr}`).not.toContain('#v1.');
    const secretPath = join(dir, 'review.secret.json');
    expect(lstatSync(secretPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(secretPath, 'utf8'))).toMatchObject({
      kind: 'openplanr-artifact-share-secrets',
      transport: 'fragment',
      reviewUrl: expect.stringMatching(/^https:\/\/share\.openplanr\.dev\/#v1\./),
    });
  });

  it('uses an absolute artifact file parent as the default bundle root', () => {
    const project = temporary();
    const artifactDir = temporary();
    const artifact = join(artifactDir, 'nested.html');
    writeFileSync(join(artifactDir, 'style.css'), 'body { color: teal; }');
    writeFileSync(
      artifact,
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>Outside project</body></html>',
    );

    const result = run(
      [
        'artifact',
        'share',
        artifact,
        '--snapshot',
        '--no-open',
        '--secret-output',
        'outside.secret.json',
        '--json',
      ],
      project,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      transport: 'fragment',
      presentation: 'document',
    });
  });

  it('serializes explicit canvas presentation while auto remains a document compatibility fallback', () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><html><body>Canvas</body></html>');

    const explicit = run(
      [
        'artifact',
        'share',
        'artifact.html',
        '--snapshot',
        '--presentation',
        'canvas',
        '--no-open',
        '--secret-output',
        'canvas.secret.json',
        '--json',
      ],
      dir,
    );
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(JSON.parse(explicit.stdout)).toMatchObject({ presentation: 'canvas' });

    const invalid = run(
      ['artifact', 'share', 'artifact.html', '--presentation', 'website', '--no-open', '--json'],
      dir,
    );
    expect(invalid.status).not.toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      code: 'E_ARTIFACT_INPUT_INVALID',
      problem: expect.stringContaining('auto, document, or canvas'),
    });
  });

  it('never overwrites an existing secret export and emits no capability fragment on failure', () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>review</title>');
    writeFileSync(join(dir, 'existing.secret.json'), 'owner bytes', { mode: 0o600 });
    const result = run(
      [
        'artifact',
        'share',
        'artifact.html',
        '--snapshot',
        '--no-open',
        '--secret-output',
        'existing.secret.json',
        '--json',
      ],
      dir,
    );
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'E_ARTIFACT_SECRET_EXPORT',
      problem: expect.stringContaining('created exclusively'),
    });
    expect(readFileSync(join(dir, 'existing.secret.json'), 'utf8')).toBe('owner bytes');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/#(?:v1\.|k=)|[&?](?:w|o|m)=/u);
    expect(`${result.stdout}${result.stderr}`).not.toContain(dir);
  });

  it('recovers a committed room after a lost response without rotating URLs or creating a duplicate', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>retry safe</title>');
    const requests: Array<Record<string, unknown>> = [];
    const logicalRooms = new Map<string, string>();
    let divergentRetry = false;
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/api/v1/rooms') {
          response.writeHead(404).end('{}');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const source = Buffer.concat(chunks).toString('utf8');
        const body = JSON.parse(source) as Record<string, unknown>;
        requests.push(body);
        const roomId = String(body.roomId);
        const prior = logicalRooms.get(roomId);
        if (prior && prior !== source) divergentRetry = true;
        logicalRooms.set(roomId, prior ?? source);
        if (requests.length === 1) {
          request.socket.destroy();
          return;
        }
        response.writeHead(201, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            id: roomId,
            expiresAt: '2026-08-30T00:00:00.000Z',
            descriptor: {
              schemaVersion: '2.0.0',
              protocolVersion: '2.0.0',
              roomId,
              reviewOf: body.reviewOf,
              ownerKey: body.ownerKey,
              capabilities: {
                reviewer: 'reviewer-write',
                owner: 'owner-verdict',
                management: 'room-management',
              },
              createdAt: '2026-08-23T00:00:00.000Z',
            },
            generation: 0,
            head: `sha256:${'0'.repeat(64)}`,
          }),
        );
      } catch {
        response.writeHead(500).end('{}');
      }
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    try {
      const address = server.address();
      expect(address && typeof address !== 'string').toBe(true);
      const port = typeof address === 'object' && address ? address.port : 0;
      const result = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--no-open',
          '--secret-output',
          'room.recovery.json',
          '--json',
          '--yes',
        ],
        dir,
        { OPENPLANR_SHARE_BASE: `http://127.0.0.1:${port}` },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        action: 'artifact_live_room_created',
        transport: 'live-room',
        opened: false,
        secretExported: true,
      });
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/#k=|[&?](?:w|o|m)=/u);
      expect(`${result.stdout}${result.stderr}`).not.toContain(dir);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(logicalRooms.size).toBe(1);
      expect(divergentRetry).toBe(false);

      const recoveryPath = join(dir, 'room.recovery.json');
      expect(lstatSync(recoveryPath).mode & 0o777).toBe(0o600);
      const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8')) as Record<string, unknown>;
      expect(recovery).toMatchObject({
        kind: 'openplanr-live-room-recovery',
        roomId: requests[0]?.roomId,
        reviewOf: requests[0]?.reviewOf,
        ownerKey: requests[0]?.ownerKey,
        ownerSigner: expect.objectContaining({
          kind: 'openplanr-live-room-signer',
          role: 'owner',
        }),
      });
      expect(recovery).not.toHaveProperty('ciphertext');
      expect(recovery).not.toHaveProperty('creationId');
      const roomId = String(requests[0]?.roomId);
      expect(recovery.url).toMatch(new RegExp(`/r/${roomId}#k=`));
      expect(recovery.ownerUrl).toMatch(new RegExp(`/r/${roomId}#k=.*&o=`));
      expect(recovery.manageUrl).toMatch(new RegExp(`/r/${roomId}#k=.*&m=`));
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it('retains 0600 recovery custody and emits bounded path-free JSON when both acknowledgements are lost', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>ambiguous</title>');
    let attempts = 0;
    const server = createServer(async (request) => {
      for await (const _chunk of request) {
        // Drain the exact request before simulating a lost acknowledgement.
      }
      attempts += 1;
      request.socket.destroy();
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const result = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--no-open',
          '--secret-output',
          'ambiguous.recovery.json',
          '--json',
          '--yes',
        ],
        dir,
        { OPENPLANR_SHARE_BASE: `http://127.0.0.1:${port}` },
      );
      expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: false,
        code: 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS',
        problem:
          'Live review room creation could not be confirmed. Private recovery custody was preserved.',
        recovery:
          'Use the preserved --secret-output file to inspect the exact room; do not create another room until its state is known.',
      });
      expect(attempts).toBe(2);
      expect(`${result.stdout}${result.stderr}`).not.toContain(dir);
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/#k=|[&?](?:w|o|m)=/u);
      const recoveryPath = join(dir, 'ambiguous.recovery.json');
      expect(lstatSync(recoveryPath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(recoveryPath, 'utf8'))).toMatchObject({
        kind: 'openplanr-live-room-recovery',
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it('does not expose the retired generic pipeline action facade', () => {
    const dir = temporary();
    const result = run(['pipeline', 'prepare-plan', 'checkout', '--json'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'commander.unknownCommand',
      problem: "unknown command 'pipeline'",
    });
  });
});
