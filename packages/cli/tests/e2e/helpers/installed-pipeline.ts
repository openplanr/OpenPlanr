import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256CanonicalJson } from '../../../src/services/canonical-json.js';
import type { PipelinePackageHandoff } from '../../../src/services/pipeline-package-service.js';

export type DashboardServer = Readonly<{
  listen(port: number, options: { env: NodeJS.ProcessEnv }): Promise<number>;
  close(): Promise<void>;
}>;

export type StartDashboard = (options: Record<string, unknown>) => DashboardServer;

export type PackedPipelineInstall = Readonly<{
  archivePath: string;
  handoff: PipelinePackageHandoff;
  packageRoot: string;
  sourceRoot: string;
  startDashboard: StartDashboard;
  cleanup(): void;
}>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workspaceRoot = resolve(repositoryRoot, '..', '..');

function sourceRoot(): string {
  const candidate = resolve(
    process.env.OPENPLANR_PIPELINE_SOURCE ?? resolve(workspaceRoot, 'packages/pipeline'),
  );
  const manifestPath = join(candidate, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      'A planr-pipeline source checkout is required only as npm-pack input. Set OPENPLANR_PIPELINE_SOURCE.',
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
  if (manifest.name !== 'planr-pipeline') {
    throw new Error('OPENPLANR_PIPELINE_SOURCE does not identify planr-pipeline.');
  }
  return candidate;
}

function runNpm(args: string[], cwd: string, cache: string): string {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: cache,
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256Bytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function packageInventoryDigest(
  packageRoot: string,
  reportedFiles: ReadonlyArray<{ path: string; size: number; mode: number }>,
): `sha256:${string}` {
  const extractedPaths: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      const portable = relative(packageRoot, absolute).split(sep).join('/');
      if (stat.isSymbolicLink()) throw new Error('Packed pipeline contains a symbolic link.');
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) extractedPaths.push(portable);
      else throw new Error('Packed pipeline contains a non-regular entry.');
    }
  };
  visit(packageRoot);
  extractedPaths.sort((left, right) => left.localeCompare(right));

  const reported = [...reportedFiles]
    .map((entry) => ({ ...entry, path: posix.normalize(entry.path.replaceAll('\\', '/')) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    reported.some(
      ({ path }) => !path || path === '..' || path.startsWith('../') || posix.isAbsolute(path),
    ) ||
    JSON.stringify(reported.map(({ path }) => path)) !== JSON.stringify(extractedPaths)
  ) {
    throw new Error('Packed pipeline inventory differs from the npm archive report.');
  }

  const inventory = reported.map((entry) => {
    const target = join(packageRoot, ...entry.path.split('/'));
    const stat = lstatSync(target);
    const bytes = readFileSync(target);
    const mode = (stat.mode & 0o111) === 0 ? 0o644 : 0o755;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      bytes.byteLength !== entry.size ||
      mode !== entry.mode
    ) {
      throw new Error('Packed pipeline entry differs from the npm archive report.');
    }
    return {
      path: entry.path,
      mode,
      size: bytes.byteLength,
      contentDigest: sha256Bytes(bytes),
    };
  });
  return sha256CanonicalJson(inventory);
}

/** Pack source bytes, install the tarball into a clean consumer, then load only that install. */
export async function installPackedPipeline(): Promise<PackedPipelineInstall> {
  const source = sourceRoot();
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-packed-pipeline-'));
  try {
    const archives = join(temporaryRoot, 'archives');
    const consumer = join(temporaryRoot, 'consumer');
    const cache = resolve(process.env.OPENPLANR_NPM_CACHE ?? join(temporaryRoot, 'npm-cache'));
    mkdirSync(archives, { recursive: true });
    mkdirSync(consumer, { recursive: true });
    writeFileSync(
      join(consumer, 'package.json'),
      '{"name":"openplanr-pipeline-custody","private":true,"type":"module"}\n',
    );

    const packReport = JSON.parse(
      runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', archives], source, cache),
    ) as Array<{
      filename?: unknown;
      files?: Array<{ path: string; size: number; mode: number }>;
    }>;
    const filename = packReport[0]?.filename;
    const reportedFiles = packReport[0]?.files;
    if (typeof filename !== 'string' || filename.length === 0 || !Array.isArray(reportedFiles)) {
      throw new Error('npm pack did not report a pipeline tarball.');
    }
    const tarball = join(archives, filename);
    runNpm(
      [
        'install',
        '--ignore-scripts',
        '--no-package-lock',
        '--omit=dev',
        '--prefer-offline',
        tarball,
      ],
      consumer,
      cache,
    );

    const installedPackageRoot = join(consumer, 'node_modules', 'planr-pipeline');
    rmSync(installedPackageRoot, { recursive: true, force: true });
    mkdirSync(installedPackageRoot, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', installedPackageRoot, '--strip-components=1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const packageRoot = realpathSync(installedPackageRoot);
    if (packageRoot === realpathSync(source)) {
      throw new Error('Packed-package QA resolved back to the source checkout.');
    }
    const archivePath = realpathSync(tarball);
    const handoff = Object.freeze({
      archiveDigest: sha256Bytes(readFileSync(archivePath)),
      packageRoot,
      sourceInventoryDigest: packageInventoryDigest(packageRoot, reportedFiles),
      contractCatalogDigest: sha256Bytes(
        readFileSync(join(packageRoot, 'lib', 'protocol', 'generated', 'contract-catalog-v2.mjs')),
      ),
    }) satisfies PipelinePackageHandoff;
    const installedManifest = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as { exports?: Record<string, unknown> };
    const publicExport = installedManifest.exports?.['.'];
    const publicEntry =
      typeof publicExport === 'string'
        ? publicExport
        : publicExport && typeof publicExport === 'object'
          ? ((publicExport as Record<string, unknown>).import ??
            (publicExport as Record<string, unknown>).default)
          : undefined;
    if (typeof publicEntry !== 'string') {
      throw new Error('Installed planr-pipeline has no public package-root export.');
    }
    const publicModule = (await import(pathToFileURL(resolve(packageRoot, publicEntry)).href)) as {
      startDashboard?: unknown;
    };
    if (typeof publicModule.startDashboard !== 'function') {
      throw new Error('Installed planr-pipeline does not export startDashboard.');
    }

    return Object.freeze({
      archivePath,
      handoff,
      packageRoot,
      sourceRoot: source,
      startDashboard: publicModule.startDashboard as StartDashboard,
      cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
    });
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
