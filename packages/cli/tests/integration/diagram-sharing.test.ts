import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeBundle, sealBundle } from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { diagramWorkspaceService } from '../../../artifact/tests/diagram-workspace-service.mjs';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-diagram-share-cli-')));
  roots.push(root);
  const project = join(root, 'project');
  const directory = join(project, 'diagrams', 'checkout');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'checkout.planr-diagram-bundle.json');
  const bundle = makeBundle('flowchart', { source: true });
  bundle.presentation.elements.find(
    (item: { elementId: string }) => item.elementId === 'note-a',
  ).bounds.width = 340;
  writeFileSync(file, JSON.stringify(sealBundle(bundle)));
  return { root, project, file };
}
function run(args: string[], project: string, env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done, fail) => {
    const child = spawn(process.execPath, [TSX, CLI, '--project-dir', project, ...args], {
      cwd: project,
      env: { ...process.env, CI: '1', NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', fail);
    child.once('close', (status) => done({ status, stdout, stderr }));
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native diagram sharing through the public artifact command', { timeout: 30_000 }, () => {
  it('requires explicit publication and rejects generic transport options without creating custody', async () => {
    const { root, project, file } = fixture();
    const env = { PLANR_HOME: join(root, 'private'), OPENPLANR_SHARE_BASE: 'http://127.0.0.1:1' };
    const result = await run(['artifact', 'share', file, '--no-open', '--json'], project, env);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('E_ARTIFACT_CONFIRMATION_REQUIRED');
    for (const args of [['--snapshot'], ['--short'], ['--ttl', '7d']]) {
      const rejected = await run(
        ['artifact', 'share', file, '--yes', '--no-open', '--json', ...args],
        project,
        env,
      );
      expect(rejected.status).not.toBe(0);
      expect(rejected.stdout + rejected.stderr).toContain('Export HTML first');
    }
    expect(readdirSync(root)).toEqual(['project']);
  });

  it('creates encrypted native custody, publishes only explicitly to the same link, and synchronizes without editing source', async () => {
    const { root, project, file } = fixture();
    const { state, fetchImpl } = diagramWorkspaceService();
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        const result = await fetchImpl(`http://localhost${request.url}`, {
          method: request.method,
          headers: { Authorization: request.headers.authorization },
          ...(body ? { body } : {}),
        });
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(await result.text());
      } catch {
        response.writeHead(500).end('{}');
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address() as { port: number };
    const env = {
      PLANR_HOME: join(root, 'private'),
      OPENPLANR_SHARE_BASE: `http://127.0.0.1:${address.port}`,
    };
    try {
      const before = readFileSync(file, 'utf8');
      const result = await run(
        ['artifact', 'share', file, '--yes', '--no-open', '--json'],
        project,
        env,
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      const shared = JSON.parse(result.stdout);
      expect(shared).toMatchObject({
        ok: true,
        title: 'Checkout',
        url: `${env.OPENPLANR_SHARE_BASE}/diagram/${state.workspace.id}`,
      });
      expect(shared.url).not.toMatch(/[?#]/u);
      const transmitted = JSON.stringify(state.requests);
      for (const excluded of [
        '<svg',
        'Café',
        'flowchart LR',
        project,
        'originalSource',
        'sourceMap',
      ])
        expect(transmitted).not.toContain(excluded);
      const repeated = await run(
        ['artifact', 'share', file, '--yes', '--no-open', '--json'],
        project,
        env,
      );
      expect(repeated.status, repeated.stderr).toBe(0);
      expect(JSON.parse(repeated.stdout).url).toBe(shared.url);
      expect(
        state.requests.filter(({ method }: { method: string }) => method === 'PUT'),
      ).toHaveLength(1);
      expect(readFileSync(file, 'utf8')).toBe(before);
      const edited = JSON.parse(before);
      edited.document.nodes[0].label = 'Accept order';
      writeFileSync(file, JSON.stringify(sealBundle(edited)));
      const local = readFileSync(file, 'utf8');
      const unchangedShare = await run(
        ['artifact', 'share', file, '--yes', '--no-open', '--json'],
        project,
        env,
      );
      expect(unchangedShare.status, unchangedShare.stderr).toBe(0);
      expect(state.revisions.size).toBe(1);
      const published = await run(['artifact', 'publish', file, '--yes', '--json'], project, env);
      expect(published.status, published.stderr + published.stdout).toBe(0);
      expect(JSON.parse(published.stdout).url).toBe(shared.url);
      expect(state.revisions.size).toBe(2);
      const synchronized = await run(['artifact', 'sync', file, '--json'], project, env);
      expect(synchronized.status, synchronized.stderr + synchronized.stdout).toBe(0);
      expect(JSON.parse(synchronized.stdout)).toMatchObject({ ok: true, imported: 0 });
      expect(readFileSync(file, 'utf8')).toBe(local);
      for (const output of [result.stdout, published.stdout, synchronized.stdout]) {
        expect(output).not.toMatch(/"(?:token|ownerAuth|ownerPrivateKey|keys)"/u);
      }
    } finally {
      await new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
      );
    }
  });
});
