#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
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
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(repositoryRoot, '..', '..');
const packageRequire = createRequire(import.meta.url);

function installedPackageRoot(packageName) {
  return dirname(packageRequire.resolve(`${packageName}/package.json`));
}

function pipelineSourceRoot() {
  const candidate = resolve(
    process.env.OPENPLANR_PIPELINE_SOURCE ?? resolve(workspaceRoot, 'packages/pipeline'),
  );
  const manifestPath = join(candidate, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      'Dashboard browser QA needs a planr-pipeline checkout as npm-pack input. Set OPENPLANR_PIPELINE_SOURCE.',
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'planr-pipeline') {
    throw new Error('OPENPLANR_PIPELINE_SOURCE does not identify planr-pipeline.');
  }
  return candidate;
}

function runNpm(args, cwd, cache) {
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

function assertNoSymlinks(directory) {
  for (const entry of readFileTree(directory)) {
    if (lstatSync(entry).isSymbolicLink()) {
      throw new Error(`Packed pipeline install contains a symbolic link: ${entry}`);
    }
  }
}

function readFileTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() && !entry.isSymbolicLink()
      ? [absolute, ...readFileTree(absolute)]
      : [absolute];
  });
}

function installPackedPipeline(temporaryRoot) {
  const sourceRoot = pipelineSourceRoot();
  const archives = join(temporaryRoot, 'archives');
  const consumer = join(temporaryRoot, 'consumer');
  const cache = join(temporaryRoot, 'npm-cache');
  mkdirSync(archives, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    '{"name":"openplanr-browser-pipeline-custody","private":true,"type":"module"}\n',
  );

  const packReport = JSON.parse(
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
      sourceRoot,
      cache,
    ),
  );
  const filename = packReport[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not report a planr-pipeline tarball.');
  }
  const archivePath = join(archives, filename);
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-package-lock',
      '--omit=dev',
      '--prefer-offline',
      archivePath,
    ],
    consumer,
    cache,
  );

  const installedPath = join(consumer, 'node_modules', 'planr-pipeline');
  if (lstatSync(installedPath).isSymbolicLink()) {
    throw new Error('Dashboard browser QA refuses a symlinked planr-pipeline install.');
  }
  const packageRoot = realpathSync(installedPath);
  if (packageRoot === realpathSync(sourceRoot)) {
    throw new Error('Dashboard browser QA resolved planr-pipeline back to its source checkout.');
  }
  assertNoSymlinks(packageRoot);
  return { archivePath, consumer, packageRoot, sourceRoot: realpathSync(sourceRoot) };
}

