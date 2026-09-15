#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDashboardAssets } from '../../packages/cli/lib/dashboard-verifier.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DASHBOARD_APP_OUTPUT = resolve(workspaceRoot, 'apps/dashboard/dist');
export const CLI_DASHBOARD_OUTPUT = resolve(workspaceRoot, 'packages/cli/dist/dashboard');

function safeRelativePath(root, candidate) {
  const value = relative(root, candidate);
  if (
    value === ''
    || value === '..'
    || value.startsWith(`..${sep}`)
    || isAbsolute(value)
  ) {
    throw new Error(`Dashboard asset path escapes custody root: ${candidate}`);
  }
  return value;
}

export function assertDashboardPathWithin(root, candidate) {
  return safeRelativePath(resolve(root), resolve(candidate));
}

function assertFixedOutput(candidate, expected, label) {
  if (resolve(candidate) !== expected) {
    throw new Error(`${label} must remain at ${expected}.`);
  }
}

function assertRealDirectory(directory, label) {
  if (!existsSync(directory)) throw new Error(`${label} is missing: ${directory}`);
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be one real directory.`);
  }
  if (realpathSync(directory) !== directory) {
    throw new Error(`${label} must not traverse a symbolic-link parent.`);
  }
}

function inventory(directory, current = directory) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const absolute = join(current, entry.name);
    const metadata = lstatSync(absolute);
    const path = safeRelativePath(directory, absolute).split(sep).join('/');
    if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
      throw new Error(`Dashboard asset custody refuses symbolic links: ${path}`);
    }
    if (entry.isDirectory() && metadata.isDirectory()) files.push(...inventory(directory, absolute));
    else if (entry.isFile() && metadata.isFile()) files.push(Object.freeze({ path, absolute }));
    else throw new Error(`Dashboard asset custody accepts regular files only: ${path}`);
  }
  return files;
}

export function dashboardAssetInventory(directory) {
  const root = resolve(directory);
  assertRealDirectory(root, 'Dashboard asset root');
  return Object.freeze(inventory(root).map(({ path, absolute }) => Object.freeze({ path, absolute })));
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function inventoryDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = readFileSync(file.absolute);
    hash.update(file.path).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function verifiedInventory(directory, label) {
  assertRealDirectory(directory, label);
  const report = verifyDashboardAssets(directory);
  if (!report.ok) {
    throw new Error(`${label} failed dashboard verification:\n${report.violations.join('\n')}`);
  }
  const files = inventory(directory);
  return Object.freeze({
    buildId: report.buildId,
    assetManifestHash: report.assetManifestHash,
    digest: inventoryDigest(files),
    files,
  });
}

/** Verify one dashboard output tree and expose only its stable custody summary. */
export function checkDashboardAssetOutput(directory, label = 'Dashboard output') {
  const custody = verifiedInventory(resolve(directory), label);
  return Object.freeze({
    ok: true,
    mode: 'check',
    buildId: custody.buildId,
    inventoryDigest: custody.digest,
    files: custody.files.length,
  });
}

function assertEqualCustody(source, destination) {
  if (source.buildId !== destination.buildId) {
    throw new Error('Dashboard build identifiers do not match.');
  }
  if (source.files.length !== destination.files.length) {
    throw new Error('Dashboard output file counts do not match.');
  }
  for (let index = 0; index < source.files.length; index += 1) {
    const left = source.files[index];
    const right = destination.files[index];
    if (left.path !== right.path || digest(readFileSync(left.absolute)) !== digest(readFileSync(right.absolute))) {
      throw new Error(`CLI dashboard copy drifted at ${left.path}.`);
    }
  }
  if (
    source.assetManifestHash !== destination.assetManifestHash
    || source.digest !== destination.digest
  ) {
    throw new Error('Dashboard custody metadata does not match.');
  }
}

/** Compare two real dashboard output trees without mutating either tree. */
export function checkDashboardAssetParity({ source, destination }) {
  const sourceRoot = resolve(source);
  const destinationRoot = resolve(destination);
  const sourceCustody = verifiedInventory(sourceRoot, 'Dashboard source output');
  const destinationCustody = verifiedInventory(destinationRoot, 'Dashboard destination output');
  assertEqualCustody(sourceCustody, destinationCustody);
  return Object.freeze({
    ok: true,
    mode: 'check',
    buildId: sourceCustody.buildId,
    inventoryDigest: sourceCustody.digest,
    files: sourceCustody.files.length,
  });
}

export function checkDashboardAssetCopy({
  source = DASHBOARD_APP_OUTPUT,
  destination = CLI_DASHBOARD_OUTPUT,
} = {}) {
  assertFixedOutput(source, DASHBOARD_APP_OUTPUT, 'Dashboard app output');
  assertFixedOutput(destination, CLI_DASHBOARD_OUTPUT, 'CLI dashboard output');
  return checkDashboardAssetParity({ source, destination });
}

export function copyDashboardAssets({
  source = DASHBOARD_APP_OUTPUT,
  destination = CLI_DASHBOARD_OUTPUT,
} = {}) {
  assertFixedOutput(source, DASHBOARD_APP_OUTPUT, 'Dashboard app output');
  assertFixedOutput(destination, CLI_DASHBOARD_OUTPUT, 'CLI dashboard output');
  const sourceCustody = verifiedInventory(source, 'Dashboard app output');
  const cliDist = resolve(workspaceRoot, 'packages/cli/dist');
  mkdirSync(cliDist, { recursive: true });
  assertRealDirectory(cliDist, 'CLI dist output');
  safeRelativePath(cliDist, destination);

  const staging = resolve(cliDist, `.dashboard-copy-${process.pid}-${randomBytes(6).toString('hex')}`);
  safeRelativePath(cliDist, staging);
  mkdirSync(staging);
  try {
    for (const file of sourceCustody.files) {
      const target = resolve(staging, file.path);
      safeRelativePath(staging, target);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file.absolute, target);
    }
    const stagedCustody = verifiedInventory(staging, 'Staged CLI dashboard output');
    assertEqualCustody(sourceCustody, stagedCustody);
    if (existsSync(destination)) {
      if (lstatSync(destination).isSymbolicLink()) {
        throw new Error('CLI dashboard destination must not be a symbolic link.');
      }
      inventory(destination);
      rmSync(destination, { recursive: true, force: false });
    }
    renameSync(staging, destination);
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
  return Object.freeze({ ...checkDashboardAssetCopy(), mode: 'copy' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv.includes('--check') ? checkDashboardAssetCopy() : copyDashboardAssets();
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
