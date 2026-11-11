import { accessSync, constants, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const HOST_EXECUTABLES = ['agent', 'claude', 'codex', 'cursor', 'cursor-agent', 'gh'];
const linkedDirectories = new Map<string, string>();

function hasHost(directory: string): boolean {
  return HOST_EXECUTABLES.some((name) => {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Links every entry of `directory` except the host CLIs into the isolated test home. */
function withoutHosts(directory: string): string {
  const linked = linkedDirectories.get(directory);
  if (linked) return linked;
  const home = process.env.OPENPLANR_TEST_ISOLATED_HOME;
  if (!home) throw new Error(`hostlessPath needs the isolated test home to filter ${directory}`);
  const target = mkdtempSync(join(home, 'hostless-path-'));
  for (const name of readdirSync(directory))
    if (!HOST_EXECUTABLES.includes(name)) symlinkSync(join(directory, name), join(target, name));
  linkedDirectories.set(directory, target);
  return target;
}

/**
 * Returns `path` with the host CLIs hidden, so discovery sees none installed.
 * A directory holding one is replaced by links to its other entries: on Linux, gh shares /usr/bin with git.
 */
export function hostlessPath(path = process.env.PATH ?? ''): string {
  return path
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => (hasHost(directory) ? withoutHosts(directory) : directory))
    .join(delimiter);
}
