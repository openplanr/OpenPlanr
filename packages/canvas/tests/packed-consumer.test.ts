import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Browser, expect as browserExpect, type Page } from '@playwright/test';
import { expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const execute = promisify(execFile);
const { launchBrowser }: { launchBrowser(options: { engine: 'chromium' }): Promise<Browser> } =
  createRequire(import.meta.url)('../../../tests/support/browser-launcher.mjs');

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw new Error(
      `Packed consumer ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function command(cwd: string, executable: string, args: string[]): Promise<void> {
  try {
    await execute(executable, args, { cwd, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (cause) {
    const output =
      cause instanceof Error && 'stdout' in cause && typeof cause.stdout === 'string'
        ? cause.stdout
        : '';
    throw new Error(
      `${executable} ${args.join(' ')}: ${cause instanceof Error ? cause.message : String(cause)}\n${output}`,
      { cause },
    );
  }
}

function lockedVersion(packages: Record<string, unknown>, name: string): string {
  const direct = packages[`node_modules/${name}`];
  const matches = direct
    ? [direct]
    : Object.entries(packages)
        .filter(([path]) => path.endsWith(`/node_modules/${name}`))
        .map(([, entry]) => entry);
  const versions = new Set(
    matches.map((entry) => {
      if (!entry || typeof entry !== 'object' || !('version' in entry))
        throw new Error(`Lockfile entry for ${name} has no version`);
      if (typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(entry.version))
        throw new Error(`Lockfile entry for ${name} has invalid version ${String(entry.version)}`);
      return entry.version;
    }),
  );
  if (versions.size !== 1)
    throw new Error(`Expected one locked version for ${name}; found ${[...versions].join(', ')}`);
  const version = [...versions][0];
  if (!version) throw new Error(`Missing locked version for ${name}`);
  return version;
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === 'string')
          reject(new Error('Loopback listener did not provide a port'));
        else resolve(address.port);
      });
    });
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await exited;
  }
}

async function waitForPreview(
  server: ChildProcess,
  url: string,
  state: { output: string; failure?: Error },
): Promise<void> {
  let lastResponse = 'No response';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (state.failure) throw state.failure;
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(`Preview exited (${server.exitCode ?? server.signalCode}): ${state.output}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
      lastResponse = `HTTP ${response.status}`;
    } catch (error) {
      lastResponse = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Preview did not become ready: ${lastResponse}\n${state.output}`);
}

async function camera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.locator('#camera').evaluate((element) => {
    const values = ['x', 'y', 'zoom'].map((key) => {
      const value = element.getAttribute(`data-${key}`);
      if (value === null) throw new Error(`Camera probe is missing ${key}`);
      return Number(value);
    });
    if (!values.every(Number.isFinite)) throw new Error('Camera probe returned invalid values');
    return { x: values[0], y: values[1], zoom: values[2] };
  });
}

const app = `import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasProvider, CanvasStage, WorldNodes, useCamera, useCanvas } from '@openplanr/canvas/react';
import { generateLayeredGraph } from '@openplanr/canvas/testing';
import '@openplanr/canvas/styles.css';
import './style.css';

const fixture = generateLayeredGraph(708, 997);
const data = new Map(fixture.nodes.map((node) => [node.id, node]));
const edges = fixture.edges.map((edge) => ({ ...edge, style: 'dependency' }));

function CameraProbe() {
  const controller = useCanvas();
  const camera = useCamera((value) => value);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!controller) return;
    const update = () => setCount(controller.getOutline().length);
    update();
    return controller.on('mount', update);
  }, [controller]);
  return <output id="camera" data-x={camera.x} data-y={camera.y} data-zoom={camera.zoom} data-node-count={count} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Packed consumer root is missing');
