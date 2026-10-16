import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real npm installs into two prefixes. POSIX only: Windows global layout and npm.cmd quoting differ.
const posix = process.platform !== 'win32';

const repositoryRoot = resolve('.');
let root: string;
let cliPrefix: string;
let npmPrefix: string;
let cliPackageRoot: string;
let packedVersion: string;
let targetVersion: string;
let registry: Server;
let registryUrl: string;

function npm(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('npm', args, { cwd: root, encoding: 'utf8', env, stdio: 'pipe' });
}

function packedTarball(directory: string): string {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], {
      cwd: directory,
      encoding: 'utf8',
    }),
  ) as Array<{ filename: string }>;
  return join(root, packed[0].filename);
}

/** A minimal `openplanr` release that answers the upgraded CLI's status check. */
function targetPackage(version: string): string {
  const directory = join(root, 'target-package');
  mkdirSync(join(directory, 'bin'), { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'openplanr', version, bin: { openplanr: 'bin/openplanr.js' } })}\n`,
  );
  writeFileSync(
    join(directory, 'bin', 'openplanr.js'),
    "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ status: 'aligned', nextSteps: [] }) + '\\n');\n",
  );
  return packedTarball(directory);
}

/** A local registry serving only `openplanr@<version>`, so the upgrade never reaches the network. */
async function startRegistry(version: string, tarball: string): Promise<void> {
  const bytes = readFileSync(tarball);
  const tarballPath = `/openplanr/-/openplanr-${version}.tgz`;
  registry = createServer((request, response) => {
    if (request.url === '/openplanr') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          name: 'openplanr',
          'dist-tags': { latest: version },
          versions: {
            [version]: {
              name: 'openplanr',
              version,
              bin: { openplanr: 'bin/openplanr.js' },
              dist: {
                tarball: `${registryUrl}${tarballPath.slice(1)}`,
                shasum: createHash('sha1').update(bytes).digest('hex'),
                integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
              },
            },
          },
        }),
      );
    } else if (request.url === tarballPath) {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(bytes);
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((done) => registry.listen(0, '127.0.0.1', done));
  registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}/`;
}

/** Runs the CLI asynchronously so the in-process registry keeps serving. */
function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(cliPackageRoot, 'bin', 'openplanr.js'), ...args], {
      cwd: join(root, 'project'),
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

beforeAll(async () => {
  if (!posix) return;
  root = mkdtempSync(join(tmpdir(), 'openplanr-two-prefixes-'));
  cliPrefix = join(root, 'cli-prefix');
  npmPrefix = join(root, 'npm-prefix');
  mkdirSync(join(npmPrefix, 'lib', 'node_modules'), { recursive: true });
  mkdirSync(join(root, 'project'), { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: join(root, 'project') });

  if (!existsSync(join(repositoryRoot, 'dist', 'cli', 'index.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repositoryRoot, stdio: 'pipe' });
  }
  packedVersion = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
    .version as string;
  const [major, minor] = packedVersion.split('.').map(Number);
  targetVersion = `${major}.${minor + 1}.0`;

  npm([
    'install',
    '-g',
    '--prefix',
    cliPrefix,
    '--omit=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefer-offline',
    '--no-progress',
    packedTarball(repositoryRoot),
  ]);
  cliPackageRoot = join(npm(['root', '-g', '--prefix', cliPrefix]).trim(), 'openplanr');
  await startRegistry(targetVersion, targetPackage(targetVersion));
}, 600_000);

afterAll(async () => {
  await new Promise((done) => (registry ? registry.close(done) : done(undefined)));
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe.skipIf(!posix)('upgrade apply when npm on PATH uses another global prefix', () => {
  it('upgrades the running CLI in its own prefix and leaves the other prefix alone', async () => {
    const ecosystem = join(root, 'ecosystem.json');
    writeFileSync(
      ecosystem,
      JSON.stringify({
        components: {
          cli: { version: targetVersion, pipelineRange: '^0.39.0' },
          pipeline: { version: '0.39.0', cliRange: `^${packedVersion}` },
          skills: { version: '1.24.0', cliRange: `^${packedVersion}` },
        },
      }),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: join(root, 'home'),
      PLANR_HOME: join(root, 'home', '.planr'),
      OPENPLANR_PIPELINE_ROOT: '',
      OPENPLANR_NPM_BIN: '',
      OPENPLANR_ECOSYSTEM_SOURCE: ecosystem,
      NO_COLOR: '1',
      NPM_CONFIG_PREFIX: npmPrefix,
      npm_config_registry: registryUrl,
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_update_notifier: 'false',
      PATH: [join(cliPrefix, 'bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    };
    expect(npm(['root', '-g'], env).trim()).toBe(join(npmPrefix, 'lib', 'node_modules'));

    const result = await runCli(
      ['--project-dir', join(root, 'project'), 'upgrade', 'apply', '--yes', '--json'],
      env,
    );

    const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as {
      ok: boolean;
      installedVersion: string;
      failure?: { message: string };
    };
    expect(report.failure?.message).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.installedVersion).toBe(targetVersion);
    expect(JSON.parse(readFileSync(join(cliPackageRoot, 'package.json'), 'utf8')).version).toBe(
      targetVersion,
    );
    expect(existsSync(join(npmPrefix, 'lib', 'node_modules', 'openplanr'))).toBe(false);
    expect(result.status, result.stderr).toBe(0);
  });
});
