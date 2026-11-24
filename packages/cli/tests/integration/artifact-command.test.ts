import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
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

describe('openplanr artifact and retired pipeline facade', { timeout: 30_000 }, () => {
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

  it('creates a private fragment link through the public openplanr artifact command', () => {
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
        const readId = /^\/api\/v2\/rooms\/([A-Za-z0-9_-]+)\?cursor=0$/u.exec(
          request.url ?? '',
        )?.[1];
        if (request.method === 'GET' && readId) {
          const stored = logicalRooms.get(readId);
          if (!stored) {
            response.writeHead(404).end('{}');
            return;
          }
          const body = JSON.parse(stored) as Record<string, unknown>;
          expect(request.headers.authorization).toBe(`Bearer ${String(body.readCapability)}`);
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              version: 'v3',
              cursor: 0,
              sequence: 0,
              eventBytes: 2,
              nextCursor: null,
              descriptor: {
                schemaVersion: '3.0.0',
                protocolVersion: '3.0.0',
                roomId: readId,
                reviewCommitment: body.reviewCommitment,
                ownerKey: body.ownerKey,
                capabilities: {
                  read: 'room-read',
                  reviewer: 'reviewer-write',
                  owner: 'owner-verdict',
                  management: 'room-management',
                },
                createdAt: '2026-08-23T00:00:00.000Z',
              },
              iv: body.iv,
              ciphertext: body.ciphertext,
              expiresAt: '2099-08-30T00:00:00.000Z',
              commentsEnabled: true,
              events: [],
              generation: 0,
              head: `sha256:${'0'.repeat(64)}`,
            }),
          );
          return;
        }
        if (request.method !== 'POST' || request.url !== '/api/v2/rooms') {
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
            expiresAt: '2099-08-30T00:00:00.000Z',
            descriptor: {
              schemaVersion: '3.0.0',
              protocolVersion: '3.0.0',
              roomId,
              reviewCommitment: body.reviewCommitment,
              ownerKey: body.ownerKey,
              capabilities: {
                read: 'room-read',
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
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(logicalRooms.size).toBe(1);
      expect(divergentRetry).toBe(false);

      const recoveryPath = join(dir, 'room.recovery.json');
      expect(lstatSync(recoveryPath).mode & 0o777).toBe(0o600);
      const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8')) as Record<string, unknown>;
      expect(recovery).toMatchObject({
        schemaVersion: '2.0.0',
        kind: 'openplanr-live-room-recovery',
        body: requests[0],
        key: expect.any(String),
        reviewOf: expect.any(String),
        ownerSigner: expect.objectContaining({ kind: 'openplanr-live-room-signer', role: 'owner' }),
      });
      expect(recovery).not.toHaveProperty('ciphertext');
      expect(JSON.parse(result.stdout).reviewUrl).toBe(roomReviewUrl(readPrivate(recoveryPath)));
      expectNoOwnerSecrets(`${result.stdout}${result.stderr}`, readPrivate(recoveryPath), dir);
      expect(requests[0]).not.toHaveProperty('reviewOf');
      expect(requests[0]).not.toHaveProperty('key');
      const roomApi = await import(
        pathToFileURL(join(pipelineRoot, 'lib/artifact/live-room.mjs')).href
      );
      const restored = await roomApi.importLiveRoomRecoveryBundle(recovery);
      expect(restored.ownerUrl).toContain('&r=');
      expect(restored.ownerUrl).toContain('&o=');
      await roomApi.commitLiveReviewRoom(restored);
      expect(requests).toHaveLength(3);
      expect(requests[2]).toEqual(requests[0]);
      expect(logicalRooms.size).toBe(1);
      const hydrated = await roomApi.hydrateLiveReviewRoom(restored.ownerUrl);
      expect(hydrated.reviewComplete).toBe(true);
      expect(hydrated.envelope.artifacts[0].html).toContain('retry safe');
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

interface ShareService {
  readonly base: string;
  close(): Promise<void>;
}

/** Minimal paste v2 and room v3 create endpoints, enough for a successful share. */
async function startShareService(): Promise<ShareService> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      : {};
    const expiresAt = '2099-08-30T00:00:00.000Z';
    if (request.method === 'POST' && request.url === '/api/v2/pastes') {
      response.writeHead(201, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          schemaVersion: '2.0.0',
          operation: 'created',
          id: body.id,
          creationId: body.creationId,
          deletionToken: request.headers['x-openplanr-paste-custody'],
          expiresAt,
        }),
      );
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v2/rooms') {
      response.writeHead(201, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: body.roomId,
          expiresAt,
          descriptor: {
            schemaVersion: '3.0.0',
            protocolVersion: '3.0.0',
            roomId: body.roomId,
            reviewCommitment: body.reviewCommitment,
            ownerKey: body.ownerKey,
            capabilities: {
              read: 'room-read',
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
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

/**
 * Puts `open` and `xdg-open` stand-ins first on PATH. Each records the URL it was given and
 * fetches it once, one second later, from a detached process that outlives the CLI.
 */
function browserShim(dir: string): { env: Record<string, string>; log: string } {
  const bin = join(dir, 'bin');
  const log = join(dir, 'browser.log');
  mkdirSync(bin);
  const script = `#!${process.execPath}
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const url = process.argv[2];
const log = ${JSON.stringify(log)};
appendFileSync(log, JSON.stringify({ opened: url }) + '\\n');
const fetchLater = \`setTimeout(async () => {
  let result;
  try {
    const response = await fetch(\${JSON.stringify(url)}, { redirect: 'manual' });
    result = { status: response.status, location: response.headers.get('location') };
  } catch (error) {
    result = { error: String(error && error.cause && error.cause.code ? error.cause.code : error) };
  }
  require('node:fs').appendFileSync(\${JSON.stringify(log)}, JSON.stringify(result) + '\\\\n');
}, 1000);\`;
spawn(process.execPath, ['-e', fetchLater], { detached: true, stdio: 'ignore' }).unref();
`;
  for (const name of ['open', 'xdg-open']) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  return { env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }, log };
}

async function browserFetch(log: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    const fetched = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => !('opened' in entry));
    if (fetched) return fetched;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('The browser stand-in never fetched the opened URL.');
}

interface RoomRecoveryFile {
  kind: 'openplanr-live-room-recovery';
  origin: string;
  key: string;
  body: Record<string, string>;
  ownerSigner: { privateKey: string };
}

interface PastePreparationFile {
  kind: 'openplanr-artifact-paste-preparation';
  origin: string;
  key: string;
  custodyToken: string;
  body: { id: string };
}

type PrivateShareFile = RoomRecoveryFile | PastePreparationFile;

function readPrivate<T extends PrivateShareFile = RoomRecoveryFile>(file: string): T {
  expect(lstatSync(file).mode & 0o777).toBe(0o600);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function roomReviewUrl(recovery: RoomRecoveryFile): string {
  const body = recovery.body;
  return `${recovery.origin}/r/${body.roomId}#k=${recovery.key}&r=${body.readCapability}&w=${body.reviewerCapability}`;
}

function pasteReviewUrl(prepared: PastePreparationFile): string {
  return `${prepared.origin}/p/${prepared.body.id}#k=${prepared.key}&v=2`;
}

/** Every owner or management secret the private file holds, by value. */
function ownerSecrets(file: PrivateShareFile): string[] {
  const values =
    file.kind === 'openplanr-live-room-recovery'
      ? [file.body.ownerCapability, file.body.manageCapability, file.ownerSigner.privateKey]
      : [file.custodyToken];
  for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43,}$/u);
  return values;
}

function expectNoOwnerSecrets(output: string, file: PrivateShareFile, dir: string): void {
  for (const value of ownerSecrets(file)) expect(output).not.toContain(value);
  expect(output).not.toMatch(/[&?#](?:o|m)=/u);
  expect(output).not.toContain(dir);
}

/** The browser shims replace `open` and `xdg-open`; Windows launches through `cmd start`. */
const describePosix = describe.skipIf(process.platform === 'win32');

describePosix('artifact share review links', { timeout: 30_000 }, () => {
  it('keeps the opened short-link handoff reachable until the browser uses it', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>opened short</title>');
    const service = await startShareService();
    const shim = browserShim(dir);
    try {
      const started = Date.now();
      const result = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--short',
          '--snapshot',
          '--ttl',
          '30d',
          '--json',
          '--yes',
        ],
        dir,
        {
          ...shim.env,
          OPENPLANR_SHARE_BASE: service.base,
          PLANR_ARTIFACT_PASTE_CUSTODY_ROOT: join(dir, 'custody'),
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(Date.now() - started).toBeLessThan(20_000);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({ ok: true, transport: 'short', opened: true });
      expect(await browserFetch(shim.log)).toEqual({ status: 302, location: output.reviewUrl });
    } finally {
      await service.close();
    }
  });

  it('keeps the opened live-room handoff reachable until the browser uses it', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>opened room</title>');
    const service = await startShareService();
    const shim = browserShim(dir);
    try {
      const result = await runAsync(
        ['artifact', 'share', 'artifact.html', '--secret-output', 'room.json', '--yes'],
        dir,
        { ...shim.env, OPENPLANR_SHARE_BASE: service.base },
      );
      expect(result.status, result.stderr).toBe(0);
      const recovery = readPrivate(join(dir, 'room.json'));
      expect(await browserFetch(shim.log)).toEqual({
        status: 302,
        location: roomReviewUrl(recovery),
      });
      expect(result.stdout).toContain('Waiting up to 30 seconds for the browser to open the link');
      expect(result.stdout).not.toContain('did not open the link');
    } finally {
      await service.close();
    }
  });

  it('prints the encrypted short link and keeps the deletion token private', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>short link</title>');
    const service = await startShareService();
    const env = {
      OPENPLANR_SHARE_BASE: service.base,
      PLANR_ARTIFACT_PASTE_CUSTODY_ROOT: join(dir, 'custody'),
    };
    try {
      const json = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--short',
          '--snapshot',
          '--no-open',
          '--secret-output',
          'paste.json',
          '--json',
          '--yes',
        ],
        dir,
        env,
      );
      expect(json.status, json.stderr).toBe(0);
      const prepared = readPrivate<PastePreparationFile>(join(dir, 'paste.json'));
      const reviewUrl = pasteReviewUrl(prepared);
      expect(reviewUrl).toMatch(/\/p\/[A-Za-z0-9_-]{43}#k=[A-Za-z0-9_-]{43}&v=2$/u);
      expect(JSON.parse(json.stdout)).toMatchObject({
        ok: true,
        transport: 'short',
        reviewUrl,
        opened: false,
      });
      expectNoOwnerSecrets(`${json.stdout}${json.stderr}`, prepared, dir);

      const resumed = await runAsync(
        ['artifact', 'share', 'artifact.html', '--resume', 'paste.json', '--no-open'],
        dir,
        env,
      );
      expect(resumed.status, resumed.stderr).toBe(0);
      expect(resumed.stdout).toContain(`Review link (safe to share):  ${reviewUrl}`);
      expect(resumed.stdout).toContain('The deletion token stays in private custody.');
      expectNoOwnerSecrets(`${resumed.stdout}${resumed.stderr}`, prepared, dir);

      const status = await runAsync(['artifact', 'status', 'paste.json', '--json'], dir);
      expect(status.status, status.stderr).toBe(0);
      expect(JSON.parse(status.stdout)).toEqual({
        ok: true,
        action: 'artifact_share_status',
        transport: 'short',
        reviewUrl,
      });
      expectNoOwnerSecrets(`${status.stdout}${status.stderr}`, prepared, dir);
    } finally {
      await service.close();
    }
  });

  it('prints the live-room reviewer link and keeps owner and management links private', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>room link</title>');
    const service = await startShareService();
    try {
      const json = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--presentation',
          'document',
          '--ttl',
          '30d',
          '--no-open',
          '--secret-output',
          'room.json',
          '--json',
          '--yes',
        ],
        dir,
        { OPENPLANR_SHARE_BASE: service.base },
      );
      expect(json.status, json.stderr).toBe(0);
      const recovery = readPrivate(join(dir, 'room.json'));
      expect(Object.keys(recovery).sort()).toEqual([
        'body',
        'inputDigest',
        'key',
        'kind',
        'origin',
        'ownerSigner',
        'reviewOf',
        'schemaVersion',
      ]);
      const reviewUrl = roomReviewUrl(recovery);
      expect(JSON.parse(json.stdout)).toMatchObject({
        ok: true,
        transport: 'live-room',
        reviewUrl,
        opened: false,
      });
      expectNoOwnerSecrets(`${json.stdout}${json.stderr}`, recovery, dir);

      const human = await runAsync(
        [
          'artifact',
          'share',
          'artifact.html',
          '--no-open',
          '--secret-output',
          'room2.json',
          '--yes',
        ],
        dir,
        { OPENPLANR_SHARE_BASE: service.base },
      );
      expect(human.status, human.stderr).toBe(0);
      const second = readPrivate(join(dir, 'room2.json'));
      expect(human.stdout).toContain(`Review link (safe to share):  ${roomReviewUrl(second)}`);
      expect(human.stdout).toContain(
        'Owner-verdict and room-management links are only in the private file.',
      );
      expect(human.stdout).not.toContain('Waiting up to');
      expectNoOwnerSecrets(`${human.stdout}${human.stderr}`, second, dir);

      for (const args of [['--json'], []]) {
        const status = await runAsync(['artifact', 'status', 'room.json', ...args], dir);
        expect(status.status, status.stderr).toBe(0);
        expect(status.stdout).toContain(reviewUrl);
        expectNoOwnerSecrets(`${status.stdout}${status.stderr}`, recovery, dir);
      }
    } finally {
      await service.close();
    }
  });

  it('prints the link and continues when the browser cannot be launched', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>no browser</title>');
    const empty = join(dir, 'empty-path');
    mkdirSync(empty);
    const service = await startShareService();
    try {
      const json = await runAsync(
        ['artifact', 'share', 'artifact.html', '--secret-output', 'room.json', '--json', '--yes'],
        dir,
        { PATH: empty, OPENPLANR_SHARE_BASE: service.base },
      );
      expect(json.status, json.stderr).toBe(0);
      const recovery = readPrivate(join(dir, 'room.json'));
      expect(JSON.parse(json.stdout)).toMatchObject({
        ok: true,
        reviewUrl: roomReviewUrl(recovery),
        opened: false,
      });
      expect(json.stderr).toContain('The browser could not be opened');
      expect(json.stderr).toContain('Use the review link above.');

      const human = await runAsync(
        ['artifact', 'share', 'artifact.html', '--secret-output', 'room2.json', '--yes'],
        dir,
        { PATH: empty, OPENPLANR_SHARE_BASE: service.base },
      );
      expect(human.status, human.stderr).toBe(0);
      const second = readPrivate(join(dir, 'room2.json'));
      expect(human.stdout).toContain(`Review link (safe to share):  ${roomReviewUrl(second)}`);
      expect(human.stdout).toContain('The browser could not be opened');
      expect(human.stdout).toContain('Use the review link above.');

      const fragment = await runAsync(
        ['artifact', 'share', 'artifact.html', '--snapshot', '--json', '--yes'],
        dir,
        { PATH: empty },
      );
      expect(fragment.status, fragment.stderr).toBe(0);
      const output = JSON.parse(fragment.stdout);
      expect(output).toMatchObject({ ok: true, transport: 'fragment', opened: false });
      expect(output).not.toHaveProperty('reviewUrl');
      expect(fragment.stderr).toContain('The browser could not be opened');
      expect(fragment.stderr).toContain('--no-open --secret-output <private-file>');
      expect(`${fragment.stdout}${fragment.stderr}`).not.toContain('#v1.');
    } finally {
      await service.close();
    }
  });

  it('reports opened false and warns when the browser never requests the link', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>never fetched</title>');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const name of ['open', 'xdg-open']) {
      writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n');
      chmodSync(join(bin, name), 0o755);
    }
    const env = {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      OPENPLANR_HANDOFF_WAIT_MS: '500',
    };
    const started = Date.now();
    const json = await runAsync(
      ['artifact', 'share', 'artifact.html', '--snapshot', '--json', '--yes'],
      dir,
      env,
    );
    expect(json.status, json.stderr).toBe(0);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(json.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      transport: 'fragment',
      opened: false,
    });
    expect(json.stderr).toContain('The browser did not open the link within 0.5 seconds.');
    expect(json.stderr).toContain('--no-open --secret-output <private-file>');

    const human = await runAsync(
      ['artifact', 'share', 'artifact.html', '--snapshot', '--yes'],
      dir,
      env,
    );
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain('Waiting up to 0.5 seconds for the browser to open the link');
    expect(human.stdout).toContain('The browser did not open the link within 0.5 seconds.');
  });

  it('refuses a saved owner or management link without echoing it', async () => {
    const dir = temporary();
    const key = 'K'.repeat(43);
    const capability = 'Z'.repeat(43);
    for (const parameter of ['o', '%6D']) {
      const reviewUrl = `https://share.example.test/r/${'a'.repeat(16)}#k=${key}&${parameter}=${capability}`;
      writeFileSync(
        join(dir, 'owner.json'),
        JSON.stringify({
          schemaVersion: '1.0.0',
          kind: 'openplanr-artifact-share-secrets',
          transport: 'short',
          reviewUrl,
        }),
        { mode: 0o600 },
      );
      chmodSync(join(dir, 'owner.json'), 0o600);
      const refusal =
        'The saved review link carries owner or management authority; it is not safe to share.';
      const json = await runAsync(['artifact', 'status', 'owner.json', '--json'], dir);
      expect(json.status).not.toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({
        code: 'E_ARTIFACT_INPUT_INVALID',
        problem: refusal,
      });
      const human = await runAsync(['artifact', 'status', 'owner.json'], dir);
      expect(human.status).not.toBe(0);
      const output = `${json.stdout}${json.stderr}${human.stdout}${human.stderr}`;
      expect(output).toContain(refusal);
      expect(output).not.toContain('requires a design-document.json');
      for (const secret of [capability, key, reviewUrl, 'share.example.test'])
        expect(output).not.toContain(secret);
    }
  });

  it('keeps fragment links out of status output and refuses non-private share files', async () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>fragment</title>');
    const shared = run(
      [
        'artifact',
        'share',
        'artifact.html',
        '--snapshot',
        '--no-open',
        '--secret-output',
        'f.json',
        '--json',
      ],
      dir,
    );
    expect(shared.status, shared.stderr).toBe(0);
    const status = await runAsync(['artifact', 'status', 'f.json', '--json'], dir);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({
      ok: true,
      action: 'artifact_share_status',
      transport: 'fragment',
    });
    expect(`${status.stdout}${status.stderr}`).not.toContain('#v1.');

    chmodSync(join(dir, 'f.json'), 0o644);
    const exposed = await runAsync(['artifact', 'status', 'f.json', '--json'], dir);
    expect(exposed.status).not.toBe(0);
    expect(JSON.parse(exposed.stdout)).toMatchObject({
      code: 'E_ARTIFACT_INPUT_INVALID',
      problem: expect.stringContaining('without group or world permissions'),
    });
  });
});
