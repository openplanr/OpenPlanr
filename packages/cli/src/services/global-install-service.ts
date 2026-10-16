import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One `openplanr` command found on PATH and the package it runs. */
export interface OpenPlanrOnPath {
  command: string;
  packageRoot: string;
  version: string | null;
}

/** The directory holding the running CLI's `package.json`. */
export function runningPackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, '../..'), path.resolve(here, '../../..')]) {
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`No OpenPlanr package.json found above ${here}.`);
}

/** The `version` in `<packageRoot>/package.json`, read from disk on every call. */
export function readPackageVersion(packageRoot: string): string {
  const file = path.join(packageRoot, 'package.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error(`${file} has no version.`);
  }
  return parsed.version;
}

/**
 * The npm prefix whose global folder holds `packageRoot`, or undefined when the
 * package is not at `<folder>/node_modules/openplanr`.
 * POSIX global installs live under `<prefix>/lib/node_modules`; Windows uses `<prefix>/node_modules`.
 */
export function npmPrefixOf(packageRoot: string): string | undefined {
  if (path.basename(packageRoot) !== 'openplanr') return undefined;
  const folder = path.dirname(packageRoot);
  if (path.basename(folder) !== 'node_modules') return undefined;
  const parent = path.dirname(folder);
  return process.platform !== 'win32' && path.basename(parent) === 'lib'
    ? path.dirname(parent)
    : parent;
}

/** Whether two paths name the same directory, following symlinks when they exist. */
export function samePath(left: string, right: string): boolean {
  const resolve = (value: string) =>
    existsSync(value) ? realpathSync(value) : path.resolve(value);
  return resolve(left) === resolve(right);
}

/**
 * Every distinct OpenPlanr package an `openplanr` command on PATH runs, in PATH order.
 * Windows npm shims are `.cmd` files beside `<prefix>/node_modules`; POSIX shims are symlinks.
 */
export function openPlanrOnPath(env: NodeJS.ProcessEnv = process.env): OpenPlanrOnPath[] {
  const windows = process.platform === 'win32';
  const found: OpenPlanrOnPath[] = [];
  for (const directory of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    const command = path.join(directory, windows ? 'openplanr.cmd' : 'openplanr');
    if (!existsSync(command)) continue;
    const packageRoot = windows
      ? path.join(directory, 'node_modules', 'openplanr')
      : path.dirname(path.dirname(realpathSync(command)));
    if (found.some((entry) => samePath(entry.packageRoot, packageRoot))) continue;
    const manifest = path.join(packageRoot, 'package.json');
    found.push({
      command,
      packageRoot,
      version: existsSync(manifest) ? readPackageVersion(packageRoot) : null,
    });
  }
  return found;
}
