import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { planrHome, userHome } from '../../../lib/planr-home.mjs';

function canonicalPath(directory: string): string {
  const resolved = path.resolve(directory);
  let existing = resolved;
  while (!existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  return path.join(realpathSync(existing), path.relative(existing, resolved));
}

/** Uses the native profile selected by the caller, without inspecting other accounts. */
export function effectiveCodexHome(): string {
  const defaultHome = path.resolve(userHome(), '.codex');
  const selected = process.env.CODEX_HOME?.trim();
  if (!selected || canonicalPath(selected) === canonicalPath(defaultHome)) return defaultHome;
  return canonicalPath(selected);
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalProjectPath(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  try {
    return realpathSync(resolved);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
    throw cause;
  }
}

export function projectKey(projectDir: string): string {
  return hash(canonicalProjectPath(projectDir)).slice(0, 16);
}

/** Canonical native homes select only Codex ownership, never another agent's state. */
export function codexProfileKey(): string | undefined {
  const selected = effectiveCodexHome();
  const defaultHome = path.resolve(userHome(), '.codex');
  return selected === defaultHome ? undefined : hash(selected).slice(0, 16);
}

export function runtimeRoot(): string {
  return path.join(planrHome(), 'runtime');
}

export function codexRuntimeRoot(nativeHome = effectiveCodexHome()): string {
  const defaultHome = path.resolve(userHome(), '.codex');
  return nativeHome === defaultHome
    ? runtimeRoot()
    : path.join(runtimeRoot(), 'profiles', `codex-${hash(nativeHome).slice(0, 16)}`);
}

export function codexBookkeepingTarget(target: string, nativeHome: string): boolean {
  const root = codexRuntimeRoot(nativeHome);
  return pathIsWithin(target, root) && !pathIsWithin(target, path.join(root, 'profiles'));
}

export function statePath(): string {
  return path.join(runtimeRoot(), 'state.json');
}

export function codexSkillsRoot(): string {
  return path.join(effectiveCodexHome(), 'skills');
}

/** Explicit OpenPlanr homes may be outside the native user's home; custody starts at their real existing boundary. */
export function planrCustodyAnchor(): string {
  const configured = path.resolve(planrHome());
  if (pathIsWithin(configured, userHome())) return userHome();
  let boundary = configured;
  while (!existsSync(boundary) && path.dirname(boundary) !== boundary)
    boundary = path.dirname(boundary);
  return boundary;
}

export function backupsRoot(): string {
  return path.join(planrHome(), 'backups');
}

export function projectBackupsRoot(projectDir: string): string {
  return path.join(backupsRoot(), projectKey(projectDir));
}

export function pathIsWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export { planrHome, userHome } from '../../../lib/planr-home.mjs';
