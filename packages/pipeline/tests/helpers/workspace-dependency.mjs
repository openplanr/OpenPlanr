import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse } from 'node:path';

const pipelinePackageManifest = new URL('../../package.json', import.meta.url);

export function resolveWorkspaceDependencyRoot(
  packageName,
  { from = pipelinePackageManifest } = {},
) {
  const packageRequire = createRequire(from);
  let currentDirectory = dirname(packageRequire.resolve(packageName));
  const filesystemRoot = parse(currentDirectory).root;

  while (currentDirectory !== filesystemRoot) {
    const manifestPath = join(currentDirectory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) {
        return currentDirectory;
      }
    }
    currentDirectory = dirname(currentDirectory);
  }

  throw new Error(`Unable to resolve the installed root for ${packageName}.`);
}