createRoot(root).render(
  <CanvasProvider label="Packed graph" nodes={fixture.nodes} edges={edges} options={{ pointerMode: 'pan' }}>
    <CanvasStage>
      <WorldNodes data={data} className="card" renderNode={(id, item) => {
        if (!item) throw new Error('Missing packed fixture node ' + id);
        return <span>{item.title}</span>;
      }} />
    </CanvasStage>
    <CameraProbe />
  </CanvasProvider>,
);
`;

it('renders a packed graph in an isolated React app and responds to pan and zoom', async () => {
  const directories: string[] = [];
  const failures: unknown[] = [];
  let browser: Browser | undefined;
  let preview: ChildProcess | undefined;
  try {
    const [packDirectory, appDirectory] = await step('create temporary directories', async () => {
      const pack = await mkdtemp(join(tmpdir(), 'canvas-pack-'));
      directories.push(pack);
      const scratch = await mkdtemp(join(tmpdir(), 'canvas-consumer-'));
      directories.push(scratch);
      const location = relative(await realpath(workspaceRoot), await realpath(scratch));
      if (!location.startsWith('..') && !isAbsolute(location))
        throw new Error(`Scratch app must be outside workspace: ${scratch}`);
      return [pack, scratch];
    });
    const dependencies = await step('read locked consumer dependencies', async () => {
      const lock: unknown = JSON.parse(
        await readFile(join(workspaceRoot, 'package-lock.json'), 'utf8'),
      );
      if (
        !lock ||
        typeof lock !== 'object' ||
        !('packages' in lock) ||
        !lock.packages ||
        typeof lock.packages !== 'object' ||
        Array.isArray(lock.packages)
      )
        throw new Error('Root package-lock.json has no packages object');
      return ['react', 'react-dom', 'vite', '@vitejs/plugin-react'].map(
        (name) => `${name}@${lockedVersion(lock.packages as Record<string, unknown>, name)}`,
      );
    });
    const tarball = await step('pack canvas', async () => {
      await command(workspaceRoot, 'npm', [
        'pack',
        '-w',
        '@openplanr/canvas',
        '--pack-destination',
        packDirectory,
      ]);
      const files = (await readdir(packDirectory)).filter((name) => name.endsWith('.tgz'));
      if (files.length !== 1)
        throw new Error(`Expected one canvas tarball; found ${files.join(', ')}`);
      return join(packDirectory, files[0]);
    });
    await step('write scratch app', async () => {
      await writeFile(
        join(appDirectory, 'package.json'),
        JSON.stringify({
          name: 'canvas-packed-consumer',
          private: true,
          type: 'module',
        }),
      );
      await writeFile(
        join(appDirectory, 'index.html'),
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packed canvas</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
      );
      await writeFile(
        join(appDirectory, 'vite.config.mjs'),
        "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n",
      );
      await writeFile(join(appDirectory, 'main.tsx'), app);
      await writeFile(
        join(appDirectory, 'style.css'),
        'html,body,#root{width:100%;height:100%;margin:0} .card{box-sizing:border-box;border:1px solid #333;background:white;color:black} #camera{position:fixed;bottom:0;pointer-events:none}',
      );
    });
    await step('install scratch dependencies', () =>
      command(appDirectory, 'npm', [
        'install',
        '--no-audit',
        '--no-fund',
        '--save-exact',
        tarball,
        ...dependencies,
      ]),
    );
    const vite = join(appDirectory, 'node_modules/vite/bin/vite.js');
    await step('build scratch app', () => command(appDirectory, process.execPath, [vite, 'build']));
    const url = await step('start preview', async () => {
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const server = spawn(
        process.execPath,
        [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: appDirectory, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      preview = server;
      const state: { output: string; failure?: Error } = { output: '' };
      server.stdout?.on('data', (chunk) => {
        state.output += String(chunk);
      });
      server.stderr?.on('data', (chunk) => {
        state.output += String(chunk);
      });
      server.once('error', (error) => {
        state.failure = error;
      });
      await waitForPreview(server, url, state);
      return url;
    });
    browser = await step('launch Chromium', () => launchBrowser({ engine: 'chromium' }));
    const liveBrowser = browser;
    const errors: string[] = [];
    const page = await step('open browser page', () =>
      liveBrowser.newPage({ viewport: { width: 1440, height: 900 } }),
    );
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await step('render packed fixture', async () => {
      await page.goto(url, { waitUntil: 'networkidle' });
      await expect.poll(() => page.locator('[data-canvas-node-id]').count()).toBeGreaterThan(0);
      await browserExpect(page.locator('[data-canvas-node-id]').first()).toBeVisible();
      await browserExpect(page.locator('#camera')).toHaveAttribute('data-node-count', '708');
      await browserExpect(page.locator('.canvas-stage')).toHaveCSS('touch-action', 'none');
      await browserExpect(page.locator('.canvas-world')).toHaveCSS('position', 'absolute');
      expect((await camera(page)).zoom).toBe(1);
    });
    await step('pan packed fixture', async () => {
      const before = await camera(page);
      await page.mouse.move(700, 400);
      await page.mouse.wheel(40, 70);
      await expect.poll(async () => (await camera(page)).y).toBeGreaterThan(before.y);
      expect((await camera(page)).zoom).toBe(before.zoom);
    });
    await step('zoom packed fixture', async () => {
      const before = await camera(page);
      await page.keyboard.down('Control');
      try {
        await page.mouse.wheel(0, -80);
      } finally {
        await page.keyboard.up('Control');
      }
      await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(before.zoom);
    });
    await step('check browser errors', async () => {
      expect(errors).toEqual([]);
    });
  } catch (error) {
    failures.push(error);
  } finally {
    const cleanup = await Promise.allSettled([
      step('close browser', async () => {
        await browser?.close();
      }),
      step('stop preview', async () => {
        if (preview) await stopServer(preview);
      }),
    ]);
    for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
    for (const directory of directories) {
      try {
        await step(`remove temporary directory ${directory}`, () =>
          rm(directory, { recursive: true, force: true }),
        );
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      failures.map((error) => (error instanceof Error ? error.message : String(error))).join('\n'),
    );
});