function preservePackedPipelineArchive(archivePath) {
  const requested = process.env.OPENPLANR_PACKED_PIPELINE_ARCHIVE_OUT;
  if (!requested) return;
  const destination = resolve(requested);
  const custodyRoot = resolve(workspaceRoot, '.ci');
  const custodyRelative = relative(custodyRoot, destination);
  if (
    custodyRelative === '' ||
    custodyRelative === '..' ||
    custodyRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error('Packed pipeline archive output must be a file below OpenPlanr .ci/.');
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(archivePath, destination);
}

function writePackedTypecheckConfig(temporaryRoot, packageRoot) {
  const target = join(temporaryRoot, 'tsconfig.dashboard.packed.json');
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        extends: join(workspaceRoot, 'apps/dashboard/tsconfig.json'),
        compilerOptions: {
          rootDir: workspaceRoot,
          typeRoots: [
            join(repositoryRoot, 'node_modules', '@types'),
            join(repositoryRoot, 'node_modules'),
            join(workspaceRoot, 'node_modules', '@types'),
            join(workspaceRoot, 'node_modules'),
          ],
          paths: {
            '@dashboard/*': [join(workspaceRoot, 'apps', 'dashboard', 'src', '*')],
            'planr-pipeline': [join(packageRoot, 'lib/pipeline/index.d.mts')],
            'planr-pipeline/*': [`${packageRoot}/*`],
          },
        },
        include: [
          join(workspaceRoot, 'apps/dashboard/src/**/*'),
          join(repositoryRoot, 'tests/e2e/fixtures/dashboard-test-entry.tsx'),
        ],
      },
      null,
      2,
    )}\n`,
  );
  return target;
}

function runChecked(command, args, environment, label) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`${label} failed${result.signal ? ` with ${result.signal}` : ''}.`);
  }
}

function writePackageResolver(temporaryRoot, consumer, playwrightCliPath) {
  const hookPath = join(temporaryRoot, 'resolve-packed-pipeline.mjs');
  const playwrightEntry = pathToFileURL(playwrightCliPath).href;
  writeFileSync(
    hookPath,
    [
      "import { pathToFileURL } from 'node:url';",
      `const pipelineRoot = ${JSON.stringify(realpathSync(join(consumer, 'node_modules', 'planr-pipeline')))};`,
      `const pipelineManifest = ${JSON.stringify(JSON.parse(readFileSync(join(consumer, 'node_modules', 'planr-pipeline', 'package.json'), 'utf8')))};`,
      `const playwrightEntry = ${JSON.stringify(playwrightEntry)};`,
      'function pipelineTarget(specifier) {',
      "  const subpath = specifier === 'planr-pipeline' ? '.' : `./${specifier.slice('planr-pipeline/'.length)}`;",
      '  let target = pipelineManifest.exports?.[subpath];',
      '  if (target === undefined) {',
      '    const pattern = Object.entries(pipelineManifest.exports ?? {}).find(([key]) => {',
      "      const star = key.indexOf('*');",
      '      return star >= 0 && subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1));',
      '    });',
      '    if (pattern) {',
      '      const [key, value] = pattern;',
      "      const star = key.indexOf('*');",
      '      const match = subpath.slice(star, subpath.length - (key.length - star - 1));',
      "      target = typeof value === 'string' ? value.replace('*', match) : value;",
      '    }',
      '  }',
      "  const selected = typeof target === 'string' ? target : target?.import ?? target?.default;",
      "  if (typeof selected !== 'string' || !selected.startsWith('./')) throw new Error(`Packed pipeline does not export ${specifier} for import.`);",
      '  return new URL(selected, pathToFileURL(`${pipelineRoot}/`)).href;',
      '}',
      'export async function resolve(specifier, context, nextResolve) {',
      "  if (specifier === 'planr-pipeline' || specifier.startsWith('planr-pipeline/')) {",
      '    return { url: pipelineTarget(specifier), shortCircuit: true };',
      '  }',
      "  if (specifier === '@playwright/test') {",
      '    return nextResolve(specifier, { ...context, parentURL: playwrightEntry });',
      '  }',
      '  return nextResolve(specifier, context);',
      '}',
      '',
    ].join('\n'),
  );
  return hookPath;
}

function playwrightCli() {
  const candidate = resolve(
    process.env.OPENPLANR_PLAYWRIGHT_CLI ??
      join(installedPackageRoot('@playwright/test'), 'cli.js'),
  );
  if (!existsSync(candidate)) {
    throw new Error('Playwright is not installed. Run npm ci before dashboard browser QA.');
  }
  return candidate;
}

/**
 * Let the Playwright process start an isolated, strict fixture. The reservation has a small
 * unavoidable hand-off race, but reuseExistingServer=false makes that race fail closed rather
 * than silently testing an unrelated listener.
 */
function reserveFixturePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string' || address.port === 4173) {
        server.close(() =>
          reject(new Error('Could not reserve an isolated dashboard fixture port.')),
        );
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

let temporaryRoot;
try {
  const compileOnly = process.argv.includes('--compile-only');
  const playwrightArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== '--compile-only');
  temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-browser-custody-'));
  const packed = installPackedPipeline(temporaryRoot);
  preservePackedPipelineArchive(packed.archivePath);
  const environment = {
    ...process.env,
    OPENPLANR_PACKED_PIPELINE_ROOT: packed.packageRoot,
    OPENPLANR_PACKED_PIPELINE_SOURCE_ROOT: packed.sourceRoot,
  };
  let playwrightCliPath;
  if (!compileOnly) {
    playwrightCliPath = playwrightCli();
    const resolverPath = writePackageResolver(temporaryRoot, packed.consumer, playwrightCliPath);
    const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim();
    environment.NODE_OPTIONS = [inheritedNodeOptions, `--experimental-loader=${resolverPath}`]
      .filter(Boolean)
      .join(' ');
    environment.OPENPLANR_DASHBOARD_FIXTURE_PORT = String(await reserveFixturePort());
    environment.OPENPLANR_DASHBOARD_FIXTURE_REQUIRE_ISOLATION = '1';
  }
  const packedTypecheck = writePackedTypecheckConfig(temporaryRoot, packed.packageRoot);
  runChecked(
    process.execPath,
    [join(installedPackageRoot('typescript'), 'bin', 'tsc'), '-p', packedTypecheck],
    environment,
    'Packed-candidate dashboard typecheck',
  );
  runChecked('npm', ['run', 'build:dashboard'], environment, 'Packed-candidate dashboard build');
  if (!compileOnly) {
    const args = [
      playwrightCliPath,
      'test',
      'tests/e2e/dashboard-visual-regression.test.ts',
      '--config',
      'playwright.config.ts',
      ...playwrightArguments,
    ];
    runChecked(process.execPath, args, environment, 'Packed-candidate Playwright');
  }
} catch (error) {
  console.error(
    `Dashboard browser QA could not run: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 2;
} finally {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
