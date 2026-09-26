#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseLedgerRowsFromProofs } from '../lib/ecosystem/release-ledger.mjs';
import {
  bindPackageProofToEcosystemCandidate,
  createEcosystemCandidateProof,
  createPackagePayloadProof,
  runInstalledExportProbes,
} from '../lib/ecosystem/release-package-proof.mjs';
import { discoverEcosystemRepositories } from '../lib/ecosystem/workspace-discovery.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRequire = createRequire(join(root, 'package.json'));
const args = new Set(process.argv.slice(2));
const supported = new Set(['--ecosystem', '--json']);
const unknown = [...args].filter((arg) => !supported.has(arg));

function reportFailure(message) {
  if (args.has('--json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          error: { code: 'E_RELEASE_PACKAGE_PROOF', message },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(`Release package proof failed: ${message}\n`);
  }
  process.exitCode = 1;
}

if (unknown.length > 0) {
  reportFailure(`unknown option ${unknown[0]}`);
} else {
  verifyReleasePackage();
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`)
      .trim()
      .split(/\r?\n/u)
      .at(-1);
    throw new Error(`required package command failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function npmCommand() {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefix: [process.env.npm_execpath] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] };
}

function pack(destination, cache) {
  const npm = npmCommand();
  const stdout = run(
    npm.command,
    [...npm.prefix, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    {
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_cache: cache,
      },
    },
  );
  const reports = JSON.parse(stdout);
  if (!Array.isArray(reports) || reports.length !== 1)
    throw new Error('npm pack returned an invalid report.');
  return reports[0];
}

function installedPackageRoot(packageName) {
  let currentDirectory = dirname(packageRequire.resolve(packageName));
  const filesystemRoot = parse(currentDirectory).root;
  while (currentDirectory !== filesystemRoot) {
    const manifestPath = join(currentDirectory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) return currentDirectory;
    }
    currentDirectory = dirname(currentDirectory);
  }
  throw new Error(`installed release-proof dependency is unavailable: ${packageName}`);
}

function packRuntimeDependencies(packageJson, destination, cache) {
  const pending = Object.keys(packageJson.dependencies ?? {});
  const localDependencies = {};
  while (pending.length > 0) {
    const dependency = pending.shift();
    if (localDependencies[dependency]) continue;
    const dependencyRoot = installedPackageRoot(dependency);
    const dependencyManifest = JSON.parse(
      readFileSync(join(dependencyRoot, 'package.json'), 'utf8'),
    );
    const npm = npmCommand();
    const reports = JSON.parse(
      run(
        npm.command,
        [...npm.prefix, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination],
        {
          cwd: dependencyRoot,
          env: {
            ...process.env,
            npm_config_audit: 'false',
            npm_config_fund: 'false',
            npm_config_cache: cache,
          },
        },
      ),
    );
    if (!Array.isArray(reports) || reports.length !== 1) {
      throw new Error(`npm pack returned an invalid dependency report for ${dependency}.`);
    }
    localDependencies[dependency] = `file:${join(destination, reports[0].filename)}`;
    pending.push(...Object.keys(dependencyManifest.dependencies ?? {}));
  }
  return localDependencies;
}

function cleanInstallEnvironment(home, cache) {
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_cache: cache,
  };
  for (const key of [
    'OPENPLANR_PIPELINE_ROOT',
    'OPENPLANR_ECOSYSTEM_SOURCE',
    'OPENPLANR_PIPELINE_TARBALL',
    'OPENPLANR_VERIFIER_SOURCE_ROOT',
    'PLANR_PIPELINE_ROOT',
    'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT',
  ])
    delete environment[key];
  return environment;
}

