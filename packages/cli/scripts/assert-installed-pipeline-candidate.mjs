#!/usr/bin/env node

import { createRequire } from 'node:module';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(`Installed pipeline candidate custody failed: ${message}`);
}

function assertNoSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
      fail(`candidate package contains a symbolic link: ${absolute}`);
    }
    if (entry.isDirectory()) assertNoSymlinks(absolute);
  }
}

const archiveArgument = process.argv[2];
if (!archiveArgument) fail('a candidate tarball path is required');
const archivePath = resolve(repositoryRoot, archiveArgument);
if (!existsSync(archivePath) || !lstatSync(archivePath).isFile()) {
  fail(`candidate tarball is not a regular file: ${archivePath}`);
}
if (lstatSync(archivePath).isSymbolicLink()) fail('candidate tarball must not be a symbolic link');

const installedPath = resolve(repositoryRoot, 'node_modules', 'planr-pipeline');
if (!existsSync(installedPath) || !lstatSync(installedPath).isDirectory()) {
  fail('node_modules/planr-pipeline is not an installed directory');
}
if (lstatSync(installedPath).isSymbolicLink()) fail('installed candidate must not be a symbolic link');

const resolvedInstalledPath = realpathSync(installedPath);
const expectedInstalledPath = join(realpathSync(join(repositoryRoot, 'node_modules')), 'planr-pipeline');
if (resolvedInstalledPath !== expectedInstalledPath) {
  fail(`resolved outside the exact installed package path: ${resolvedInstalledPath}`);
}

for (const sourcePath of [
  resolve(repositoryRoot, '..', 'planr-pipeline'),
  resolve(repositoryRoot, '.ci', 'planr-pipeline'),
  resolve(repositoryRoot, '.ci', 'planr-pipeline-candidate'),
]) {
  if (existsSync(sourcePath) && resolvedInstalledPath === realpathSync(sourcePath)) {
    fail(`resolved back to source checkout: ${sourcePath}`);
  }
}

assertNoSymlinks(resolvedInstalledPath);
const manifestPath = join(resolvedInstalledPath, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.name !== 'planr-pipeline') fail('installed manifest is not planr-pipeline');

const require = createRequire(join(repositoryRoot, 'package.json'));
if (realpathSync(require.resolve('planr-pipeline/package.json')) !== realpathSync(manifestPath)) {
  fail('Node does not resolve planr-pipeline to the asserted installed candidate');
}

const candidateRuntimePath = realpathSync(
  require.resolve(
    'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs',
  ),
);
const candidateRuntimeRelative = relative(resolvedInstalledPath, candidateRuntimePath);
if (candidateRuntimeRelative.startsWith('..') || isAbsolute(candidateRuntimeRelative)) {
  fail(`candidate-only v1.2 runtime resolved outside the installed package: ${candidateRuntimePath}`);
}
const candidateRuntime = await import(pathToFileURL(candidateRuntimePath).href);
if (typeof candidateRuntime.assertOperateExperienceDisplaySurfaceV1 !== 'function') {
  fail('candidate-only v1.2 runtime export is unavailable');
}

process.stdout.write(`installed pipeline candidate verified: ${resolvedInstalledPath}\n`);
