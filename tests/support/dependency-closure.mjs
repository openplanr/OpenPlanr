import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse } from 'node:path';

/** Resolve an installed package at the same dependency boundary as its consumer. */
export function resolveInstalledDependencyRoot(packageName, { from } = {}) {
  const require = createRequire(from);
  let entryPath;
  try {
    entryPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error.code !== 'MODULE_NOT_FOUND')
      throw error;
    entryPath = require.resolve(packageName);
  }
  let currentDirectory = dirname(entryPath);
  const filesystemRoot = parse(currentDirectory).root;
  while (currentDirectory !== filesystemRoot) {
    const manifestPath = join(currentDirectory, 'package.json');
    if (
      existsSync(manifestPath) &&
      JSON.parse(readFileSync(manifestPath, 'utf8')).name === packageName
    )
      return currentDirectory;
    currentDirectory = dirname(currentDirectory);
  }
  throw new Error(`Unable to resolve the installed root for ${packageName}.`);
}

/** Package real runtime dependencies and required peers; optional peers stay optional. */
export function installedDependencyClosure(packageNames, { from } = {}) {
  const packages = new Map();
  const visit = (name, consumer) => {
    const root = resolveInstalledDependencyRoot(name, { from: consumer });
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const previous = packages.get(name);
    if (previous) {
      if (previous.version !== manifest.version)
        throw new Error(`Dependency fixture cannot flatten conflicting versions of ${name}.`);
      return;
    }
    packages.set(name, { name, root, version: manifest.version });
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      visit(dependency, join(root, 'package.json'));
    for (const peer of Object.keys(manifest.peerDependencies ?? {}))
      if (!manifest.peerDependenciesMeta?.[peer]?.optional) visit(peer, join(root, 'package.json'));
  };
  for (const name of packageNames) visit(name, from);
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
}