function verifyReleasePackage() {
  const temp = mkdtempSync(join(tmpdir(), 'planr-release-package-proof-'));
  try {
    const firstDirectory = join(temp, 'first');
    const secondDirectory = join(temp, 'second');
    const extracted = join(temp, 'extracted');
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });
    mkdirSync(extracted, { recursive: true });

    const firstPack = pack(firstDirectory, join(temp, 'npm-cache'));
    const secondPack = pack(secondDirectory, join(temp, 'npm-cache'));
    const firstArchive = join(firstDirectory, firstPack.filename);
    const secondArchive = join(secondDirectory, secondPack.filename);
    run('tar', ['-xzf', firstArchive, '-C', extracted]);

    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const packageProof = createPackagePayloadProof({
      packageJson,
      sourceRoot: root,
      extractedPackageRoot: join(extracted, 'package'),
      firstPack,
      secondPack,
      firstArchiveBytes: readFileSync(firstArchive),
      secondArchiveBytes: readFileSync(secondArchive),
    });
    const consumerRoot = join(temp, 'consumer');
    const consumerHome = join(temp, 'consumer-home');
    const dependencyRoot = join(temp, 'dependencies');
    mkdirSync(consumerRoot, { recursive: true });
    mkdirSync(consumerHome, { recursive: true });
    mkdirSync(dependencyRoot, { recursive: true });
    const localDependencies = packRuntimeDependencies(
      packageJson,
      dependencyRoot,
      join(temp, 'npm-cache'),
    );
    writeFileSync(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'pipeline-release-proof',
          private: true,
          dependencies: localDependencies,
        },
        null,
        2,
      )}\n`,
    );
    const installEnvironment = cleanInstallEnvironment(consumerHome, join(temp, 'npm-cache'));
    const npm = npmCommand();
    run(
      npm.command,
      [
        ...npm.prefix,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-save',
        '--no-package-lock',
        '--omit=optional',
        '--offline',
        firstArchive,
      ],
      { cwd: consumerRoot, env: installEnvironment },
    );
    const installedRoot = join(consumerRoot, 'node_modules', packageJson.name);
    const installedStat = lstatSync(installedRoot);
    if (
      !installedStat.isDirectory() ||
      installedStat.isSymbolicLink() ||
      realpathSync(installedRoot) !==
        realpathSync(join(consumerRoot, 'node_modules', packageJson.name))
    ) {
      throw new Error('installed pipeline candidate is not a real consumer-owned directory');
    }
    packageProof.installedExports = runInstalledExportProbes({
      packageName: packageJson.name,
      exportsField: packageJson.exports,
      archiveFiles: firstPack.files.map(({ path }) => path),
      installedPackageRoot: installedRoot,
      consumerRoot,
      environment: installEnvironment,
    });

    let ecosystemProof = null;
    let packageCandidateBinding = null;
    let ledgerBinding = null;
    if (args.has('--ecosystem')) {
      const discovered = discoverEcosystemRepositories({
        pipelineRoot: root,
        workspaceRoot: resolve(root, '..'),
      });
      const repositories = Object.fromEntries(
        Object.entries(discovered.repositories).map(([key, repository]) => [
          key,
          repository && {
            ...repository,
            label:
              key === 'pipeline'
                ? 'planr-pipeline'
                : key === 'cli'
                  ? 'OpenPlanr'
                  : key === 'web'
                    ? 'openplanr-web'
                    : key,
          },
        ]),
      );
      ecosystemProof = createEcosystemCandidateProof({ repositories });
      packageCandidateBinding = bindPackageProofToEcosystemCandidate({
        packageProof,
        ecosystemProof,
      });
      // Compatibility is bound to these proven bytes here rather than derived a
      // second time from version prose. Every repository the proof cannot cover
      // stays a named absence.
      const declaredPackages = Object.fromEntries(
        Object.entries(discovered.repositories).map(([key, repository]) => {
          const manifestPath = repository && join(repository.path, 'package.json');
          if (!manifestPath) return [key, null];
          try {
            const declared = JSON.parse(readFileSync(manifestPath, 'utf8'));
            return [key, { name: declared.name, version: declared.version }];
          } catch {
            return [key, null];
          }
        }),
      );
      ledgerBinding = releaseLedgerRowsFromProofs({
        ecosystemProof,
        packageProof,
        packages: declaredPackages,
      });
    }

    const proof = {
      ok: true,
      package: packageProof,
      ...(ecosystemProof ? { ecosystem: ecosystemProof } : {}),
      ...(packageCandidateBinding ? { packageCandidateBinding } : {}),
      ...(ledgerBinding ? { ledgerBinding } : {}),
    };
    if (args.has('--json')) {
      process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Release package proof: PASS (${packageProof.archive.entryCount} files, ` +
          `${packageProof.exports.length} export targets, ` +
          `${packageProof.installedExports.runtime} runtime exports loaded, ` +
          `${packageProof.documentation.length} documentation links, ` +
          `${packageProof.archive.digest})\n`,
      );
      if (ecosystemProof) {
        process.stdout.write(
          `Five-repository candidate: PASS (${ecosystemProof.candidateDigest})\n`,
        );
      }
      if (ledgerBinding) {
        process.stdout.write(
          `Release ledger binding: ${ledgerBinding.rows.length} digest-bound row(s), ` +
            `${ledgerBinding.absences.length} unproven input(s)\n`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportFailure(message);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
