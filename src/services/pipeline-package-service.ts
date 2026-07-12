import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export interface PipelinePackage {
  root: string;
  version: string;
  binPath: string;
  adapterRegistryPath: string;
  roleRegistryPath: string;
}

function candidateRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    process.env.OPENPLANR_PIPELINE_ROOT,
    path.resolve(here, '../../../planr-pipeline'),
    path.resolve(process.cwd(), '../planr-pipeline'),
  ].filter((value): value is string => Boolean(value));

  try {
    const entry = require.resolve('@openplanr/pipeline');
    roots.unshift(path.resolve(path.dirname(entry), '../..'));
  } catch {
    // Optional dependency may be omitted by the minimal installer.
  }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function resolvePipelinePackage(required = true): PipelinePackage | null {
  for (const root of candidateRoots()) {
    const packagePath = path.join(root, 'package.json');
    const binPath = path.join(root, 'bin', 'planr-pipeline.mjs');
    const adapterRegistryPath = path.join(root, 'registry', 'adapters.json');
    const roleRegistryPath = path.join(root, 'registry', 'roles.json');
    if (![packagePath, binPath, adapterRegistryPath, roleRegistryPath].every(existsSync)) continue;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return {
      root,
      version: pkg.version ?? '0.0.0',
      binPath,
      adapterRegistryPath,
      roleRegistryPath,
    };
  }

  if (!required) return null;
  const error = new Error(
    'The pipeline package is not installed. Run `npm install -g openplanr@latest` or rerun setup without `--minimal`.',
  );
  error.name = 'E_PIPELINE_NOT_INSTALLED';
  throw error;
}
